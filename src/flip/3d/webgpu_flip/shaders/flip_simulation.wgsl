// =============================================================================
// FLIP (Fluid-Implicit-Particle) Simulation - WebGPU Compute Kernels
// =============================================================================
//
// This file implements a 3D incompressible fluid solver using the FLIP method,
// a hybrid Lagrangian-Eulerian approach introduced by Brackbill & Ruppel (1986)
// and refined for graphics by Zhu & Bridson (2005).
//
// =============================================================================
// ALGORITHM OVERVIEW
// =============================================================================
//
// FLIP combines two complementary representations:
//
//   1. PARTICLES (Lagrangian): Carry fluid mass and momentum through space.
//      - Advantages: No numerical diffusion, preserves vorticity, handles
//        free surfaces and splashes naturally.
//      - Stored in: `positions[]`, `velocities[]`
//
//   2. GRID (Eulerian): A fixed 3D MAC (Marker-And-Cell) grid used to enforce
//      the incompressibility constraint (divergence-free velocity field).
//      - Advantages: Easy to solve pressure Poisson equation, simple boundary
//        conditions, efficient neighbor queries.
//      - Stored in: `gridVel[]`, `pressure[]`, `marker[]`
//
// =============================================================================
// PER-FRAME SIMULATION LOOP (12 steps)
// =============================================================================
//
//   1. clearGrid        - Zero all grid arrays
//   2. transferToGrid   - Particle-to-Grid (P2G): splat particle velocity/mass
//   3. markCells        - Flag cells containing fluid particles
//   4. normalizeGrid    - Convert weighted sums to average velocities
//   5. addGravity       - Apply external forces (gravity, mouse interaction)
//   6. enforceBoundary  - Set wall velocities to zero (free-slip BC)
//   7. computeDivergence- Calculate velocity divergence per cell
//   8. jacobi (x50)     - Iteratively solve pressure Poisson equation
//   9. applyPressure    - Subtract pressure gradient to make field divergence-free
//  10. enforceBoundary  - Re-apply boundary conditions after projection
//  11. gridToParticle   - Grid-to-Particle (G2P): blend PIC and FLIP updates
//  12. advect           - Move particles through the velocity field (RK2)
//
// =============================================================================
// MAC GRID STAGGERING
// =============================================================================
//
// The MAC grid stores velocity components at face centers, not cell centers:
//
//        +-------+-------+
//       /|      /|      /|
//      / |  Vz / |  Vz / |     Vz: stored on xy-faces (z = integer)
//     +-------+-------+  |
//     |  |    |  |    |  |
//  Vx |  +----|-Vy----|-Vy     Vy: stored on xz-faces (y = integer)
//     | /     | /     | /
//     |/   Vz |/   Vz |/       Vx: stored on yz-faces (x = integer)
//     +-------+-------+
//        Vx      Vx
//
// This staggering:
//   - Prevents checkerboard pressure instabilities
//   - Makes divergence computation natural (finite differences align with faces)
//   - Requires offset interpolation for each velocity component
//
// =============================================================================
// PIC vs FLIP BLENDING
// =============================================================================
//
// The method blends two velocity update strategies:
//
//   PIC (Particle-In-Cell): vNew = gridVel
//     - Very stable but over-dissipates energy
//     - Results in "viscous" looking fluid
//
//   FLIP (Fluid-Implicit-Particle): vNew = vOld + (gridVelNew - gridVelOld)
//     - Preserves kinetic energy and vorticity
//     - Can become unstable/noisy with too many particles per cell
//
//   Final: vNew = mix(vPIC, vFLIP, fluidity)
//     - fluidity = 0.0: pure PIC (stable, viscous)
//     - fluidity = 0.99: nearly pure FLIP (energetic, may have noise)
//
// =============================================================================
// IMPLEMENTATION NOTES
// =============================================================================
//
// - Atomic integers are used for P2G accumulation to handle race conditions
//   when multiple particles contribute to the same grid node. Values are
//   scaled by SCALE=10000 for fixed-point precision.
//
// - `gridVelOrig` snapshots the velocity field after normalization but before
//   pressure projection. This is needed for the FLIP delta: (vNew - vOld).
//
// - The pressure solve uses Jacobi iteration (50 iterations per frame).
//   This is simple to parallelize but converges slowly. Production code
//   might use multigrid or conjugate gradient solvers.
//
// - A density-correction term in the divergence helps prevent particle
//   clustering in high-density regions.

// =============================================================================
// Uniform Block - Simulation Parameters (112 bytes, updated each frame)
// =============================================================================
struct Uniforms {
  // Grid resolution: number of cells along each axis.
  // Velocity grid is (nx+1) x (ny+1) x (nz+1) due to MAC staggering.
  nx: u32, ny: u32, nz: u32,

  // Total number of active particles this frame.
  particleCount: u32,

  // World-space dimensions of the simulation container.
  width: f32, height: f32, depth: f32,

  // Timestep (typically 1/60 second for real-time).
  dt: f32,

  // Frame counter, used to offset random sampling for turbulence.
  frameNumber: f32,

  // PIC/FLIP blend factor: 0.0 = pure PIC, 1.0 = pure FLIP.
  // Typical values: 0.95-0.99 for lively fluid with some stability.
  fluidity: f32,

  // Gravity magnitude (applied downward along -Y).
  gravity: f32,

  // Target particle density per cell. Used for density-correction pressure.
  particleDensity: f32,

  // Mouse interaction: world-space velocity imparted to nearby fluid.
  mouseVelocity: vec3<f32>, _pad4: f32,

  // Mouse ray for interaction (origin + direction in world space).
  mouseRayOrigin: vec3<f32>, _pad5: f32,
  mouseRayDirection: vec3<f32>, _pad6: f32,
};

// =============================================================================
// Buffer Bindings
// =============================================================================

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

// Particle state buffers (Lagrangian representation)
// positions.xyz = world position, w = unused
// velocities.xyz = velocity vector, w = unused
@group(0) @binding(1) var<storage, read_write> positions: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> velocities: array<vec4<f32>>;

// =============================================================================
// Atomic Accumulation Buffers (for race-free P2G transfer)
// =============================================================================
// During P2G, many particles may contribute to the same grid node simultaneously.
// We use atomic integers to accumulate weighted sums without data races.
// Values are scaled by SCALE to preserve precision in fixed-point representation.
struct AtomicCell { x: atomic<i32>, y: atomic<i32>, z: atomic<i32>, w: atomic<i32> };
@group(0) @binding(3) var<storage, read_write> gridVelAtomic: array<AtomicCell>;  // Weighted velocity sum
@group(0) @binding(4) var<storage, read_write> gridWeightAtomic: array<AtomicCell>; // Weight sum

