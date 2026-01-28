/**
 * ============================================================================
 * EXTERNAL FORCES & PREDICTION SHADER
 * ============================================================================
 *
 * Pipeline Stage: 1 of 8 (First compute pass)
 * Entry Point: main
 * Workgroup Size: 256 threads
 *
 * Purpose:
 * --------
 * This shader kicks off each simulation frame by:
 *   1. Applying external forces (gravity, user interaction)
 *   2. Updating velocities based on accumulated acceleration
 *   3. Computing predicted positions for spatial hashing
 *
 * Position Based Dynamics (PBD) Prediction:
 * -----------------------------------------
 * Instead of using current positions for neighbor search, we predict where
 * particles WILL be at the end of the timestep. This improves stability:
 *
 *   predicted[i] = position[i] + velocity[i] * predictionFactor
 *
 * The prediction factor (1/120) is tuned to match typical simulation rates.
 * Using predicted positions ensures that pressure forces are calculated
 * based on the future configuration, preventing particles from "overshooting"
 * and penetrating each other.
 *
 * Interactive Force Model:
 * ------------------------
 * When the user clicks/drags, particles within 'interactionRadius' experience:
 *
 *   - Pull (positive strength): Attracted toward input point
 *   - Push (negative strength): Repelled from input point
 *
 * The force uses a smooth falloff from center (100%) to edge (0%):
 *
 *   centreT = 1 - (distance / radius)
 *   force = direction * centreT * interactionStrength
 *
 * A velocity damping term (-vel * centreT) is applied near the interaction
 * center to prevent particles from orbiting/exploding at the click point.
 *
 * Data Flow:
 * ----------
 *   Input:
 *     - positions[]     : Current particle positions (read-only)
 *     - velocities[]    : Current velocities (read-write)
 *     - params          : Simulation parameters
 *
 *   Output:
 *     - velocities[]    : Updated with acceleration * dt
 *     - predicted[]     : Predicted position for spatial hashing
 *
 * ============================================================================
 */

/**
 * Simulation Parameters Uniform Buffer
 *
 * Memory Layout (16-byte aligned for WebGPU):
 * Offset  Size  Field
 * ------  ----  -----
 *   0      4    deltaTime           - Frame timestep in seconds
 *   4      4    gravity             - Gravity acceleration (typically -9.8)
 *   8      4    interactionRadius   - Mouse interaction sphere radius
 *  12      4    interactionStrength - Force magnitude (+ = pull, - = push)
 *  16     16    inputPoint          - 3D mouse position (vec4, w unused)
 * ------
 * Total: 32 bytes
 */
struct SimParams {
  deltaTime: f32,
  gravity: f32,
  interactionRadius: f32,
  interactionStrength: f32,
  inputPoint: vec4<f32>,
};

// ============================================================================
// BUFFER BINDINGS
// ============================================================================
// Group 0: External Forces compute pass
//
//   Binding 0: positions[]  - Current particle positions (read-only)
//              Format: vec4<f32> per particle, xyz = position, w = 1.0
//
//   Binding 1: velocities[] - Particle velocities (read-write)
//              Format: vec4<f32> per particle, xyz = velocity, w = 0.0
//
//   Binding 2: predicted[]  - Output predicted positions for spatial hashing
//              Format: vec4<f32> per particle, xyz = predicted pos, w = 1.0
//
//   Binding 3: params       - Uniform parameters for this pass
// ============================================================================

@group(0) @binding(0) var<storage, read> positions: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> velocities: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> predicted: array<vec4<f32>>;
@group(0) @binding(3) var<uniform> params: SimParams;

