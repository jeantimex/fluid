/**
 * ============================================================================
 * PRESSURE KERNEL (LINEAR GRID + STRIP OPTIMIZATION)
 * ============================================================================
 *
 * Pipeline Stage: Stage 6 (Second SPH physics pass)
 * Entry Point: main
 * Workgroup Size: 256 threads
 *
 * Purpose:
 * --------
 * Computes pressure forces using the Linear Grid for O(1) neighbor search,
 * with the strip optimisation for contiguous X-row iteration.
 *
 * This is the Linear Grid variant of pressure.wgsl. The physics are identical
 * (symmetric dual-pressure EOS), but neighbor iteration uses sortOffsets
 * with strip ranges instead of spatial hash key matching.
 *
 * See pressure.wgsl for detailed physics documentation (equation of state,
 * kernel gradient derivation, symmetric pressure averaging).
 * ============================================================================
 */

// Beginner note: pressure uses density to compute forces that repel particles.

/**
 * Pressure Parameters Uniform Buffer
 *
 * Memory Layout (64 bytes):
 * Offset  Size  Field
 * ------  ----  -----
 *   0      4    dt                     - Sub-step timestep
 *   4      4    targetDensity          - Rest density ρ₀
 *   8      4    pressureMultiplier     - Stiffness k for standard pressure
 *  12      4    nearPressureMultiplier - Stiffness for near-pressure
 *  16      4    radius                 - Smoothing radius h
 *  20      4    spikyPow2DerivScale    - Gradient normalisation for Spiky² kernel
 *  24      4    spikyPow3DerivScale    - Gradient normalisation for Spiky³ kernel
 *  28      4    particleCountF         - Particle count as f32
 *  32     12    minBounds              - Minimum corner of simulation domain
 *  44      4    pad0                   - Padding
 *  48     12    gridRes                - Grid resolution per axis (f32)
 *  60      4    pad1                   - Padding
 * ------
 * Total: 64 bytes
 */
struct PressureParams {
  dt: f32,
  targetDensity: f32,
  pressureMultiplier: f32,
  nearPressureMultiplier: f32,
  radius: f32,
  spikyPow2DerivScale: f32,
  spikyPow3DerivScale: f32,
  particleCountF: f32,
  minBounds: vec3<f32>,
  pad0: f32,
  gridRes: vec3<f32>,
  pad1: f32,
};

// ============================================================================
// BUFFER BINDINGS
// ============================================================================
// Group 0: Pressure compute pass (Linear Grid)
//
//   Binding 0: predicted[]   - Predicted positions (for neighbor distances)
//   Binding 1: velocities[]  - Velocities (updated with pressure acceleration)
//   Binding 2: densities[]   - Computed densities from density pass
//              vec2: x = density, y = near-density
//   Binding 3: sortOffsets[] - Cell start/end offsets for strip iteration
//   Binding 4: params        - Pressure parameters
// ============================================================================

@group(0) @binding(0) var<storage, read> predicted: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> velocities: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> densities: array<vec2<f32>>;
@group(0) @binding(3) var<storage, read> sortOffsets: array<u32>;
@group(0) @binding(4) var<uniform> params: PressureParams;

/**
 * Converts 3D integer cell coordinates to a linear grid index.
 * index = x + width × (y + height × z)
 */
fn getGridIndex(x: i32, y: i32, z: i32) -> u32 {
    let gridRes = vec3<u32>(params.gridRes);
    return u32(x) + gridRes.x * (u32(y) + gridRes.y * u32(z));
}

/** Gradient of Spiky² kernel: dW/dr = -(h-r) × scale. */
fn derivativeSpikyPow2(dst: f32, radius: f32, scale: f32) -> f32 {
  if (dst <= radius) {
    let v = radius - dst;
    return -v * scale;
  }
  return 0.0;
}

/** Gradient of Spiky³ kernel: dW/dr = -(h-r)² × scale. Stronger at close range. */
fn derivativeSpikyPow3(dst: f32, radius: f32, scale: f32) -> f32 {
  if (dst <= radius) {
    let v = radius - dst;
    return -v * v * scale;
  }
  return 0.0;
}

/**
 * Main Pressure Force Kernel (Strip-Optimised)
 *
 * For each particle:
 *   1. Compute pressure from EOS: P = k × (ρ - ρ₀)
 *   2. Iterate over 3×3 Y-Z row strips using sortOffsets ranges
 *   3. For each neighbor, compute symmetric averaged pressure force
 *   4. Update velocity: v += (force / density) × dt
 *
 * Dispatch: ceil(particleCount / 256) workgroups
 */
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  let count = u32(params.particleCountF + 0.5);

  if (i >= count) { return; }

  let densityPair = densities[i];
  let density = densityPair.x;
  let nearDensity = densityPair.y;

  if (density <= 0.0) { return; }

  let pressure = (density - params.targetDensity) * params.pressureMultiplier;
  let nearPressure = params.nearPressureMultiplier * nearDensity;

  let pos = predicted[i].xyz;
  let gridRes = vec3<i32>(params.gridRes);
  let localPos = pos - params.minBounds;
  
  let cellX = i32(floor(localPos.x / params.radius));
  let cellY = i32(floor(localPos.y / params.radius));
  let cellZ = i32(floor(localPos.z / params.radius));
  
  let cx = clamp(cellX, 0, gridRes.x - 1);
  let cy = clamp(cellY, 0, gridRes.y - 1);
  let cz = clamp(cellZ, 0, gridRes.z - 1);

  let radiusSq = params.radius * params.radius;
  var force = vec3<f32>(0.0);

  let minZ = max(0, cz - 1);
  let maxZ = min(gridRes.z - 1, cz + 1);
  let minY = max(0, cy - 1);
  let maxY = min(gridRes.y - 1, cy + 1);
  let minX = max(0, cx - 1);
  let maxX = min(gridRes.x - 1, cx + 1);

  for (var z = minZ; z <= maxZ; z++) {
    for (var y = minY; y <= maxY; y++) {
      let startKey = getGridIndex(minX, y, z);
      let endKey = getGridIndex(maxX, y, z);
      let start = sortOffsets[startKey];
      let end = sortOffsets[endKey + 1u];

      for (var j = start; j < end; j++) {
            let neighborIndex = j;
            if (neighborIndex != i) {
                let neighborPos = predicted[neighborIndex].xyz;
                let offset = neighborPos - pos;
                let dstSq = dot(offset, offset);

                if (dstSq <= radiusSq) {
                    let dst = sqrt(dstSq);
                    let invDst = select(0.0, 1.0 / dst, dst > 0.0);
                    let dir = offset * invDst;

                    let nDens = densities[neighborIndex];
                    let nPressure = (nDens.x - params.targetDensity) * params.pressureMultiplier;
                    let nNearPressure = params.nearPressureMultiplier * nDens.y;

                    let sharedPressure = (pressure + nPressure) * 0.5;
                    let sharedNearPressure = (nearPressure + nNearPressure) * 0.5;

                    if (nDens.x > 0.0) {
                        let scale = derivativeSpikyPow2(dst, params.radius, params.spikyPow2DerivScale) * (sharedPressure / nDens.x);
                        force = force + dir * scale;
                    }
                    if (nDens.y > 0.0) {
                        let scale = derivativeSpikyPow3(dst, params.radius, params.spikyPow3DerivScale) * (sharedNearPressure / nDens.y);
                        force = force + dir * scale;
                    }
                }
            }
      }
    }
  }

  let accel = force / density;
  velocities[i] = vec4<f32>(velocities[i].xyz + accel * params.dt, 0.0);
}
