/**
 * Particle Count Compute Shader
 *
 * Counts particles per cell using atomic operations.
 * Must clear cellCount to 0 before running this shader.
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

@group(0) @binding(0) var<storage, read> particleHash: array<u32>;
@group(0) @binding(1) var<storage, read_write> cellCount: array<atomic<u32>>;
@group(0) @binding(2) var<uniform> params: SimParams;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;

  if (i >= u32(params.numParticles)) {
    return;
  }

  let cellNr = particleHash[i];
  atomicAdd(&cellCount[cellNr], 1u);
}
