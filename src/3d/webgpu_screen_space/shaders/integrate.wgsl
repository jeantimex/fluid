/**
 * ============================================================================
 * INTEGRATION & COLLISION SHADER
 * ============================================================================
 *
 * Pipeline Stage: Stage 8 (Final compute pass)
 * Entry Point: main
 * Workgroup Size: 256 threads
 *
 * Purpose:
 * --------
 * Updates particle positions based on velocity and handles boundary collisions.
 * This is the final step that commits all physics calculations to position.
 *
 * Time Integration:
 * -----------------
 * Uses simple Euler integration (also called Forward Euler):
 *
 *   position_new = position_old + velocity × dt
 *
 * While more sophisticated integrators exist (Verlet, RK4), Euler is sufficient
 * here because:
 *   1. SPH forces are already computed at predicted positions
 *   2. Timestep is small (typically 1/60 or 1/120 second)
 *   3. Pressure forces provide inherent stability
 *
 * Boundary Collision:
 * -------------------
 * The simulation domain is an axis-aligned box centered at origin.
 *
 *     ┌─────────────────────┐
 *     │                     │
 *     │    halfBounds.y     │
 *     │         ↑           │
 *     │         │           │
 *     │  ←──────┼──────→    │  halfBounds.x
 *     │         │           │
 *     │         ↓           │
 *     │                     │
 *     └─────────────────────┘
 *
 * Collision response:
 *   1. Check if particle is outside bounds: |pos| > halfBounds
 *   2. If outside, clamp position to boundary
 *   3. Reflect velocity component: vel = -vel × damping
 *
 * Collision Damping:
 *   - 1.0 = perfectly elastic (no energy loss)
 *   - 0.5 = moderate damping (half velocity on bounce)
 *   - 0.0 = perfectly inelastic (stops on contact)
 *
 * Typical values: 0.7 - 0.95 for realistic fluid behavior.
 *
 * Coordinate System:
 * ------------------
 *   +Y = Up
 *   +X = Right
 *   +Z = Forward (out of screen)
 *
 *   Box spans: [-halfBounds, +halfBounds] on each axis
 *
 * ============================================================================
 */

/**
 * Integration Parameters Uniform Buffer
 *
 * Memory Layout (16-byte aligned):
 * Offset  Size  Field
 * ------  ----  -----
 *   0      4    dt               - Timestep for position integration
 *   4      4    collisionDamping - Velocity multiplier on collision [0, 1]
 *   8      4    hasObstacle      - Flag for dynamic obstacle (unused currently)
 *  12      4    pad0             - Padding
 *  16     12    halfBounds       - Half-extents of simulation box (x, y, z)
 *  28      4    pad1             - Padding
 *  32     12    obstacleCenter   - Center of dynamic obstacle (reserved)
 *  44      4    pad2             - Padding
 *  48     12    obstacleHalf     - Half-extents of obstacle
 *  60      4    pad3             - Padding
 *  64     12    obstacleRotation - Rotation in degrees (XYZ)
 *  76      4    pad4             - Padding
 * ------
 * Total: 80 bytes
 *
 * Note: obstacleRotation is in degrees to match GUI controls.
 */
struct IntegrateParams {
  dt: f32,
  collisionDamping: f32,
  hasObstacle: f32,
  pad0: f32,
  halfBounds: vec3<f32>,
  pad1: f32,
  obstacleCenter: vec3<f32>,
  pad2: f32,
  obstacleHalf: vec3<f32>,
  pad3: f32,
  obstacleRotation: vec3<f32>,
  pad4: f32,
};

// ============================================================================
// BUFFER BINDINGS
// ============================================================================
// Group 0: Integration compute pass
//
//   Binding 0: positions[]  - Particle positions (read-write)
//              Updated with: pos_new = pos_old + vel × dt
//
//   Binding 1: velocities[] - Particle velocities (read-write)
//              Modified on collision: vel = -vel × damping
//
//   Binding 2: params       - Integration parameters
// ============================================================================

