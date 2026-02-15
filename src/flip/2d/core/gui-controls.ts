import GUI from 'lil-gui';
import { Scene } from '../canvas2d/types';

interface PauseResetGuiState {
  togglePause: () => void;
  reset: () => void;
}

export function addPauseResetControls(gui: GUI, guiState: PauseResetGuiState, scene: Scene) {
  const pauseController = gui.add(guiState, 'togglePause').name(scene.paused ? 'Resume' : 'Pause');
  gui.add(guiState, 'reset').name('Reset Simulation');
  return pauseController;
}
