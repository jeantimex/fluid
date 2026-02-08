/**
 * ============================================================================
 * LINEAR GRID HASH KERNEL
 * ============================================================================
 *
 * Pipeline Stage: 2 of 8 (After external forces)
 * Entry Point: main
 * Workgroup Size: 256 threads
 *
 * Purpose:
 * --------
 * Assigns each particle to a Linear Grid Index based on its predicted position.
 * This is the first step of the O(1) neighbor search acceleration.
 *
 * Linear Grid vs Spatial Hash:
 * ----------------------------
 * Instead of hashing (which has collisions), we use a deterministic mapping
 * from 3D cell coordinates to a 1D index:
 *
 *   index = x + width * (y + height * z)
 *
 * Requirements:
 * - Fixed simulation bounds (minBounds, maxBounds)
 * - Grid resolution calculated from bounds / radius
 * - Particles outside bounds are clamped to the nearest boundary cell
 *
 * Advantages:
 * - No hash collisions (two particles in different cells never share a key)
 * - Contiguous X-rows allow "Strip Optimization" in neighbor search
 * - Deterministic iteration order
 *
 * Output:
 * -------
 *   keys[i]    = grid index for particle i
 *   indices[i] = i (original particle index, preserved through sorting)
 * ============================================================================
 */

// Beginner note: keys[] are cell IDs used for sorting; indices[] keeps the original index.

/**
 * Hash Parameters Uniform Buffer
 *
 * Memory Layout (32 bytes, two vec4-sized rows):
 * Offset  Size  Field
 * ------  ----  -----
 *   0      4    radius         - Grid cell size (= smoothing radius)
 *   4      4    particleCount  - Number of particles (as f32)
 *   8      4    minBoundsX     - Minimum X of simulation domain
 *  12      4    minBoundsY     - Minimum Y of simulation domain
 *  16      4    minBoundsZ     - Minimum Z of simulation domain
 *  20      4    gridResX       - Grid resolution along X axis
 *  24      4    gridResY       - Grid resolution along Y axis
 *  28      4    gridResZ       - Grid resolution along Z axis
 * ------
 * Total: 32 bytes
 */
struct HashParams {
  radius: f32,
  particleCount: f32,
  minBoundsX: f32,
  minBoundsY: f32,
  minBoundsZ: f32,
  gridResX: f32,
  gridResY: f32,
  gridResZ: f32,
};

// ============================================================================
// BUFFER BINDINGS
// ============================================================================
// Group 0: Linear Grid Hash compute pass
//
//   Binding 0: predicted[]  - Predicted particle positions from external forces
//              Format: vec4<f32> per particle (xyz = position, w = 1.0)
//
//   Binding 1: keys[]       - Output linear grid indices (one u32 per particle)
//              These keys are deterministic (no collisions) and contiguous
//              along the X axis for strip optimisation in neighbor search
//
//   Binding 2: indices[]    - Output original particle indices (identity mapping)
//              Tracks which particle each key belongs to after sorting
//
//   Binding 3: params       - Uniform hash parameters (radius, bounds, resolution)
// ============================================================================

@group(0) @binding(0) var<storage, read> predicted: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> keys: array<u32>;
@group(0) @binding(2) var<storage, read_write> indices: array<u32>;
@group(0) @binding(3) var<uniform> params: HashParams;

/**
 * Converts a 3D world-space position to a linear grid index.
 *
 * Steps:
 *   1. Shift position into local space: pos - minBounds
 *   2. Divide by cell size (radius) to get cell coordinates
 *   3. Clamp to [0, gridRes - 1] on each axis (boundary safety)
 *   4. Linearise: index = x + width × (y + height × z)
 *
 * The clamp ensures particles slightly outside the domain are assigned to
 * the nearest boundary cell rather than producing out-of-range indices.
 *
 * @param pos - World-space position
 * @returns Linear grid index in [0, gridTotalCells - 1]
 */
fn getGridIndex(pos: vec3<f32>) -> u32 {
    let gridRes = vec3<u32>(u32(params.gridResX), u32(params.gridResY), u32(params.gridResZ));
    let minBounds = vec3<f32>(params.minBoundsX, params.minBoundsY, params.minBoundsZ);
    
    let localPos = pos - minBounds;
    
    // Clamp to valid grid range [0, gridRes-1]
    let cellX = u32(clamp(floor(localPos.x / params.radius), 0.0, f32(gridRes.x - 1u)));
    let cellY = u32(clamp(floor(localPos.y / params.radius), 0.0, f32(gridRes.y - 1u)));
    let cellZ = u32(clamp(floor(localPos.z / params.radius), 0.0, f32(gridRes.z - 1u)));
    
    // Linear index: x + width * (y + height * z)
    return cellX + gridRes.x * (cellY + gridRes.y * cellZ);
}

/**
 * Main Compute Kernel
 *
 * Dispatch: ceil(particleCount / 256) workgroups
 * Each thread processes exactly one particle.
 *
 * Writes:
 *   keys[i]    = linear grid index for particle i
 *   indices[i] = i (identity mapping, preserved through sorting)
 */
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let index = id.x;

  // Convert float particle count to integer with rounding
  let count = u32(params.particleCount + 0.5);

  // Bounds check: one thread per particle
  if (index >= count) {
    return;
  }

  // Compute deterministic grid index from predicted position
  let pos = predicted[index].xyz;
  keys[index] = getGridIndex(pos);

  // Store identity mapping (will be rearranged by scatter)
  indices[index] = index;
}
