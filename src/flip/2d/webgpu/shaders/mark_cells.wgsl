/**
 * Mark Cells Compute Shader
 *
 * First pass: Mark cells as SOLID or AIR based on solid flag.
 * This runs per grid cell.
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

@group(0) @binding(0) var<storage, read> gridS: array<f32>;
@group(0) @binding(1) var<storage, read_write> cellType: array<i32>;
@group(0) @binding(2) var<uniform> params: SimParams;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;

  if (i >= u32(params.fNumCells)) {
    return;
  }

  // Mark as SOLID if s == 0, otherwise AIR (will be marked FLUID by particles)
  if (gridS[i] == 0.0) {
    cellType[i] = SOLID_CELL;
  } else {
    cellType[i] = AIR_CELL;
  }
}
