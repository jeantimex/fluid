/**
 * =============================================================================
 * 3D Math Utilities
 * =============================================================================
 *
 * This module provides essential 3D math functions for the fluid simulation,
 * including matrix operations, vector math, and ray-box intersection testing.
 *
 * ## Matrix Convention
 *
 * All matrices use **column-major** order, which is the standard for WebGPU,
 * OpenGL, and WGSL shaders. In column-major order:
 *
 * ```
 * Logical matrix:     Memory layout (Float32Array):
 * [ m00 m01 m02 m03 ] [ m00, m10, m20, m30,  ← Column 0
 *   m10 m11 m12 m13     m01, m11, m21, m31,  ← Column 1
 *   m20 m21 m22 m23     m02, m12, m22, m32,  ← Column 2
 *   m30 m31 m32 m33 ]   m03, m13, m23, m33 ] ← Column 3
 *
 * Index formula: array[col * 4 + row]
 * ```
 *
 * ## Coordinate System
 *
 * We use a right-handed coordinate system:
 * - +X: Right
 * - +Y: Up
 * - +Z: Out of screen (toward viewer)
 *
 * This matches WebGPU's default NDC space where:
 * - X: [-1, 1] (left to right)
 * - Y: [-1, 1] (bottom to top)
 * - Z: [0, 1] (near to far)
 *
 * @module math_utils
 */

/**
 * Simple 3D vector type used throughout the math utilities.
 */
type Vec3 = { x: number; y: number; z: number };

// =============================================================================
// Matrix Functions
// =============================================================================

/**
 * Creates a perspective projection matrix.
 *
 * This matrix transforms view-space coordinates to clip-space coordinates,
 * creating the illusion of depth where distant objects appear smaller.
 *
 * ## WebGPU NDC Space
 *
 * WebGPU uses a different NDC (Normalized Device Coordinates) space than OpenGL:
 * - X: [-1, 1]
 * - Y: [-1, 1]
 * - Z: [0, 1] (not [-1, 1] like OpenGL!)
 *
 * This function generates a matrix for WebGPU's Z convention.
 *
 * ## Matrix Form
 *
 * ```
 * [ f/aspect  0       0              0        ]
 * [    0      f       0              0        ]
 * [    0      0   (f+n)/(n-f)   2fn/(n-f)     ]
 * [    0      0      -1              0        ]
 *
 * where f = 1 / tan(fov/2)
 * ```
 *
 * @param fov - Vertical field of view in radians
 * @param aspect - Aspect ratio (width / height)
 * @param near - Near clipping plane distance (must be > 0)
 * @param far - Far clipping plane distance (must be > near)
 * @returns A 4x4 perspective matrix as Float32Array (column-major)
 *
 * @example
 * ```typescript
 * const projection = mat4Perspective(
 *   Math.PI / 3,  // 60 degree FOV
 *   16 / 9,       // 16:9 aspect ratio
 *   0.1,          // Near plane at 0.1 units
 *   100.0         // Far plane at 100 units
 * );
 * ```
 */
export function mat4Perspective(
  fov: number,
  aspect: number,
  near: number,
  far: number
): Float32Array {
  // f = 1 / tan(fov/2) = cot(fov/2)
  // This is the focal length in terms of field of view
  const f = 1.0 / Math.tan(fov / 2);

  // nf = 1 / (near - far) - used in Z transformation
  const nf = 1 / (near - far);

  // Initialize with zeros
  const out = new Float32Array(16);

  // Column 0: X scaling (affected by aspect ratio)
  out[0] = f / aspect;

  // Column 1: Y scaling
  out[5] = f;

  // Column 2: Z transformation for WebGPU's [0, 1] depth range
  out[10] = far * nf;
  out[11] = -1; // Perspective divide indicator (w = -z)

  // Column 3: Z translation
  out[14] = far * near * nf;

  return out;
}

/**
 * Creates an orthographic projection matrix for WebGPU's [0, 1] depth range.
 */
export function mat4Ortho(
  left: number,
  right: number,
  bottom: number,
  top: number,
  near: number,
  far: number
): Float32Array {
  const lr = 1 / (right - left);
  const bt = 1 / (top - bottom);
  const nf = 1 / (far - near);

  const out = new Float32Array(16);
  out[0] = 2 * lr;
  out[5] = 2 * bt;
  out[10] = nf;
  out[12] = -(right + left) * lr;
  out[13] = -(top + bottom) * bt;
  out[14] = -near * nf;
  out[15] = 1;
  return out;
}

/**
 * Computes the inverse of a 4x4 matrix.
 */
