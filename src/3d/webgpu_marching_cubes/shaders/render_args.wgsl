struct ArgsParams {
  maxTriangles: u32,
  _pad0: vec3<u32>,
};

@group(0) @binding(0) var<storage, read_write> triangleCount: atomic<u32>;
@group(0) @binding(1) var<storage, read_write> renderArgs: array<u32>;
@group(0) @binding(2) var<uniform> params: ArgsParams;

@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let triCount = min(atomicLoad(&triangleCount), params.maxTriangles);
  renderArgs[0] = triCount * 3u;
  renderArgs[1] = 1u;
  renderArgs[2] = 0u;
  renderArgs[3] = 0u;
}
