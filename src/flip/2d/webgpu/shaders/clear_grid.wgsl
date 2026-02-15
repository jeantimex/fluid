/**
 * Clear Grid Compute Shader
 *
 * Clears grid velocity arrays (u, v) and weight arrays (du, dv) to zero.
 * Also copies current velocities to prev buffers before clearing.
 */

struct SimParams {
  h: f32,
  fInvSpacing: f32,
  particleRadius: f32,
  pInvSpacing: f32,
  gravity: f32,
  dt: f32,
  flipRatio: f32,
  overRelaxation: f32,
  particleRestDensity: f32,
  domainWidth: f32,
  domainHeight: f32,
  _pad0: f32,
  fNumX: i32,
  fNumY: i32,
  fNumCells: i32,
  numParticles: i32,
  maxParticles: i32,
  pNumX: i32,
  pNumY: i32,
  pNumCells: i32,
};

@group(0) @binding(0) var<storage, read_write> gridU: array<f32>;
@group(0) @binding(1) var<storage, read_write> gridV: array<f32>;
@group(0) @binding(2) var<storage, read_write> gridDU: array<f32>;
@group(0) @binding(3) var<storage, read_write> gridDV: array<f32>;
@group(0) @binding(4) var<storage, read_write> prevU: array<f32>;
@group(0) @binding(5) var<storage, read_write> prevV: array<f32>;
@group(0) @binding(6) var<uniform> params: SimParams;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;

  if (i >= u32(params.fNumCells)) {
    return;
  }

  // Copy to prev before clearing
  prevU[i] = gridU[i];
  prevV[i] = gridV[i];

  // Clear
  gridU[i] = 0.0;
  gridV[i] = 0.0;
  gridDU[i] = 0.0;
  gridDV[i] = 0.0;
}
