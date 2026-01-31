/**
 * =============================================================================
 * Orbit Camera Controller
 * =============================================================================
 *
 * This module implements a spherical coordinate-based orbit camera for the
 * 3D fluid simulation. The camera orbits around a target point (typically
 * the center of the simulation), allowing users to view the scene from any angle.
 *
 * ## Spherical Coordinates
 *
 * The camera position is defined using spherical coordinates:
 *
 * ```
 *           Y (up)
 *           │
 *           │    * Camera
 *           │   /│
 *           │  / │ radius
 *           │ /  │
 *           │/ φ │ (phi - angle from Y axis)
 *           ├────┼──────► X
 *          /  θ
 *         /  (theta - angle around Y axis)
 *        Z
 *
 * Position calculation:
 *   x = radius × sin(φ) × sin(θ)
 *   y = radius × cos(φ)
 *   z = radius × sin(φ) × cos(θ)
 * ```
 *
 * ## Angle Conventions
 *
 * - **theta (θ)**: Azimuthal angle, rotation around the Y axis (horizontal)
 *   - Range: (-∞, +∞), wraps around naturally
 *   - 0 = looking from +Z direction
 *
 * - **phi (φ)**: Polar angle, angle from the Y axis (vertical)
 *   - Range: (ε, π - ε) where ε ≈ 0.001
 *   - 0 = directly above (looking down from +Y)
 *   - π/2 = at the horizon
 *   - π = directly below (looking up from -Y)
 *   - Clamped to avoid gimbal lock at poles
 *
 * ## Usage
 *
 * ```typescript
 * const camera = new OrbitCamera();
 * camera.radius = 30;        // Set distance from target
 * camera.theta = Math.PI/6;  // Rotate around Y axis
 * camera.phi = Math.PI/2.5;  // Tilt down from above
 *
 * // During interaction:
 * camera.rotate(dx * 0.005, dy * 0.005);  // Rotate based on mouse drag
 * camera.zoom(wheelDelta * 0.01);          // Zoom based on mouse wheel
 *
 * // For rendering:
 * const viewMatrix = camera.viewMatrix;    // Use for view transformation
 * ```
 *
 * @module orbit_camera
 */

import { mat4LookAt, vec3Add } from './math_utils';

/**
 * Simple 3D vector type for camera calculations.
 */
type Vec3 = { x: number; y: number; z: number };

/**
 * Orbit camera that rotates around a target point.
 *
 * The camera maintains its position in spherical coordinates relative to
 * a target point. This makes it easy to implement orbit controls where
 * the user drags to rotate around the scene.
 */
export class OrbitCamera {
  // ===========================================================================
  // Spherical Coordinate Parameters
  // ===========================================================================

  /**
   * Distance from camera to target point.
   * Controlled by zoom (mouse wheel).
   *
   * Default: 5.0 (typically overridden by application)
   */
  radius: number = 5.0;

  /**
   * Horizontal rotation angle (radians).
   * Rotation around the Y axis.
   *
   * - Positive values rotate counter-clockwise when viewed from above
   * - Unbounded (can wrap around multiple times)
   *
   * Default: 0.0 (looking from +Z direction)
   */
  theta: number = 0.0;

  /**
   * Vertical angle from the Y axis (radians).
   * Also known as the polar angle or inclination.
   *
   * - 0 = directly above, looking straight down
   * - π/2 = at horizon level
   * - π = directly below, looking straight up
   *
   * Clamped to avoid gimbal lock at poles.
   *
   * Default: π/2 (at horizon level)
   */
  phi: number = Math.PI / 2;

  /**
   * The point the camera looks at and orbits around.
   *
   * Default: (0, 0, 0) - scene origin
   */
  target: Vec3 = { x: 0, y: 0, z: 0 };

  // ===========================================================================
  // Zoom Constraints
  // ===========================================================================

  /**
   * Minimum allowed radius (closest zoom).
   * Prevents camera from going through the target.
   */
  minRadius: number = 2.0;

  /**
   * Maximum allowed radius (farthest zoom).
   * Prevents camera from going too far away.
   */
  maxRadius: number = 100.0;

  // ===========================================================================
  // Constructor
  // ===========================================================================

  /**
   * Creates a new orbit camera with default settings.
   *
   * The camera starts at:
   * - radius = 5 units from target
   * - theta = 0 (looking from +Z direction)
   * - phi = π/2 (at horizon level)
   * - target = (0, 0, 0)
   */
  constructor() {}

  // ===========================================================================
  // Camera Controls
  // ===========================================================================

