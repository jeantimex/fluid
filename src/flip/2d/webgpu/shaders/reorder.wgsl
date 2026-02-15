/**
 * Particle Reorder Compute Shader
 *
 * Places particle indices into sorted order based on their cell.
 * Uses atomic decrements to handle multiple particles per cell.
 *
 * After this shader:
 * - sortedIndex contains particle indices sorted by cell
 * - cellOffset is modified (decremented) - need to restore from cellCount after
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
@group(0) @binding(1) var<storage, read> particleIndex: array<u32>;
@group(0) @binding(2) var<storage, read_write> cellOffset: array<atomic<u32>>;
@group(0) @binding(3) var<storage, read_write> sortedIndex: array<u32>;
@group(0) @binding(4) var<uniform> params: SimParams;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;

  if (i >= u32(params.numParticles)) {
    return;
  }

  let cellNr = particleHash[i];
  let origIndex = particleIndex[i];

  // Atomically get slot and decrement offset
  // Note: This modifies cellOffset, so we need separate buffers or restore after
  let slot = atomicAdd(&cellOffset[cellNr], 1u);

  sortedIndex[slot] = origIndex;
}
