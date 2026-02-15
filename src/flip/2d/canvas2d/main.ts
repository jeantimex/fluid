import './style.css';
import { setupGui } from './gui';
import { Scene } from './types';
import { Renderer } from './renderer';
import { applyObstacleToScene, createDefaultScene, setupFluidScene } from '../core/scene';
import { bindObstaclePointerControls } from '../core/interaction';
import { bindSimulationKeyboardControls } from '../core/keyboard';
import { simulateScene } from '../core/simulation';
import { resizeSimulationCanvas } from '../core/resize';
import { createGuiState } from '../core/gui';
import { createFluidGuiOptions } from '../core/gui-options';
import { startAnimationLoop } from '../core/loop';
import { createFluidGuiCallbacks } from '../core/gui-callbacks';

const canvas = document.getElementById("myCanvas") as HTMLCanvasElement;
const gl = canvas.getContext("webgl")!;
const renderer = new Renderer(gl);

canvas.focus();

let simHeight = 3.0;
let cScale = 300.0;
let simWidth = 1.0;

const scene: Scene = createDefaultScene();

function setupScene() {
  renderer.resetGridBuffer();
  setupFluidScene(scene, simWidth, simHeight);
}

export function setObstacle(x: number, y: number, reset: boolean) {
  applyObstacleToScene(scene, x, y, reset);
}

function resize() {
  const size = resizeSimulationCanvas(canvas);
  gl.viewport(0, 0, canvas.width, canvas.height);
  cScale = size.cScale;
  simHeight = size.simHeight;
  simWidth = size.simWidth;
  setupScene();
}

bindObstaclePointerControls({
  canvas,
  scene,
  getScale: () => cScale,
  setObstacle,
});

bindSimulationKeyboardControls({ scene, simulate });

const guiState = createGuiState({
  scene,
  onReset: setupScene,
  onPauseStateChanged: (paused) => {
    if (pauseController) pauseController.name(paused ? 'Resume' : 'Pause');
  },
});

const { stats, gui } = setupGui(
  scene,
  createFluidGuiCallbacks({ scene, onReset: guiState.reset, setObstacle }),
  createFluidGuiOptions({
    title: 'Canvas 2D FLIP Fluid',
    subtitle: 'Hybrid FLIP/PIC Fluid Simulation',
    features: ['FLIP/PIC Hybrid Solver', 'Staggered MAC Grid', 'Incompressible Pressure Solver', 'Interactive Obstacle', 'Particle Drift Compensation'],
  })
);

let pauseController = gui.add(guiState, 'togglePause').name(scene.paused ? 'Resume' : 'Pause');
gui.add(guiState, 'reset').name('Reset Simulation');

function simulate() {
  simulateScene(scene);
}

setupScene();
resize();
window.addEventListener("resize", resize);
startAnimationLoop({
  immediateStart: true,
  frame: () => {
    stats.begin();
    simulate();
    renderer.draw(scene, simWidth, simHeight, canvas);
    stats.end();
  },
});