  /**
   * Rotates the camera around the target.
   *
   * This is typically called in response to mouse drag events.
   * The deltas should be scaled appropriately (e.g., multiply mouse
   * pixel movement by a sensitivity factor like 0.005).
   *
   * @param dTheta - Change in horizontal angle (radians)
   * @param dPhi - Change in vertical angle (radians)
   */
  rotate(dTheta: number, dPhi: number) {
    // Apply rotation deltas
    this.theta += dTheta;
    this.phi += dPhi;

    // Clamp phi to prevent flipping at poles (gimbal lock)
    // We leave a small epsilon to avoid exactly 0 or π which causes
    // the up vector to become parallel to the view direction
    const epsilon = 0.001;
    this.phi = Math.max(epsilon, Math.min(Math.PI - epsilon, this.phi));
  }

  /**
   * Zooms the camera in or out by adjusting the radius.
   *
   * Positive delta zooms out (increases radius).
   * Negative delta zooms in (decreases radius).
   *
   * This is typically called in response to mouse wheel events.
   * The delta should be scaled appropriately (e.g., multiply wheel
   * delta by 0.01).
   *
   * @param delta - Change in radius (positive = zoom out)
   */
  zoom(delta: number) {
    this.radius += delta;
    // Clamp to allowed range
    this.radius = Math.max(
      this.minRadius,
      Math.min(this.maxRadius, this.radius)
    );
  }

  // ===========================================================================
  // Matrix Generation
  // ===========================================================================

  /**
   * Computes the view matrix for rendering.
   *
   * The view matrix transforms world coordinates to view (camera) coordinates.
   * It is the inverse of the camera's world transformation.
   *
   * This getter computes the matrix fresh each time, so cache the result
   * if you need to use it multiple times per frame.
   *
   * @returns A 4x4 view matrix as Float32Array (column-major)
   */
  get viewMatrix(): Float32Array {
    // Convert spherical coordinates to Cartesian offset from target
    // x = r × sin(φ) × sin(θ)
    // y = r × cos(φ)
    // z = r × sin(φ) × cos(θ)
    const x = this.radius * Math.sin(this.phi) * Math.sin(this.theta);
    const y = this.radius * Math.cos(this.phi);
    const z = this.radius * Math.sin(this.phi) * Math.cos(this.theta);

    // Camera position is target + offset
    const eye = vec3Add(this.target, { x, y, z });

    // Generate look-at matrix
    // Eye looks at target with Y-up orientation
    return mat4LookAt(eye, this.target, { x: 0, y: 1, z: 0 });
  }

  // ===========================================================================
  // Basis Vectors
  // ===========================================================================

  /**
   * Returns the camera's basis vectors in world space.
   *
   * These vectors describe the camera's orientation:
   * - **right**: Points to the camera's right (+X in view space)
   * - **up**: Points to the camera's up (+Y in view space)
   * - **forward**: Points toward the target (-Z in view space, into the screen)
   *
   * These are useful for:
   * - Converting screen coordinates to world rays (ray casting)
   * - Billboard rendering
   * - UI placement in 3D space
   *
   * The vectors are extracted from the view matrix, which stores them
   * in its rows (transposed rotation part).
   *
   * @returns Object containing right, up, and forward unit vectors
   */
  get basis(): {
    right: Vec3;
    up: Vec3;
    forward: Vec3;
  } {
    const view = this.viewMatrix;

    // The view matrix is: M = R^T × T
    // where R^T is the transposed rotation matrix.
    //
    // For a look-at matrix with (right, up, back) as camera axes:
    // R = [right | up | back] (columns)
    // R^T = [right; up; back] (rows)
    //
    // In column-major storage (WebGPU/OpenGL convention):
    // index = col * 4 + row
    // So indices 0, 4, 8 are the first row (right vector)
    // indices 1, 5, 9 are the second row (up vector)
    // indices 2, 6, 10 are the third row (back vector)

    const right: Vec3 = { x: view[0], y: view[4], z: view[8] };
    const up: Vec3 = { x: view[1], y: view[5], z: view[9] };
    const back: Vec3 = { x: view[2], y: view[6], z: view[10] };

    // Forward is the opposite of back (toward the target)
    const forward: Vec3 = { x: -back.x, y: -back.y, z: -back.z };

    return { right, up, forward };
  }

  // ===========================================================================
  // Position Accessor
  // ===========================================================================

  /**
   * Returns the camera's position in world space.
   *
   * This is computed from the spherical coordinates (radius, theta, phi)
   * plus the target offset.
   *
   * @returns Camera position as a 3D vector
   */
  get position(): Vec3 {
    // Same calculation as in viewMatrix getter
    const x = this.radius * Math.sin(this.phi) * Math.sin(this.theta);
    const y = this.radius * Math.cos(this.phi);
    const z = this.radius * Math.sin(this.phi) * Math.cos(this.theta);

    return vec3Add(this.target, { x, y, z });
  }
}
