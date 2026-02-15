import { Scene } from '../canvas2d/types';

interface GuiStateOptions {
  scene: Scene;
  onReset: () => void;
  onPauseStateChanged?: (paused: boolean) => void;
}

export function createGuiState(options: GuiStateOptions) {
  const { scene, onReset, onPauseStateChanged } = options;
  return {
    togglePause: () => {
      scene.paused = !scene.paused;
      onPauseStateChanged?.(scene.paused);
    },
    reset: () => onReset(),
  };
}
