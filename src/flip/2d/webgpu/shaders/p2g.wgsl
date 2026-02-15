/**
 * P2G (Particle to Grid) Transfer Compute Shader
 *
 * Transfers velocities from particles to the MAC grid using atomic accumulation.
 * Uses fixed-point encoding since WebGPU atomics only support i32/u32.
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

// Fixed-point scale factor for accumulation
// Velocities are typically in range [-20, 20], weights sum to ~1 per particle
// Per cell: ~100 particles max, so max accumulated = 100 * 20 * SCALE
// With SCALE = 65536: max = 131M, well within i32 range (2B)
const SCALE: f32 = 65536.0;

@group(0) @binding(0) var<storage, read> positions: array<vec2<f32>>;
@group(0) @binding(1) var<storage, read> velocities: array<vec2<f32>>;
@group(0) @binding(2) var<storage, read_write> gridUAccum: array<atomic<i32>>;
@group(0) @binding(3) var<storage, read_write> gridVAccum: array<atomic<i32>>;
@group(0) @binding(4) var<storage, read_write> gridDUAccum: array<atomic<i32>>;
@group(0) @binding(5) var<storage, read_write> gridDVAccum: array<atomic<i32>>;
@group(0) @binding(6) var<uniform> params: SimParams;

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
  let vel = velocities[i];

  // Clamp position to valid range
  let px = clamp(pos.x, h, f32(params.fNumX - 1) * h);
  let py = clamp(pos.y, h, f32(params.fNumY - 1) * h);

  // === Transfer U component (sampled at left cell faces, offset by (0, h/2)) ===
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

    let pv = vel.x;

    // Accumulate to 4 neighboring cells using atomics
    let nr0 = u32(x0 * n + y0);
    let nr1 = u32(x1 * n + y0);
    let nr2 = u32(x1 * n + y1);
    let nr3 = u32(x0 * n + y1);

    // Fixed-point encoding: multiply by SCALE, convert to i32
    atomicAdd(&gridUAccum[nr0], i32(pv * d0 * SCALE));
    atomicAdd(&gridDUAccum[nr0], i32(d0 * SCALE));

    atomicAdd(&gridUAccum[nr1], i32(pv * d1 * SCALE));
    atomicAdd(&gridDUAccum[nr1], i32(d1 * SCALE));

    atomicAdd(&gridUAccum[nr2], i32(pv * d2 * SCALE));
    atomicAdd(&gridDUAccum[nr2], i32(d2 * SCALE));

    atomicAdd(&gridUAccum[nr3], i32(pv * d3 * SCALE));
    atomicAdd(&gridDUAccum[nr3], i32(d3 * SCALE));
  }

  // === Transfer V component (sampled at bottom cell faces, offset by (h/2, 0)) ===
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

    let pv = vel.y;

    let nr0 = u32(x0 * n + y0);
    let nr1 = u32(x1 * n + y0);
    let nr2 = u32(x1 * n + y1);
    let nr3 = u32(x0 * n + y1);

    atomicAdd(&gridVAccum[nr0], i32(pv * d0 * SCALE));
    atomicAdd(&gridDVAccum[nr0], i32(d0 * SCALE));

    atomicAdd(&gridVAccum[nr1], i32(pv * d1 * SCALE));
    atomicAdd(&gridDVAccum[nr1], i32(d1 * SCALE));

    atomicAdd(&gridVAccum[nr2], i32(pv * d2 * SCALE));
    atomicAdd(&gridDVAccum[nr2], i32(d2 * SCALE));

    atomicAdd(&gridVAccum[nr3], i32(pv * d3 * SCALE));
    atomicAdd(&gridDVAccum[nr3], i32(d3 * SCALE));
  }
}