// =============================================================================
// Grid State Buffers (Eulerian representation)
// =============================================================================
// gridVel: Current velocity field (after normalization and forces).
//   .xyz = staggered velocity components (Vx on yz-face, Vy on xz-face, Vz on xy-face)
//   .w = accumulated scalar weight (used for density estimation)
@group(0) @binding(5) var<storage, read_write> gridVel: array<vec4<f32>>;

// gridVelOrig: Snapshot of grid velocity BEFORE pressure projection.
// Required for FLIP update: delta = gridVelNew - gridVelOrig
@group(0) @binding(6) var<storage, read_write> gridVelOrig: array<vec4<f32>>;

// marker: Cell occupancy flags. 0 = air (empty), 1 = fluid (contains particles).
// Pressure is only solved in fluid cells.
@group(0) @binding(7) var<storage, read_write> marker: array<u32>;

// Pressure and divergence for incompressibility projection.
// divergence = ∇·v (velocity divergence, should become zero)
// pressure = scalar field whose gradient makes velocity divergence-free
@group(0) @binding(8) var<storage, read_write> pressure: array<f32>;
@group(0) @binding(9) var<storage, read_write> divergence: array<f32>;

// Pre-computed random unit vectors for turbulent noise during advection.
@group(0) @binding(10) var<storage, read> randomDirs: array<vec4<f32>>;

// =============================================================================
// Constants
// =============================================================================

// Fixed-point scale factor for atomic accumulation.
// Atomic operations only work on integers, so we multiply floats by SCALE,
// accumulate as integers, then divide by SCALE after normalization.
const SCALE: f32 = 10000.0;

// Magnitude of random turbulent perturbation added during advection.
// Keeps motion lively and prevents particle stacking.
const TURBULENCE: f32 = 0.05;

// Radius of mouse interaction force field (in grid units).
const MOUSE_RADIUS: f32 = 5.0;

// =============================================================================
// INDEX HELPER FUNCTIONS
// =============================================================================
// The simulation uses two grid indexing schemes:
//
// 1. Velocity grid: (nx+1) x (ny+1) x (nz+1) nodes
//    - One extra node per axis for MAC staggering
//    - Used for velocity components at face centers
//
// 2. Scalar grid: nx x ny x nz cells
//    - Used for pressure, divergence, and cell markers
//    - Values live at cell centers
// =============================================================================

/// Convert 3D velocity grid coordinates to linear buffer index.
/// The velocity grid has dimensions (nx+1) x (ny+1) x (nz+1).
/// Coordinates are clamped to valid range to handle boundary lookups safely.
fn velIdx(x: u32, y: u32, z: u32) -> u32 {
  let cx = clamp(x, 0u, uniforms.nx);
  let cy = clamp(y, 0u, uniforms.ny);
  let cz = clamp(z, 0u, uniforms.nz);
  // Row-major layout: x varies fastest, then y, then z
  return cx + cy * (uniforms.nx + 1u) + cz * (uniforms.nx + 1u) * (uniforms.ny + 1u);
}

/// Convert 3D scalar grid coordinates to linear buffer index.
/// The scalar grid has dimensions nx x ny x nz (cell-centered quantities).
/// Used for pressure, divergence, and marker arrays.
fn scalarIdx(x: u32, y: u32, z: u32) -> u32 {
  let cx = clamp(x, 0u, uniforms.nx - 1u);
  let cy = clamp(y, 0u, uniforms.ny - 1u);
  let cz = clamp(z, 0u, uniforms.nz - 1u);
  return cx + cy * uniforms.nx + cz * uniforms.nx * uniforms.ny;
}

/// Transform world-space position to grid-space coordinates.
/// Grid space: [0, nx] x [0, ny] x [0, nz]
/// This is the fractional cell position used for interpolation.
fn worldToGrid(p: vec3<f32>) -> vec3<f32> {
  return vec3<f32>(
    p.x / uniforms.width * f32(uniforms.nx),
    p.y / uniforms.height * f32(uniforms.ny),
    p.z / uniforms.depth * f32(uniforms.nz)
  );
}

// =============================================================================
// INTERPOLATION KERNEL FUNCTIONS
// =============================================================================
// The interpolation kernel determines how particles spread their influence
// to nearby grid nodes (P2G) and how grid velocities are sampled at arbitrary
// positions (G2P and advection).
//
// We use a separable trilinear (tent) kernel, which is the standard choice
// for FLIP/PIC methods. Each component uses a 1D hat function:
//
//         1.0  ___
//             /   \
//            /     \
//     ______/       \______
//         -1   0   +1
//
// The 3D kernel is the product: K(dx, dy, dz) = h(dx) * h(dy) * h(dz)
// This gives bilinear interpolation within each grid cell.
// =============================================================================

/// 1D tent (hat) kernel function.
/// Returns linear falloff from 1 at r=0 to 0 at |r|=1.
/// Zero outside [-1, 1].
fn h(r: f32) -> f32 {
  if (r >= 0.0 && r <= 1.0) { return 1.0 - r; }
  else if (r >= -1.0 && r < 0.0) { return 1.0 + r; }
  return 0.0;
}

/// 3D separable tent kernel for trilinear interpolation.
/// v = offset vector from grid node to particle (in grid units).
/// Returns weight in range [0, 1], used for both P2G and G2P.
fn kernel(v: vec3<f32>) -> f32 {
  return h(v.x) * h(v.y) * h(v.z);
}

/// Smooth falloff kernel for mouse interaction force.
/// Returns 1.0 near the mouse ray, falling to 0.0 at MOUSE_RADIUS distance.
/// Uses smoothstep for C1 continuity (no sudden force discontinuities).
fn mouseKernel(gridPosition: vec3<f32>) -> f32 {
  // Convert grid position back to world space
  let worldPosition = gridPosition / vec3<f32>(f32(uniforms.nx), f32(uniforms.ny), f32(uniforms.nz)) *
                     vec3<f32>(uniforms.width, uniforms.height, uniforms.depth);

  // Compute perpendicular distance from point to mouse ray
  // Using: d = |cross(rayDir, toPoint)| / |rayDir| (rayDir is unit length)
  let toOrigin = worldPosition - uniforms.mouseRayOrigin;
  let distanceToMouseRay = length(cross(uniforms.mouseRayDirection, toOrigin));
  let normalizedDistance = max(0.0, distanceToMouseRay / MOUSE_RADIUS);

  // Smoothstep gives C1 falloff from 1 (at center) to 0 (at radius)
  return smoothstep(1.0, 0.9, normalizedDistance);
}

