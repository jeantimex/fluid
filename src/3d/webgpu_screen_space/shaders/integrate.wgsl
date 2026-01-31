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
 *  48     12    obstacleHalf     - Half-extents of obstacle (reserved)
 *  60      4    pad3             - Padding
 * ------
 * Total: 64 bytes
 *
 * Note: obstacleCenter and obstacleHalf are reserved for future use
 * (dynamic obstacle collision, not currently implemented)
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

      // Calculate position relative to obstacle center
      let localPos = pos - obsCenter;

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
              pos.x = obsCenter.x + obsHalf.x * sign(localPos.x);
              // Reflect velocity
              vel.x = -vel.x * params.collisionDamping;
          } else if (depthY < depthZ) {
              // ---- Y-AXIS COLLISION ----
              pos.y = obsCenter.y + obsHalf.y * sign(localPos.y);
              vel.y = -vel.y * params.collisionDamping;
          } else {
              // ---- Z-AXIS COLLISION ----
              pos.z = obsCenter.z + obsHalf.z * sign(localPos.z);
              vel.z = -vel.z * params.collisionDamping;
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
