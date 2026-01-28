/**
 * ============================================================================
 * SPH PRESSURE FORCE SHADER
 * ============================================================================
 *
 * Pipeline Stage: Stage 6 (Second SPH physics pass)
 * Entry Point: main
 * Workgroup Size: 256 threads
 *
 * Purpose:
 * --------
 * Computes pressure forces that push particles from high-density regions toward
 * low-density regions. This is the primary force maintaining fluid incompressibility.
 *
 * Physics Background:
 * -------------------
 * In real fluids, pressure is related to density through an Equation of State.
 * For weakly compressible SPH, we use a simplified linear relationship:
 *
 *   P = k × (ρ - ρ₀)
 *
 * Where:
 *   P  = pressure
 *   k  = pressure stiffness coefficient (pressureMultiplier)
 *   ρ  = current density
 *   ρ₀ = target/rest density
 *
 * When ρ > ρ₀: Positive pressure (expansion force)
 * When ρ < ρ₀: Negative pressure (compression force)
 * When ρ = ρ₀: Zero pressure (at rest)
 *
 * SPH Pressure Force Formula:
 * ---------------------------
 * The pressure force on particle i is:
 *
 *   Fᵢ = -Σⱼ mⱼ × ((Pᵢ + Pⱼ) / 2) × (1/ρⱼ) × ∇W(rᵢⱼ)
 *
 * Where:
 *   (Pᵢ + Pⱼ) / 2 = symmetric pressure (ensures Newton's 3rd law)
 *   ∇W = gradient of the smoothing kernel
 *   rᵢⱼ = distance from i to j
 *
 * The gradient points from i to j, so the force pushes i away from j
 * when pressure is positive (high density).
 *
 * Kernel Gradient (Spiky):
 * ------------------------
 * For the Spiky kernel W(r) = (h-r)² × scale:
 *
 *   ∇W(r) = -2 × (h-r) × scale × (direction)
 *
 * The derivative is negative (pointing inward), but combined with the
 * negative sign in the force formula, creates an outward push.
 *
 * Dual Pressure System:
 * ---------------------
 * We compute two types of pressure forces:
 *
 *   1. Standard Pressure (pow2 kernel):
 *      - Long-range incompressibility
 *      - Maintains overall fluid volume
 *
 *   2. Near-Pressure (pow3 kernel):
 *      - Short-range repulsion
 *      - Prevents particle clustering
 *      - Creates surface tension effect
 *
 * The near-pressure uses a sharper kernel that activates strongly only
 * when particles are very close together.
 *
 * Symmetric Pressure Averaging:
 * -----------------------------
 * Using (Pᵢ + Pⱼ) / 2 instead of just Pᵢ ensures:
 *   - Force on i from j equals force on j from i (Newton's 3rd law)
 *   - Momentum is conserved exactly
 *   - No artificial rotation or translation of the fluid body
 *
 * ============================================================================
 */

/**
 * Pressure Parameters Uniform Buffer
 *
 * Memory Layout (16-byte aligned):
 * Offset  Size  Field
 * ------  ----  -----
 *   0      4    dt                       - Timestep for velocity integration
 *   4      4    targetDensity            - Rest density ρ₀
 *   8      4    pressureMultiplier       - Stiffness k for standard pressure
 *  12      4    nearPressureMultiplier   - Stiffness for near-pressure
 *  16      4    radius                   - Smoothing radius h
 *  20      4    spikyPow2DerivScale      - Gradient normalization for pow2 kernel
 *  24      4    spikyPow3DerivScale      - Gradient normalization for pow3 kernel
 *  28      4    particleCountF           - Particle count as float
 *  32     16    pad0                     - Padding for 48-byte alignment
 * ------
 * Total: 48 bytes
 */
