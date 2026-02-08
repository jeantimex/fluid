/**
 * Density Probe Shader
 *
 * Beginner note: reads a single voxel from the density texture for debugging.
 */

struct ProbeParams {
  coord: vec3<u32>,
  _pad0: u32,
};

@group(0) @binding(0) var densityTex: texture_3d<f32>;
@group(0) @binding(1) var<uniform> params: ProbeParams;
@group(0) @binding(2) var<storage, read_write> outValue: array<f32>;

@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let c = vec3<i32>(params.coord);
  let sample = textureLoad(densityTex, c, 0).r;
  outValue[0] = sample;
}