/**
 * Main Compute Kernel
 *
 * Dispatch: ceil(particleCount / 256) workgroups
 * Each thread processes exactly one particle.
 *
 * Algorithm:
 * 1. Early exit if thread index exceeds particle count
 * 2. Load current position and velocity
 * 3. Compute gravity acceleration (constant downward force)
 * 4. If user interaction is active:
 *    a. Check if particle is within interaction radius
 *    b. Compute smooth falloff factor (1 at center, 0 at edge)
 *    c. Apply interaction force toward/away from input point
 *    d. Apply velocity damping to prevent orbital instability
 *    e. Optionally reduce gravity (for "lifting" effect during pull)
 * 5. Integrate velocity: v_new = v_old + accel * dt
 * 6. Predict position: pred = pos + vel * (1/120)
 */
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let index = id.x;

  // Bounds check: Ensure we don't access beyond the buffer
  // Note: arrayLength() returns the number of elements, not bytes
  if (index >= arrayLength(&positions)) {
    return;
  }

  // Load current state
  // .xyz extracts the 3D vector, ignoring the w component
  let pos = positions[index].xyz;
  var vel = velocities[index].xyz;

  // ========================================================================
  // GRAVITY FORCE
  // ========================================================================
  // Constant downward acceleration (Y-axis is up in this coordinate system)
  // Typical value: -9.8 m/s² for Earth-like gravity
  let gravityAccel = vec3<f32>(0.0, params.gravity, 0.0);
  var finalAccel = gravityAccel;

  // ========================================================================
  // USER INTERACTION FORCE
  // ========================================================================
  // Only compute if user is actively interacting (strength != 0)
  // interactionStrength > 0 = pull toward cursor
  // interactionStrength < 0 = push away from cursor
  if (params.interactionStrength != 0.0) {
      // Vector from particle to input point
      let offset = params.inputPoint.xyz - pos;
      let sqrDst = dot(offset, offset);  // Squared distance (avoid sqrt when possible)
      let radius = params.interactionRadius;

      // Check if particle is within interaction sphere
      // Also check sqrDst > epsilon to avoid division by zero at exact center
      if (sqrDst < radius * radius && sqrDst > 0.000001) {
          let dst = sqrt(sqrDst);

          // Smooth falloff function:
          //   edgeT = 0 at center, 1 at edge
          //   centreT = 1 at center, 0 at edge
          // This creates a smooth force field that's strongest at the click point
          let edgeT = dst / radius;
          let centreT = 1.0 - edgeT;

          // Normalized direction toward input point
          let dirToCentre = offset / dst;

          // Reduce gravity influence when pulling (creates a "lifting" effect)
          // saturate() clamps to [0, 1] range
          // At strength=10, gravity is completely cancelled at the center
          let gravityWeight = 1.0 - (centreT * saturate(params.interactionStrength / 10.0));

          // Interaction acceleration: scales with distance falloff and strength
          let interactionAccel = dirToCentre * centreT * params.interactionStrength;

          // Final acceleration combines:
          //   1. Gravity (optionally reduced during pull)
          //   2. Interaction force (toward or away from cursor)
          //   3. Velocity damping (prevents particles from orbiting the cursor)
          // The damping term (-vel * centreT) is crucial for stable interaction
          finalAccel = gravityAccel * gravityWeight + interactionAccel - vel * centreT;
      }
  }

  // ========================================================================
  // VELOCITY INTEGRATION
  // ========================================================================
  // Semi-implicit Euler: v(t+dt) = v(t) + a(t) * dt
  // Position will be updated in the integrate shader after pressure/viscosity
  vel = vel + finalAccel * params.deltaTime;
  velocities[index] = vec4<f32>(vel, 0.0);

  // ========================================================================
  // POSITION PREDICTION (PBD)
  // ========================================================================
  // Predict where the particle will be at the end of this frame.
  // This predicted position is used for spatial hashing (neighbor search).
  //
  // Why 1/120?
  //   - Matches common simulation tick rates (120 Hz)
  //   - Provides a good balance between prediction accuracy and stability
  //   - Consistent with the Unity reference implementation
  //
  // Note: The actual position update uses the full deltaTime in integrate.wgsl
  let predictionFactor = 1.0 / 120.0;
  predicted[index] = vec4<f32>(pos + vel * predictionFactor, 1.0);
}