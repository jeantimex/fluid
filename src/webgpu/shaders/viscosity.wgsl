struct ViscosityParams {
  dt: f32,
  viscosityStrength: f32,
  radius: f32,
  poly6Scale: f32,
  particleCountF: f32,
  pad0: vec3<f32>,
};

@group(0) @binding(0) var<storage, read> predicted: array<vec2<f32>>;
@group(0) @binding(1) var<storage, read_write> velocities: array<vec2<f32>>;
@group(0) @binding(2) var<storage, read> sortedKeys: array<u32>;
@group(0) @binding(3) var<storage, read> indices: array<u32>;
@group(0) @binding(4) var<storage, read> spatialOffsets: array<u32>;
@group(0) @binding(5) var<uniform> params: ViscosityParams;

const neighborOffsets = array<vec2<i32>, 9>(
  vec2<i32>(-1, 1),
  vec2<i32>(0, 1),
  vec2<i32>(1, 1),
  vec2<i32>(-1, 0),
  vec2<i32>(0, 0),
  vec2<i32>(1, 0),
  vec2<i32>(-1, -1),
  vec2<i32>(0, -1),
  vec2<i32>(1, -1)
);

fn hashCell2D(cellX: i32, cellY: i32) -> u32 {
  let ax = cellX * 15823;
  let by = cellY * 9737333;
  return u32(ax + by);
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
  if (i >= count) {
    return;
  }

  let pos = predicted[i];
  let originCellX = i32(floor(pos.x / params.radius));
  let originCellY = i32(floor(pos.y / params.radius));
  let radiusSq = params.radius * params.radius;

  var forceX = 0.0;
  var forceY = 0.0;
  let vel = velocities[i];

  for (var n = 0u; n < 9u; n = n + 1u) {
    let cellOffset = neighborOffsets[n];
    let cellX = originCellX + cellOffset.x;
    let cellY = originCellY + cellOffset.y;
    let hash = hashCell2D(cellX, cellY);
    let key = hash % count;
    let start = spatialOffsets[key];
    if (start == count) {
      continue;
    }

    var j = start;
    loop {
      if (j >= count || sortedKeys[j] != key) {
        break;
      }
      let neighborIndex = indices[j];
      if (neighborIndex != i) {
        let neighborPos = predicted[neighborIndex];
        let dx = neighborPos.x - pos.x;
        let dy = neighborPos.y - pos.y;
        let dstSq = dx * dx + dy * dy;
        if (dstSq <= radiusSq) {
          let dst = sqrt(dstSq);
          let weight = smoothingKernelPoly6(dst, params.radius, params.poly6Scale);
          let neighborVel = velocities[neighborIndex];
          forceX = forceX + (neighborVel.x - vel.x) * weight;
          forceY = forceY + (neighborVel.y - vel.y) * weight;
        }
      }
      j = j + 1u;
    }
  }

  velocities[i].x = velocities[i].x + forceX * params.viscosityStrength * params.dt;
  velocities[i].y = velocities[i].y + forceY * params.viscosityStrength * params.dt;
}