@group(0) @binding(0) var<storage, read_write> positions: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> velocities: array<vec4<f32>>;
@group(0) @binding(2) var<uniform> params: IntegrateParams;

// SDF Collision Bindings
@group(0) @binding(3) var sdfTexture: texture_3d<f32>;

struct SDFParams {
  minBounds: vec3<f32>,
  pad0: f32,
  maxBounds: vec3<f32>,
  pad1: f32,
  modelInv: mat4x4<f32>, // To transform World -> Model
  modelMatrix: mat4x4<f32>, // Model -> World (for normal rotation)
};

@group(0) @binding(5) var<uniform> sdfParams: SDFParams;

fn rotateX(v: vec3<f32>, angle: f32) -> vec3<f32> {
  let c = cos(angle);
  let s = sin(angle);
  return vec3<f32>(v.x, v.y * c - v.z * s, v.y * s + v.z * c);
}

fn rotateY(v: vec3<f32>, angle: f32) -> vec3<f32> {
  let c = cos(angle);
  let s = sin(angle);
  return vec3<f32>(v.x * c + v.z * s, v.y, -v.x * s + v.z * c);
}

fn rotateZ(v: vec3<f32>, angle: f32) -> vec3<f32> {
  let c = cos(angle);
  let s = sin(angle);
  return vec3<f32>(v.x * c - v.y * s, v.x * s + v.y * c, v.z);
}

fn toRadians(v: vec3<f32>) -> vec3<f32> {
  return v * (3.14159265 / 180.0);
}

fn rotateLocalToWorld(v: vec3<f32>, rot: vec3<f32>) -> vec3<f32> {
  var r = v;
  r = rotateX(r, rot.x);
  r = rotateY(r, rot.y);
  r = rotateZ(r, rot.z);
  return r;
}

fn rotateWorldToLocal(v: vec3<f32>, rot: vec3<f32>) -> vec3<f32> {
  var r = v;
  r = rotateZ(r, -rot.z);
  r = rotateY(r, -rot.y);
  r = rotateX(r, -rot.x);
  return r;
}

// Manual trilinear interpolation for unfilterable texture.
fn sampleSDF(modelPos: vec3<f32>) -> f32 {
  let boundsSize = sdfParams.maxBounds - sdfParams.minBounds;
  let uvw = (modelPos - sdfParams.minBounds) / boundsSize;

  if (any(uvw < vec3<f32>(0.0)) || any(uvw > vec3<f32>(1.0))) {
    return 10.0; // Outside grid
  }

  let dims = vec3<f32>(textureDimensions(sdfTexture));
  let coord = uvw * dims - 0.5;
  let base = vec3<i32>(floor(coord));
  let f = fract(coord);

  let c000 = max(vec3<i32>(0), base);
  let c111 = min(vec3<i32>(dims) - 1, base + 1);
  let c100 = vec3<i32>(c111.x, c000.y, c000.z);
  let c010 = vec3<i32>(c000.x, c111.y, c000.z);
  let c001 = vec3<i32>(c000.x, c000.y, c111.z);
  let c110 = vec3<i32>(c111.x, c111.y, c000.z);
  let c101 = vec3<i32>(c111.x, c000.y, c111.z);
  let c011 = vec3<i32>(c000.x, c111.y, c111.z);

  let v000 = textureLoad(sdfTexture, c000, 0).r;
  let v100 = textureLoad(sdfTexture, c100, 0).r;
  let v010 = textureLoad(sdfTexture, c010, 0).r;
  let v001 = textureLoad(sdfTexture, c001, 0).r;
  let v110 = textureLoad(sdfTexture, c110, 0).r;
  let v101 = textureLoad(sdfTexture, c101, 0).r;
  let v011 = textureLoad(sdfTexture, c011, 0).r;
  let v111 = textureLoad(sdfTexture, c111, 0).r;

  let i1 = mix(v000, v100, f.x);
  let i2 = mix(v010, v110, f.x);
  let i3 = mix(v001, v101, f.x);
  let i4 = mix(v011, v111, f.x);

  let j1 = mix(i1, i2, f.y);
  let j2 = mix(i3, i4, f.y);

  return mix(j1, j2, f.z);
}