// =============================================================================
// STEP 1: CLEAR GRID
// =============================================================================
// Reset all grid buffers to zero at the start of each frame.
// This prepares for fresh P2G accumulation.
//
// Workgroup size: (8, 4, 4) = 128 threads
// Dispatch: ceil((nx+1)/8) x ceil((ny+1)/4) x ceil((nz+1)/4) workgroups
// =============================================================================

@compute @workgroup_size(8, 4, 4)
fn clearGrid(@builtin(global_invocation_id) id: vec3<u32>) {
  // Clear velocity grid (includes boundary nodes due to <= comparison)
  if (id.x <= uniforms.nx && id.y <= uniforms.ny && id.z <= uniforms.nz) {
    let vi = velIdx(id.x, id.y, id.z);

    // Reset atomic accumulators (used in P2G for race-free summation)
    atomicStore(&gridVelAtomic[vi].x, 0);
    atomicStore(&gridVelAtomic[vi].y, 0);
    atomicStore(&gridVelAtomic[vi].z, 0);
    atomicStore(&gridVelAtomic[vi].w, 0);
    atomicStore(&gridWeightAtomic[vi].x, 0);
    atomicStore(&gridWeightAtomic[vi].y, 0);
    atomicStore(&gridWeightAtomic[vi].z, 0);
    atomicStore(&gridWeightAtomic[vi].w, 0);

    // Reset float velocity buffers
    gridVel[vi] = vec4<f32>(0.0);
    gridVelOrig[vi] = vec4<f32>(0.0);
  }

  // Clear scalar grid (cell-centered quantities)
  if (id.x < uniforms.nx && id.y < uniforms.ny && id.z < uniforms.nz) {
    let si = scalarIdx(id.x, id.y, id.z);
    marker[si] = 0u;       // 0 = air, will be set to 1 by markCells if particles present
    pressure[si] = 0.0;    // Initial pressure guess (warm starting could improve convergence)
    divergence[si] = 0.0;  // Will be computed in computeDivergence
  }
}

// =============================================================================
// STEP 2: PARTICLE TO GRID (P2G) - Transfer momentum from particles to grid
// =============================================================================
// This is the heart of the Lagrangian-to-Eulerian transfer in FLIP/PIC.
//
// Each particle "splats" its velocity to the 8 surrounding grid nodes using
// trilinear interpolation weights. The weighted sum is accumulated atomically
// since many particles may contribute to the same node.
//
// KEY CONCEPT - MAC Staggering:
// Unlike a collocated grid where all velocity components live at the same
// position, MAC grids store each component at face centers:
//
//   Vx: stored at yz-face center (x = integer, y+0.5, z+0.5)
//   Vy: stored at xz-face center (x+0.5, y = integer, z+0.5)
//   Vz: stored at xy-face center (x+0.5, y+0.5, z = integer)
//
// This means each velocity component uses DIFFERENT interpolation offsets!
// The kernel weight for Vx is computed from distance to (i, j+0.5, k+0.5),
// not from distance to (i, j, k).
//
// Workgroup size: 64 threads (1D dispatch)
// Dispatch: ceil(particleCount / 64) workgroups
// =============================================================================

@compute @workgroup_size(64)
fn transferToGrid(@builtin(global_invocation_id) id: vec3<u32>) {
  let pIdx = id.x;
  if (pIdx >= uniforms.particleCount) { return; }

  // Load particle state
  let pos = positions[pIdx].xyz;  // World-space position
  let vel = velocities[pIdx].xyz; // Velocity to transfer
  let g = worldToGrid(pos);       // Grid-space position (fractional)

  // Find base cell (lower-left-back corner of 2x2x2 neighborhood)
  let baseX = i32(floor(g.x));
  let baseY = i32(floor(g.y));
  let baseZ = i32(floor(g.z));

  // Loop over 2x2x2 neighborhood of grid nodes
  for (var di = 0; di <= 1; di++) {
    for (var dj = 0; dj <= 1; dj++) {
      for (var dk = 0; dk <= 1; dk++) {
        let cellX = u32(max(0, baseX + di));
        let cellY = u32(max(0, baseY + dj));
        let cellZ = u32(max(0, baseZ + dk));

        // Skip out-of-bounds nodes
        if (cellX > uniforms.nx || cellY > uniforms.ny || cellZ > uniforms.nz) {
          continue;
        }

        let cellIdx = velIdx(cellX, cellY, cellZ);

        // =================================================================
        // MAC Staggered Sample Positions:
        // Each velocity component lives at a different position within
        // the grid cell. We compute separate weights for each.
        // =================================================================
        // Vx: yz-face center (x=integer, y/z offset by 0.5)
        let xPos = vec3<f32>(f32(cellX), f32(cellY) + 0.5, f32(cellZ) + 0.5);
        // Vy: xz-face center (y=integer, x/z offset by 0.5)
        let yPos = vec3<f32>(f32(cellX) + 0.5, f32(cellY), f32(cellZ) + 0.5);
        // Vz: xy-face center (z=integer, x/y offset by 0.5)
        let zPos = vec3<f32>(f32(cellX) + 0.5, f32(cellY) + 0.5, f32(cellZ));
        // Scalar weight for density estimation (cell center)
        let scalarPos = vec3<f32>(f32(cellX) + 0.5, f32(cellY) + 0.5, f32(cellZ) + 0.5);

        // Compute interpolation weights (tent kernel, range [0,1])
        let xWeight = kernel(g - xPos);
        let yWeight = kernel(g - yPos);
        let zWeight = kernel(g - zPos);
        let scalarWeight = kernel(g - scalarPos);

        // =================================================================
        // Atomic Accumulation:
        // Multiple threads may write to the same grid node. We use atomic
        // adds on scaled integers to avoid race conditions.
        // After all particles are processed, normalizeGrid will divide
        // by the total weight to get average velocity.
        // =================================================================
        atomicAdd(&gridWeightAtomic[cellIdx].x, i32(xWeight * SCALE));
        atomicAdd(&gridWeightAtomic[cellIdx].y, i32(yWeight * SCALE));
        atomicAdd(&gridWeightAtomic[cellIdx].z, i32(zWeight * SCALE));
        atomicAdd(&gridWeightAtomic[cellIdx].w, i32(scalarWeight * SCALE));

        // Accumulate weighted velocity (momentum-like quantity)
        atomicAdd(&gridVelAtomic[cellIdx].x, i32(vel.x * xWeight * SCALE));
        atomicAdd(&gridVelAtomic[cellIdx].y, i32(vel.y * yWeight * SCALE));
        atomicAdd(&gridVelAtomic[cellIdx].z, i32(vel.z * zWeight * SCALE));
      }
    }
  }
}

