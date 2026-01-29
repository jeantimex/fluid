/**
 * ============================================================================
 * PRESSURE KERNEL (LINEAR GRID + STRIP OPTIMIZATION)
 * ============================================================================
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
  minBounds: vec3<f32>,
  pad0: f32,
  gridRes: vec3<f32>,
  pad1: f32,
};

@group(0) @binding(0) var<storage, read> predicted: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> velocities: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> densities: array<vec2<f32>>;
@group(0) @binding(3) var<storage, read> sortOffsets: array<u32>;
@group(0) @binding(4) var<uniform> params: PressureParams;

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

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  let count = u32(params.particleCountF + 0.5);

  if (i >= count) { return; }

  let densityPair = densities[i];
  let density = densityPair.x;
  let nearDensity = densityPair.y;

  if (density <= 0.0) { return; }

  let pressure = (density - params.targetDensity) * params.pressureMultiplier;
  let nearPressure = params.nearPressureMultiplier * nearDensity;

  let pos = predicted[i].xyz;
  let gridRes = vec3<i32>(params.gridRes);
  let localPos = pos - params.minBounds;
  
  let cellX = i32(floor(localPos.x / params.radius));
  let cellY = i32(floor(localPos.y / params.radius));
  let cellZ = i32(floor(localPos.z / params.radius));
  
  let cx = clamp(cellX, 0, gridRes.x - 1);
  let cy = clamp(cellY, 0, gridRes.y - 1);
  let cz = clamp(cellZ, 0, gridRes.z - 1);

  let radiusSq = params.radius * params.radius;
  var force = vec3<f32>(0.0);

  let minZ = max(0, cz - 1);
  let maxZ = min(gridRes.z - 1, cz + 1);
  let minY = max(0, cy - 1);
  let maxY = min(gridRes.y - 1, cy + 1);
  let minX = max(0, cx - 1);
  let maxX = min(gridRes.x - 1, cx + 1);

  for (var z = minZ; z <= maxZ; z++) {
    for (var y = minY; y <= maxY; y++) {
      let startKey = getGridIndex(minX, y, z);
      let endKey = getGridIndex(maxX, y, z);
      let start = sortOffsets[startKey];
      let end = sortOffsets[endKey + 1u];

      for (var j = start; j < end; j++) {
            let neighborIndex = j;
            if (neighborIndex != i) {
                let neighborPos = predicted[neighborIndex].xyz;
                let offset = neighborPos - pos;
                let dstSq = dot(offset, offset);

                if (dstSq <= radiusSq) {
                    let dst = sqrt(dstSq);
                    let invDst = select(0.0, 1.0 / dst, dst > 0.0);
                    let dir = offset * invDst;

                    let nDens = densities[neighborIndex];
                    let nPressure = (nDens.x - params.targetDensity) * params.pressureMultiplier;
                    let nNearPressure = params.nearPressureMultiplier * nDens.y;

                    let sharedPressure = (pressure + nPressure) * 0.5;
                    let sharedNearPressure = (nearPressure + nNearPressure) * 0.5;

                    if (nDens.x > 0.0) {
                        let scale = derivativeSpikyPow2(dst, params.radius, params.spikyPow2DerivScale) * (sharedPressure / nDens.x);
                        force = force + dir * scale;
                    }
                    if (nDens.y > 0.0) {
                        let scale = derivativeSpikyPow3(dst, params.radius, params.spikyPow3DerivScale) * (sharedNearPressure / nDens.y);
                        force = force + dir * scale;
                    }
                }
            }
      }
    }
  }

  let accel = force / density;
  velocities[i] = vec4<f32>(velocities[i].xyz + accel * params.dt, 0.0);
}