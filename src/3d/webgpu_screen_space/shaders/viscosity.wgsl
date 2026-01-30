/**
 * ============================================================================
 * SPH VISCOSITY FORCE SHADER
 * ============================================================================
 *
 * Pipeline Stage: Stage 7 (Third SPH physics pass)
 * Entry Point: main
 * Workgroup Size: 256 threads
 *
 * Purpose:
 * --------
 * Applies viscous damping to smooth out velocity differences between
 * neighboring particles. This simulates the fluid's internal friction
 * (resistance to shearing motion).
 *
 * Physical Interpretation:
 * ------------------------
 * Viscosity represents a fluid's "thickness":
 *   - High viscosity: Honey, tar, lava (resists flow)
 *   - Low viscosity: Water, alcohol (flows easily)
 *
 * In SPH, viscosity force pulls particle velocities toward the local average:
 *
 *   F_viscosity = μ × Σⱼ (vⱼ - vᵢ) × W(rᵢⱼ)
 *
 * Where:
 *   μ = viscosity coefficient
 *   vᵢ, vⱼ = velocities of particles i and j
 *   W = smoothing kernel
 *
 * Effect:
 *   - If neighbor is faster → positive force (speed up)
 *   - If neighbor is slower → negative force (slow down)
 *   - Net effect: Velocities converge to local average
 *
 * Poly6 Kernel:
 * -------------
 * We use the Poly6 kernel for viscosity because:
 *   1. It's always positive (no sign changes)
 *   2. Smooth everywhere (no discontinuities)
 *   3. Maximum at center (strongest influence from closest particles)
 *
 *    W(r, h) = (h² - r²)³ × scale
 *
 *         Kernel Shape:
 *         ▲
 *         │●
 *         │ ╲
 *         │  ╲
 *         │   ╲
 *         │    ╲____
 *         └─────────●──▶ r
 *         0         h
 *
 * Numerical Stability:
 * --------------------
 * Viscosity provides important numerical damping:
 *   - Prevents velocity oscillations
 *   - Stabilizes pressure solver
 *   - Reduces "jitter" in the simulation
 *
 * Without viscosity, small numerical errors can amplify and cause instability.
 *
 * ============================================================================
 */

/**
 * Viscosity Parameters Uniform Buffer
 *
 * Memory Layout (16-byte aligned):
 * Offset  Size  Field
 * ------  ----  -----
 *   0      4    dt                 - Timestep for velocity integration
 *   4      4    viscosityStrength  - Viscosity coefficient μ
 *   8      4    radius             - Smoothing radius h
 *  12      4    poly6Scale         - Normalization constant for Poly6 kernel
 *  16      4    particleCountF     - Particle count as float
 *  20     12    pad0               - Padding for 32-byte alignment
 * ------
 * Total: 32 bytes
 */
struct ViscosityParams {
  dt: f32,
  viscosityStrength: f32,
  radius: f32,
  poly6Scale: f32,
  particleCountF: f32,
  pad0: vec3<f32>,
};

// ============================================================================
// BUFFER BINDINGS
// ============================================================================
// Group 0: Viscosity compute pass
//
//   Binding 0: predicted[]      - Particle positions for neighbor search
//   Binding 1: velocities[]     - Velocities (read-write, updated with viscosity)
//   Binding 2: sortedKeys[]     - For neighbor iteration
//   Binding 3: spatialOffsets[] - For cell lookup
//   Binding 4: params           - Viscosity parameters
// ============================================================================

@group(0) @binding(0) var<storage, read> predicted: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> velocities: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> sortedKeys: array<u32>;
@group(0) @binding(3) var<storage, read> spatialOffsets: array<u32>;
@group(0) @binding(4) var<uniform> params: ViscosityParams;

/**
 * Spatial hash function - must match hash.wgsl
 */
fn hashCell3D(cellX: i32, cellY: i32, cellZ: i32) -> u32 {
    let blockSize = 50u;
    let ucell = vec3<u32>(
        u32(cellX + i32(blockSize / 2u)),
        u32(cellY + i32(blockSize / 2u)),
        u32(cellZ + i32(blockSize / 2u))
    );
    let localCell = ucell % blockSize;
    let blockID = ucell / blockSize;
    let blockHash = blockID.x * 15823u + blockID.y * 9737333u + blockID.z * 440817757u;
    return localCell.x + blockSize * (localCell.y + blockSize * localCell.z) + blockHash;
}

