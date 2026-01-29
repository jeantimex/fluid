/**
 * ============================================================================
 * VISCOSITY KERNEL (LINEAR GRID + STRIP OPTIMIZATION)
 * ============================================================================
 */

struct ViscosityParams {
  dt: f32,
  viscosityStrength: f32,
  radius: f32,
  poly6Scale: f32,
  particleCountF: f32,
  minBoundsX: f32,
  minBoundsY: f32,
  minBoundsZ: f32,
  gridResX: f32,
  gridResY: f32,
  gridResZ: f32,
  pad0: f32,
};

@group(0) @binding(0) var<storage, read> predicted: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> velocities: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> sortOffsets: array<u32>;
@group(0) @binding(4) var<uniform> params: ViscosityParams;

fn getGridIndex(x: i32, y: i32, z: i32) -> u32 {
    let gridRes = vec3<u32>(u32(params.gridResX), u32(params.gridResY), u32(params.gridResZ));
    return u32(x) + gridRes.x * (u32(y) + gridRes.y * u32(z));
}

fn smoothingKernelPoly6(dst: f32, radius: f32, scale: f32) -> f32 {
  if (dst < radius) {
    let v = radius * radius - dst * dst;
    return v * v * v * scale;
  }
  return 0.0;
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  let count = u32(params.particleCountF + 0.5);

  if (i >= count) { return; }

  let pos = predicted[i].xyz;
  let vel = velocities[i].xyz;

  let gridRes = vec3<i32>(i32(params.gridResX), i32(params.gridResY), i32(params.gridResZ));
  let minBounds = vec3<f32>(params.minBoundsX, params.minBoundsY, params.minBoundsZ);
  let localPos = pos - minBounds;
  
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
                    let weight = smoothingKernelPoly6(dst, params.radius, params.poly6Scale);
                    let neighborVel = velocities[neighborIndex].xyz;
                    force = force + (neighborVel - vel) * weight;
                }
            }
      }
    }
  }

  velocities[i] = vec4<f32>(velocities[i].xyz + force * params.viscosityStrength * params.dt, 0.0);
}