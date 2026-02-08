const e=`// =============================================================================
// Splat Clear Compute Shader
// =============================================================================
//
// Pass 1 of the 3-pass density splatting pipeline.
//
// Zeros the atomic density buffer before each frame's splatting pass.
// Each thread resets one u32 entry to 0 using atomicStore. This is necessary
// because the splat pass accumulates density via atomicAdd, so stale values
// from the previous frame must be cleared first.
// =============================================================================

// Beginner note: this pass is just a parallel memset for the 3D density grid.

/// Parameters for the clear pass.
struct ClearParams {
  totalVoxels: u32,   // Total number of voxels in the density volume
};

/// Atomic density buffer to be cleared (one u32 per voxel).
@group(0) @binding(0) var<storage, read_write> atomicBuffer: array<atomic<u32>>;

/// Uniform parameters.
@group(0) @binding(1) var<uniform> params: ClearParams;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let idx = id.x;
  if (idx >= params.totalVoxels) {
    return;
  }
  atomicStore(&atomicBuffer[idx], 0u);
}
`,n=`// =============================================================================
// Splat Particles Compute Shader
// =============================================================================
//
// Pass 2 of the 3-pass density splatting pipeline.
//
// Each thread processes one particle and accumulates its SPH kernel density
// contribution into nearby voxels of the atomic density buffer. The Spiky²
// kernel is evaluated at each affected voxel, converted to a fixed-point
// integer, and added via \`atomicAdd\` for thread-safe accumulation.
//
// ## Algorithm
//
// For each particle:
//   1. Convert world position → normalized UVW → voxel-space coordinate
//   2. Compute the kernel radius in voxel units
//   3. Loop over the axis-aligned bounding box of affected voxels
//   4. For each voxel, convert back to world space and measure distance
//   5. Evaluate the Spiky² kernel: W(r) = (h − r)² × scale
//   6. Encode as fixed-point u32 and \`atomicAdd\` into the buffer
//
// ## Fixed-Point Encoding
//
// WebGPU lacks atomicAdd for floats, so density values are multiplied by
// \`fixedPointScale\` (e.g. 1000) and stored as u32. The resolve pass divides
// by the same factor to recover the float density.
// =============================================================================

// Beginner note: this pass rasterizes particle density into a 3D voxel grid.

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
`,a=`// =============================================================================
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
`;export{n as a,a as b,e as s};
