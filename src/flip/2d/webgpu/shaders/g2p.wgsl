/**
 * Grid to Particle (G2P) Velocity Transfer Compute Shader
 *
 * Transfers velocities from the MAC grid back to particles using bilinear interpolation.
 * Implements FLIP/PIC blending for stable yet detailed fluid motion.
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

const FLUID_CELL: i32 = 0;
const AIR_CELL: i32 = 1;
const SOLID_CELL: i32 = 2;

@group(0) @binding(0) var<storage, read> positions: array<vec2<f32>>;
@group(0) @binding(1) var<storage, read_write> velocities: array<vec2<f32>>;
@group(0) @binding(2) var<storage, read> gridU: array<f32>;
@group(0) @binding(3) var<storage, read> gridV: array<f32>;
@group(0) @binding(4) var<storage, read> prevU: array<f32>;
@group(0) @binding(5) var<storage, read> prevV: array<f32>;
@group(0) @binding(6) var<storage, read> cellType: array<i32>;
@group(0) @binding(7) var<uniform> params: SimParams;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;

  // Bounds check
  if (i >= u32(params.numParticles)) {
    return;
  }

  // Keep dummy read to prevent binding from being optimized away
  let _ct = cellType[0];

  let n = params.fNumY;
  let h = params.h;
  let h1 = params.fInvSpacing;
  let h2 = 0.5 * h;

  let pos = positions[i];
  let origVel = velocities[i];
  var vel = origVel;

  // Clamp position to grid interior
  let px = clamp(pos.x, h, f32(params.fNumX - 1) * h);
  let py = clamp(pos.y, h, f32(params.fNumY - 1) * h);

  // PIC + FLIP for U component (no validity checks for now)
  {
    let x0 = min(i32(floor(px * h1)), params.fNumX - 2);
    let tx = (px - f32(x0) * h) * h1;
    let x1 = min(x0 + 1, params.fNumX - 2);

    let y0 = min(i32(floor((py - h2) * h1)), params.fNumY - 2);
    let ty = ((py - h2) - f32(y0) * h) * h1;
    let y1 = min(y0 + 1, params.fNumY - 2);

    let sx = 1.0 - tx;
    let sy = 1.0 - ty;

    let d0 = sx * sy;
    let d1 = tx * sy;
    let d2 = tx * ty;
    let d3 = sx * ty;

    let nr0 = u32(x0 * n + y0);
    let nr1 = u32(x1 * n + y0);
    let nr2 = u32(x1 * n + y1);
    let nr3 = u32(x0 * n + y1);

    let picV = d0 * gridU[nr0] + d1 * gridU[nr1] + d2 * gridU[nr2] + d3 * gridU[nr3];

    let corr = d0 * (gridU[nr0] - prevU[nr0]) +
               d1 * (gridU[nr1] - prevU[nr1]) +
               d2 * (gridU[nr2] - prevU[nr2]) +
               d3 * (gridU[nr3] - prevU[nr3]);
    let flipV = origVel.x + corr;

    vel.x = (1.0 - params.flipRatio) * picV + params.flipRatio * flipV;
  }

  // PIC + FLIP for V component (no validity checks for now)
  {
    let x0 = min(i32(floor((px - h2) * h1)), params.fNumX - 2);
    let tx = ((px - h2) - f32(x0) * h) * h1;
    let x1 = min(x0 + 1, params.fNumX - 2);

    let y0 = min(i32(floor(py * h1)), params.fNumY - 2);
    let ty = (py - f32(y0) * h) * h1;
    let y1 = min(y0 + 1, params.fNumY - 2);

    let sx = 1.0 - tx;
    let sy = 1.0 - ty;

    let d0 = sx * sy;
    let d1 = tx * sy;
    let d2 = tx * ty;
    let d3 = sx * ty;

    let nr0 = u32(x0 * n + y0);
    let nr1 = u32(x1 * n + y0);
    let nr2 = u32(x1 * n + y1);
    let nr3 = u32(x0 * n + y1);

    let picV = d0 * gridV[nr0] + d1 * gridV[nr1] + d2 * gridV[nr2] + d3 * gridV[nr3];

    let corr = d0 * (gridV[nr0] - prevV[nr0]) +
               d1 * (gridV[nr1] - prevV[nr1]) +
               d2 * (gridV[nr2] - prevV[nr2]) +
               d3 * (gridV[nr3] - prevV[nr3]);
    let flipV = origVel.y + corr;

    vel.y = (1.0 - params.flipRatio) * picV + params.flipRatio * flipV;
  }

  velocities[i] = vel;
}
