struct SortParams {
  particleCount: u32,
  pad0: vec3<u32>,
};

@group(0) @binding(0) var<storage, read> keys: array<u32>;
@group(0) @binding(1) var<storage, read_write> sortOffsets: array<u32>;
@group(0) @binding(2) var<storage, read_write> sortedKeys: array<u32>;
@group(0) @binding(3) var<storage, read_write> indices: array<u32>;
@group(0) @binding(4) var<uniform> params: SortParams;

@compute @workgroup_size(1)
fn prefixAndScatter(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x != 0u) {
    return;
  }

  let count = params.particleCount;
  var sum = 0u;
  for (var k = 0u; k < count; k = k + 1u) {
    let c = sortOffsets[k];
    sortOffsets[k] = sum;
    sum = sum + c;
  }

  for (var i = 0u; i < count; i = i + 1u) {
    let key = keys[i];
    let dest = sortOffsets[key];
    sortOffsets[key] = dest + 1u;
    indices[dest] = i;
    sortedKeys[dest] = key;
  }
}