// =============================================================================
// STEP 3: MARK CELLS - Flag cells containing fluid particles
// =============================================================================
// Cells are marked as either:
//   0 = AIR: no particles, pressure = 0 (Dirichlet boundary)
//   1 = FLUID: contains particles, solve pressure equation here
//
// This classification is essential for the pressure solve: we only need to
// compute pressure in fluid cells, and air cells provide boundary conditions.
//
// Note: This simple scheme doesn't distinguish SOLID cells. Wall boundaries
// are handled separately in enforceBoundary by zeroing wall-normal velocities.
// =============================================================================

@compute @workgroup_size(64)
fn markCells(@builtin(global_invocation_id) id: vec3<u32>) {
  let pIdx = id.x;
  if (pIdx >= uniforms.particleCount) { return; }

  // Find which cell this particle occupies
  let pos = positions[pIdx].xyz;
  let g = worldToGrid(pos);

  let cellX = u32(clamp(i32(floor(g.x)), 0, i32(uniforms.nx) - 1));
  let cellY = u32(clamp(i32(floor(g.y)), 0, i32(uniforms.ny) - 1));
  let cellZ = u32(clamp(i32(floor(g.z)), 0, i32(uniforms.nz) - 1));

  // Mark cell as containing fluid
  // Multiple particles may mark the same cell; that's fine (idempotent)
  let si = scalarIdx(cellX, cellY, cellZ);
  marker[si] = 1u;
}

// =============================================================================
// STEP 4: NORMALIZE GRID - Convert weighted sums to average velocities
// =============================================================================
// After P2G, each grid node contains:
//   gridVelAtomic = Σ(weight_i * velocity_i)  (weighted velocity sum)
//   gridWeightAtomic = Σ(weight_i)            (total weight)
//
// The actual velocity is: v = Σ(w_i * v_i) / Σ(w_i)
//
// This normalization step also:
//   - Converts from fixed-point (integers) back to floating-point
//   - Saves a copy to gridVelOrig for the FLIP update later
//   - Stores scalar weight in .w for density estimation
// =============================================================================

@compute @workgroup_size(8, 4, 4)
fn normalizeGrid(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x > uniforms.nx || id.y > uniforms.ny || id.z > uniforms.nz) { return; }
  let vi = velIdx(id.x, id.y, id.z);

  // Load and descale atomic accumulators
  let wx = f32(atomicLoad(&gridWeightAtomic[vi].x)) / SCALE;
  let wy = f32(atomicLoad(&gridWeightAtomic[vi].y)) / SCALE;
  let wz = f32(atomicLoad(&gridWeightAtomic[vi].z)) / SCALE;
  let ws = f32(atomicLoad(&gridWeightAtomic[vi].w)) / SCALE;

  // Compute normalized (average) velocities per component
  // Zero weight means no particles contributed; velocity stays zero
  var vx = 0.0;
  var vy = 0.0;
  var vz = 0.0;

  if (wx > 0.0) {
    vx = f32(atomicLoad(&gridVelAtomic[vi].x)) / SCALE / wx;
  }
  if (wy > 0.0) {
    vy = f32(atomicLoad(&gridVelAtomic[vi].y)) / SCALE / wy;
  }
  if (wz > 0.0) {
    vz = f32(atomicLoad(&gridVelAtomic[vi].z)) / SCALE / wz;
  }

  // Store normalized velocity (.xyz) and scalar weight (.w for density)
  gridVel[vi] = vec4<f32>(vx, vy, vz, ws);

  // CRITICAL: Save copy BEFORE forces and pressure projection.
  // The FLIP update uses: v_new = v_old + (gridVel_after - gridVelOrig)
  // gridVelOrig captures the "before" state for this delta.
  gridVelOrig[vi] = vec4<f32>(vx, vy, vz, ws);
}

// =============================================================================
// STEP 5: ADD EXTERNAL FORCES (Gravity + Mouse Interaction)
// =============================================================================
// External forces are applied to the grid velocity field using forward Euler:
//   v_new = v_old + acceleration * dt
//
// Two forces are applied:
//   1. Gravity: constant downward acceleration (-Y direction)
//   2. Mouse: radial force field around mouse ray, pushing fluid
//
// Note: Forces are applied AFTER normalization but BEFORE pressure projection.
// This ensures incompressibility is enforced on the final velocity field.
// =============================================================================

@compute @workgroup_size(8, 4, 4)
fn addGravity(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x > uniforms.nx || id.y > uniforms.ny || id.z > uniforms.nz) { return; }
  let vi = velIdx(id.x, id.y, id.z);

  // Apply gravity (acceleration integrated over timestep)
  // Only affects Y-component since gravity is along -Y
  gridVel[vi].y -= uniforms.gravity * uniforms.dt;

  // =================================================================
  // Mouse Interaction Force
  // =================================================================
  // Compute staggered positions for each velocity component
  // (same offsets as in P2G)
  let xPosition = vec3<f32>(f32(id.x), f32(id.y) + 0.5, f32(id.z) + 0.5);
  let yPosition = vec3<f32>(f32(id.x) + 0.5, f32(id.y), f32(id.z) + 0.5);
  let zPosition = vec3<f32>(f32(id.x) + 0.5, f32(id.y) + 0.5, f32(id.z));

  // Get smooth falloff weight from each position to mouse ray
  let kernelX = mouseKernel(xPosition);
  let kernelY = mouseKernel(yPosition);
  let kernelZ = mouseKernel(zPosition);

  // Scale force by timestep for framerate independence
  // smoothstep prevents excessive forces at very small dt
  let forceMultiplier = 3.0 * smoothstep(0.0, 1.0 / 200.0, uniforms.dt);

  // Add mouse velocity impulse (weighted by distance to mouse ray)
  gridVel[vi].x += uniforms.mouseVelocity.x * kernelX * forceMultiplier;
  gridVel[vi].y += uniforms.mouseVelocity.y * kernelY * forceMultiplier;
  gridVel[vi].z += uniforms.mouseVelocity.z * kernelZ * forceMultiplier;
}

