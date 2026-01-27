struct SortParams {
  particleCount: u32,
  pad0: vec3<u32>,
};

@group(0) @binding(0) var<storage, read> keys: array<u32>;
@group(0) @binding(1) var<storage, read_write> sortOffsets: array<atomic<u32>>;
@group(0) @binding(2) var<storage, read_write> sortedKeys: array<u32>;
@group(0) @binding(3) var<storage, read_write> indices: array<u32>;
@group(0) @binding(4) var<uniform> params: SortParams;

@compute @workgroup_size(256)
fn scatter(@builtin(global_invocation_id) id: vec3<u32>) {
  let index = id.x;
  if (index >= params.particleCount) {
    return;
  }

  let key = keys[index];
  
  // Atomically increment the offset for this key to get a unique destination index
  let dest = atomicAdd(&sortOffsets[key], 1u);
  
  indices[dest] = index;
  sortedKeys[dest] = key;
}
