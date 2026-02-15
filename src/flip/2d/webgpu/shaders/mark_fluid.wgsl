/**
 * Mark Fluid Cells Compute Shader
 *
 * Second pass: Mark cells containing particles as FLUID.
 * This runs per particle.
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

const FLUID_CELL: i32 = 0;
const AIR_CELL: i32 = 1;
const SOLID_CELL: i32 = 2;

@group(0) @binding(0) var<storage, read> positions: array<vec2<f32>>;
@group(0) @binding(1) var<storage, read_write> cellType: array<i32>;
@group(0) @binding(2) var<uniform> params: SimParams;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;

  if (i >= u32(params.numParticles)) {
    return;
  }

  let pos = positions[i];
  let xi = clamp(i32(floor(pos.x * params.fInvSpacing)), 0, params.fNumX - 1);
  let yi = clamp(i32(floor(pos.y * params.fInvSpacing)), 0, params.fNumY - 1);
  let cellNr = xi * params.fNumY + yi;

  // Only mark AIR cells as FLUID (don't change SOLID cells)
  if (cellType[cellNr] == AIR_CELL) {
    cellType[cellNr] = FLUID_CELL;
  }
}