// =============================================================================
// STEP 6 & 10: ENFORCE BOUNDARY CONDITIONS
// =============================================================================
// Apply wall boundary conditions to the velocity field.
// This kernel runs TWICE per frame:
//   1. After external forces, before pressure solve
//   2. After pressure projection, before G2P
//
// Boundary Type: FREE-SLIP (no friction, no penetration)
//   - Wall-normal velocity component is set to zero
//   - Wall-tangent components are left unchanged
//
// Special case: TOP WALL (y = ny)
//   - Allows downward flow (min with 0) but blocks upward
//   - This permits fluid to "pour out" the top if desired
//
// Note: No solid obstacles are handled here. Adding solids would require
// checking marker values and zeroing velocities into solid cells.
// =============================================================================

@compute @workgroup_size(8, 4, 4)
fn enforceBoundary(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x > uniforms.nx || id.y > uniforms.ny || id.z > uniforms.nz) { return; }
  let vi = velIdx(id.x, id.y, id.z);

  // Left wall (x = 0): no flow in -X direction
  if (id.x == 0u) { gridVel[vi].x = 0.0; }
  // Right wall (x = nx): no flow in +X direction
  if (id.x == uniforms.nx) { gridVel[vi].x = 0.0; }

  // Bottom wall (y = 0): no flow in -Y direction
  if (id.y == 0u) { gridVel[vi].y = 0.0; }
  // Top wall (y = ny): allow outflow (downward) but block inflow (upward)
  if (id.y == uniforms.ny) { gridVel[vi].y = min(gridVel[vi].y, 0.0); }

  // Back wall (z = 0): no flow in -Z direction
  if (id.z == 0u) { gridVel[vi].z = 0.0; }
  // Front wall (z = nz): no flow in +Z direction
  if (id.z == uniforms.nz) { gridVel[vi].z = 0.0; }
}

// =============================================================================
// STEP 7: COMPUTE DIVERGENCE - Measure how much fluid is "created" per cell
// =============================================================================
// Divergence measures the net outflow of velocity from a cell:
//   ∇·v = ∂vx/∂x + ∂vy/∂y + ∂vz/∂z
//
// For incompressible fluids, divergence must be zero everywhere:
//   ∇·v = 0  (continuity equation)
//
// A positive divergence means the cell is "expanding" (more outflow than inflow).
// A negative divergence means the cell is "compressing" (more inflow than outflow).
//
// The pressure solve will find a pressure field whose gradient, when subtracted
// from velocity, eliminates this divergence.
//
// DENSITY CORRECTION:
// An additional term is subtracted based on local particle density.
// If density > target, this adds "artificial divergence" that pushes
// particles apart, preventing excessive clustering.
// =============================================================================

@compute @workgroup_size(8, 4, 4)
fn computeDivergence(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= uniforms.nx || id.y >= uniforms.ny || id.z >= uniforms.nz) { return; }
  let si = scalarIdx(id.x, id.y, id.z);

  // Air cells have zero divergence (Dirichlet BC: pressure = 0)
  if (marker[si] == 0u) {
    divergence[si] = 0.0;
    return;
  }

  // =================================================================
  // Discrete Divergence Computation
  // =================================================================
  // Due to MAC staggering, velocity components align naturally with
  // cell faces. The divergence is simply the sum of differences:
  //
  //   ∇·v = (Vx_right - Vx_left) + (Vy_top - Vy_bottom) + (Vz_front - Vz_back)
  //
  // This is exact (no interpolation needed) because faces share nodes.
  //
  //      +---Vy_top---+
  //      |           |
  //   Vx_left   •   Vx_right   (• = cell center)
  //      |           |
  //      +--Vy_bottom-+
  // =================================================================

  let leftX = gridVel[velIdx(id.x, id.y, id.z)].x;       // Left face Vx
  let rightX = gridVel[velIdx(id.x + 1u, id.y, id.z)].x;  // Right face Vx
  let bottomY = gridVel[velIdx(id.x, id.y, id.z)].y;      // Bottom face Vy
  let topY = gridVel[velIdx(id.x, id.y + 1u, id.z)].y;    // Top face Vy
  let backZ = gridVel[velIdx(id.x, id.y, id.z)].z;        // Back face Vz
  let frontZ = gridVel[velIdx(id.x, id.y, id.z + 1u)].z;  // Front face Vz

  // Compute discrete divergence (units: 1/time, or velocity/distance)
  var div = (rightX - leftX) + (topY - bottomY) + (frontZ - backZ);

  // =================================================================
  // Density Correction Term
  // =================================================================
  // If particle density exceeds target, add artificial divergence.
  // This creates outward pressure that separates clustered particles.
  // The max() ensures we only push apart, never pull together.
  let density = gridVel[velIdx(id.x, id.y, id.z)].w;
  div -= max((density - uniforms.particleDensity) * 1.0, 0.0);

  divergence[si] = div;
}

// =============================================================================
// STEP 8: JACOBI PRESSURE SOLVE - Make velocity divergence-free
// =============================================================================
// We need to find pressure P such that:
//   ∇²P = ∇·v   (Poisson equation)
//
// Then subtract the pressure gradient from velocity:
//   v_new = v - ∇P
//
// This makes ∇·v_new = 0 (divergence-free, incompressible).
//
// JACOBI ITERATION:
// The discrete Laplacian ∇²P at cell (i,j,k) is:
//   ∇²P ≈ (P_left + P_right + P_bottom + P_top + P_back + P_front - 6*P_center)
//
// Rearranging the Poisson equation:
//   P_center = (P_neighbors - divergence) / 6
//
// Each Jacobi iteration updates all cells simultaneously using values from
// the previous iteration. This is highly parallel but converges slowly.
// We run 50 iterations per frame (could use multigrid for faster convergence).
//
// BOUNDARY CONDITIONS:
// - Air cells (marker=0): pressure = 0 (Dirichlet BC, free surface)
// - Boundary neighbors: implicitly treated as having pressure = 0
// =============================================================================

