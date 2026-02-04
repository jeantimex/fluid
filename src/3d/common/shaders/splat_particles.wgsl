// =============================================================================
// Splat Particles Compute Shader
// =============================================================================
//
// Pass 2 of the 3-pass density splatting pipeline.
//
// Each thread processes one particle and accumulates its SPH kernel density
// contribution into nearby voxels of the atomic density buffer. The Spiky²
// kernel is evaluated at each affected voxel, converted to a fixed-point
// integer, and added via `atomicAdd` for thread-safe accumulation.
//
// ## Algorithm
//
// For each particle:
//   1. Convert world position → normalized UVW → voxel-space coordinate
//   2. Compute the kernel radius in voxel units
//   3. Loop over the axis-aligned bounding box of affected voxels
//   4. For each voxel, convert back to world space and measure distance
//   5. Evaluate the Spiky² kernel: W(r) = (h − r)² × scale
//   6. Encode as fixed-point u32 and `atomicAdd` into the buffer
//
// ## Fixed-Point Encoding
//
// WebGPU lacks atomicAdd for floats, so density values are multiplied by
// `fixedPointScale` (e.g. 1000) and stored as u32. The resolve pass divides
// by the same factor to recover the float density.
// =============================================================================

/// Per-frame parameters for the splat pass.
struct SplatParams {
  radius: f32,            // SPH smoothing radius in world units
  spikyPow2Scale: f32,    // Spiky² kernel normalization: 15 / (2π h⁵)
  particleCount: u32,     // Number of active particles
  fixedPointScale: f32,   // Float-to-integer conversion factor (e.g. 1000)
  minBounds: vec3<f32>,   // Simulation domain min corner
  voxelsPerUnit: f32,     // Fixed world-to-voxel scale
  maxBounds: vec3<f32>,   // Simulation domain max corner
  pad1: f32,
  volumeSize: vec3<u32>,  // Density texture resolution (voxels per axis)
  pad2: u32,
};

/// Predicted particle positions (vec4 per particle; xyz = position, w unused).
@group(0) @binding(0) var<storage, read> predicted: array<vec4<f32>>;

/// Atomic density buffer — one u32 per voxel for thread-safe accumulation.
@group(0) @binding(1) var<storage, read_write> atomicBuffer: array<atomic<u32>>;

/// Uniform parameters for this pass.
@group(0) @binding(2) var<uniform> params: SplatParams;

/// Evaluates the Spiky² kernel: W(r, h) = (h − r)² × scale for r < h, else 0.
/// This is the squared variant of the standard Spiky kernel used in SPH
/// density estimation. The quadratic falloff produces smooth density fields.
fn spikyPow2(dst: f32, radius: f32, scale: f32) -> f32 {
  if (dst < radius) {
    let v = radius - dst;
    return v * v * scale;
  }
  return 0.0;
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let particleIdx = id.x;
  if (particleIdx >= params.particleCount) {
    return;
  }

  let particlePos = predicted[particleIdx].xyz;
  let radius = params.radius;
  let worldToVoxel = params.voxelsPerUnit;

  // Convert world position to continuous voxel-space coordinates [0, volumeSize − 1].
  let voxelPos = (particlePos - params.minBounds) * worldToVoxel;

  // Determine the axis-aligned bounding box of voxels within kernel radius.
  let radiusInVoxels = radius * worldToVoxel;
  let minVoxel = vec3<i32>(floor(voxelPos - radiusInVoxels));
  let maxVoxel = vec3<i32>(ceil(voxelPos + radiusInVoxels));

  // Clamp to volume bounds to avoid out-of-range buffer accesses
  let clampedMin = max(minVoxel, vec3<i32>(0));
  let clampedMax = min(maxVoxel, vec3<i32>(params.volumeSize) - vec3<i32>(1));

  // Iterate over all voxels in the clamped bounding box
  for (var z = clampedMin.z; z <= clampedMax.z; z++) {
    for (var y = clampedMin.y; y <= clampedMax.y; y++) {
      for (var x = clampedMin.x; x <= clampedMax.x; x++) {
        // Convert voxel index back to world position for distance check.
        // This MUST match the inverse of the mapping used above.
        let worldPos = params.minBounds + vec3<f32>(f32(x), f32(y), f32(z)) / worldToVoxel;

        // Check if this voxel is within the kernel radius
        let offset = worldPos - particlePos;
        let sqrDst = dot(offset, offset);
        if (sqrDst <= radius * radius) {
          let dst = sqrt(sqrDst);
          let density = spikyPow2(dst, radius, params.spikyPow2Scale);

          // Fixed-point encode and atomically accumulate
          let fixedVal = u32(density * params.fixedPointScale);
          if (fixedVal > 0u) {
            // Linear index: x + volumeSize.x * (y + volumeSize.y * z)
            let bufferIdx = u32(x) + params.volumeSize.x * (u32(y) + params.volumeSize.y * u32(z));
            atomicAdd(&atomicBuffer[bufferIdx], fixedVal);
          }
        }
      }
    }
  }
}
