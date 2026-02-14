// =============================================================================
// Splat Resolve Compute Shader
// =============================================================================
//
// Pass 3 of the 3-pass density splatting pipeline.
//
// Converts the atomic u32 density buffer back to f32 by dividing by the
// fixed-point scale factor, then writes the result into the R channel of
// the rgba16float 3D density texture. This texture is subsequently sampled
// by the raymarch fragment shader.
//
// Each thread processes one voxel (dispatched as 8×8×4 workgroups).
// =============================================================================

// Beginner note: this converts integer atomics back into float density.

/// Parameters for the resolve pass.
struct ResolveParams {
  fixedPointScale: f32,
  pad0: f32,
  pad1: f32,
  pad2: f32,
  volumeSize: vec3<u32>,
  pad3: u32,
};

/// Atomic density buffer (read-only in this pass; written by splat pass).
@group(0) @binding(0) var<storage, read> atomicBuffer: array<u32>;

/// Output 3D density texture (rgba16float, only the R channel is used).
@group(0) @binding(1) var densityVolume: texture_storage_3d<rgba16float, write>;

/// Uniform parameters.
@group(0) @binding(2) var<uniform> params: ResolveParams;

/// Main entry point — one thread per voxel.
/// Reads the accumulated fixed-point u32 value, converts to f32 by dividing
/// by the fixed-point scale, and stores into the density texture's R channel.
@compute @workgroup_size(8, 8, 4)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  // Bounds check: skip threads outside the volume
  if (id.x >= params.volumeSize.x || id.y >= params.volumeSize.y || id.z >= params.volumeSize.z) {
    return;
  }

  // Linear buffer index: x + volumeSize.x * (y + volumeSize.y * z)
  let bufferIdx = id.x + params.volumeSize.x * (id.y + params.volumeSize.y * id.z);

  // Convert fixed-point integer back to floating-point density
  let rawVal = atomicBuffer[bufferIdx];
  let density = f32(rawVal) / params.fixedPointScale;

  // Write density to the R channel of the output texture
  textureStore(densityVolume, vec3<i32>(id), vec4<f32>(density, 0.0, 0.0, 1.0));
}
