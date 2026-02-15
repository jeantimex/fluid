/**
 * Push Particles Apart Compute Shader
 *
 * Uses spatial hash to find nearby particles and push overlapping ones apart.
 * Note: This only moves the current particle (not the neighbor) to avoid race conditions.
 * Multiple iterations are needed to converge.
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

@group(0) @binding(0) var<storage, read_write> positions: array<vec2<f32>>;
@group(0) @binding(1) var<storage, read> cellOffset: array<u32>;
@group(0) @binding(2) var<storage, read> sortedIndex: array<u32>;
@group(0) @binding(3) var<uniform> params: SimParams;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;

  if (i >= u32(params.numParticles)) {
    return;
  }

  let minDist = 2.0 * params.particleRadius;
  let minDist2 = minDist * minDist;

  var pos = positions[i];

  // Compute cell indices
  let pxi = i32(floor(pos.x * params.pInvSpacing));
  let pyi = i32(floor(pos.y * params.pInvSpacing));

  // Search 3x3 neighborhood
  let x0 = max(pxi - 1, 0);
  let y0 = max(pyi - 1, 0);
  let x1 = min(pxi + 1, params.pNumX - 1);
  let y1 = min(pyi + 1, params.pNumY - 1);

  // Accumulate displacement
  var displacement = vec2<f32>(0.0, 0.0);

  for (var xi = x0; xi <= x1; xi++) {
    for (var yi = y0; yi <= y1; yi++) {
      let cellNr = u32(xi * params.pNumY + yi);

      let cellStart = cellOffset[cellNr];
      let cellEnd = cellOffset[cellNr + 1u];

      for (var j = cellStart; j < cellEnd; j++) {
        let otherId = sortedIndex[j];

        if (otherId == i) {
          continue;
        }

        let otherPos = positions[otherId];
        let dx = otherPos.x - pos.x;
        let dy = otherPos.y - pos.y;
        let d2 = dx * dx + dy * dy;

        if (d2 > minDist2 || d2 < 0.0001) {
          continue;
        }

        let d = sqrt(d2);
        // Use 0.25 instead of 0.5 because both particles will process this pair
        // (each moves half of the half = quarter, total movement = half)
        let s = 0.25 * (minDist - d) / d;

        // Only move this particle (not the other) to avoid race conditions
        // Each particle handles its own displacement
        displacement.x -= dx * s;
        displacement.y -= dy * s;
      }
    }
  }

  // Apply accumulated displacement
  positions[i] = pos + displacement;
}
