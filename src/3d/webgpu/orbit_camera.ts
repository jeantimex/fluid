import { mat4LookAt, vec3Add } from './math_utils';

export class OrbitCamera {
  radius: number = 5.0;
  theta: number = 0.0; // Angle around Y axis
  phi: number = Math.PI / 2; // Angle from Y axis (polar)
  target: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 };

      minRadius: number = 2.0;
      maxRadius: number = 100.0;
  
      constructor() {}
  rotate(dTheta: number, dPhi: number) {
    this.theta += dTheta;
    this.phi += dPhi;

    // Clamp phi to avoid flipping
    const epsilon = 0.001;
    this.phi = Math.max(epsilon, Math.min(Math.PI - epsilon, this.phi));
  }

  zoom(delta: number) {
    this.radius += delta;
    this.radius = Math.max(
      this.minRadius,
      Math.min(this.maxRadius, this.radius)
    );
  }

  get viewMatrix(): Float32Array {
    const x = this.radius * Math.sin(this.phi) * Math.sin(this.theta);
    const y = this.radius * Math.cos(this.phi);
    const z = this.radius * Math.sin(this.phi) * Math.cos(this.theta);

    const eye = vec3Add(this.target, { x, y, z });
    return mat4LookAt(eye, this.target, { x: 0, y: 1, z: 0 });
  }

  get basis(): {
    right: { x: number; y: number; z: number };
    up: { x: number; y: number; z: number };
    forward: { x: number; y: number; z: number };
  } {
    const view = this.viewMatrix;
    // View matrix is inverse camera transform.
    // Rows of rotation part are the basis vectors of camera in world space?
    // Let's re-derive.
    // M_view = [ R^T  -R^T * eye ]
    // R = [ right, up, back ] (columns)
    // R^T = [ right^T; up^T; back^T ] (rows)

    // So Row 0 is Right. Row 1 is Up. Row 2 is Back.
    // indices: 0, 4, 8 for col 0. 1, 5, 9 for col 1.
    // mat4LookAt in math_utils:
    // out[0] = x.x; out[4] = x.y; out[8] = x.z;
    // This sets Column 0? No.
    // indices 0,1,2,3 is Col 0.
    // out[0] is index 0. out[4] is index 4.
    // So x.x is at (0,0). x.y is at (1,0) (row 1, col 0)?
    // No, float array is usually column-major.
    // index = col * 4 + row.
    // 0 = 0*4 + 0. 4 = 1*4 + 0. 8 = 2*4 + 0.
    // So out[0], out[4], out[8] are the elements of Row 0.
    // So Row 0 is (x.x, x.y, x.z).
    // Which is Right vector.

    const right = { x: view[0], y: view[4], z: view[8] };
    const up = { x: view[1], y: view[5], z: view[9] };
    const back = { x: view[2], y: view[6], z: view[10] };
    const forward = { x: -back.x, y: -back.y, z: -back.z };

    return { right, up, forward };
  }

  get position(): { x: number; y: number; z: number } {
    const x = this.radius * Math.sin(this.phi) * Math.sin(this.theta);
    const y = this.radius * Math.cos(this.phi);
    const z = this.radius * Math.sin(this.phi) * Math.cos(this.theta);
    return vec3Add(this.target, { x, y, z });
  }
}
