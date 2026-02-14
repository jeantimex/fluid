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
 * The simulation domain is an axis-aligned box defined by [minBounds, maxBounds].
 *
 *     ┌─────────────────────┐  maxBounds
 *     │                     │
 *     │          ↑          │
 *     │          │          │
 *     │   ←──────┼──────→   │
 *     │          │          │
 *     │          ↓          │
 *     │                     │
 *     └─────────────────────┘  minBounds
 *
 * Collision response:
 *   1. Check if particle is outside [minBounds, maxBounds]
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
 * ============================================================================
 */

// Beginner note: this pass writes final positions (and clamps to bounds).

/**
 * Integration Parameters Uniform Buffer
 *
 * Memory Layout (16-byte aligned):
 * Offset  Size  Field
 * ------  ----  -----
 *   0      4    dt               - Timestep for position integration
 *   4      4    collisionDamping - Velocity multiplier on collision [0, 1]
 *   8      4    hasObstacle      - Flag for dynamic obstacle (unused currently)
 *  12      4    obstacleShape    - 0 = box, 1 = sphere
 *  16     12    minBounds        - Minimum corner of simulation box (x, y, z)
 *  28      4    pad1             - Padding
 *  32     12    maxBounds        - Maximum corner of simulation box (x, y, z)
 *  44      4    pad2             - Padding
 *  48     12    obstacleCenter   - Center of dynamic obstacle
 *  60      4    pad3             - Padding
 *  64     12    obstacleHalf     - Half-extents of obstacle
 *  76      4    pad4             - Padding
 *  80     12    obstacleRotation - Rotation in degrees (XYZ)
 *  92      4    pad5             - Padding
 * ------
 * Total: 96 bytes
 *
 * Note: obstacleRotation is in degrees to match GUI controls.
 */
struct IntegrateParams {
  dt: f32,
  collisionDamping: f32,
  hasObstacle: f32,
  obstacleShape: f32,
  minBounds: vec3<f32>,
  pad1: f32,
  maxBounds: vec3<f32>,
  pad2: f32,
  obstacleCenter: vec3<f32>,
  pad3: f32,
  obstacleHalf: vec3<f32>,
  pad4: f32,
  obstacleRotation: vec3<f32>,
  pad5: f32,
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
  // OBSTACLE COLLISION HANDLING (AABB)
  // ========================================================================
  // If enabled, check if particle is inside the obstacle box.
  // If so, push it out to the nearest face and reflect velocity.

  if (params.hasObstacle > 0.5) {
    let obsCenter = params.obstacleCenter;
    let obsHalf = params.obstacleHalf;
    let isSphere = params.obstacleShape > 0.5;

    if (isSphere) {
      let radius = obsHalf.x;
      let delta = pos - obsCenter;
      let dist = length(delta);
      if (dist < radius && radius > 0.0) {
        let normal = delta / max(dist, 1e-5);
        pos = obsCenter + normal * radius;
        let vn = dot(vel, normal);
        if (vn < 0.0) {
          vel = vel - (1.0 + params.collisionDamping) * vn * normal;
        }
      }
    } else {
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
  }

  // ========================================================================
  // BOUNDARY COLLISION HANDLING
  // ========================================================================
  // For each axis, check if particle has crossed the boundary.
  //
  // Collision detection: check if pos is outside [minBounds, maxBounds]
  //
  // Collision response:
  //   1. Clamp position to boundary
  //   2. Reflect velocity: vel = -vel × damping

  // ---- X-AXIS COLLISION ----
  if (pos.x < params.minBounds.x) {
    pos.x = params.minBounds.x;
    vel.x = -vel.x * params.collisionDamping;
  } else if (pos.x > params.maxBounds.x) {
    pos.x = params.maxBounds.x;
    vel.x = -vel.x * params.collisionDamping;
  }

  // ---- Y-AXIS COLLISION ----
  if (pos.y < params.minBounds.y) {
    pos.y = params.minBounds.y;
    vel.y = -vel.y * params.collisionDamping;
  } else if (pos.y > params.maxBounds.y) {
    pos.y = params.maxBounds.y;
    vel.y = -vel.y * params.collisionDamping;
  }

  // ---- Z-AXIS COLLISION ----
  if (pos.z < params.minBounds.z) {
    pos.z = params.minBounds.z;
    vel.z = -vel.z * params.collisionDamping;
  } else if (pos.z > params.maxBounds.z) {
    pos.z = params.maxBounds.z;
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
