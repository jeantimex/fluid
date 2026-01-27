struct SortParams {
  particleCount: u32,
  pad0: vec3<u32>,
};

@group(0) @binding(0) var<storage, read> sortedKeys: array<u32>;
@group(0) @binding(1) var<storage, read_write> spatialOffsets: array<u32>;
@group(0) @binding(2) var<uniform> params: SortParams;

@compute @workgroup_size(256)
fn initOffsets(@builtin(global_invocation_id) id: vec3<u32>) {
  let index = id.x;
  if (index >= params.particleCount) { return; }
  spatialOffsets[index] = params.particleCount;
}

@compute @workgroup_size(256)
fn calculateOffsets(@builtin(global_invocation_id) id: vec3<u32>) {
  let index = id.x;
  if (index >= params.particleCount) { return; }
  
  let key = sortedKeys[index];
  
  if (index == 0u) {
    spatialOffsets[key] = index;
  } else {
    let prevKey = sortedKeys[index - 1u];
    if (key != prevKey) {
      spatialOffsets[key] = index;
    }
  }
}
