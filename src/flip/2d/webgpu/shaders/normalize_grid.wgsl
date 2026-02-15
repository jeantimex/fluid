/**
 * Normalize Grid Velocities Compute Shader
 *
 * After P2G atomic accumulation:
 * 1. Reads accumulated fixed-point values
 * 2. Divides velocity by weight to get average
 * 3. Restores velocities for solid cells from prevU/prevV
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

// Read accumulated values (i32 fixed-point)
@group(0) @binding(0) var<storage, read> gridUAccum: array<i32>;
@group(0) @binding(1) var<storage, read> gridVAccum: array<i32>;
@group(0) @binding(2) var<storage, read> gridDUAccum: array<i32>;
@group(0) @binding(3) var<storage, read> gridDVAccum: array<i32>;

// Write normalized values (f32)
@group(0) @binding(4) var<storage, read_write> gridU: array<f32>;
@group(0) @binding(5) var<storage, read_write> gridV: array<f32>;

// Previous velocities for restoring solid cells
@group(0) @binding(6) var<storage, read> prevU: array<f32>;
@group(0) @binding(7) var<storage, read> prevV: array<f32>;

// Cell types
@group(0) @binding(8) var<storage, read> cellType: array<i32>;

@group(0) @binding(9) var<uniform> params: SimParams;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let idx = id.x;

  if (idx >= u32(params.fNumCells)) {
    return;
  }

  let n = params.fNumY;
  let i = i32(idx) / n;  // x index
  let j = i32(idx) % n;  // y index

  // === Normalize U velocity ===
  {
    let uAccum = gridUAccum[idx];
    let duAccum = gridDUAccum[idx];

    var u: f32;
    if (duAccum > 0) {
      // Scale factors cancel out: (uAccum/SCALE) / (duAccum/SCALE) = uAccum/duAccum
      u = f32(uAccum) / f32(duAccum);
    } else {
      u = 0.0;
    }

    // Restore solid cell velocities:
    // If this cell is solid OR the cell to the left is solid, restore from prev
    let isSolid = cellType[idx] == SOLID_CELL;
    let leftIsSolid = (i > 0) && (cellType[u32((i - 1) * n + j)] == SOLID_CELL);

    if (isSolid || leftIsSolid) {
      u = prevU[idx];
    }

    gridU[idx] = u;
  }

  // === Normalize V velocity ===
  {
    let vAccum = gridVAccum[idx];
    let dvAccum = gridDVAccum[idx];

    var v: f32;
    if (dvAccum > 0) {
      v = f32(vAccum) / f32(dvAccum);
    } else {
      v = 0.0;
    }

    // If this cell is solid OR the cell below is solid, restore from prev
    let isSolid = cellType[idx] == SOLID_CELL;
    let belowIsSolid = (j > 0) && (cellType[u32(i * n + j - 1)] == SOLID_CELL);

    if (isSolid || belowIsSolid) {
      v = prevV[idx];
    }

    gridV[idx] = v;
  }
}
