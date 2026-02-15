/**
 * Particle Integration Compute Shader
 *
 * Applies gravity and updates particle positions using semi-implicit Euler integration.
 * This is an embarrassingly parallel operation - one thread per particle.
 */

struct SimParams {
  // Floats
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

  // Ints
  fNumX: i32,
  fNumY: i32,
  fNumCells: i32,
  numParticles: i32,
  maxParticles: i32,
  pNumX: i32,
  pNumY: i32,
  pNumCells: i32,
};

@group(0) @binding(0) var<storage, read_write> positions: array<vec2<f32>>;
@group(0) @binding(1) var<storage, read_write> velocities: array<vec2<f32>>;
@group(0) @binding(2) var<uniform> params: SimParams;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;

  // Bounds check
  if (i >= u32(params.numParticles)) {
    return;
  }

  // Apply gravity to velocity
  var vel = velocities[i];
  vel.y = vel.y + params.gravity * params.dt;
  velocities[i] = vel;

  // Update position
  var pos = positions[i];
  pos = pos + vel * params.dt;
  positions[i] = pos;
}
