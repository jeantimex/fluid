/**
 * Density Volume Compute Shader
 *
 * Samples particle density at each voxel of a 3D texture.
 * The neighbor search uses the same spatial hash as the particle density pass.
 */

struct DensityVolumeParams {
  radius: f32,
  spikyPow2Scale: f32,
  particleCount: f32,
  pad0: f32,
  boundsSize: vec3<f32>,
  pad1: f32,
  volumeSize: vec3<u32>,
  pad2: u32,
};

@group(0) @binding(0) var<storage, read> predicted: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read> sortedKeys: array<u32>;
@group(0) @binding(2) var<storage, read> spatialOffsets: array<u32>;
@group(0) @binding(3) var densityVolume: texture_storage_3d<rgba16float, write>;
@group(0) @binding(4) var<uniform> params: DensityVolumeParams;

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

fn spikyPow2(dst: f32, radius: f32, scale: f32) -> f32 {
  if (dst < radius) {
    let v = radius - dst;
    return v * v * scale;
  }
  return 0.0;
}

fn densityAtPoint(worldPos: vec3<f32>) -> f32 {
  let radius = params.radius;
  let sqrRadius = radius * radius;
  let cellX = i32(floor(worldPos.x / radius));
  let cellY = i32(floor(worldPos.y / radius));
  let cellZ = i32(floor(worldPos.z / radius));
  let count = u32(params.particleCount + 0.5);

  var density = 0.0;

  for (var dz = -1; dz <= 1; dz++) {
    for (var dy = -1; dy <= 1; dy++) {
      for (var dx = -1; dx <= 1; dx++) {
        let hash = hashCell3D(cellX + dx, cellY + dy, cellZ + dz);
        let key = hash % count;
        let start = spatialOffsets[key];

        var j = start;
        loop {
          if (j >= count) {
            break;
          }
          let neighborKey = sortedKeys[j];
          if (neighborKey != key) {
            break;
          }
          let neighborPos = predicted[j].xyz;
          let offset = neighborPos - worldPos;
          let sqrDst = dot(offset, offset);
          if (sqrDst <= sqrRadius) {
            density = density + spikyPow2(sqrt(sqrDst), radius, params.spikyPow2Scale);
          }
          j = j + 1u;
        }
      }
    }
  }

  return density;
}

@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= params.volumeSize.x || id.y >= params.volumeSize.y || id.z >= params.volumeSize.z) {
    return;
  }

  let volumeSizeF = vec3<f32>(params.volumeSize);
  let uvw = vec3<f32>(id) / max(volumeSizeF - vec3<f32>(1.0), vec3<f32>(1.0));
  let worldPos = (uvw - vec3<f32>(0.5)) * params.boundsSize;

  let density = densityAtPoint(worldPos);
  textureStore(densityVolume, vec3<i32>(id), vec4<f32>(density, 0.0, 0.0, 1.0));
}