@compute @workgroup_size(8, 4, 4)
fn jacobi(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= uniforms.nx || id.y >= uniforms.ny || id.z >= uniforms.nz) { return; }
  let si = scalarIdx(id.x, id.y, id.z);

  // Skip air cells - they maintain zero pressure
  if (marker[si] == 0u) { return; }

  let div = divergence[si];

  // Sample 6-connected neighbor pressures
  // Boundary cells use 0 pressure (implicit Dirichlet BC)
  var pL = 0.0;  // Left   (-X)
  var pR = 0.0;  // Right  (+X)
  var pB = 0.0;  // Bottom (-Y)
  var pT = 0.0;  // Top    (+Y)
  var pBk = 0.0; // Back   (-Z)
  var pFr = 0.0; // Front  (+Z)

  if (id.x > 0u) { pL = pressure[scalarIdx(id.x - 1u, id.y, id.z)]; }
  if (id.x < uniforms.nx - 1u) { pR = pressure[scalarIdx(id.x + 1u, id.y, id.z)]; }
  if (id.y > 0u) { pB = pressure[scalarIdx(id.x, id.y - 1u, id.z)]; }
  if (id.y < uniforms.ny - 1u) { pT = pressure[scalarIdx(id.x, id.y + 1u, id.z)]; }
  if (id.z > 0u) { pBk = pressure[scalarIdx(id.x, id.y, id.z - 1u)]; }
  if (id.z < uniforms.nz - 1u) { pFr = pressure[scalarIdx(id.x, id.y, id.z + 1u)]; }

  // Jacobi update: P_new = (sum_of_neighbors - divergence) / 6
  // This is one step toward solving: ∇²P = divergence
  pressure[si] = (pL + pR + pB + pT + pBk + pFr - div) / 6.0;
}

// =============================================================================
// STEP 9: APPLY PRESSURE GRADIENT - Project velocity to divergence-free field
// =============================================================================
// This is the "projection" step that enforces incompressibility.
//
// Given the pressure field P from Jacobi iteration, we subtract its gradient:
//   v_new = v_old - ∇P
//
// Since ∇²P = ∇·v_old, and ∇·(∇P) = ∇²P, we get:
//   ∇·v_new = ∇·v_old - ∇²P = ∇·v_old - ∇·v_old = 0  ✓
//
// The velocity field is now divergence-free (incompressible).
//
// MAC GRID NOTE:
// Each velocity component is co-located with the pressure gradient in that
// direction. This makes the gradient computation exact (no interpolation):
//
//   Vx at face between cells (i-1,j,k) and (i,j,k):
//     ∂P/∂x ≈ P[i,j,k] - P[i-1,j,k]
//
// This perfect alignment is a key benefit of MAC staggering.
// =============================================================================

@compute @workgroup_size(8, 4, 4)
fn applyPressure(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x > uniforms.nx || id.y > uniforms.ny || id.z > uniforms.nz) { return; }
  let vi = velIdx(id.x, id.y, id.z);

  var v = gridVel[vi];

  // =================================================================
  // X-Velocity Update (lives on yz-face at x = id.x)
  // =================================================================
  // The face separates cells (id.x-1, y, z) and (id.x, y, z)
  // Gradient: ∂P/∂x = P_right - P_left
  let pRight = pressure[scalarIdx(id.x, id.y, id.z)];
  let pLeft = pressure[scalarIdx(id.x - 1u, id.y, id.z)];
  v.x -= (pRight - pLeft);

  // =================================================================
  // Y-Velocity Update (lives on xz-face at y = id.y)
  // =================================================================
  // The face separates cells (x, id.y-1, z) and (x, id.y, z)
  // Gradient: ∂P/∂y = P_top - P_bottom
  let pTop = pressure[scalarIdx(id.x, id.y, id.z)];
  let pBottom = pressure[scalarIdx(id.x, id.y - 1u, id.z)];
  v.y -= (pTop - pBottom);

  // =================================================================
  // Z-Velocity Update (lives on xy-face at z = id.z)
  // =================================================================
  // The face separates cells (x, y, id.z-1) and (x, y, id.z)
  // Gradient: ∂P/∂z = P_front - P_back
  let pFront = pressure[scalarIdx(id.x, id.y, id.z)];
  let pBack = pressure[scalarIdx(id.x, id.y, id.z - 1u)];
  v.z -= (pFront - pBack);

  gridVel[vi] = v;
}

// =============================================================================
// STAGGERED VELOCITY SAMPLING FUNCTIONS
// =============================================================================
// These functions sample the MAC grid velocity at arbitrary positions using
// trilinear interpolation. Due to MAC staggering, each component requires
// different offsets:
//
//   Vx is stored at (i, j+0.5, k+0.5) → sample at (g.x, g.y-0.5, g.z-0.5)
//   Vy is stored at (i+0.5, j, k+0.5) → sample at (g.x-0.5, g.y, g.z-0.5)
//   Vz is stored at (i+0.5, j+0.5, k) → sample at (g.x-0.5, g.y-0.5, g.z)
//
// The offset accounts for the fact that values are stored at face centers,
// not node corners. After applying the offset, standard trilinear
// interpolation can be used.
// =============================================================================

/// Sample X-velocity component at grid position g using trilinear interpolation.
/// Applies -0.5 offset to y and z due to MAC staggering of Vx on yz-faces.
fn sampleXVelocity(g: vec3<f32>) -> f32 {
  // Transform to Vx sample space (Vx stored at y+0.5, z+0.5 positions)
  let p = vec3<f32>(g.x, g.y - 0.5, g.z - 0.5);
  let base = vec3<i32>(i32(floor(p.x)), i32(floor(p.y)), i32(floor(p.z)));
  let f = p - vec3<f32>(f32(base.x), f32(base.y), f32(base.z)); // Fractional part

  // Trilinear interpolation over 2x2x2 neighborhood
  var v = 0.0;
  for (var di = 0; di <= 1; di++) {
    for (var dj = 0; dj <= 1; dj++) {
      for (var dk = 0; dk <= 1; dk++) {
        // Trilinear weight = product of 1D lerp weights
        let w = select(1.0 - f.x, f.x, di == 1) *
                select(1.0 - f.y, f.y, dj == 1) *
                select(1.0 - f.z, f.z, dk == 1);
        let ix = u32(clamp(base.x + di, 0, i32(uniforms.nx)));
        let iy = u32(clamp(base.y + dj, 0, i32(uniforms.ny)));
        let iz = u32(clamp(base.z + dk, 0, i32(uniforms.nz)));
        v += gridVel[velIdx(ix, iy, iz)].x * w;
      }
    }
  }
  return v;
}

