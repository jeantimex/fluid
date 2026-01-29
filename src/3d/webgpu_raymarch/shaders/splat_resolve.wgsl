/**
 * Splat Resolve Compute Shader
 *
 * Converts the atomic u32 density buffer back to f32 and writes
 * to the rgba16float storage texture for raymarching.
 */

struct ResolveParams {
  fixedPointScale: f32,
  pad0: f32,
  pad1: f32,
  pad2: f32,
  volumeSize: vec3<u32>,
  pad3: u32,
};

@group(0) @binding(0) var<storage, read> atomicBuffer: array<u32>;
@group(0) @binding(1) var densityVolume: texture_storage_3d<rgba16float, write>;
@group(0) @binding(2) var<uniform> params: ResolveParams;

@compute @workgroup_size(8, 8, 4)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= params.volumeSize.x || id.y >= params.volumeSize.y || id.z >= params.volumeSize.z) {
    return;
  }

  let bufferIdx = id.x + params.volumeSize.x * (id.y + params.volumeSize.y * id.z);
  let rawVal = atomicBuffer[bufferIdx];
  let density = f32(rawVal) / params.fixedPointScale;

  textureStore(densityVolume, vec3<i32>(id), vec4<f32>(density, 0.0, 0.0, 1.0));
}
