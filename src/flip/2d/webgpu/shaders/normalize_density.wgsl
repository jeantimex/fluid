/**
 * Normalize Density Compute Shader
 *
 * Converts accumulated fixed-point density values to floats.
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

const SCALE: f32 = 65536.0;

@group(0) @binding(0) var<storage, read> densityAccum: array<i32>;
@group(0) @binding(1) var<storage, read_write> density: array<f32>;
@group(0) @binding(2) var<uniform> params: SimParams;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let idx = id.x;

  if (idx >= u32(params.fNumCells)) {
    return;
  }

  // Convert from fixed-point to float
  density[idx] = f32(densityAccum[idx]) / SCALE;
}
