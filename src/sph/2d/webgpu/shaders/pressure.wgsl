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

@group(0) @binding(0) var<storage, read> predicted: array<vec2<f32>>;
@group(0) @binding(1) var<storage, read_write> velocities: array<vec2<f32>>;
@group(0) @binding(2) var<storage, read> densities: array<vec2<f32>>;
@group(0) @binding(3) var<storage, read> sortedKeys: array<u32>;
@group(0) @binding(4) var<storage, read> indices: array<u32>;
@group(0) @binding(5) var<storage, read> spatialOffsets: array<u32>;
@group(0) @binding(6) var<uniform> params: PressureParams;

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
  if (i >= count) {
    return;
  }

  let densityPair = densities[i];
  let density = densityPair.x;
  let nearDensity = densityPair.y;
  if (density <= 0.0) {
    return;
  }

  let pressure = (density - params.targetDensity) * params.pressureMultiplier;
  let nearPressure = params.nearPressureMultiplier * nearDensity;

  let pos = predicted[i];
  let originCellX = i32(floor(pos.x / params.radius));
  let originCellY = i32(floor(pos.y / params.radius));
  let radiusSq = params.radius * params.radius;

  var forceX = 0.0;
  var forceY = 0.0;

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
          let invDst = select(0.0, 1.0 / dst, dst > 0.0);
          let dirX = dx * invDst;
          let dirY = dy * invDst;

          let neighborDensityPair = densities[neighborIndex];
          let neighborDensity = neighborDensityPair.x;
          let neighborNearDensity = neighborDensityPair.y;
          let neighborPressure =
            (neighborDensity - params.targetDensity) * params.pressureMultiplier;
          let neighborNearPressure =
            params.nearPressureMultiplier * neighborNearDensity;

          let sharedPressure = (pressure + neighborPressure) * 0.5;
          let sharedNearPressure = (nearPressure + neighborNearPressure) * 0.5;

          if (neighborDensity > 0.0) {
            let scale =
              derivativeSpikyPow2(dst, params.radius, params.spikyPow2DerivScale) *
              (sharedPressure / neighborDensity);
            forceX = forceX + dirX * scale;
            forceY = forceY + dirY * scale;
          }

          if (neighborNearDensity > 0.0) {
            let scale =
              derivativeSpikyPow3(dst, params.radius, params.spikyPow3DerivScale) *
              (sharedNearPressure / neighborNearDensity);
            forceX = forceX + dirX * scale;
            forceY = forceY + dirY * scale;
          }
        }
      }
      j = j + 1u;
    }
  }

  velocities[i].x = velocities[i].x + (forceX / density) * params.dt;
  velocities[i].y = velocities[i].y + (forceY / density) * params.dt;
}
