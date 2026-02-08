/**
 * ============================================================================
 * VISCOSITY KERNEL (LINEAR GRID + STRIP OPTIMIZATION)
 * ============================================================================
 *
 * Pipeline Stage: Stage 7 (Third SPH physics pass)
 * Entry Point: main
 * Workgroup Size: 256 threads
 *
 * Purpose:
 * --------
 * Applies viscous damping using the Linear Grid for neighbor search, with
 * strip optimisation for contiguous X-row iteration.
 *
 * This is the Linear Grid variant of viscosity.wgsl. The physics are
 * identical (Poly6-weighted velocity averaging), but neighbor iteration
 * uses sortOffsets with strip ranges instead of spatial hash key matching.
 *
 * See viscosity.wgsl for detailed physics documentation (Poly6 kernel,
 * viscosity force formulation, numerical stability benefits).
 * ============================================================================
 */

// Beginner note: viscosity smooths velocity differences to reduce jitter.

/**
 * Viscosity Parameters Uniform Buffer
 *
 * Memory Layout (48 bytes):
 * Offset  Size  Field
 * ------  ----  -----
 *   0      4    dt                - Sub-step timestep
 *   4      4    viscosityStrength - Viscosity coefficient μ
 *   8      4    radius            - Smoothing radius h
 *  12      4    poly6Scale        - Normalisation for Poly6 kernel: 315/(64πh⁹)
 *  16      4    particleCountF    - Particle count as f32
 *  20      4    minBoundsX        - Minimum X of simulation domain
 *  24      4    minBoundsY        - Minimum Y of simulation domain
 *  28      4    minBoundsZ        - Minimum Z of simulation domain
 *  32      4    gridResX          - Grid resolution along X axis
 *  36      4    gridResY          - Grid resolution along Y axis
 *  40      4    gridResZ          - Grid resolution along Z axis
 *  44      4    pad0              - Padding
 * ------
 * Total: 48 bytes
 */
struct ViscosityParams {
  dt: f32,
  viscosityStrength: f32,
  radius: f32,
  poly6Scale: f32,
  particleCountF: f32,
  minBoundsX: f32,
  minBoundsY: f32,
  minBoundsZ: f32,
  gridResX: f32,
  gridResY: f32,
  gridResZ: f32,
  pad0: f32,
};

// ============================================================================
// BUFFER BINDINGS
// ============================================================================
// Group 0: Viscosity compute pass (Linear Grid)
//
//   Binding 0: predicted[]   - Predicted positions (for neighbor distances)
//   Binding 1: velocities[]  - Velocities (updated with viscosity damping)
//   Binding 2: sortOffsets[] - Cell start/end offsets for strip iteration
//   Binding 4: params        - Viscosity parameters (note: binding 3 skipped)
// ============================================================================

@group(0) @binding(0) var<storage, read> predicted: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> velocities: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> sortOffsets: array<u32>;
@group(0) @binding(4) var<uniform> params: ViscosityParams;

/**
 * Converts 3D integer cell coordinates to a linear grid index.
 * index = x + width × (y + height × z)
 */
fn getGridIndex(x: i32, y: i32, z: i32) -> u32 {
    let gridRes = vec3<u32>(u32(params.gridResX), u32(params.gridResY), u32(params.gridResZ));
    return u32(x) + gridRes.x * (u32(y) + gridRes.y * u32(z));
}

/** Poly6 kernel: W(r,h) = (h²-r²)³ × scale. Smooth, positive, max at r=0. */
fn smoothingKernelPoly6(dst: f32, radius: f32, scale: f32) -> f32 {
  if (dst < radius) {
    let v = radius * radius - dst * dst;
    return v * v * v * scale;
  }
  return 0.0;
}

/**
 * Main Viscosity Kernel (Strip-Optimised)
 *
 * For each particle, iterates over the 3×3 Y-Z row strips and computes
 * a Poly6-weighted velocity difference from each neighbor:
 *   force += (v_neighbor - v_self) × W(distance)
 *
 * Final update: v += force × viscosityStrength × dt
 *
 * Dispatch: ceil(particleCount / 256) workgroups
 */
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  let count = u32(params.particleCountF + 0.5);

  if (i >= count) { return; }

  let pos = predicted[i].xyz;
  let vel = velocities[i].xyz;

  let gridRes = vec3<i32>(i32(params.gridResX), i32(params.gridResY), i32(params.gridResZ));
  let minBounds = vec3<f32>(params.minBoundsX, params.minBoundsY, params.minBoundsZ);
  let localPos = pos - minBounds;
  
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
                    let weight = smoothingKernelPoly6(dst, params.radius, params.poly6Scale);
                    let neighborVel = velocities[neighborIndex].xyz;
                    force = force + (neighborVel - vel) * weight;
                }
            }
      }
    }
  }

  velocities[i] = vec4<f32>(velocities[i].xyz + force * params.viscosityStrength * params.dt, 0.0);
}