export function mat4Invert(m: Float32Array): Float32Array {
  const out = new Float32Array(16);

  const a00 = m[0],
    a01 = m[1],
    a02 = m[2],
    a03 = m[3];
  const a10 = m[4],
    a11 = m[5],
    a12 = m[6],
    a13 = m[7];
  const a20 = m[8],
    a21 = m[9],
    a22 = m[10],
    a23 = m[11];
  const a30 = m[12],
    a31 = m[13],
    a32 = m[14],
    a33 = m[15];

  const b00 = a00 * a11 - a01 * a10;
  const b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11;
  const b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30;
  const b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31;
  const b11 = a22 * a33 - a23 * a32;

  let det =
    b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;

  if (!det) {
    return out;
  }
  det = 1.0 / det;

  out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
  out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
  out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
  out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
  out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
  out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
  out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
  out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
  out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
  out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
  out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
  out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
  out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
  out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
  out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
  out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;

  return out;
}

/**
 * Creates a view matrix using the "look-at" construction.
 *
 * The view matrix transforms world coordinates to view (camera) coordinates.
 * It positions the camera at `eye`, looking toward `target`, with `up`
 * defining the camera's vertical orientation.
 *
 * ## Construction
 *
 * 1. Calculate basis vectors:
 *    - forward (z): normalize(eye - target) → points away from target
 *    - right (x): normalize(up × forward)
 *    - up (y): forward × right (orthogonalized)
 *
 * 2. The view matrix combines:
 *    - Rotation to align world axes with camera axes
 *    - Translation to move origin to camera position
 *
 * ```
 * View = [ R^T | -R^T × eye ]
 *        [  0  |      1     ]
 *
 * where R = [right | up | forward] (camera basis as columns)
 * ```
 *
 * @param eye - Camera position in world space
 * @param target - Point the camera looks at
 * @param up - Up direction (typically {x:0, y:1, z:0})
 * @returns A 4x4 view matrix as Float32Array (column-major)
 *
 * @example
 * ```typescript
 * const view = mat4LookAt(
 *   { x: 0, y: 5, z: 10 },  // Camera at (0, 5, 10)
 *   { x: 0, y: 0, z: 0 },   // Looking at origin
 *   { x: 0, y: 1, z: 0 }    // Y is up
 * );
 * ```
 */
export function mat4LookAt(eye: Vec3, target: Vec3, up: Vec3): Float32Array {
  // Calculate camera basis vectors
  // z (forward): points from target toward eye (camera looks along -z)
  const z = normalize(sub(eye, target));

  // x (right): perpendicular to both up and forward
  const x = normalize(cross(up, z));

  // y (up): perpendicular to forward and right (re-orthogonalized)
  const y = cross(z, x);

  // Build the view matrix (column-major)
  const out = new Float32Array(16);

  // Column 0: right vector (x axis in view space)
  out[0] = x.x;
  out[1] = y.x;
  out[2] = z.x;
  out[3] = 0;

  // Column 1: up vector (y axis in view space)
  out[4] = x.y;
  out[5] = y.y;
  out[6] = z.y;
  out[7] = 0;

  // Column 2: forward vector (z axis in view space)
  out[8] = x.z;
  out[9] = y.z;
  out[10] = z.z;
  out[11] = 0;

  // Column 3: translation (-R^T × eye)
  out[12] = -dot(x, eye);
  out[13] = -dot(y, eye);
  out[14] = -dot(z, eye);
  out[15] = 1;

  return out;
}

/**
 * Multiplies two 4x4 matrices: result = a × b
 *
 * Matrix multiplication order matters:
 * - (a × b) × v = a × (b × v)
 * - So if you want to apply b first, then a, multiply as (a × b)
 *
 * For view-projection: VP = Projection × View
 * (View is applied first to vertices, then Projection)
 *
 * @param a - Left matrix (applied second)
 * @param b - Right matrix (applied first)
 * @returns The product matrix a × b as Float32Array (column-major)
 *
 * @example
 * ```typescript
 * const viewProj = mat4Multiply(projection, view);
 * // Transforms: world → view → clip space
 * ```
 */
export function mat4Multiply(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(16);

  // Standard matrix multiplication for column-major 4x4 matrices
  // out[col][row] = sum over k of a[k][row] * b[col][k]
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        // a[k][r] = a[k * 4 + r]
        // b[c][k] = b[c * 4 + k]
        sum += a[k * 4 + r] * b[c * 4 + k];
      }
      out[c * 4 + r] = sum;
    }
  }

  return out;
}

// =============================================================================
// Vector Functions
// =============================================================================

/**
 * Subtracts two vectors: a - b
 *
 * @param a - First vector (minuend)
 * @param b - Second vector (subtrahend)
 * @returns The difference vector a - b
 */
