/**
 * Prefix Sum (Exclusive Scan) Compute Shader
 *
 * Computes exclusive prefix sum of cell counts.
 * Uses a simple sequential approach - suitable for small arrays.
 * For larger arrays, would need a parallel Blelloch scan.
 *
 * cellOffset[i] = sum of cellCount[0..i-1]
 * cellOffset[0] = 0
 * cellOffset[pNumCells] = total particle count (guard value)
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

@group(0) @binding(0) var<storage, read> cellCount: array<u32>;
@group(0) @binding(1) var<storage, read_write> cellOffset: array<u32>;
@group(0) @binding(2) var<uniform> params: SimParams;

// Single-threaded prefix sum - simple but works for small arrays
@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  var sum = 0u;

  for (var i = 0u; i < u32(params.pNumCells); i++) {
    cellOffset[i] = sum;
    sum += cellCount[i];
  }

  // Guard value at the end
  cellOffset[u32(params.pNumCells)] = sum;
}
