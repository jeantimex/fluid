import { Utilities } from './utilities';

// =============================================================================
// ORBIT CAMERA CONFIGURATION
// =============================================================================
// The camera orbits around a fixed point (typically world origin) at a
// constrained distance. Large min/max values accommodate the fluid container.

/** Mouse drag sensitivity (radians per pixel). */
const SENSITIVITY = 0.005;

/** Minimum camera distance (prevents clipping into fluid). */
const MIN_DISTANCE = 25.0;

/** Maximum camera distance (keeps fluid visible). */
const MAX_DISTANCE = 60.0;

/**
 * Orbit Camera Controller
 *
 * Implements a spherical coordinate camera that orbits around a fixed point.
 * Used for viewing the fluid simulation from any angle.
 *
 * ## Coordinate System
 *
 * - **Azimuth**: Horizontal rotation around Y-axis (0 = looking along -Z)
 * - **Elevation**: Vertical tilt (0 = looking at horizon, +PI/4 = looking down)
 * - **Distance**: Radius of orbit sphere
 *
 * ## Controls
 *
 * - **Mouse drag**: Rotate azimuth and elevation
 * - **Mouse wheel**: Zoom in/out (change distance)
 *
 * ## View Matrix Computation
 *
 * The view matrix is composed as:
 * ```
 * V = T(-distance) * Rx(elevation) * Ry(azimuth) * T(-orbitPoint)
 * ```
 * This transforms world coordinates to camera space where the camera
 * sits at origin looking down -Z.
 */
export class Camera {
  element: HTMLElement;
  distance: number = 30.0;
  orbitPoint: number[];
  azimuth: number = -Math.PI / 6;
  elevation: number = Math.PI / 2 - Math.PI / 2.5; // ~0.314 rad (18 degrees)
  minElevation: number = -Math.PI / 4;
  maxElevation: number = Math.PI / 4;

  lastMouseX: number = 0;
  lastMouseY: number = 0;
  mouseDown: boolean = false;

  viewMatrix: Float32Array = new Float32Array(16);

  constructor(element: HTMLElement, orbitPoint: number[]) {
    this.element = element;
    this.orbitPoint = orbitPoint;

    this.recomputeViewMatrix();

    element.addEventListener('wheel', (event: WheelEvent) => {
      // Wheel delta is translated to coarse distance steps for predictable zoom.
      const scrollDelta = event.deltaY;
      this.distance += (scrollDelta > 0 ? 1 : -1) * 2.0;

      if (this.distance < MIN_DISTANCE) this.distance = MIN_DISTANCE;
      if (this.distance > MAX_DISTANCE) this.distance = MAX_DISTANCE;

      this.recomputeViewMatrix();
    });
  }

  recomputeViewMatrix() {
    // Compose view matrix as:
    // T(-orbitPoint) -> Ry(azimuth) -> Rx(elevation) -> T(0, 0, -distance)
    // premultiplyMatrix(out, A, B) computes out = B * A in this codebase.
    const xRotationMatrix = new Float32Array(16);
    const yRotationMatrix = new Float32Array(16);
    const distanceTranslationMatrix = Utilities.makeIdentityMatrix(
      new Float32Array(16)
    );
    const orbitTranslationMatrix = Utilities.makeIdentityMatrix(
      new Float32Array(16)
    );

    Utilities.makeIdentityMatrix(this.viewMatrix);

    Utilities.makeXRotationMatrix(xRotationMatrix, this.elevation);
    Utilities.makeYRotationMatrix(yRotationMatrix, this.azimuth);

    distanceTranslationMatrix[14] = -this.distance;

    orbitTranslationMatrix[12] = -this.orbitPoint[0];
    orbitTranslationMatrix[13] = -this.orbitPoint[1];
    orbitTranslationMatrix[14] = -this.orbitPoint[2];

    Utilities.premultiplyMatrix(
      this.viewMatrix,
      this.viewMatrix,
      orbitTranslationMatrix
    );
    Utilities.premultiplyMatrix(
      this.viewMatrix,
      this.viewMatrix,
      yRotationMatrix
    );
    Utilities.premultiplyMatrix(
      this.viewMatrix,
      this.viewMatrix,
      xRotationMatrix
    );
    Utilities.premultiplyMatrix(
      this.viewMatrix,
      this.viewMatrix,
      distanceTranslationMatrix
    );
  }

  getPosition(): number[] {
    // Convert spherical orbit coordinates to world-space camera position.
    return [
      this.distance *
        Math.sin(Math.PI / 2 - this.elevation) *
        Math.sin(-this.azimuth) +
        this.orbitPoint[0],
      this.distance * Math.cos(Math.PI / 2 - this.elevation) +
        this.orbitPoint[1],
      this.distance *
        Math.sin(Math.PI / 2 - this.elevation) *
        Math.cos(-this.azimuth) +
        this.orbitPoint[2],
    ];
  }

  getViewMatrix(): Float32Array {
    return this.viewMatrix;
  }

  setBounds(minElevation: number, maxElevation: number) {
    // Bounds prevent flipping over the top/bottom poles.
    this.minElevation = minElevation;
    this.maxElevation = maxElevation;

    if (this.elevation > this.maxElevation) this.elevation = this.maxElevation;
    if (this.elevation < this.minElevation) this.elevation = this.minElevation;

    this.recomputeViewMatrix();
  }

  onMouseDown(event: MouseEvent) {
    // Capture current cursor location to compute drag deltas in onMouseMove.
    const { x, y } = Utilities.getMousePosition(event, this.element);
    this.mouseDown = true;
    this.lastMouseX = x;
    this.lastMouseY = y;
  }

  onMouseUp() {
    this.mouseDown = false;
  }

  isMouseDown(): boolean {
    return this.mouseDown;
  }

  onMouseMove(event: MouseEvent) {
    const { x, y } = Utilities.getMousePosition(event, this.element);

    if (this.mouseDown) {
      // Horizontal drag rotates around Y; vertical drag tilts camera.
      const deltaAzimuth = (x - this.lastMouseX) * SENSITIVITY;
      const deltaElevation = (y - this.lastMouseY) * SENSITIVITY;

      this.azimuth += deltaAzimuth;
      this.elevation += deltaElevation;

      if (this.elevation > this.maxElevation)
        this.elevation = this.maxElevation;
      if (this.elevation < this.minElevation)
        this.elevation = this.minElevation;

      this.recomputeViewMatrix();

      this.lastMouseX = x;
      this.lastMouseY = y;
    }
  }
}