export function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

/**
 * Normalizes a vector to unit length.
 *
 * Returns a vector pointing in the same direction with length 1.
 * Warning: Returns NaN components if input is zero vector.
 *
 * @param v - Vector to normalize
 * @returns Unit vector in the same direction
 */
export function normalize(v: Vec3): Vec3 {
  const l = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  return { x: v.x / l, y: v.y / l, z: v.z / l };
}

/**
 * Computes the cross product of two vectors: a × b
 *
 * The cross product produces a vector perpendicular to both inputs.
 * In a right-handed coordinate system, the result follows the right-hand rule.
 *
 * Properties:
 * - a × b = -(b × a) (anti-commutative)
 * - |a × b| = |a| × |b| × sin(θ) where θ is the angle between them
 * - a × b = 0 if a and b are parallel
 *
 * @param a - First vector
 * @param b - Second vector
 * @returns Cross product vector perpendicular to both
 */
export function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

/**
 * Computes the dot product of two vectors: a · b
 *
 * Properties:
 * - a · b = |a| × |b| × cos(θ) where θ is the angle between them
 * - a · b > 0 when angle < 90°
 * - a · b = 0 when perpendicular
 * - a · b < 0 when angle > 90°
 * - a · a = |a|² (squared length)
 *
 * @param a - First vector
 * @param b - Second vector
 * @returns Scalar dot product
 */
export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/**
 * Scales a vector by a scalar factor.
 *
 * @param v - Vector to scale
 * @param s - Scale factor
 * @returns Scaled vector v × s
 */
export function vec3Scale(v: Vec3, s: number): Vec3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

/**
 * Adds two vectors: a + b
 *
 * @param a - First vector
 * @param b - Second vector
 * @returns Sum vector a + b
 */
export function vec3Add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

// =============================================================================
// Ray Intersection
// =============================================================================

/**
 * Tests if a ray intersects an axis-aligned bounding box (AABB).
 *
 * Uses the "slab method" which tests the ray against each pair of
 * parallel planes (slabs) that define the box.
 *
 * ## Algorithm
 *
 * For each axis:
 * 1. Calculate t values where ray enters and exits the slab
 * 2. Track the maximum entry t (tmin) and minimum exit t (tmax)
 * 3. If tmax < tmin at any point, ray misses the box
 *
 * This efficiently handles all cases including rays parallel to axes.
 *
 * @param rayOrigin - Starting point of the ray
 * @param rayDir - Direction of the ray (should be normalized for t to represent distance)
 * @param boxMin - Minimum corner of the AABB
 * @param boxMax - Maximum corner of the AABB
 * @returns True if ray intersects the box, false otherwise
 *
 * @example
 * ```typescript
 * const hit = rayBoxIntersection(
 *   { x: 0, y: 0, z: 10 },   // Ray origin
 *   { x: 0, y: 0, z: -1 },   // Ray direction (toward -Z)
 *   { x: -5, y: -5, z: -5 }, // Box min corner
 *   { x: 5, y: 5, z: 5 }     // Box max corner
 * );
 * // hit = true (ray hits the box)
 * ```
 */
export function rayBoxIntersection(
  rayOrigin: Vec3,
  rayDir: Vec3,
  boxMin: Vec3,
  boxMax: Vec3
): boolean {
  // X slab
  let tmin = (boxMin.x - rayOrigin.x) / rayDir.x;
  let tmax = (boxMax.x - rayOrigin.x) / rayDir.x;

  // Ensure tmin <= tmax (swap if ray direction is negative)
  if (tmin > tmax) [tmin, tmax] = [tmax, tmin];

  // Y slab
  let tymin = (boxMin.y - rayOrigin.y) / rayDir.y;
  let tymax = (boxMax.y - rayOrigin.y) / rayDir.y;

  if (tymin > tymax) [tymin, tymax] = [tymax, tymin];

  // Check for miss: ray exits Y slab before entering X, or vice versa
  if (tmin > tymax || tymin > tmax) return false;

  // Update interval to intersection of X and Y slabs
  if (tymin > tmin) tmin = tymin;
  if (tymax < tmax) tmax = tymax;

  // Z slab
  let tzmin = (boxMin.z - rayOrigin.z) / rayDir.z;
  let tzmax = (boxMax.z - rayOrigin.z) / rayDir.z;

  if (tzmin > tzmax) [tzmin, tzmax] = [tzmax, tzmin];

  // Check for miss: ray exits Z slab before entering XY, or vice versa
  if (tmin > tzmax || tzmin > tmax) return false;

  // Ray intersects the box
  return true;
}
