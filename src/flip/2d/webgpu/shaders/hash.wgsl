/**
 * Particle Hash Compute Shader
 *
 * Computes spatial hash cell index for each particle.
 * This is the first step of the counting sort for spatial hashing.
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

@group(0) @binding(0) var<storage, read> positions: array<vec2<f32>>;
@group(0) @binding(1) var<storage, read_write> particleHash: array<u32>;
@group(0) @binding(2) var<storage, read_write> particleIndex: array<u32>;
@group(0) @binding(3) var<uniform> params: SimParams;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;

  if (i >= u32(params.numParticles)) {
    return;
  }

  let pos = positions[i];

  // Compute cell indices
  let xi = clamp(i32(floor(pos.x * params.pInvSpacing)), 0, params.pNumX - 1);
  let yi = clamp(i32(floor(pos.y * params.pInvSpacing)), 0, params.pNumY - 1);

  // Compute cell number (hash key)
  let cellNr = u32(xi * params.pNumY + yi);

  // Store hash and original index
  particleHash[i] = cellNr;
  particleIndex[i] = i;
}