struct PressureParams {
  dt: f32,
  targetDensity: f32,
  pressureMultiplier: f32,
  nearPressureMultiplier: f32,
  radius: f32,
  spikyPow2DerivScale: f32,
  spikyPow3DerivScale: f32,
  particleCountF: f32,
  pad0: vec4<f32>,
};

// ============================================================================
// BUFFER BINDINGS
// ============================================================================
// Group 0: Pressure compute pass
//
//   Binding 0: predicted[]      - Predicted positions (for neighbor distance)
//   Binding 1: velocities[]     - Velocities (read-write, updated with pressure force)
//   Binding 2: densities[]      - Computed densities from Stage 5 (read-only)
//              vec2: x = density, y = near-density
//   Binding 3: sortedKeys[]     - For neighbor iteration termination
//   Binding 4: spatialOffsets[] - For cell lookup
//   Binding 5: params           - Pressure parameters
// ============================================================================

@group(0) @binding(0) var<storage, read> predicted: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> velocities: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> densities: array<vec2<f32>>;
@group(0) @binding(3) var<storage, read> sortedKeys: array<u32>;
@group(0) @binding(4) var<storage, read> spatialOffsets: array<u32>;
@group(0) @binding(5) var<uniform> params: PressureParams;

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
 * Gradient of Spiky Kernel (pow2)
 *
 * For W(r) = (h-r)² × scale:
 *   dW/dr = -2 × (h-r) × scale
 *
 * The derivative is negative, indicating the kernel decreases with distance.
 * This is incorporated into the pressure force formula.
 *
 * @param dst    Distance to neighbor
 * @param radius Smoothing radius h
 * @param scale  Precomputed gradient normalization
 * @returns      Scalar derivative dW/dr (negative)
 */
fn derivativeSpikyPow2(dst: f32, radius: f32, scale: f32) -> f32 {
  if (dst <= radius) {
    let v = radius - dst;
    return -v * scale;  // Negative: kernel decreases outward
  }
  return 0.0;
}

/**
 * Gradient of Spiky Kernel (pow3)
 *
 * For W(r) = (h-r)³ × scale:
 *   dW/dr = -3 × (h-r)² × scale
 *
 * Steeper gradient than pow2, creating stronger forces at close range.
 *
 * @param dst    Distance to neighbor
 * @param radius Smoothing radius h
 * @param scale  Precomputed gradient normalization
 * @returns      Scalar derivative dW/dr (negative)
 */
fn derivativeSpikyPow3(dst: f32, radius: f32, scale: f32) -> f32 {
  if (dst <= radius) {
    let v = radius - dst;
    return -v * v * scale;  // Negative: kernel decreases outward
  }
  return 0.0;
}

