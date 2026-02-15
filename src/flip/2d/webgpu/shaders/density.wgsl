/**
 * Particle Density Compute Shader
 *
 * Computes particle density per grid cell using bilinear interpolation.
 * Each particle contributes its weight to 4 neighboring cells.
 * Uses atomic accumulation with fixed-point encoding.
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

// Fixed-point scale factor (same as P2G for consistency)
const SCALE: f32 = 65536.0;

@group(0) @binding(0) var<storage, read> positions: array<vec2<f32>>;
@group(0) @binding(1) var<storage, read_write> densityAccum: array<atomic<i32>>;
@group(0) @binding(2) var<uniform> params: SimParams;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;

  if (i >= u32(params.numParticles)) {
    return;
  }

  let n = params.fNumY;
  let h = params.h;
  let h1 = params.fInvSpacing;
  let h2 = 0.5 * h;

  let pos = positions[i];

  // Clamp position to valid range
  let px = clamp(pos.x, h, f32(params.fNumX - 1) * h);
  let py = clamp(pos.y, h, f32(params.fNumY - 1) * h);

  // Cell-centered sampling (offset by h2 in both x and y)
  let x0 = i32(floor((px - h2) * h1));
  let tx = ((px - h2) - f32(x0) * h) * h1;
  let x1 = min(x0 + 1, params.fNumX - 2);

  let y0 = i32(floor((py - h2) * h1));
  let ty = ((py - h2) - f32(y0) * h) * h1;
  let y1 = min(y0 + 1, params.fNumY - 2);

  let sx = 1.0 - tx;
  let sy = 1.0 - ty;

  // Bilinear weights
  let d0 = sx * sy;
  let d1 = tx * sy;
  let d2 = tx * ty;
  let d3 = sx * ty;

  // Accumulate to 4 neighboring cells
  // Check bounds (x0, y0 could be negative near boundaries)
  if (x0 >= 0 && x0 < params.fNumX && y0 >= 0 && y0 < params.fNumY) {
    atomicAdd(&densityAccum[u32(x0 * n + y0)], i32(d0 * SCALE));
  }
  if (x1 >= 0 && x1 < params.fNumX && y0 >= 0 && y0 < params.fNumY) {
    atomicAdd(&densityAccum[u32(x1 * n + y0)], i32(d1 * SCALE));
  }
  if (x1 >= 0 && x1 < params.fNumX && y1 >= 0 && y1 < params.fNumY) {
    atomicAdd(&densityAccum[u32(x1 * n + y1)], i32(d2 * SCALE));
  }
  if (x0 >= 0 && x0 < params.fNumX && y1 >= 0 && y1 < params.fNumY) {
    atomicAdd(&densityAccum[u32(x0 * n + y1)], i32(d3 * SCALE));
  }
}