fn computeSDFNormal(modelPos: vec3<f32>) -> vec3<f32> {
  let eps = 1.0;
  let dx = sampleSDF(modelPos + vec3<f32>(eps, 0.0, 0.0)) - sampleSDF(modelPos - vec3<f32>(eps, 0.0, 0.0));
  let dy = sampleSDF(modelPos + vec3<f32>(0.0, eps, 0.0)) - sampleSDF(modelPos - vec3<f32>(0.0, eps, 0.0));
  let dz = sampleSDF(modelPos + vec3<f32>(0.0, 0.0, eps)) - sampleSDF(modelPos - vec3<f32>(0.0, 0.0, eps));

  let v = vec3<f32>(dx, dy, dz);
  if (dot(v, v) < 0.000001) {
    return vec3<f32>(0.0, 1.0, 0.0);
  }
  return normalize(v);
}

/**
 * Main Integration Compute Kernel
 *
 * Updates positions and handles boundary collisions.
 *
 * Dispatch: ceil(particleCount / 256) workgroups
 * Each thread processes exactly one particle.
 *
 * Algorithm:
 * 1. Load current position and velocity
 * 2. Integrate: pos += vel × dt
 * 3. For each axis (X, Y, Z):
 *    a. Check if outside bounds
 *    b. If yes, clamp position and reflect velocity
 * 4. Store updated position and velocity
 */
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let index = id.x;

  // Bounds check using arrayLength for safety
  if (index >= arrayLength(&positions)) {
    return;
  }

  // Load current state
  var pos = positions[index].xyz;
  var vel = velocities[index].xyz;

  // ========================================================================
  // TIME INTEGRATION (Euler Method)
  // ========================================================================
  // p(t + dt) = p(t) + v(t) × dt
  //
  // At this point, velocity has been updated by:
  //   - External forces (gravity, interaction)
  //   - Pressure forces
  //   - Viscosity forces
  //
  // The integration commits all these changes to position.
  pos = pos + vel * params.dt;

  // ========================================================================
  // SDF MODEL COLLISION
  // ========================================================================

  let localPos = (sdfParams.modelInv * vec4<f32>(pos, 1.0)).xyz;
  let dist = sampleSDF(localPos);

  let modelScale = 0.04;
  let particleRadiusWorld = 0.2;
  let particleRadiusModel = particleRadiusWorld / modelScale;

  if (dist < particleRadiusModel) {
    let localNormal = computeSDFNormal(localPos);
    let worldNormal = normalize((sdfParams.modelMatrix * vec4<f32>(localNormal, 0.0)).xyz);
    let penetrationModel = particleRadiusModel - dist;
    let penetrationWorld = min(penetrationModel * modelScale, 0.5);
    pos = pos + worldNormal * penetrationWorld;
    let vn = dot(vel, worldNormal);
    if (vn < 0.0) {
      vel = vel - (1.0 + params.collisionDamping) * vn * worldNormal;
    }
  }

  // Cache half-bounds for repeated access
  let halfBounds = params.halfBounds;

  // ========================================================================
  // OBSTACLE COLLISION HANDLING (AABB)
  // ========================================================================
  // If enabled, check if particle is inside the obstacle box.
  // If so, push it out to the nearest face and reflect velocity.

  if (params.hasObstacle > 0.5) {
      let obsCenter = params.obstacleCenter;
      let obsHalf = params.obstacleHalf;
      let rot = toRadians(params.obstacleRotation);

      // Calculate position relative to obstacle center
      var localPos = rotateWorldToLocal(pos - obsCenter, rot);

      // Check if inside obstacle (overlap on all axes)
      // We use a small epsilon for robustness, though strict inequality is fine
      if (abs(localPos.x) < obsHalf.x && 
          abs(localPos.y) < obsHalf.y && 
          abs(localPos.z) < obsHalf.z) {

          // Determine penetration depth on each axis
          // (Distance to the nearest face)
          let depthX = obsHalf.x - abs(localPos.x);
          let depthY = obsHalf.y - abs(localPos.y);
          let depthZ = obsHalf.z - abs(localPos.z);

          // Find the axis of least penetration (closest face)
          if (depthX < depthY && depthX < depthZ) {
              // ---- X-AXIS COLLISION ----
              // Snap to surface
              localPos.x = obsHalf.x * sign(localPos.x);
              let normal = rotateLocalToWorld(vec3<f32>(sign(localPos.x), 0.0, 0.0), rot);
              pos = obsCenter + rotateLocalToWorld(localPos, rot);
              let vn = dot(vel, normal);
              if (vn < 0.0) {
                vel = vel - (1.0 + params.collisionDamping) * vn * normal;
              }
          } else if (depthY < depthZ) {
              // ---- Y-AXIS COLLISION ----
              localPos.y = obsHalf.y * sign(localPos.y);
              let normal = rotateLocalToWorld(vec3<f32>(0.0, sign(localPos.y), 0.0), rot);
              pos = obsCenter + rotateLocalToWorld(localPos, rot);
              let vn = dot(vel, normal);
              if (vn < 0.0) {
                vel = vel - (1.0 + params.collisionDamping) * vn * normal;
              }
          } else {
              // ---- Z-AXIS COLLISION ----
              localPos.z = obsHalf.z * sign(localPos.z);
              let normal = rotateLocalToWorld(vec3<f32>(0.0, 0.0, sign(localPos.z)), rot);
              pos = obsCenter + rotateLocalToWorld(localPos, rot);
              let vn = dot(vel, normal);
              if (vn < 0.0) {
                vel = vel - (1.0 + params.collisionDamping) * vn * normal;
              }
          }
      }
  }

  // ========================================================================
  // BOUNDARY COLLISION HANDLING
  // ========================================================================
  // For each axis, check if particle has crossed the boundary.
  // The box is centered at origin with extent [-halfBounds, +halfBounds].
  //
  // Collision detection: edgeDst = halfBounds - |pos|
  //   If edgeDst <= 0, particle is outside bounds
  //
  // Collision response:
  //   1. Clamp position to boundary: pos = halfBounds × sign(pos)
  //   2. Reflect velocity: vel = -vel × damping
  //
  // Why clamp instead of push back?
  //   - Simpler and more robust
  //   - Prevents particles from tunneling through walls
  //   - Works even for very high velocities

  // ---- X-AXIS COLLISION ----
  let edgeDstX = halfBounds.x - abs(pos.x);
  if (edgeDstX <= 0.0) {
    // Clamp to boundary (sign preserves direction: +halfBounds or -halfBounds)
    pos.x = halfBounds.x * sign(pos.x);
    // Reflect and damp velocity
    vel.x = -vel.x * params.collisionDamping;
  }

  // ---- Y-AXIS COLLISION ----
  let edgeDstY = halfBounds.y - abs(pos.y);
  if (edgeDstY <= 0.0) {
    pos.y = halfBounds.y * sign(pos.y);
    vel.y = -vel.y * params.collisionDamping;
  }

  // ---- Z-AXIS COLLISION ----
  let edgeDstZ = halfBounds.z - abs(pos.z);
  if (edgeDstZ <= 0.0) {
    pos.z = halfBounds.z * sign(pos.z);
    vel.z = -vel.z * params.collisionDamping;
  }

  // ========================================================================
  // WRITE BACK RESULTS
  // ========================================================================
  // Store updated position (w = 1.0 for homogeneous coordinates)
  // Store updated velocity (w = 0.0, velocity is a direction/rate)
  positions[index] = vec4<f32>(pos, 1.0);
  velocities[index] = vec4<f32>(vel, 0.0);
}