/**
 * Main Pressure Force Compute Kernel
 *
 * Computes pressure forces and updates velocities.
 *
 * Dispatch: ceil(particleCount / 256) workgroups
 *
 * Algorithm:
 * 1. Calculate this particle's pressure from its density
 * 2. For each neighbor:
 *    a. Calculate neighbor's pressure
 *    b. Compute symmetric (averaged) pressure
 *    c. Compute kernel gradient in the direction of neighbor
 *    d. Add force contribution
 * 3. Convert force to acceleration (F/density for unit mass)
 * 4. Update velocity
 */
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  let count = u32(params.particleCountF + 0.5);

  // Bounds check
  if (i >= count) {
    return;
  }

  // Load this particle's densities
  let densityPair = densities[i];
  let density = densityPair.x;
  let nearDensity = densityPair.y;

  // Skip particles with zero density (shouldn't happen, but safety check)
  // This prevents division by zero in the acceleration calculation
  if (density <= 0.0) {
    return;
  }

  // ========================================================================
  // EQUATION OF STATE: Compute pressure from density
  // ========================================================================
  // Linear equation of state: P = k × (ρ - ρ₀)
  //
  // - ρ > ρ₀: Positive pressure → particles pushed apart
  // - ρ < ρ₀: Negative pressure → particles pulled together
  // - ρ = ρ₀: Zero pressure → at rest density
  //
  // pressureMultiplier (k) controls how "stiff" the fluid is.
  // Higher k = less compressible = more like water
  // Lower k = more compressible = more like foam
  let pressure = (density - params.targetDensity) * params.pressureMultiplier;

  // Near-pressure: Always positive (repulsive only)
  // Doesn't use target density because it only prevents clustering
  let nearPressure = params.nearPressureMultiplier * nearDensity;

  // Get position and cell coordinates
  let pos = predicted[i].xyz;
  let originCellX = i32(floor(pos.x / params.radius));
  let originCellY = i32(floor(pos.y / params.radius));
  let originCellZ = i32(floor(pos.z / params.radius));
  let radiusSq = params.radius * params.radius;

  // Accumulate force from all neighbors
  var force = vec3<f32>(0.0, 0.0, 0.0);

  // ========================================================================
  // NEIGHBOR SEARCH: Same 3x3x3 pattern as density calculation
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

            // Skip self-interaction (a particle doesn't exert force on itself)
            if (neighborIndex != i) {
                let neighborPos = predicted[neighborIndex].xyz;
                let offset = neighborPos - pos;  // Vector FROM this particle TO neighbor
                let dstSq = dot(offset, offset);

                if (dstSq <= radiusSq) {
                    let dst = sqrt(dstSq);

                    // Compute unit direction vector toward neighbor
                    // select(a, b, cond) returns b if cond is true, a otherwise
                    // This handles the case when dst = 0 (particles at same position)
                    let invDst = select(0.0, 1.0 / dst, dst > 0.0);
                    let dir = offset * invDst;  // Unit vector toward neighbor

                    // Load neighbor's densities
                    let neighborDensityPair = densities[neighborIndex];
                    let neighborDensity = neighborDensityPair.x;
                    let neighborNearDensity = neighborDensityPair.y;

                    // Compute neighbor's pressures using same equation of state
                    let neighborPressure = (neighborDensity - params.targetDensity) * params.pressureMultiplier;
                    let neighborNearPressure = params.nearPressureMultiplier * neighborNearDensity;

                    // ============================================================
                    // SYMMETRIC PRESSURE AVERAGING
                    // ============================================================
                    // Using (Pᵢ + Pⱼ) / 2 ensures:
                    //   - Force on i from j = -Force on j from i
                    //   - Newton's 3rd law is satisfied
                    //   - Momentum is conserved
                    let sharedPressure = (pressure + neighborPressure) * 0.5;
                    let sharedNearPressure = (nearPressure + neighborNearPressure) * 0.5;

                    // ============================================================
                    // STANDARD PRESSURE FORCE
                    // ============================================================
                    // F = -(P_shared / ρ_neighbor) × ∇W
                    //
                    // Division by neighbor density comes from SPH formulation
                    // (mass is assumed to be proportional to density)
                    if (neighborDensity > 0.0) {
                        let scale = derivativeSpikyPow2(dst, params.radius, params.spikyPow2DerivScale) * (sharedPressure / neighborDensity);
                        force = force + dir * scale;
                    }

                    // ============================================================
                    // NEAR-PRESSURE FORCE (Anti-clustering)
                    // ============================================================
                    // Same formula, but uses the pow3 kernel gradient
                    // Stronger effect at very close range
                    if (neighborNearDensity > 0.0) {
                        let scale = derivativeSpikyPow3(dst, params.radius, params.spikyPow3DerivScale) * (sharedNearPressure / neighborNearDensity);
                        force = force + dir * scale;
                    }
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
  // Newton's 2nd law: F = m × a  →  a = F / m
  //
  // With unit mass per particle, effective mass is proportional to density.
  // This gives us: a = F / ρ
  //
  // Then: v_new = v_old + a × dt
  let accel = force / density;
  velocities[i] = vec4<f32>(velocities[i].xyz + accel * params.dt, 0.0);
}
