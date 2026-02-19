/**
 * Shared math utilities for camera transforms, matrix ops, and vector ops.
 *
 * Conventions used by this file/project:
 * - Matrices are 4x4 column-major Float32Array values (WebGL/WebGPU style).
 * - Vector helpers operate on mutable output arrays to avoid per-frame GC.
 * - Most functions return `out` for chaining.
 */
export const Utilities = {
  // Clamp scalar x to [min, max].
  clamp: function (x: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, x));
  },

  // Convert a DOM mouse event to element-local pixel coordinates.
  getMousePosition: function (event: MouseEvent, element: HTMLElement) {
    const boundingRect = element.getBoundingClientRect();
    return {
      x: event.clientX - boundingRect.left,
      y: event.clientY - boundingRect.top,
    };
  },

  // out = a + b
  addVectors: function (
    out: number[] | Float32Array,
    a: number[] | Float32Array,
    b: number[] | Float32Array
  ) {
    out[0] = a[0] + b[0];
    out[1] = a[1] + b[1];
    out[2] = a[2] + b[2];
    return out;
  },

  // out = a - b
  subtractVectors: function (
    out: number[] | Float32Array,
    a: number[] | Float32Array,
    b: number[] | Float32Array
  ) {
    out[0] = a[0] - b[0];
    out[1] = a[1] - b[1];
    out[2] = a[2] - b[2];
    return out;
  },

  // |v|
  magnitudeOfVector: function (v: number[] | Float32Array): number {
    return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  },

  // Dot product a · b.
  dotVectors: function (
    a: number[] | Float32Array,
    b: number[] | Float32Array
  ): number {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  },

  // out = v * k[0]. Kept for backward compatibility with older call-sites.
  multiplyVectorByScalar: function (
    out: number[] | Float32Array,
    v: number[] | Float32Array,
    k: number[]
  ) {
    out[0] = v[0] * k[0];
    out[1] = v[1] * k[0];
    out[2] = v[2] * k[0];
    return out;
  },

  // Preferred scalar multiply overload: out = v * k.
  multiplyVectorByNumber: function (
    out: number[] | Float32Array,
    v: number[] | Float32Array,
    k: number
  ) {
    out[0] = v[0] * k;
    out[1] = v[1] * k;
    out[2] = v[2] * k;
    return out;
  },

  // Normalize vector; returns zero vector for zero-length input.
  normalizeVector: function (
    out: number[] | Float32Array,
    v: number[] | Float32Array
  ) {
    const mag = Utilities.magnitudeOfVector(v);
    if (mag === 0) {
      out[0] = 0;
      out[1] = 0;
      out[2] = 0;
      return out;
    }
    const inverseMagnitude = 1.0 / mag;
    out[0] = v[0] * inverseMagnitude;
    out[1] = v[1] * inverseMagnitude;
    out[2] = v[2] * inverseMagnitude;
    return out;
  },

  // Standard perspective projection matrix.
  makePerspectiveMatrix: function (
    out: Float32Array,
    fovy: number,
    aspect: number,
    near: number,
    far: number
  ) {
    const f = 1.0 / Math.tan(fovy / 2),
      nf = 1 / (near - far);

    out[0] = f / aspect;
    out[1] = 0;
    out[2] = 0;
    out[3] = 0;
    out[4] = 0;
    out[5] = f;
    out[6] = 0;
    out[7] = 0;
    out[8] = 0;
    out[9] = 0;
    out[10] = (far + near) * nf;
    out[11] = -1;
    out[12] = 0;
    out[13] = 0;
    out[14] = 2 * far * near * nf;
    out[15] = 0;
    return out;
  },

  // Set matrix to identity.
  makeIdentityMatrix: function (matrix: Float32Array) {
    matrix.fill(0);
    matrix[0] = 1.0;
    matrix[5] = 1.0;
    matrix[10] = 1.0;
    matrix[15] = 1.0;
    return matrix;
  },

  premultiplyMatrix: function (
    out: Float32Array,
    matrixA: Float32Array,
    matrixB: Float32Array
  ) {
    // Computes out = matrixB * matrixA.
    // This ordering is intentional and used consistently by the camera code.
    const b0 = matrixB[0],
      b4 = matrixB[4],
      b8 = matrixB[8],
      b12 = matrixB[12],
      b1 = matrixB[1],
      b5 = matrixB[5],
      b9 = matrixB[9],
      b13 = matrixB[13],
      b2 = matrixB[2],
      b6 = matrixB[6],
      b10 = matrixB[10],
      b14 = matrixB[14],
      b3 = matrixB[3],
      b7 = matrixB[7],
      b11 = matrixB[11],
      b15 = matrixB[15],
      a0 = matrixA[0],
      a1 = matrixA[1],
      a2 = matrixA[2],
      a3 = matrixA[3];
    out[0] = b0 * a0 + b4 * a1 + b8 * a2 + b12 * a3;
    out[1] = b1 * a0 + b5 * a1 + b9 * a2 + b13 * a3;
    out[2] = b2 * a0 + b6 * a1 + b10 * a2 + b14 * a3;
    out[3] = b3 * a0 + b7 * a1 + b11 * a2 + b15 * a3;

    const a4 = matrixA[4],
      a5 = matrixA[5],
      a6 = matrixA[6],
      a7 = matrixA[7];
    out[4] = b0 * a4 + b4 * a5 + b8 * a6 + b12 * a7;
    out[5] = b1 * a4 + b5 * a5 + b9 * a6 + b13 * a7;
    out[6] = b2 * a4 + b6 * a5 + b10 * a6 + b14 * a7;
    out[7] = b3 * a4 + b7 * a5 + b11 * a6 + b15 * a7;

    const a8 = matrixA[8],
      a9 = matrixA[9],
      a10 = matrixA[10],
      a11 = matrixA[11];
    out[8] = b0 * a8 + b4 * a9 + b8 * a10 + b12 * a11;
    out[9] = b1 * a8 + b5 * a9 + b9 * a10 + b13 * a11;
    out[10] = b2 * a8 + b6 * a9 + b10 * a10 + b14 * a11;
    out[11] = b3 * a8 + b7 * a9 + b11 * a10 + b15 * a11;

    const a12 = matrixA[12],
      a13 = matrixA[13],
      a14 = matrixA[14],
      a15 = matrixA[15];
    out[12] = b0 * a12 + b4 * a13 + b8 * a14 + b12 * a15;
    out[13] = b1 * a12 + b5 * a13 + b9 * a14 + b13 * a15;
    out[14] = b2 * a12 + b6 * a13 + b10 * a14 + b14 * a15;
    out[15] = b3 * a12 + b7 * a13 + b11 * a14 + b15 * a15;

    return out;
  },

  // Rotation around X axis (radians).
  makeXRotationMatrix: function (matrix: Float32Array, angle: number) {
    Utilities.makeIdentityMatrix(matrix);
    matrix[5] = Math.cos(angle);
    matrix[6] = Math.sin(angle);
    matrix[9] = -Math.sin(angle);
    matrix[10] = Math.cos(angle);
    return matrix;
  },

  // Rotation around Y axis (radians).
  makeYRotationMatrix: function (matrix: Float32Array, angle: number) {
    Utilities.makeIdentityMatrix(matrix);
    matrix[0] = Math.cos(angle);
    matrix[2] = -Math.sin(angle);
    matrix[8] = Math.sin(angle);
    matrix[10] = Math.cos(angle);
    return matrix;
  },

  // Transform direction by matrix, ignoring translation (w = 0).
  transformDirectionByMatrix: function (
    out: number[] | Float32Array,
    v: number[] | Float32Array,
    m: Float32Array
  ) {
    const x = v[0],
      y = v[1],
      z = v[2];
    out[0] = m[0] * x + m[4] * y + m[8] * z;
    out[1] = m[1] * x + m[5] * y + m[9] * z;
    out[2] = m[2] * x + m[6] * y + m[10] * z;
    return out;
  },

  // General 4x4 inverse. Returns null for singular matrices.
  invertMatrix: function (out: Float32Array, m: Float32Array) {
    const m0 = m[0],
      m4 = m[4],
      m8 = m[8],
      m12 = m[12],
      m1 = m[1],
      m5 = m[5],
      m9 = m[9],
      m13 = m[13],
      m2 = m[2],
      m6 = m[6],
      m10 = m[10],
      m14 = m[14],
      m3 = m[3],
      m7 = m[7],
      m11 = m[11],
      m15 = m[15],
      temp0 = m10 * m15,
      temp1 = m14 * m11,
      temp2 = m6 * m15,
      temp3 = m14 * m7,
      temp4 = m6 * m11,
      temp5 = m10 * m7,
      temp6 = m2 * m15,
      temp7 = m14 * m3,
      temp8 = m2 * m11,
      temp9 = m10 * m3,
      temp10 = m2 * m7,
      temp11 = m6 * m3,
      temp12 = m8 * m13,
      temp13 = m12 * m9,
      temp14 = m4 * m13,
      temp15 = m12 * m5,
      temp16 = m4 * m9,
      temp17 = m8 * m5,
      temp18 = m0 * m13,
      temp19 = m12 * m1,
      temp20 = m0 * m9,
      temp21 = m8 * m1,
      temp22 = m0 * m5,
      temp23 = m4 * m1,
      t0 =
        temp0 * m5 +
        temp3 * m9 +
        temp4 * m13 -
        (temp1 * m5 + temp2 * m9 + temp5 * m13),
      t1 =
        temp1 * m1 +
        temp6 * m9 +
        temp9 * m13 -
        (temp0 * m1 + temp7 * m9 + temp8 * m13),
      t2 =
        temp2 * m1 +
        temp7 * m5 +
        temp10 * m13 -
        (temp3 * m1 + temp6 * m5 + temp11 * m13),
      t3 =
        temp5 * m1 +
        temp8 * m5 +
        temp11 * m9 -
        (temp4 * m1 + temp9 * m5 + temp10 * m9),
      det = m0 * t0 + m4 * t1 + m8 * t2 + m12 * t3;

    if (det === 0) return null;
    const d = 1.0 / det;

    out[0] = d * t0;
    out[1] = d * t1;
    out[2] = d * t2;
    out[3] = d * t3;
    out[4] =
      d *
      (temp1 * m4 +
        temp2 * m8 +
        temp5 * m12 -
        (temp0 * m4 + temp3 * m8 + temp4 * m12));
    out[5] =
      d *
      (temp0 * m0 +
        temp7 * m8 +
        temp8 * m12 -
        (temp1 * m0 + temp6 * m8 + temp9 * m12));
    out[6] =
      d *
      (temp3 * m0 +
        temp6 * m4 +
        temp11 * m12 -
        (temp2 * m0 + temp7 * m4 + temp10 * m12));
    out[7] =
      d *
      (temp4 * m0 +
        temp9 * m4 +
        temp10 * m8 -
        (temp5 * m0 + temp8 * m4 + temp11 * m8));
    out[8] =
      d *
      (temp12 * m7 +
        temp15 * m11 +
        temp16 * m15 -
        (temp13 * m7 + temp14 * m11 + temp17 * m15));
    out[9] =
      d *
      (temp13 * m3 +
        temp18 * m11 +
        temp21 * m15 -
        (temp12 * m3 + temp19 * m11 + temp20 * m15));
    out[10] =
      d *
      (temp14 * m3 +
        temp19 * m7 +
        temp22 * m15 -
        (temp15 * m3 + temp18 * m7 + temp23 * m15));
    out[11] =
      d *
      (temp17 * m3 +
        temp20 * m7 +
        temp23 * m11 -
        (temp16 * m3 + temp21 * m7 + temp22 * m11));
    out[12] =
      d *
      (temp14 * m10 +
        temp17 * m14 +
        temp13 * m6 -
        (temp16 * m14 + temp12 * m6 + temp15 * m10));
    out[13] =
      d *
      (temp20 * m14 +
        temp12 * m2 +
        temp19 * m10 -
        (temp18 * m10 + temp21 * m14 + temp13 * m2));
    out[14] =
      d *
      (temp18 * m6 +
        temp23 * m14 +
        temp15 * m2 -
        (temp22 * m14 + temp14 * m2 + temp19 * m6));
    out[15] =
      d *
      (temp22 * m10 +
        temp16 * m2 +
        temp21 * m6 -
        (temp20 * m6 + temp23 * m10 + temp17 * m2));

    return out;
  },

  // Right-handed look-at view matrix.
  makeLookAtMatrix: function (
    matrix: Float32Array,
    eye: number[] | Float32Array,
    target: number[] | Float32Array,
    up: number[] | Float32Array
  ) {
    const forwardX = eye[0] - target[0],
      forwardY = eye[1] - target[1],
      forwardZ = eye[2] - target[2];
    const forwardMagnitude = Math.sqrt(
      forwardX * forwardX + forwardY * forwardY + forwardZ * forwardZ
    );
    const fX = forwardX / forwardMagnitude;
    const fY = forwardY / forwardMagnitude;
    const fZ = forwardZ / forwardMagnitude;

    const rightX = up[2] * fY - up[1] * fZ;
    const rightY = up[0] * fZ - up[2] * fX;
    const rightZ = up[1] * fX - up[0] * fY;

    const rightMagnitude = Math.sqrt(
      rightX * rightX + rightY * rightY + rightZ * rightZ
    );
    const rX = rightX / rightMagnitude;
    const rY = rightY / rightMagnitude;
    const rZ = rightZ / rightMagnitude;

    const newUpX = fY * rZ - fZ * rY;
    const newUpY = fZ * rX - fX * rZ;
    const newUpZ = fX * rY - fY * rX;

    const newUpMagnitude = Math.sqrt(
      newUpX * newUpX + newUpY * newUpY + newUpZ * newUpZ
    );
    const nUX = newUpX / newUpMagnitude;
    const nUY = newUpY / newUpMagnitude;
    const nUZ = newUpZ / newUpMagnitude;

    matrix[0] = rX;
    matrix[1] = nUX;
    matrix[2] = fX;
    matrix[3] = 0;
    matrix[4] = rY;
    matrix[5] = nUY;
    matrix[6] = fY;
    matrix[7] = 0;
    matrix[8] = rZ;
    matrix[9] = nUZ;
    matrix[10] = fZ;
    matrix[11] = 0;
    matrix[12] = -(rX * eye[0] + rY * eye[1] + rZ * eye[2]);
    matrix[13] = -(nUX * eye[0] + nUY * eye[1] + nUZ * eye[2]);
    matrix[14] = -(fX * eye[0] + fY * eye[1] + fZ * eye[2]);
    matrix[15] = 1;
    return matrix;
  },

  // OpenGL-style orthographic projection (z in [-1, 1]).
  makeOrthographicMatrix: function (
    matrix: Float32Array,
    left: number,
    right: number,
    bottom: number,
    top: number,
    near: number,
    far: number
  ) {
    matrix[0] = 2 / (right - left);
    matrix[1] = 0;
    matrix[2] = 0;
    matrix[3] = 0;
    matrix[4] = 0;
    matrix[5] = 2 / (top - bottom);
    matrix[6] = 0;
    matrix[7] = 0;
    matrix[8] = 0;
    matrix[9] = 0;
    matrix[10] = -2 / (far - near);
    matrix[11] = 0;
    matrix[12] = -(right + left) / (right - left);
    matrix[13] = -(top + bottom) / (top - bottom);
    matrix[14] = -(far + near) / (far - near);
    matrix[15] = 1;

    return matrix;
  },

  // WebGPU orthographic projection (z in [0, 1]).
  makeOrthographicMatrixWebGPU: function (
    matrix: Float32Array,
    left: number,
    right: number,
    bottom: number,
    top: number,
    near: number,
    far: number
  ) {
    matrix[0] = 2 / (right - left);
    matrix[1] = 0;
    matrix[2] = 0;
    matrix[3] = 0;
    matrix[4] = 0;
    matrix[5] = 2 / (top - bottom);
    matrix[6] = 0;
    matrix[7] = 0;
    matrix[8] = 0;
    matrix[9] = 0;
    matrix[10] = -1 / (far - near); // Changed for [0,1] depth
    matrix[11] = 0;
    matrix[12] = -(right + left) / (right - left);
    matrix[13] = -(top + bottom) / (top - bottom);
    matrix[14] = -near / (far - near); // Changed for [0,1] depth
    matrix[15] = 1;

    return matrix;
  },
};
