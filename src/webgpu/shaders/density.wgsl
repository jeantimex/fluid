struct DensityParams {
  radius: f32,
  spikyPow2Scale: f32,
  spikyPow3Scale: f32,
  particleCountF: f32,
  pad0: vec4<f32>,
};

@group(0) @binding(0) var<storage, read> predicted: array<vec2<f32>>;
@group(0) @binding(1) var<storage, read> sortedKeys: array<u32>;
@group(0) @binding(2) var<storage, read> indices: array<u32>;
@group(0) @binding(3) var<storage, read> spatialOffsets: array<u32>;
@group(0) @binding(4) var<storage, read_write> densities: array<vec2<f32>>;
@group(0) @binding(5) var<uniform> params: DensityParams;

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

  var density = 0.0;
  var nearDensity = 0.0;
  let radiusSq = params.radius * params.radius;

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
      let neighborPos = predicted[neighborIndex];
      let dx = neighborPos.x - pos.x;
      let dy = neighborPos.y - pos.y;
      let dstSq = dx * dx + dy * dy;
      if (dstSq <= radiusSq) {
        let dst = sqrt(dstSq);
        density = density + spikyPow2(dst, params.radius, params.spikyPow2Scale);
        nearDensity = nearDensity + spikyPow3(dst, params.radius, params.spikyPow3Scale);
      }
      j = j + 1u;
    }
  }

  densities[i] = vec2<f32>(density, nearDensity);
}
