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

@group(0) @binding(0) var<storage, read> predicted: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> velocities: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> densities: array<vec2<f32>>;
@group(0) @binding(3) var<storage, read> sortedKeys: array<u32>;
@group(0) @binding(4) var<storage, read> spatialOffsets: array<u32>;
@group(0) @binding(5) var<uniform> params: PressureParams;

fn hashCell3D(cellX: i32, cellY: i32, cellZ: i32) -> u32 {
    let blockSize = 50u;
    let ucell = vec3<u32>(
        u32(cellX + i32(blockSize / 2u)),
        u32(cellY + i32(blockSize / 2u)),
        u32(cellZ + i32(blockSize / 2u))
    );
    let localCell = ucell % blockSize;
    let blockID = ucell / blockSize;
    let blockHash = blockID.x * 15823u + blockID.y * 9737333u + blockID.z * 440817757u;
    return localCell.x + blockSize * (localCell.y + blockSize * localCell.z) + blockHash;
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

  let pos = predicted[i].xyz;
  let originCellX = i32(floor(pos.x / params.radius));
  let originCellY = i32(floor(pos.y / params.radius));
  let originCellZ = i32(floor(pos.z / params.radius));
  let radiusSq = params.radius * params.radius;

  var force = vec3<f32>(0.0, 0.0, 0.0);

  for (var z = -1; z <= 1; z = z + 1) {
    for (var y = -1; y <= 1; y = y + 1) {
      for (var x = -1; x <= 1; x = x + 1) {
        let cellX = originCellX + x;
        let cellY = originCellY + y;
        let cellZ = originCellZ + z;
        
        let hash = hashCell3D(cellX, cellY, cellZ);
        let key = hash % count;
        let start = spatialOffsets[key];
        
        if (start == count) { continue; }

        var j = start;
        loop {
            if (j >= count || sortedKeys[j] != key) { break; }
            let neighborIndex = j;
            
            if (neighborIndex != i) {
                let neighborPos = predicted[neighborIndex].xyz;
                let offset = neighborPos - pos;
                let dstSq = dot(offset, offset);
                
                if (dstSq <= radiusSq) {
                    let dst = sqrt(dstSq);
                    let invDst = select(0.0, 1.0 / dst, dst > 0.0);
                    let dir = offset * invDst;

                    let neighborDensityPair = densities[neighborIndex];
                    let neighborDensity = neighborDensityPair.x;
                    let neighborNearDensity = neighborDensityPair.y;
                    let neighborPressure = (neighborDensity - params.targetDensity) * params.pressureMultiplier;
                    let neighborNearPressure = params.nearPressureMultiplier * neighborNearDensity;

                    let sharedPressure = (pressure + neighborPressure) * 0.5;
                    let sharedNearPressure = (nearPressure + neighborNearPressure) * 0.5;

                    if (neighborDensity > 0.0) {
                        let scale = derivativeSpikyPow2(dst, params.radius, params.spikyPow2DerivScale) * (sharedPressure / neighborDensity);
                        force = force + dir * scale;
                    }

                    if (neighborNearDensity > 0.0) {
                        let scale = derivativeSpikyPow3(dst, params.radius, params.spikyPow3DerivScale) * (sharedNearPressure / neighborNearDensity);
                        force = force + dir * scale;
                    }
                }
            }
            j = j + 1u;
        }
      }
    }
  }

  let accel = force / density;
  velocities[i] = vec4<f32>(velocities[i].xyz + accel * params.dt, 0.0);
}
