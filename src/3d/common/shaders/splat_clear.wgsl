// =============================================================================
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
