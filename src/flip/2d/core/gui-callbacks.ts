import { GuiCallbacks } from '../canvas2d/gui';
import { Scene } from '../canvas2d/types';

interface CreateGuiCallbacksOptions {
  scene: Scene;
  onReset: () => void;
  setObstacle: (x: number, y: number, reset: boolean) => void;
}

export function createFluidGuiCallbacks(options: CreateGuiCallbacksOptions): GuiCallbacks {
  const { scene, onReset, setObstacle } = options;
  return {
    onReset,
    onToggleObstacle: () => setObstacle(scene.obstacleX, scene.obstacleY, true),
  };
}
