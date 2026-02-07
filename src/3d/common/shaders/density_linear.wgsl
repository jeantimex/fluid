/**
 * ============================================================================
 * DENSITY KERNEL (LINEAR GRID + STRIP OPTIMIZATION)
 * ============================================================================
 *
 * Pipeline Stage: Stage 5
 * Entry Point: main
 * Workgroup Size: 256 threads
 *
 * Purpose:
 * --------
 * Computes fluid density using the Linear Grid for O(1) neighbor search.
 *
 * Optimization: Strip Processing
 * ------------------------------
 * Instead of checking 27 individual neighbor cells, we iterate over 3 Z-planes
 * and 3 Y-rows. Inside each Y-row, the X-cells are contiguous in the Linear Grid Index.
 *
 *   Row: [ Cell(x-1), Cell(x), Cell(x+1) ]
 *
 * Because indices are contiguous:
 *   Key(x-1) = K
 *   Key(x)   = K + 1
 *   Key(x+1) = K + 2
 *
 * We can fetch the particle range for the ENTIRE strip in one go:
 *   Start = sortOffsets[Key(x-1)]
 *   End   = sortOffsets[Key(x+1) + 1]
 *
 * This reduces 27 loop setups to 9, and eliminates the "if (key != target)" check
 * inside the inner loop, drastically reducing memory bandwidth.
 * ============================================================================
 */

/**
 * Density Parameters Uniform Buffer
 *
 * Memory Layout (48 bytes):
 * Offset  Size  Field
 * ------  ----  -----
 *   0      4    radius          - Smoothing radius h (= grid cell size)
 *   4      4    spikyPow2Scale  - Normalisation for (h-r)² kernel: 15/(2πh⁵)
 *   8      4    spikyPow3Scale  - Normalisation for (h-r)³ kernel: 15/(πh⁶)
 *  12      4    particleCountF  - Particle count as f32 (for GPU convenience)
 *  16     12    minBounds       - Minimum corner of simulation domain (xyz)
 *  28      4    pad0            - Padding
 *  32     12    gridRes         - Grid resolution per axis (xyz as f32)
 *  44      4    pad1            - Padding
 * ------
 * Total: 48 bytes
 */
struct DensityParams {
  radius: f32,
  spikyPow2Scale: f32,
  spikyPow3Scale: f32,
  particleCountF: f32,
  minBounds: vec3<f32>,
  pad0: f32,
  gridRes: vec3<f32>,
  pad1: f32,
};

// ============================================================================
// BUFFER BINDINGS
// ============================================================================
// Group 0: Density compute pass (Linear Grid)
//
//   Binding 0: predicted[]   - Predicted particle positions (spatially sorted)
//              Used for distance calculations during neighbor iteration
//
//   Binding 1: sortOffsets[] - Cell start/end offsets from prefix sum
//              Used for strip-optimised neighbor lookup
//
//   Binding 2: densities[]   - Output: (density, nearDensity) per particle
//              vec2<f32>: x = standard density, y = near-density
//
//   Binding 3: params        - Uniform density parameters
// ============================================================================

@group(0) @binding(0) var<storage, read> predicted: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read> sortOffsets: array<u32>;
@group(0) @binding(2) var<storage, read_write> densities: array<vec2<f32>>;
@group(0) @binding(3) var<uniform> params: DensityParams;

/**
 * Converts 3D integer cell coordinates to a linear grid index.
 *
 * Uses row-major linearisation: index = x + width × (y + height × z).
 * The caller must ensure coordinates are within [0, gridRes - 1].
 */
fn getGridIndex(x: i32, y: i32, z: i32) -> u32 {
    let gridRes = vec3<u32>(params.gridRes);
    return u32(x) + gridRes.x * (u32(y) + gridRes.y * u32(z));
}

/** Spiky² kernel: W(r,h) = (h-r)² × scale. Compact support: 0 for r ≥ h. */
fn spikyPow2(dst: f32, radius: f32, scale: f32) -> f32 {
  if (dst < radius) {
    let v = radius - dst;
    return v * v * scale;
  }
  return 0.0;
}

/** Spiky³ kernel: W(r,h) = (h-r)³ × scale. Sharper falloff for near-density. */
fn spikyPow3(dst: f32, radius: f32, scale: f32) -> f32 {
  if (dst < radius) {
    let v = radius - dst;
    return v * v * v * scale;
  }
  return 0.0;
}

/**
 * Main Density Compute Kernel (Strip-Optimised)
 *
 * For each particle, iterates over the 3×3 neighborhood of Y-Z rows.
 * Within each row, the X-cells are contiguous in the linear grid, so we
 * fetch the particle range for the entire 3-cell strip in one go:
 *   start = sortOffsets[getGridIndex(minX, y, z)]
 *   end   = sortOffsets[getGridIndex(maxX, y, z) + 1]
 *
 * This reduces 27 separate cell lookups to 9 strips and eliminates the
 * per-particle key comparison in the inner loop.
 *
 * Dispatch: ceil(particleCount / 256) workgroups
 */
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  let count = u32(params.particleCountF + 0.5);

  if (i >= count) { return; }

  let pos = predicted[i].xyz;
  let gridRes = vec3<i32>(params.gridRes);

  let localPos = pos - params.minBounds;
  let cellX = i32(floor(localPos.x / params.radius));
  let cellY = i32(floor(localPos.y / params.radius));
  let cellZ = i32(floor(localPos.z / params.radius));
  
  let cx = clamp(cellX, 0, gridRes.x - 1);
  let cy = clamp(cellY, 0, gridRes.y - 1);
  let cz = clamp(cellZ, 0, gridRes.z - 1);

  var density = 0.0;
  var nearDensity = 0.0;
  let radiusSq = params.radius * params.radius;

  // Search ranges
  let minZ = max(0, cz - 1);
  let maxZ = min(gridRes.z - 1, cz + 1);
  let minY = max(0, cy - 1);
  let maxY = min(gridRes.y - 1, cy + 1);
  let minX = max(0, cx - 1);
  let maxX = min(gridRes.x - 1, cx + 1);

  // Strip Optimization Loop
  for (var z = minZ; z <= maxZ; z++) {
    for (var y = minY; y <= maxY; y++) {
      let startKey = getGridIndex(minX, y, z);
      let endKey = getGridIndex(maxX, y, z);
      
      let start = sortOffsets[startKey];
      let end = sortOffsets[endKey + 1u];

      for (var j = start; j < end; j++) {
          let neighborPos = predicted[j].xyz;
          let offset = neighborPos - pos;
          let dstSq = dot(offset, offset);

          if (dstSq <= radiusSq) {
              let dst = sqrt(dstSq);
              density = density + spikyPow2(dst, params.radius, params.spikyPow2Scale);
              nearDensity = nearDensity + spikyPow3(dst, params.radius, params.spikyPow3Scale);
          }
      }
    }
  }

  densities[i] = vec2<f32>(density, nearDensity);
}