/// Sample Y-velocity component at grid position g using trilinear interpolation.
/// Applies -0.5 offset to x and z due to MAC staggering of Vy on xz-faces.
fn sampleYVelocity(g: vec3<f32>) -> f32 {
  // Transform to Vy sample space (Vy stored at x+0.5, z+0.5 positions)
  let p = vec3<f32>(g.x - 0.5, g.y, g.z - 0.5);
  let base = vec3<i32>(i32(floor(p.x)), i32(floor(p.y)), i32(floor(p.z)));
  let f = p - vec3<f32>(f32(base.x), f32(base.y), f32(base.z));

  var v = 0.0;
  for (var di = 0; di <= 1; di++) {
    for (var dj = 0; dj <= 1; dj++) {
      for (var dk = 0; dk <= 1; dk++) {
        let w = select(1.0 - f.x, f.x, di == 1) *
                select(1.0 - f.y, f.y, dj == 1) *
                select(1.0 - f.z, f.z, dk == 1);
        let ix = u32(clamp(base.x + di, 0, i32(uniforms.nx)));
        let iy = u32(clamp(base.y + dj, 0, i32(uniforms.ny)));
        let iz = u32(clamp(base.z + dk, 0, i32(uniforms.nz)));
        v += gridVel[velIdx(ix, iy, iz)].y * w;
      }
    }
  }
  return v;
}

/// Sample Z-velocity component at grid position g using trilinear interpolation.
/// Applies -0.5 offset to x and y due to MAC staggering of Vz on xy-faces.
fn sampleZVelocity(g: vec3<f32>) -> f32 {
  // Transform to Vz sample space (Vz stored at x+0.5, y+0.5 positions)
  let p = vec3<f32>(g.x - 0.5, g.y - 0.5, g.z);
  let base = vec3<i32>(i32(floor(p.x)), i32(floor(p.y)), i32(floor(p.z)));
  let f = p - vec3<f32>(f32(base.x), f32(base.y), f32(base.z));

  var v = 0.0;
  for (var di = 0; di <= 1; di++) {
    for (var dj = 0; dj <= 1; dj++) {
      for (var dk = 0; dk <= 1; dk++) {
        let w = select(1.0 - f.x, f.x, di == 1) *
                select(1.0 - f.y, f.y, dj == 1) *
                select(1.0 - f.z, f.z, dk == 1);
        let ix = u32(clamp(base.x + di, 0, i32(uniforms.nx)));
        let iy = u32(clamp(base.y + dj, 0, i32(uniforms.ny)));
        let iz = u32(clamp(base.z + dk, 0, i32(uniforms.nz)));
        v += gridVel[velIdx(ix, iy, iz)].z * w;
      }
    }
  }
  return v;
}

/// Sample full velocity vector at world position p.
/// Combines the three staggered component samples into a single vec3.
fn sampleVelocity(p: vec3<f32>) -> vec3<f32> {
  let g = worldToGrid(p);
  return vec3<f32>(sampleXVelocity(g), sampleYVelocity(g), sampleZVelocity(g));
}

// =============================================================================
// ORIGINAL VELOCITY SAMPLING (for FLIP delta computation)
// =============================================================================
// These functions sample gridVelOrig (the pre-projection snapshot) instead of
// gridVel (post-projection). Used in G2P to compute the FLIP velocity delta:
//   delta = gridVel_new - gridVelOrig
// =============================================================================

/// Sample X-velocity from the ORIGINAL (pre-projection) grid state.
fn sampleXVelocityOrig(g: vec3<f32>) -> f32 {
  let p = vec3<f32>(g.x, g.y - 0.5, g.z - 0.5);
  let base = vec3<i32>(i32(floor(p.x)), i32(floor(p.y)), i32(floor(p.z)));
  let f = p - vec3<f32>(f32(base.x), f32(base.y), f32(base.z));

  var v = 0.0;
  for (var di = 0; di <= 1; di++) {
    for (var dj = 0; dj <= 1; dj++) {
      for (var dk = 0; dk <= 1; dk++) {
        let w = select(1.0 - f.x, f.x, di == 1) *
                select(1.0 - f.y, f.y, dj == 1) *
                select(1.0 - f.z, f.z, dk == 1);
        let ix = u32(clamp(base.x + di, 0, i32(uniforms.nx)));
        let iy = u32(clamp(base.y + dj, 0, i32(uniforms.ny)));
        let iz = u32(clamp(base.z + dk, 0, i32(uniforms.nz)));
        v += gridVelOrig[velIdx(ix, iy, iz)].x * w;  // Note: gridVelOrig, not gridVel
      }
    }
  }
  return v;
}

/// Sample Y-velocity from the ORIGINAL (pre-projection) grid state.
fn sampleYVelocityOrig(g: vec3<f32>) -> f32 {
  let p = vec3<f32>(g.x - 0.5, g.y, g.z - 0.5);
  let base = vec3<i32>(i32(floor(p.x)), i32(floor(p.y)), i32(floor(p.z)));
  let f = p - vec3<f32>(f32(base.x), f32(base.y), f32(base.z));

  var v = 0.0;
  for (var di = 0; di <= 1; di++) {
    for (var dj = 0; dj <= 1; dj++) {
      for (var dk = 0; dk <= 1; dk++) {
        let w = select(1.0 - f.x, f.x, di == 1) *
                select(1.0 - f.y, f.y, dj == 1) *
                select(1.0 - f.z, f.z, dk == 1);
        let ix = u32(clamp(base.x + di, 0, i32(uniforms.nx)));
        let iy = u32(clamp(base.y + dj, 0, i32(uniforms.ny)));
        let iz = u32(clamp(base.z + dk, 0, i32(uniforms.nz)));
        v += gridVelOrig[velIdx(ix, iy, iz)].y * w;
      }
    }
  }
  return v;
}

