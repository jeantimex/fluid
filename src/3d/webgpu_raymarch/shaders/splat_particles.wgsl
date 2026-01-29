/**
 * Splat Particles Compute Shader
 *
 * Each thread processes one particle, splatting its density contribution
 * into nearby voxels using atomicAdd with fixed-point encoding.
 */

struct SplatParams {
  radius: f32,
  spikyPow2Scale: f32,
  particleCount: u32,
  fixedPointScale: f32,
  boundsSize: vec3<f32>,
  pad0: f32,
  volumeSize: vec3<u32>,
  pad1: u32,
};

@group(0) @binding(0) var<storage, read> predicted: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> atomicBuffer: array<atomic<u32>>;
@group(0) @binding(2) var<uniform> params: SplatParams;

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
  let volumeSizeF = vec3<f32>(params.volumeSize);

  // Convert particle world position to voxel-space (continuous)
  let uvw = (particlePos + 0.5 * params.boundsSize) / params.boundsSize;
  let voxelPos = uvw * (volumeSizeF - vec3<f32>(1.0));

  // Determine the range of voxels affected by this particle
  let radiusInVoxels = radius / params.boundsSize * (volumeSizeF - vec3<f32>(1.0));
  let minVoxel = vec3<i32>(floor(voxelPos - radiusInVoxels));
  let maxVoxel = vec3<i32>(ceil(voxelPos + radiusInVoxels));

  // Clamp to volume bounds
  let clampedMin = max(minVoxel, vec3<i32>(0));
  let clampedMax = min(maxVoxel, vec3<i32>(params.volumeSize) - vec3<i32>(1));

  for (var z = clampedMin.z; z <= clampedMax.z; z++) {
    for (var y = clampedMin.y; y <= clampedMax.y; y++) {
      for (var x = clampedMin.x; x <= clampedMax.x; x++) {
        // Convert voxel index back to world position
        let voxelUvw = vec3<f32>(f32(x), f32(y), f32(z)) / max(volumeSizeF - vec3<f32>(1.0), vec3<f32>(1.0));
        let worldPos = (voxelUvw - vec3<f32>(0.5)) * params.boundsSize;

        let offset = worldPos - particlePos;
        let sqrDst = dot(offset, offset);
        if (sqrDst <= radius * radius) {
          let dst = sqrt(sqrDst);
          let density = spikyPow2(dst, radius, params.spikyPow2Scale);

          // Fixed-point encode and atomicAdd
          let fixedVal = u32(density * params.fixedPointScale);
          if (fixedVal > 0u) {
            let bufferIdx = u32(x) + params.volumeSize.x * (u32(y) + params.volumeSize.y * u32(z));
            atomicAdd(&atomicBuffer[bufferIdx], fixedVal);
          }
        }
      }
    }
  }
}
