/**
 * Pressure Solver Compute Shader (Red-Black Gauss-Seidel)
 *
 * Solves for pressure to enforce incompressibility.
 * Uses Red-Black ordering to allow parallel updates:
 * - Red cells: (i + j) % 2 == 0
 * - Black cells: (i + j) % 2 == 1
 *
 * Each dispatch processes either red or black cells.
 * The `colorPass` uniform controls which cells to process.
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

struct PressureParams {
  cp: f32,              // density * h / dt
  colorPass: i32,       // 0 = red cells, 1 = black cells
  compensateDrift: i32, // whether to compensate for density drift
  _pad: i32,
};

const FLUID_CELL: i32 = 0;
const AIR_CELL: i32 = 1;
const SOLID_CELL: i32 = 2;

@group(0) @binding(0) var<storage, read_write> gridU: array<f32>;
@group(0) @binding(1) var<storage, read_write> gridV: array<f32>;
@group(0) @binding(2) var<storage, read_write> gridP: array<f32>;
@group(0) @binding(3) var<storage, read> gridS: array<f32>;
@group(0) @binding(4) var<storage, read> cellType: array<i32>;
@group(0) @binding(5) var<storage, read> density: array<f32>;
@group(0) @binding(6) var<uniform> params: SimParams;
@group(0) @binding(7) var<uniform> pressureParams: PressureParams;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let idx = id.x;

  // Convert linear index to 2D grid coordinates
  // We process interior cells only (1 to fNumX-2, 1 to fNumY-2)
  let interiorWidth = params.fNumX - 2;
  let interiorHeight = params.fNumY - 2;
  let interiorCells = u32(interiorWidth * interiorHeight);

  if (idx >= interiorCells) {
    return;
  }

  // Convert to interior coordinates
  let ix = i32(idx) % interiorWidth;
  let iy = i32(idx) / interiorWidth;

  // Convert to full grid coordinates (offset by 1 for boundary)
  let i = ix + 1;
  let j = iy + 1;

  // Red-Black check: skip if not the right color
  let cellColor = (i + j) % 2;
  if (cellColor != pressureParams.colorPass) {
    return;
  }

  let n = params.fNumY;
  let center = i * n + j;

  // Only process fluid cells
  if (cellType[center] != FLUID_CELL) {
    return;
  }

  let left = (i - 1) * n + j;
  let right = (i + 1) * n + j;
  let bottom = i * n + j - 1;
  let top = i * n + j + 1;

  // Get solid flags of neighbors
  let sx0 = gridS[left];
  let sx1 = gridS[right];
  let sy0 = gridS[bottom];
  let sy1 = gridS[top];
  let s = sx0 + sx1 + sy0 + sy1;

  if (s == 0.0) {
    return;
  }

  // Compute divergence
  var div = gridU[right] - gridU[center] + gridV[top] - gridV[center];

  // Drift compensation
  if (params.particleRestDensity > 0.0 && pressureParams.compensateDrift != 0) {
    let k = 1.0;
    let compression = density[center] - params.particleRestDensity;
    if (compression > 0.0) {
      div = div - k * compression;
    }
  }

  // Compute pressure correction
  var pressure = -div / s;
  pressure *= params.overRelaxation;

  // Update pressure (accumulate)
  gridP[center] += pressureParams.cp * pressure;

  // Update velocities
  gridU[center] -= sx0 * pressure;
  gridU[right] += sx1 * pressure;
  gridV[center] -= sy0 * pressure;
  gridV[top] += sy1 * pressure;
}
