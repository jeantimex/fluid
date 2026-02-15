/**
 * FLIP Fluid User Interaction
 *
 * This module handles mouse, touch, and keyboard input for the simulation.
 * - Mouse/touch drag: Move the obstacle
 * - Keyboard 'p': Pause/unpause
 * - Keyboard 'm': Single step (manual advance)
 */

export interface InteractionState {
  mouseDown: boolean;
  obstacleX: number;
  obstacleY: number;
  obstacleVelX: number;
  obstacleVelY: number;
}

export class Interaction {
  private canvas: HTMLCanvasElement;
  private cScale: number;
  private simHeight: number;
  private state: InteractionState;
  private dt: number;

  constructor(canvas: HTMLCanvasElement, simHeight: number, dt: number) {
    this.canvas = canvas;
    this.simHeight = simHeight;
    this.cScale = canvas.height / simHeight;
    this.dt = dt;

    this.state = {
      mouseDown: false,
      obstacleX: 0,
      obstacleY: 0,
      obstacleVelX: 0,
      obstacleVelY: 0,
    };
  }

  /**
   * Convert client coordinates to simulation coordinates.
   */
  private clientToSim(clientX: number, clientY: number): { x: number; y: number } {
    const bounds = this.canvas.getBoundingClientRect();
    const mx = clientX - bounds.left - this.canvas.clientLeft;
    const my = clientY - bounds.top - this.canvas.clientTop;
    return {
      x: mx / this.cScale,
      y: (this.canvas.height - my) / this.cScale,
    };
  }

  /**
   * Called when drag starts (mousedown/touchstart).
   */
  startDrag(clientX: number, clientY: number): void {
    this.state.mouseDown = true;
    const pos = this.clientToSim(clientX, clientY);
    this.state.obstacleX = pos.x;
    this.state.obstacleY = pos.y;
    this.state.obstacleVelX = 0;
    this.state.obstacleVelY = 0;
  }

  /**
   * Called during drag (mousemove/touchmove).
   */
  drag(clientX: number, clientY: number): void {
    if (!this.state.mouseDown) return;

    const pos = this.clientToSim(clientX, clientY);

    // Compute velocity from position change
    this.state.obstacleVelX = (pos.x - this.state.obstacleX) / this.dt;
    this.state.obstacleVelY = (pos.y - this.state.obstacleY) / this.dt;

    this.state.obstacleX = pos.x;
    this.state.obstacleY = pos.y;
  }

  /**
   * Called when drag ends (mouseup/touchend).
   */
  endDrag(): void {
    this.state.mouseDown = false;
    this.state.obstacleVelX = 0;
    this.state.obstacleVelY = 0;
  }

  /**
   * Get current obstacle position.
   */
  getObstaclePosition(): { x: number; y: number } {
    return {
      x: this.state.obstacleX,
      y: this.state.obstacleY,
    };
  }

  /**
   * Get current obstacle velocity.
   */
  getObstacleVelocity(): { vx: number; vy: number } {
    return {
      vx: this.state.obstacleVelX,
      vy: this.state.obstacleVelY,
    };
  }

  /**
   * Set obstacle position directly (for initial setup).
   */
  setObstaclePosition(x: number, y: number): void {
    this.state.obstacleX = x;
    this.state.obstacleY = y;
  }

  /**
   * Check if currently dragging.
   */
  isDragging(): boolean {
    return this.state.mouseDown;
  }
}
