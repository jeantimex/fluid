/**
 * ============================================================================
 * DENSITY KERNEL (SHARED MEMORY OPTIMIZATION)
 * ============================================================================
 *
 * Pipeline Stage: Stage 5
 * Entry Point: main
 * Workgroup Size: 64 threads (optimized for mobile GPUs)
 *
 * Purpose:
 * --------
 * Computes fluid density using workgroup shared memory to reduce global
 * memory bandwidth. This is especially beneficial for mobile GPUs.
 *
 * Optimization Strategy:
 * ----------------------
 * Since particles are sorted by cell (from the spatial grid), particles in
 * the same workgroup tend to be spatially close. We exploit this by:
 *
 *   1. Computing a workgroup-wide bounding box of neighbor cells
 *   2. Collaboratively loading ALL potential neighbors into shared memory
 *   3. Each thread filters to its actual neighbors during computation
 *
 * This trades some extra distance checks for much faster memory access.
 *
 * Why this works:
 * ---------------
 * Sorted particles → nearby particles in same workgroup → overlapping neighbors
 * → shared memory is reused by multiple threads → reduced global memory reads
 *
 * Memory: ~8KB shared memory (512 × vec3 × 4 bytes = 6KB + overhead)
 *
 * ============================================================================
 */

const TILE_SIZE: u32 = 512u;
const WORKGROUP_SIZE: u32 = 64u;

struct DensityParams {
  radius: f32,
  spikyPow2Scale: f32,
  spikyPow3Scale: f32,
  particleCountF: f32,
  minBounds: vec3<f32>,
  pad0: f32,
  gridRes: vec3<f32>,
  pad1: f32,
};

@group(0) @binding(0) var<storage, read> predicted: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read> sortOffsets: array<u32>;
@group(0) @binding(2) var<storage, read_write> densities: array<vec2<f32>>;
@group(0) @binding(3) var<uniform> params: DensityParams;

// Shared memory for neighbor positions
var<workgroup> sharedPositions: array<vec3<f32>, TILE_SIZE>;

// Workgroup-shared bounds (computed collaboratively)
var<workgroup> wgMinCell: vec3<i32>;
var<workgroup> wgMaxCell: vec3<i32>;
var<workgroup> wgNeighborStart: u32;
var<workgroup> wgNeighborEnd: u32;

// Atomics for workgroup reduction
var<workgroup> wgMinX: atomic<i32>;
var<workgroup> wgMinY: atomic<i32>;
var<workgroup> wgMinZ: atomic<i32>;
var<workgroup> wgMaxX: atomic<i32>;
var<workgroup> wgMaxY: atomic<i32>;
var<workgroup> wgMaxZ: atomic<i32>;

fn getGridIndex(x: i32, y: i32, z: i32) -> u32 {
  let gridRes = vec3<u32>(params.gridRes);
  return u32(x) + gridRes.x * (u32(y) + gridRes.y * u32(z));
}

fn spikyPow2(dst: f32, radius: f32, scale: f32) -> f32 {
  if (dst < radius) {
    let v = radius - dst;
    return v * v * scale;
  }
  return 0.0;
}

fn spikyPow3(dst: f32, radius: f32, scale: f32) -> f32 {
  if (dst < radius) {
    let v = radius - dst;
    return v * v * v * scale;
  }
  return 0.0;
}

