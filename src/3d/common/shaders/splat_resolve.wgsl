// =============================================================================
// Splat Resolve Compute Shader
// =============================================================================
//
// Pass 3 of the 3-pass density splatting pipeline.
//
// Converts the atomic u32 density buffer back to f32 by dividing by the
// fixed-point scale factor, computes the surface normal from the density
// gradient, and writes both to the rgba16float 3D density texture:
//   R = density value
//   G = normal.x (remapped from [-1,1] to [0,1])
//   B = normal.y (remapped from [-1,1] to [0,1])
//   A = normal.z (remapped from [-1,1] to [0,1])
//
// Computing normals here saves 6 texture samples per normal lookup in the
// raymarch fragment shader (a significant performance win).
//
// Each thread processes one voxel (dispatched as 8×8×4 workgroups).
// =============================================================================

// Beginner note: this converts integer atomics back into float density
// and precomputes surface normals for faster raymarching.

/// Parameters for the resolve pass.
struct ResolveParams {
  fixedPointScale: f32,
  computeNormals: f32,  // 1.0 = compute normals, 0.0 = skip
  pad1: f32,
  pad2: f32,
  volumeSize: vec3<u32>,
  pad3: u32,
};

/// Atomic density buffer (read-only in this pass; written by splat pass).
@group(0) @binding(0) var<storage, read> atomicBuffer: array<u32>;

/// Output 3D density texture (rgba16float).
@group(0) @binding(1) var densityVolume: texture_storage_3d<rgba16float, write>;

/// Uniform parameters.
@group(0) @binding(2) var<uniform> params: ResolveParams;

/// Reads density from the atomic buffer at the given voxel coordinate.
/// Returns 0 for out-of-bounds coordinates.
fn readDensityAt(coord: vec3<i32>) -> f32 {
  // Bounds check
  if (coord.x < 0 || coord.y < 0 || coord.z < 0 ||
      u32(coord.x) >= params.volumeSize.x ||
      u32(coord.y) >= params.volumeSize.y ||
      u32(coord.z) >= params.volumeSize.z) {
    return 0.0;
  }

  let idx = u32(coord.x) + params.volumeSize.x * (u32(coord.y) + params.volumeSize.y * u32(coord.z));
  return f32(atomicBuffer[idx]) / params.fixedPointScale;
}

/// Main entry point — one thread per voxel.
/// Reads the accumulated fixed-point u32 value, converts to f32, computes
/// the surface normal from density gradient, and stores both in the texture.
@compute @workgroup_size(8, 8, 4)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  // Bounds check: skip threads outside the volume
  if (id.x >= params.volumeSize.x || id.y >= params.volumeSize.y || id.z >= params.volumeSize.z) {
    return;
  }

  let coord = vec3<i32>(id);

  // Convert fixed-point integer back to floating-point density
  let bufferIdx = id.x + params.volumeSize.x * (id.y + params.volumeSize.y * id.z);
  let rawVal = atomicBuffer[bufferIdx];
  let density = f32(rawVal) / params.fixedPointScale;

  // Compute normal from density gradient (if enabled)
  var encodedNormal = vec3<f32>(0.5, 1.0, 0.5); // Default: up vector encoded

  if (params.computeNormals > 0.5) {
    // Central differences for gradient computation
    let dx = readDensityAt(coord - vec3<i32>(1, 0, 0)) - readDensityAt(coord + vec3<i32>(1, 0, 0));
    let dy = readDensityAt(coord - vec3<i32>(0, 1, 0)) - readDensityAt(coord + vec3<i32>(0, 1, 0));
    let dz = readDensityAt(coord - vec3<i32>(0, 0, 1)) - readDensityAt(coord + vec3<i32>(0, 0, 1));

    var normal = vec3<f32>(dx, dy, dz);
    let len = length(normal);

    // Normalize, or use default up vector if gradient is near-zero
    if (len > 0.0001) {
      normal = normal / len;
    } else {
      normal = vec3<f32>(0.0, 1.0, 0.0);
    }

    // Remap normal from [-1, 1] to [0, 1] for storage in unsigned texture
    encodedNormal = normal * 0.5 + 0.5;
  }

  // Store density in R, encoded normal in GBA
  textureStore(densityVolume, coord, vec4<f32>(density, encodedNormal.x, encodedNormal.y, encodedNormal.z));
}
