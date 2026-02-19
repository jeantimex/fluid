import { Camera } from '../camera';
import { Utilities } from '../utilities';

export interface MouseInteractionSample {
  viewMatrix: Float32Array;
  inverseViewMatrix: Float32Array;
  worldSpaceMouseRay: [number, number, number];
  mouseVelocity: [number, number, number];
  simMouseRayOrigin: [number, number, number];
}

/**
 * Encapsulates pointer input and per-frame interaction math used by the solver.
 *
 * Responsibilities:
 * - Forward pointer events to orbit camera controls.
 * - Track normalized mouse coordinates.
 * - Compute mouse ray + world velocity each frame for fluid interaction forces.
 */
export class MouseInteractionController {
  private readonly canvas: HTMLCanvasElement;
  private readonly camera: Camera;

  private mouseX = 0;
  private mouseY = 0;
  private lastMousePlaneX = 0;
  private lastMousePlaneY = 0;

  constructor(canvas: HTMLCanvasElement, camera: Camera) {
    this.canvas = canvas;
    this.camera = camera;

    canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.camera.onMouseDown(e);
    });

    document.addEventListener('pointerup', (e) => {
      e.preventDefault();
      this.camera.onMouseUp();
    });

    canvas.addEventListener('pointermove', (e) => {
      e.preventDefault();

      const position = Utilities.getMousePosition(e, canvas);
      const rect = canvas.getBoundingClientRect();
      const normalizedX = position.x / rect.width;
      const normalizedY = position.y / rect.height;

      this.mouseX = normalizedX * 2.0 - 1.0;
      this.mouseY = (1.0 - normalizedY) * 2.0 - 1.0;

      this.camera.onMouseMove(e);
    });
  }

  sample(
    fov: number,
    simOffset: [number, number, number]
  ): MouseInteractionSample {
    const tanHalfFov = Math.tan(fov / 2.0);
    const aspect = this.canvas.width / this.canvas.height;

    const viewSpaceMouseRay: [number, number, number] = [
      this.mouseX * tanHalfFov * aspect,
      this.mouseY * tanHalfFov,
      -1.0,
    ];

    const mousePlaneX = viewSpaceMouseRay[0] * this.camera.distance;
    const mousePlaneY = viewSpaceMouseRay[1] * this.camera.distance;

    let mouseVelocityX = mousePlaneX - this.lastMousePlaneX;
    let mouseVelocityY = mousePlaneY - this.lastMousePlaneY;

    if (this.camera.isMouseDown()) {
      mouseVelocityX = 0.0;
      mouseVelocityY = 0.0;
    }

    this.lastMousePlaneX = mousePlaneX;
    this.lastMousePlaneY = mousePlaneY;

    const viewMatrix = this.camera.getViewMatrix();
    const inverseViewMatrix =
      Utilities.invertMatrix(new Float32Array(16), viewMatrix) ||
      new Float32Array(16);

    const worldSpaceMouseRay: [number, number, number] = [0, 0, 0];
    Utilities.transformDirectionByMatrix(
      worldSpaceMouseRay,
      viewSpaceMouseRay,
      inverseViewMatrix
    );
    Utilities.normalizeVector(worldSpaceMouseRay, worldSpaceMouseRay);

    const cameraRight: [number, number, number] = [
      viewMatrix[0],
      viewMatrix[4],
      viewMatrix[8],
    ];
    const cameraUp: [number, number, number] = [
      viewMatrix[1],
      viewMatrix[5],
      viewMatrix[9],
    ];

    const mouseVelocity: [number, number, number] = [
      mouseVelocityX * cameraRight[0] + mouseVelocityY * cameraUp[0],
      mouseVelocityX * cameraRight[1] + mouseVelocityY * cameraUp[1],
      mouseVelocityX * cameraRight[2] + mouseVelocityY * cameraUp[2],
    ];

    const mouseRayOrigin = this.camera.getPosition();
    const simMouseRayOrigin: [number, number, number] = [
      mouseRayOrigin[0] - simOffset[0],
      mouseRayOrigin[1] - simOffset[1],
      mouseRayOrigin[2] - simOffset[2],
    ];

    return {
      viewMatrix,
      inverseViewMatrix,
      worldSpaceMouseRay,
      mouseVelocity,
      simMouseRayOrigin,
    };
  }
}