@compute @workgroup_size(64)
fn main(
  @builtin(global_invocation_id) globalId: vec3<u32>,
  @builtin(local_invocation_id) localId: vec3<u32>,
  @builtin(workgroup_id) workgroupId: vec3<u32>
) {
  let particleIndex = globalId.x;
  let localIndex = localId.x;
  let particleCount = u32(params.particleCountF + 0.5);
  let gridRes = vec3<i32>(params.gridRes);

  let hasParticle = particleIndex < particleCount;

  // =========================================================================
  // PHASE 1: Compute workgroup-wide neighbor bounds
  // =========================================================================

  // Initialize atomics (thread 0 only)
  if (localIndex == 0u) {
    atomicStore(&wgMinX, gridRes.x);
    atomicStore(&wgMinY, gridRes.y);
    atomicStore(&wgMinZ, gridRes.z);
    atomicStore(&wgMaxX, -1);
    atomicStore(&wgMaxY, -1);
    atomicStore(&wgMaxZ, -1);
  }
  workgroupBarrier();

  // Each thread contributes its neighbor bounds
  var pos = vec3<f32>(0.0);
  var myCellX: i32 = 0;
  var myCellY: i32 = 0;
  var myCellZ: i32 = 0;

  if (hasParticle) {
    pos = predicted[particleIndex].xyz;
    let localPos = pos - params.minBounds;
    myCellX = clamp(i32(floor(localPos.x / params.radius)), 0, gridRes.x - 1);
    myCellY = clamp(i32(floor(localPos.y / params.radius)), 0, gridRes.y - 1);
    myCellZ = clamp(i32(floor(localPos.z / params.radius)), 0, gridRes.z - 1);

    // Neighbor range for this particle (3x3x3 neighborhood)
    let minX = max(0, myCellX - 1);
    let minY = max(0, myCellY - 1);
    let minZ = max(0, myCellZ - 1);
    let maxX = min(gridRes.x - 1, myCellX + 1);
    let maxY = min(gridRes.y - 1, myCellY + 1);
    let maxZ = min(gridRes.z - 1, myCellZ + 1);

    // Atomic min/max to find workgroup bounds
    atomicMin(&wgMinX, minX);
    atomicMin(&wgMinY, minY);
    atomicMin(&wgMinZ, minZ);
    atomicMax(&wgMaxX, maxX);
    atomicMax(&wgMaxY, maxY);
    atomicMax(&wgMaxZ, maxZ);
  }
  workgroupBarrier();

  // Thread 0 computes the neighbor range
  if (localIndex == 0u) {
    let minX = atomicLoad(&wgMinX);
    let minY = atomicLoad(&wgMinY);
    let minZ = atomicLoad(&wgMinZ);
    let maxX = atomicLoad(&wgMaxX);
    let maxY = atomicLoad(&wgMaxY);
    let maxZ = atomicLoad(&wgMaxZ);

    wgMinCell = vec3<i32>(minX, minY, minZ);
    wgMaxCell = vec3<i32>(maxX, maxY, maxZ);

    // Get particle index range for the bounding box
    if (maxX >= 0 && maxY >= 0 && maxZ >= 0) {
      let startKey = getGridIndex(minX, minY, minZ);
      let endKey = getGridIndex(maxX, maxY, maxZ);
      wgNeighborStart = sortOffsets[startKey];
      wgNeighborEnd = sortOffsets[endKey + 1u];
    } else {
      wgNeighborStart = 0u;
      wgNeighborEnd = 0u;
    }
  }
  workgroupBarrier();

  let rangeStart = wgNeighborStart;
  let rangeEnd = wgNeighborEnd;

  // =========================================================================
  // PHASE 2: Process neighbors in tiles using shared memory
  // =========================================================================

  var density = 0.0;
  var nearDensity = 0.0;
  let radiusSq = params.radius * params.radius;

  var tileStart = rangeStart;
  loop {
    if (tileStart >= rangeEnd) { break; }

    let tileEnd = min(tileStart + TILE_SIZE, rangeEnd);
    let tileCount = tileEnd - tileStart;

    // Collaborative loading: each thread loads multiple elements
    let loadsPerThread = (tileCount + WORKGROUP_SIZE - 1u) / WORKGROUP_SIZE;
    for (var l = 0u; l < loadsPerThread; l++) {
      let loadIdx = localIndex + l * WORKGROUP_SIZE;
      if (loadIdx < tileCount) {
        let globalIdx = tileStart + loadIdx;
        sharedPositions[loadIdx] = predicted[globalIdx].xyz;
      }
    }

    workgroupBarrier();

    // Each thread computes density from shared memory
    if (hasParticle) {
      for (var j = 0u; j < tileCount; j++) {
        let neighborPos = sharedPositions[j];
        let offset = neighborPos - pos;
        let dstSq = dot(offset, offset);

        if (dstSq <= radiusSq) {
          let dst = sqrt(dstSq);
          density += spikyPow2(dst, params.radius, params.spikyPow2Scale);
          nearDensity += spikyPow3(dst, params.radius, params.spikyPow3Scale);
        }
      }
    }

    workgroupBarrier();
    tileStart = tileEnd;
  }

  // =========================================================================
  // PHASE 3: Write results
  // =========================================================================

  if (hasParticle) {
    densities[particleIndex] = vec2<f32>(density, nearDensity);
  }
}
