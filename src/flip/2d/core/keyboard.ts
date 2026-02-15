import { Scene } from '../canvas2d/types';

interface KeyboardControlOptions {
  scene: Scene;
  simulate: () => void;
  onPauseStateChanged?: (paused: boolean) => void;
}

export function bindSimulationKeyboardControls(options: KeyboardControlOptions) {
  const { scene, simulate, onPauseStateChanged } = options;

  document.addEventListener("keydown", (e) => {
    if (e.key === "p") {
      scene.paused = !scene.paused;
      onPauseStateChanged?.(scene.paused);
    }

    if (e.key === "m") {
      scene.paused = false;
      simulate();
      scene.paused = true;
      onPauseStateChanged?.(scene.paused);
    }
  });
}
