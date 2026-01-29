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

@group(0) @binding(0) var<storage, read> predicted: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> keys: array<u32>;
@group(0) @binding(2) var<storage, read_write> indices: array<u32>;
@group(0) @binding(3) var<uniform> params: HashParams;

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

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let index = id.x;
  let count = u32(params.particleCount + 0.5);

  if (index >= count) {
    return;
  }

  let pos = predicted[index].xyz;
  keys[index] = getGridIndex(pos);
  indices[index] = index;
}