struct DensityParams {
  radius: f32,
  spikyPow2Scale: f32,
  spikyPow3Scale: f32,
  particleCountF: f32,
  pad0: vec4<f32>,
};

@group(0) @binding(0) var<storage, read> predicted: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read> sortedKeys: array<u32>;
@group(0) @binding(2) var<storage, read> spatialOffsets: array<u32>;
@group(0) @binding(3) var<storage, read_write> densities: array<vec2<f32>>;
@group(0) @binding(4) var<uniform> params: DensityParams;

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

  let pos = predicted[i].xyz;
  let originCellX = i32(floor(pos.x / params.radius));
  let originCellY = i32(floor(pos.y / params.radius));
  let originCellZ = i32(floor(pos.z / params.radius));

  var density = 0.0;
  var nearDensity = 0.0;
  let radiusSq = params.radius * params.radius;

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
            let neighborPos = predicted[neighborIndex].xyz;
            let offset = neighborPos - pos;
            let dstSq = dot(offset, offset);
            
            if (dstSq <= radiusSq) {
                let dst = sqrt(dstSq);
                density = density + spikyPow2(dst, params.radius, params.spikyPow2Scale);
                nearDensity = nearDensity + spikyPow3(dst, params.radius, params.spikyPow3Scale);
            }
            j = j + 1u;
        }
      }
    }
  }

  densities[i] = vec2<f32>(density, nearDensity);
}