/// Sample Z-velocity from the ORIGINAL (pre-projection) grid state.
fn sampleZVelocityOrig(g: vec3<f32>) -> f32 {
  let p = vec3<f32>(g.x - 0.5, g.y - 0.5, g.z);
  let base = vec3<i32>(i32(floor(p.x)), i32(floor(p.y)), i32(floor(p.z)));
  let f = p - vec3<f32>(f32(base.x), f32(base.y), f32(base.z));

  var v = 0.0;
  for (var di = 0; di <= 1; di++) {
    for (var dj = 0; dj <= 1; dj++) {
      for (var dk = 0; dk <= 1; dk++) {
        let w = select(1.0 - f.x, f.x, di == 1) *
                select(1.0 - f.y, f.y, dj == 1) *
                select(1.0 - f.z, f.z, dk == 1);
        let ix = u32(clamp(base.x + di, 0, i32(uniforms.nx)));
        let iy = u32(clamp(base.y + dj, 0, i32(uniforms.ny)));
        let iz = u32(clamp(base.z + dk, 0, i32(uniforms.nz)));
        v += gridVelOrig[velIdx(ix, iy, iz)].z * w;
      }
    }
  }
  return v;
}

/// Sample full velocity vector from the ORIGINAL (pre-projection) grid state.
fn sampleVelocityOrig(p: vec3<f32>) -> vec3<f32> {
  let g = worldToGrid(p);
  return vec3<f32>(sampleXVelocityOrig(g), sampleYVelocityOrig(g), sampleZVelocityOrig(g));
}

// =============================================================================
// STEP 11: GRID TO PARTICLE (G2P) - Transfer velocity back to particles
// =============================================================================
// This step transfers the updated grid velocity back to particles.
// Two strategies are blended:
//
// PIC (Particle-In-Cell):
//   v_particle = sampleVelocity(position)
//   - Simply copy grid velocity to particle
//   - Very stable, but causes excessive numerical diffusion
//   - Results in "viscous" fluid that loses energy quickly
//
// FLIP (Fluid-Implicit-Particle):
//   v_particle = v_old + (gridVel_new - gridVel_old)
//   - Add only the CHANGE in grid velocity to particle
//   - Preserves kinetic energy and vorticity
//   - Can become noisy/unstable with too high fluidity
//
// Final velocity = mix(PIC, FLIP, fluidity)
//   - fluidity = 0.0: pure PIC (stable but diffusive)
//   - fluidity = 0.99: nearly pure FLIP (energetic but may be noisy)
//   - Typical values: 0.95 - 0.99
//
// WHY FLIP WORKS:
// The grid "absorbs" numerical errors during P2G averaging and pressure solve.
// By taking only the delta (what the grid DID to the velocity), particles
// keep their pre-existing momentum and only receive the incompressibility
// correction and external forces applied to the grid.
// =============================================================================

@compute @workgroup_size(64)
fn gridToParticle(@builtin(global_invocation_id) id: vec3<u32>) {
  let pIdx = id.x;
  if (pIdx >= uniforms.particleCount) { return; }

  let pos = positions[pIdx].xyz;
  let velOld = velocities[pIdx].xyz;  // Particle velocity from previous frame

  // Sample CURRENT grid velocity (after projection and forces)
  let vGridNew = sampleVelocity(pos);

  // Sample ORIGINAL grid velocity (before projection, saved in normalizeGrid)
  let vGridOld = sampleVelocityOrig(pos);

  // =================================================================
  // PIC/FLIP Velocity Computation
  // =================================================================

  // FLIP: Add grid delta to particle's existing velocity
  // This preserves particle momentum and only adds the grid's contribution
  let vFlip = velOld + (vGridNew - vGridOld);

  // PIC: Just use the grid velocity directly
  // This is more stable but loses the particle's individual momentum
  let vPic = vGridNew;

  // Blend between PIC (stable) and FLIP (energetic)
  // fluidity = 0: all PIC, fluidity = 1: all FLIP
  let vNew = mix(vPic, vFlip, uniforms.fluidity);

  velocities[pIdx] = vec4<f32>(vNew, 0.0);
}

// =============================================================================
// STEP 12: ADVECT PARTICLES - Move particles through velocity field
// =============================================================================
// Particles are moved according to the divergence-free velocity field using
// Runge-Kutta 2 (midpoint method) integration:
//
//   v1 = velocity(position)
//   midpoint = position + v1 * dt/2
//   v2 = velocity(midpoint)
//   position_new = position + v2 * dt
//
// This second-order method is more accurate than forward Euler and prevents
// particles from "overshooting" in regions of high velocity gradient.
//
// TURBULENT NOISE:
// A small random perturbation is added to each particle's motion:
//   - Scaled by velocity magnitude (faster particles get more noise)
//   - Prevents particles from forming perfectly ordered structures
//   - Adds visual liveliness to the simulation
//   - The random direction is pre-computed and indexed by particle + frame
//
// BOUNDARY CLAMPING:
// Particles are clamped inside the container with a small epsilon margin.
// This prevents particles from getting stuck exactly on walls.
// =============================================================================

@compute @workgroup_size(64)
fn advect(@builtin(global_invocation_id) id: vec3<u32>) {
  let pIdx = id.x;
  if (pIdx >= uniforms.particleCount) { return; }

  var pos = positions[pIdx].xyz;

  // =================================================================
  // RK2 (Midpoint) Integration
  // =================================================================
  // More accurate than forward Euler for curved trajectories.
  // Uses velocity at midpoint for the actual step.

  // Sample velocity at current position
  let v1 = sampleVelocity(pos);

  // Compute midpoint (half timestep forward)
  let midPos = pos + v1 * uniforms.dt * 0.5;

  // Sample velocity at midpoint
  let v2 = sampleVelocity(midPos);

  // Take full step using midpoint velocity
  var step = v2 * uniforms.dt;

  // =================================================================
  // Turbulent Noise
  // =================================================================
  // Add small random perturbation proportional to velocity.
  // Frame offset ensures different particles get different noise each frame.
  let offset = u32(uniforms.frameNumber) % uniforms.particleCount;
  let randomIdx = (pIdx + offset) % uniforms.particleCount;
  let randomDir = randomDirs[randomIdx].xyz;  // Pre-computed unit vector

  // Scale noise by velocity magnitude and timestep
  step += TURBULENCE * randomDir * length(v1) * uniforms.dt;

  // Apply displacement
  pos += step;

  // =================================================================
  // Boundary Clamping
  // =================================================================
  // Keep particles strictly inside container with small margin.
  // This prevents numerical issues at exact boundaries.
  let eps = 0.01;
  pos = clamp(pos,
    vec3<f32>(eps, eps, eps),
    vec3<f32>(uniforms.width - eps, uniforms.height - eps, uniforms.depth - eps)
  );

  positions[pIdx] = vec4<f32>(pos, 1.0);
}
