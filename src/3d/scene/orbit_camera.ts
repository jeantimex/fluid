/**
 * Orbit Camera Controller
 *
 * Uses spherical coordinates to orbit around a target point.
 */

import { mat4LookAt, vec3Add } from './math_utils';

type Vec3 = { x: number; y: number; z: number };

export class OrbitCamera {
  radius: number = 5.0;
  theta: number = 0.0;
  phi: number = Math.PI / 2;
  target: Vec3 = { x: 0, y: 0, z: 0 };
  minRadius: number = 2.0;
  maxRadius: number = 100.0;

  rotate(dTheta: number, dPhi: number) {
    this.theta += dTheta;
    this.phi += dPhi;

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

  get position(): Vec3 {
    const x = this.radius * Math.sin(this.phi) * Math.sin(this.theta);
    const y = this.radius * Math.cos(this.phi);
    const z = this.radius * Math.sin(this.phi) * Math.cos(this.theta);

    return vec3Add(this.target, { x, y, z });
  }
}