/**
 * Poly6 Smoothing Kernel
 *
 * W(r, h) = (h² - r²)³ × scale
 *
 * Properties:
 * - Maximum at r = 0 (strongest weight for closest neighbors)
 * - Smoothly decays to 0 at r = h
 * - First derivative is 0 at r = 0 (smooth at center)
 * - Compact support: W = 0 for r ≥ h
 *
 * Why Poly6 for viscosity?
 * - Symmetric and smooth
 * - Doesn't favor any direction
 * - Provides stable, isotropic damping
 *
 * @param dst    Distance to neighbor
 * @param radius Smoothing radius h
 * @param scale  Normalization constant = 315 / (64 × π × h⁹) in 3D
 * @returns      Kernel value W(dst)
 */
fn smoothingKernelPoly6(dst: f32, radius: f32, scale: f32) -> f32 {
  if (dst < radius) {
    let v = radius * radius - dst * dst;  // (h² - r²)
    return v * v * v * scale;             // (h² - r²)³ × scale
  }
  return 0.0;
}

/**
 * Main Viscosity Compute Kernel
 *
 * Smooths velocity differences between neighboring particles.
 *
 * Dispatch: ceil(particleCount / 256) workgroups
 *
 * The viscosity force causes particles to adopt the weighted average
 * velocity of their neighbors, creating a smooth velocity field.
 */
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  let count = u32(params.particleCountF + 0.5);

  // Bounds check
  if (i >= count) {
    return;
  }

  // Get position and current velocity
  let pos = predicted[i].xyz;
  let vel = velocities[i].xyz;

  // Cell coordinates for neighbor search
  let originCellX = i32(floor(pos.x / params.radius));
  let originCellY = i32(floor(pos.y / params.radius));
  let originCellZ = i32(floor(pos.z / params.radius));
  let radiusSq = params.radius * params.radius;

  // Accumulate velocity adjustment from neighbors
  var force = vec3<f32>(0.0, 0.0, 0.0);

  // ========================================================================
  // NEIGHBOR SEARCH: Same 3x3x3 pattern as density/pressure
  // ========================================================================
  for (var z = -1; z <= 1; z = z + 1) {
    for (var y = -1; y <= 1; y = y + 1) {
      for (var x = -1; x <= 1; x = x + 1) {
        let cellX = originCellX + x;
        let cellY = originCellY + y;
        let cellZ = originCellZ + z;

        let hash = hashCell3D(cellX, cellY, cellZ);
        let key = hash % count;
        let start = spatialOffsets[key];

        if (start == count) { continue; }

        var j = start;
        loop {
            if (j >= count || sortedKeys[j] != key) { break; }
            let neighborIndex = j;

            // Skip self (a particle doesn't apply viscosity to itself)
            if (neighborIndex != i) {
                let neighborPos = predicted[neighborIndex].xyz;
                let offset = neighborPos - pos;
                let dstSq = dot(offset, offset);

                if (dstSq <= radiusSq) {
                    let dst = sqrt(dstSq);

                    // Compute kernel weight for this neighbor
                    let weight = smoothingKernelPoly6(dst, params.radius, params.poly6Scale);

                    // Get neighbor's velocity
                    let neighborVel = velocities[neighborIndex].xyz;

                    // ========================================================
                    // VISCOSITY FORCE CALCULATION
                    // ========================================================
                    // force += (v_neighbor - v_self) × weight
                    //
                    // This pulls our velocity toward the neighbor's velocity.
                    // The amount of pull is proportional to the kernel weight
                    // (closer neighbors have more influence).
                    //
                    // Summing over all neighbors effectively computes a
                    // weighted average velocity that we blend toward.
                    force = force + (neighborVel - vel) * weight;
                }
            }
            j = j + 1u;
        }
      }
    }
  }

  // ========================================================================
  // UPDATE VELOCITY
  // ========================================================================
  // Apply viscosity: v_new = v_old + force × strength × dt
  //
  // Higher viscosityStrength = more damping = thicker fluid
  // Lower viscosityStrength = less damping = thinner fluid
  velocities[i] = vec4<f32>(velocities[i].xyz + force * params.viscosityStrength * params.dt, 0.0);
}
