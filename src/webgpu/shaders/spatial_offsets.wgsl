struct SortParams {
  particleCount: u32,
  pad0: vec3<u32>,
};

@group(0) @binding(0) var<storage, read> sortedKeys: array<u32>;
@group(0) @binding(1) var<storage, read_write> spatialOffsets: array<u32>;
@group(0) @binding(2) var<uniform> params: SortParams;

@compute @workgroup_size(1)
fn buildOffsets(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x != 0u) {
    return;
  }

  let count = params.particleCount;
  for (var i = 0u; i < count; i = i + 1u) {
    spatialOffsets[i] = count;
  }

  for (var i = 0u; i < count; i = i + 1u) {
    if (i == 0u || sortedKeys[i] != sortedKeys[i - 1u]) {
      spatialOffsets[sortedKeys[i]] = i;
    }
  }
}
