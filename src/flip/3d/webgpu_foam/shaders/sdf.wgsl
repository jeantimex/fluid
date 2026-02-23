// =============================================================================
// Surface SDF (Signed Distance Field) Compute Kernels
// =============================================================================
// Separate shader module to stay within 10 storage buffer per-stage limit.
// These kernels only need marker and SDF buffers, not the full FLIP buffers.
// =============================================================================

struct SDFUniforms {
  nx: u32,
  ny: u32,
  nz: u32,
  _pad: u32,
};

@group(0) @binding(0) var<uniform> uniforms: SDFUniforms;
@group(0) @binding(1) var<storage, read> marker: array<u32>;
@group(0) @binding(2) var<storage, read_write> surfaceSDF: array<f32>;

/// Convert 3D grid coordinates to linear buffer index (cell-centered).
fn scalarIdx(x: u32, y: u32, z: u32) -> u32 {
  let cx = clamp(x, 0u, uniforms.nx - 1u);
  let cy = clamp(y, 0u, uniforms.ny - 1u);
  let cz = clamp(z, 0u, uniforms.nz - 1u);
  return cx + cy * uniforms.nx + cz * uniforms.nx * uniforms.ny;
}

// =============================================================================
// INIT SDF - Initialize Surface Signed Distance Field
// =============================================================================
// Initializes the SDF buffer based on marker values:
// - Fluid cells (marker=1): SDF = -0.5 (inside by half a cell)
// - Air cells (marker=0): SDF = large positive (far outside, to be refined by JFA)
//
// The SDF is used for whitewater particle classification:
// - SDF < -threshold: deep inside fluid → bubble
// - SDF ≈ 0: at surface → foam
// - SDF > +threshold: outside fluid → spray
// =============================================================================

@compute @workgroup_size(8, 4, 4)
fn initSDF(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= uniforms.nx || id.y >= uniforms.ny || id.z >= uniforms.nz) { return; }

  let si = scalarIdx(id.x, id.y, id.z);
  let isFluid = marker[si] == 1u;

  // Initialize SDF:
  // - Fluid cells get negative value (inside)
  // - Air cells get large positive value (outside, will be refined by JFA)
  if (isFluid) {
    surfaceSDF[si] = -0.5;  // Inside by half a cell
  } else {
    surfaceSDF[si] = 100.0; // Large positive (far outside)
  }
}
