export function mat4Perspective(
  fov: number,
  aspect: number,
  near: number,
  far: number
): Float32Array {
  const f = 1.0 / Math.tan(fov / 2);
  const nf = 1 / (near - far);
  const out = new Float32Array(16);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) * nf;
  out[11] = -1;
  out[14] = 2 * far * near * nf;
  return out;
}

export function mat4LookAt(
  eye: { x: number; y: number; z: number },
  target: { x: number; y: number; z: number },
  up: { x: number; y: number; z: number }
): Float32Array {
  const z = normalize(sub(eye, target));
  const x = normalize(cross(up, z));
  const y = cross(z, x);
  const out = new Float32Array(16);
  out[0] = x.x;
  out[4] = x.y;
  out[8] = x.z;
  out[12] = -dot(x, eye);
  out[1] = y.x;
  out[5] = y.y;
  out[9] = y.z;
  out[13] = -dot(y, eye);
  out[2] = z.x;
  out[6] = z.y;
  out[10] = z.z;
  out[14] = -dot(z, eye);
  out[3] = 0;
  out[7] = 0;
  out[11] = 0;
  out[15] = 1;
  return out;
}

export function mat4Multiply(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(16);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        sum += a[k * 4 + r] * b[c * 4 + k]; // Column-major logic
      }
      out[c * 4 + r] = sum;
    }
  }
  return out;
}

export function sub(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number }
) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
export function normalize(v: { x: number; y: number; z: number }) {
  const l = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  return { x: v.x / l, y: v.y / l, z: v.z / l };
}
export function cross(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number }
) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}
export function dot(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number }
) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function vec3Scale(v: { x: number; y: number; z: number }, s: number) {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}
export function vec3Add(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number }
) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function rayBoxIntersection(
  rayOrigin: { x: number; y: number; z: number },
  rayDir: { x: number; y: number; z: number },
  boxMin: { x: number; y: number; z: number },
  boxMax: { x: number; y: number; z: number }
): boolean {
  let tmin = (boxMin.x - rayOrigin.x) / rayDir.x;
  let tmax = (boxMax.x - rayOrigin.x) / rayDir.x;

  if (tmin > tmax) [tmin, tmax] = [tmax, tmin];

  let tymin = (boxMin.y - rayOrigin.y) / rayDir.y;
  let tymax = (boxMax.y - rayOrigin.y) / rayDir.y;

  if (tymin > tymax) [tymin, tymax] = [tymax, tymin];

  if (tmin > tymax || tymin > tmax) return false;

  if (tymin > tmin) tmin = tymin;
  if (tymax < tmax) tmax = tymax;

  let tzmin = (boxMin.z - rayOrigin.z) / rayDir.z;
  let tzmax = (boxMax.z - rayOrigin.z) / rayDir.z;

  if (tzmin > tzmax) [tzmin, tzmax] = [tzmax, tzmin];

  if (tmin > tzmax || tzmin > tmax) return false;

  return true;
}
