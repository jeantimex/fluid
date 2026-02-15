import { Scene } from '../canvas2d/types';
import { clientToWorld } from './input';

interface ObstaclePointerControlOptions {
  canvas: HTMLCanvasElement;
  scene: Scene;
  getScale: () => number;
  setObstacle: (x: number, y: number, reset: boolean) => void;
}

export function bindObstaclePointerControls(options: ObstaclePointerControlOptions) {
  const { canvas, scene, getScale, setObstacle } = options;
  let mouseDown = false;

  function startDrag(clientX: number, clientY: number) {
    const world = clientToWorld(canvas, getScale(), clientX, clientY);
    mouseDown = true;
    setObstacle(world.x, world.y, true);
    scene.paused = false;
  }

  function drag(clientX: number, clientY: number) {
    if (!mouseDown) return;
    const world = clientToWorld(canvas, getScale(), clientX, clientY);
    setObstacle(world.x, world.y, false);
  }

  function endDrag() {
    mouseDown = false;
    scene.obstacleVelX = 0.0;
    scene.obstacleVelY = 0.0;
  }

  canvas.addEventListener("mousedown", (e) => startDrag(e.clientX, e.clientY));
  window.addEventListener("mouseup", () => endDrag());
  canvas.addEventListener("mousemove", (e) => drag(e.clientX, e.clientY));
  canvas.addEventListener("touchstart", (e) => startDrag(e.touches[0].clientX, e.touches[0].clientY));
  canvas.addEventListener("touchend", () => endDrag());
  canvas.addEventListener("touchmove", (e) => {
    e.preventDefault();
    drag(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: false });
}
