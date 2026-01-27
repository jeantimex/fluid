struct HashParams {
  radius: f32,
  particleCount: f32,
  pad0: vec2<f32>,
};

@group(0) @binding(0) var<storage, read> predicted: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> keys: array<u32>;
@group(0) @binding(2) var<storage, read_write> indices: array<u32>;
@group(0) @binding(3) var<uniform> params: HashParams;

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

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let index = id.x;
  let count = u32(params.particleCount + 0.5);
  if (index >= count) {
    return;
  }

  let pos = predicted[index].xyz;
  let cellX = i32(floor(pos.x / params.radius));
  let cellY = i32(floor(pos.y / params.radius));
  let cellZ = i32(floor(pos.z / params.radius));
  
  let hash = hashCell3D(cellX, cellY, cellZ);
  let key = hash % count;
  keys[index] = key;
  indices[index] = index;
}
