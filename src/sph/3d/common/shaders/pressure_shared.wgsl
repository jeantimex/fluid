/**
 * ============================================================================
 * PRESSURE KERNEL (SHARED MEMORY OPTIMIZATION)
 * ============================================================================
 *
 * Pipeline Stage: Stage 6
 * Entry Point: main
 * Workgroup Size: 64 threads (optimized for mobile GPUs)
 *
 * Purpose:
 * --------
 * Computes pressure forces using workgroup shared memory to reduce global
 * memory bandwidth. Uses the same collaborative loading strategy as the
 * density shader.
 *
 * ============================================================================
 */

const TILE_SIZE: u32 = 384u;  // Smaller than density since we store more data
const WORKGROUP_SIZE: u32 = 64u;

struct PressureParams {
  dt: f32,
  targetDensity: f32,
  pressureMultiplier: f32,
  nearPressureMultiplier: f32,
  radius: f32,
  spikyPow2DerivScale: f32,
  spikyPow3DerivScale: f32,
  particleCountF: f32,
  minBounds: vec3<f32>,
  pad0: f32,
  gridRes: vec3<f32>,
  pad1: f32,
};

// Neighbor data packed into shared memory
struct NeighborData {
  pos: vec3<f32>,
  density: f32,
  nearDensity: f32,
}

@group(0) @binding(0) var<storage, read> predicted: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> velocities: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> densities: array<vec2<f32>>;
@group(0) @binding(3) var<storage, read> sortOffsets: array<u32>;
@group(0) @binding(4) var<uniform> params: PressureParams;

// Shared memory for neighbor data
var<workgroup> sharedPos: array<vec3<f32>, TILE_SIZE>;
var<workgroup> sharedDensity: array<f32, TILE_SIZE>;
var<workgroup> sharedNearDensity: array<f32, TILE_SIZE>;

// Workgroup-shared bounds
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

fn derivativeSpikyPow2(dst: f32, radius: f32, scale: f32) -> f32 {
  if (dst <= radius) {
    let v = radius - dst;
    return -v * scale;
  }
  return 0.0;
}

fn derivativeSpikyPow3(dst: f32, radius: f32, scale: f32) -> f32 {
  if (dst <= radius) {
    let v = radius - dst;
    return -v * v * scale;
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

  if (localIndex == 0u) {
    atomicStore(&wgMinX, gridRes.x);
    atomicStore(&wgMinY, gridRes.y);
    atomicStore(&wgMinZ, gridRes.z);
    atomicStore(&wgMaxX, -1);
    atomicStore(&wgMaxY, -1);
    atomicStore(&wgMaxZ, -1);
  }
  workgroupBarrier();

  var pos = vec3<f32>(0.0);
  var myDensity = 0.0;
  var myNearDensity = 0.0;
  var myPressure = 0.0;
  var myNearPressure = 0.0;

  if (hasParticle) {
    pos = predicted[particleIndex].xyz;
    let densityPair = densities[particleIndex];
    myDensity = densityPair.x;
    myNearDensity = densityPair.y;

    if (myDensity > 0.0) {
      myPressure = (myDensity - params.targetDensity) * params.pressureMultiplier;
      myNearPressure = params.nearPressureMultiplier * myNearDensity;
    }

    let localPos = pos - params.minBounds;
    let cellX = clamp(i32(floor(localPos.x / params.radius)), 0, gridRes.x - 1);
    let cellY = clamp(i32(floor(localPos.y / params.radius)), 0, gridRes.y - 1);
    let cellZ = clamp(i32(floor(localPos.z / params.radius)), 0, gridRes.z - 1);

    let minX = max(0, cellX - 1);
    let minY = max(0, cellY - 1);
    let minZ = max(0, cellZ - 1);
    let maxX = min(gridRes.x - 1, cellX + 1);
    let maxY = min(gridRes.y - 1, cellY + 1);
    let maxZ = min(gridRes.z - 1, cellZ + 1);

    atomicMin(&wgMinX, minX);
    atomicMin(&wgMinY, minY);
    atomicMin(&wgMinZ, minZ);
    atomicMax(&wgMaxX, maxX);
    atomicMax(&wgMaxY, maxY);
    atomicMax(&wgMaxZ, maxZ);
  }
  workgroupBarrier();

  if (localIndex == 0u) {
    let minX = atomicLoad(&wgMinX);
    let minY = atomicLoad(&wgMinY);
    let minZ = atomicLoad(&wgMinZ);
    let maxX = atomicLoad(&wgMaxX);
    let maxY = atomicLoad(&wgMaxY);
    let maxZ = atomicLoad(&wgMaxZ);

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

  // Skip if this particle has no density
  if (hasParticle && myDensity <= 0.0) {
    return;
  }

  let rangeStart = wgNeighborStart;
  let rangeEnd = wgNeighborEnd;

  // =========================================================================
  // PHASE 2: Process neighbors in tiles using shared memory
  // =========================================================================

  var force = vec3<f32>(0.0);
  let radiusSq = params.radius * params.radius;

  var tileStart = rangeStart;
  loop {
    if (tileStart >= rangeEnd) { break; }

    let tileEnd = min(tileStart + TILE_SIZE, rangeEnd);
    let tileCount = tileEnd - tileStart;

    // Collaborative loading
    let loadsPerThread = (tileCount + WORKGROUP_SIZE - 1u) / WORKGROUP_SIZE;
    for (var l = 0u; l < loadsPerThread; l++) {
      let loadIdx = localIndex + l * WORKGROUP_SIZE;
      if (loadIdx < tileCount) {
        let globalIdx = tileStart + loadIdx;
        sharedPos[loadIdx] = predicted[globalIdx].xyz;
        let d = densities[globalIdx];
        sharedDensity[loadIdx] = d.x;
        sharedNearDensity[loadIdx] = d.y;
      }
    }

    workgroupBarrier();

    // Compute pressure forces from shared memory
    if (hasParticle && myDensity > 0.0) {
      for (var j = 0u; j < tileCount; j++) {
        let neighborGlobalIdx = tileStart + j;
        if (neighborGlobalIdx != particleIndex) {
          let neighborPos = sharedPos[j];
          let offset = neighborPos - pos;
          let dstSq = dot(offset, offset);

          if (dstSq <= radiusSq && dstSq > 0.0) {
            let dst = sqrt(dstSq);
            let dir = offset / dst;

            let nDensity = sharedDensity[j];
            let nNearDensity = sharedNearDensity[j];

            if (nDensity > 0.0) {
              let nPressure = (nDensity - params.targetDensity) * params.pressureMultiplier;
              let nNearPressure = params.nearPressureMultiplier * nNearDensity;

              let sharedPressure = (myPressure + nPressure) * 0.5;
              let sharedNearPressure = (myNearPressure + nNearPressure) * 0.5;

              let scale1 = derivativeSpikyPow2(dst, params.radius, params.spikyPow2DerivScale) * (sharedPressure / nDensity);
              let scale2 = derivativeSpikyPow3(dst, params.radius, params.spikyPow3DerivScale) * (sharedNearPressure / nDensity);

              force += dir * (scale1 + scale2);
            }
          }
        }
      }
    }

    workgroupBarrier();
    tileStart = tileEnd;
  }

  // =========================================================================
  // PHASE 3: Update velocity
  // =========================================================================

  if (hasParticle && myDensity > 0.0) {
    let accel = force / myDensity;
    velocities[particleIndex] = vec4<f32>(velocities[particleIndex].xyz + accel * params.dt, 0.0);
  }
}
