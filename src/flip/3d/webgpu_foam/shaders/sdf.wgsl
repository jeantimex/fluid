// =============================================================================
// Surface SDF (Signed Distance Field) Compute Kernels
// =============================================================================
// Separate shader module to stay within 10 storage buffer per-stage limit.
// These kernels only need marker and SDF buffers, not the full FLIP buffers.
// =============================================================================

struct SDFUniforms {
  nx: u32,
  ny: u32,
  nz: u32,
  jumpSize: u32,  // For JFA pass (replaces _pad)
};

@group(0) @binding(0) var<uniform> uniforms: SDFUniforms;
@group(0) @binding(1) var<storage, read> marker: array<u32>;
@group(0) @binding(2) var<storage, read_write> surfaceSDF: array<f32>;

/// Convert 3D grid coordinates to linear buffer index (cell-centered).
fn scalarIdx(x: u32, y: u32, z: u32) -> u32 {
  let cx = clamp(x, 0u, uniforms.nx - 1u);
  let cy = clamp(y, 0u, uniforms.ny - 1u);
  let cz = clamp(z, 0u, uniforms.nz - 1u);
  return cx + cy * uniforms.nx + cz * uniforms.nx * uniforms.ny;
}

// =============================================================================
// INIT SDF - Initialize Surface Signed Distance Field
// =============================================================================
// Initializes the SDF buffer based on marker values:
// - Fluid cells (marker=1): SDF = -0.5 (inside by half a cell)
// - Air cells (marker=0): SDF = large positive (far outside, to be refined by JFA)
//
// The SDF is used for whitewater particle classification:
// - SDF < -threshold: deep inside fluid → bubble
// - SDF ≈ 0: at surface → foam
// - SDF > +threshold: outside fluid → spray
// =============================================================================

/// Check if a cell is at the fluid/air boundary (surface cell)
fn isSurfaceCell(x: u32, y: u32, z: u32) -> bool {
  let si = scalarIdx(x, y, z);
  let isFluid = marker[si] == 1u;

  // A surface cell is a fluid cell with at least one air neighbor
  // or an air cell with at least one fluid neighbor
  if (isFluid) {
    // Fluid cell: check 6-connected neighbors for air
    if (x > 0u && marker[scalarIdx(x - 1u, y, z)] == 0u) { return true; }
    if (x < uniforms.nx - 1u && marker[scalarIdx(x + 1u, y, z)] == 0u) { return true; }
    if (y > 0u && marker[scalarIdx(x, y - 1u, z)] == 0u) { return true; }
    if (y < uniforms.ny - 1u && marker[scalarIdx(x, y + 1u, z)] == 0u) { return true; }
    if (z > 0u && marker[scalarIdx(x, y, z - 1u)] == 0u) { return true; }
    if (z < uniforms.nz - 1u && marker[scalarIdx(x, y, z + 1u)] == 0u) { return true; }
  } else {
    // Air cell: check 6-connected neighbors for fluid
    if (x > 0u && marker[scalarIdx(x - 1u, y, z)] == 1u) { return true; }
    if (x < uniforms.nx - 1u && marker[scalarIdx(x + 1u, y, z)] == 1u) { return true; }
    if (y > 0u && marker[scalarIdx(x, y - 1u, z)] == 1u) { return true; }
    if (y < uniforms.ny - 1u && marker[scalarIdx(x, y + 1u, z)] == 1u) { return true; }
    if (z > 0u && marker[scalarIdx(x, y, z - 1u)] == 1u) { return true; }
    if (z < uniforms.nz - 1u && marker[scalarIdx(x, y, z + 1u)] == 1u) { return true; }
  }
  return false;
}

@compute @workgroup_size(8, 4, 4)
fn initSDF(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= uniforms.nx || id.y >= uniforms.ny || id.z >= uniforms.nz) { return; }

  let si = scalarIdx(id.x, id.y, id.z);
  let isFluid = marker[si] == 1u;

  // Initialize SDF for JFA:
  // - Surface cells (boundary): SDF = 0 (seeds)
  // - Interior fluid: SDF = -LARGE (inside, distance unknown)
  // - Air cells: SDF = +LARGE (outside, distance unknown)
  let isSurface = isSurfaceCell(id.x, id.y, id.z);

  if (isSurface) {
    // Surface cells are seeds with distance 0
    // Use small negative for fluid surface, small positive for air surface
    if (isFluid) {
      surfaceSDF[si] = -0.5;  // Just inside surface
    } else {
      surfaceSDF[si] = 0.5;   // Just outside surface
    }
  } else if (isFluid) {
    surfaceSDF[si] = -1000.0;  // Deep inside (unknown distance)
  } else {
    surfaceSDF[si] = 1000.0;   // Far outside (unknown distance)
  }
}

// =============================================================================
// JFA PASS - Jump Flooding Algorithm for SDF propagation
// =============================================================================
// Each cell looks at neighbors at distance `jumpSize` and updates its SDF
// if a neighbor is closer to the surface.
//
// Run with decreasing jump sizes: n/2, n/4, ..., 2, 1
// This propagates distance information efficiently in O(log n) passes.
// =============================================================================

@compute @workgroup_size(8, 4, 4)
fn jfaPass(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= uniforms.nx || id.y >= uniforms.ny || id.z >= uniforms.nz) { return; }

  let si = scalarIdx(id.x, id.y, id.z);
  let currentSDF = surfaceSDF[si];
  let currentDist = abs(currentSDF);
  let currentSign = sign(currentSDF);

  let jump = i32(uniforms.jumpSize);
  var bestDist = currentDist;

  // Check 26 neighbors at jump distance (3x3x3 cube minus center)
  for (var dz = -1; dz <= 1; dz++) {
    for (var dy = -1; dy <= 1; dy++) {
      for (var dx = -1; dx <= 1; dx++) {
        if (dx == 0 && dy == 0 && dz == 0) { continue; }

        let nx = i32(id.x) + dx * jump;
        let ny = i32(id.y) + dy * jump;
        let nz = i32(id.z) + dz * jump;

        // Bounds check
        if (nx < 0 || nx >= i32(uniforms.nx) ||
            ny < 0 || ny >= i32(uniforms.ny) ||
            nz < 0 || nz >= i32(uniforms.nz)) {
          continue;
        }

        let ni = scalarIdx(u32(nx), u32(ny), u32(nz));
        let neighborSDF = surfaceSDF[ni];
        let neighborDist = abs(neighborSDF);

        // Distance from this cell to neighbor (in grid units)
        let stepDist = sqrt(f32(dx * dx + dy * dy + dz * dz)) * f32(jump);

        // If neighbor's distance + step is less than our current distance, update
        let newDist = neighborDist + stepDist;
        if (newDist < bestDist) {
          bestDist = newDist;
        }
      }
    }
  }

  // Update SDF with best distance, preserving sign (inside/outside)
  surfaceSDF[si] = currentSign * bestDist;
}
