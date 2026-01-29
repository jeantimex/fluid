/**
 * Splat Clear Compute Shader
 *
 * Zeros the atomic density buffer before each frame's splatting pass.
 */

struct ClearParams {
  totalVoxels: u32,
};

@group(0) @binding(0) var<storage, read_write> atomicBuffer: array<atomic<u32>>;
@group(0) @binding(1) var<uniform> params: ClearParams;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let idx = id.x;
  if (idx >= params.totalVoxels) {
    return;
  }
  atomicStore(&atomicBuffer[idx], 0u);
}
