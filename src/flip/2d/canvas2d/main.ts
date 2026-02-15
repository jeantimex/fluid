import './style.css';
import { setupGui } from './gui';
import { Renderer } from './renderer';
import { createSetObstacle, setupFluidScene } from '../core/scene';
import { bindObstaclePointerControls } from '../core/interaction';
import { bindSimulationKeyboardControls } from '../core/keyboard';
import { simulateScene } from '../core/simulation';
import { resizeSimulationCanvas } from '../core/resize';
import { createGuiState } from '../core/gui';
import { createFluidGuiOptions } from '../core/gui-options';
import { startAnimationLoop } from '../core/loop';
import { createFluidGuiCallbacks } from '../core/gui-callbacks';
import { resetGridRenderer } from '../core/render';
import { bootstrapWithResize } from '../core/bootstrap';
import { addPauseResetControls } from '../core/gui-controls';
import { createSimulationContext } from '../core/context';

const canvas = document.getElementById("myCanvas") as HTMLCanvasElement;
const gl = canvas.getContext("webgl")!;
const renderer = new Renderer(gl);

canvas.focus();

const sim = createSimulationContext();
const setObstacleFn = createSetObstacle(sim.scene);

function setupScene() {
  resetGridRenderer(renderer);
  setupFluidScene(sim.scene, sim.simWidth, sim.simHeight);
}

function resize() {
  const size = resizeSimulationCanvas(canvas);
  gl.viewport(0, 0, canvas.width, canvas.height);
  sim.cScale = size.cScale;
  sim.simHeight = size.simHeight;
  sim.simWidth = size.simWidth;
  setupScene();
}

bindObstaclePointerControls({
  canvas,
  scene: sim.scene,
  getScale: () => sim.cScale,
  setObstacle: setObstacleFn,
});

bindSimulationKeyboardControls({ scene: sim.scene, simulate });

const guiState = createGuiState({
  scene: sim.scene,
  onReset: setupScene,
  onPauseStateChanged: (paused) => {
    if (pauseController) pauseController.name(paused ? 'Resume' : 'Pause');
  },
});

const { stats, gui } = setupGui(
  sim.scene,
  createFluidGuiCallbacks({ scene: sim.scene, onReset: guiState.reset, setObstacle: setObstacleFn }),
  createFluidGuiOptions({
    title: 'Canvas 2D FLIP Fluid',
    subtitle: 'Hybrid FLIP/PIC Fluid Simulation',
    features: ['FLIP/PIC Hybrid Solver', 'Staggered MAC Grid', 'Incompressible Pressure Solver', 'Interactive Obstacle', 'Particle Drift Compensation'],
  })
);

let pauseController = addPauseResetControls(gui, guiState, sim.scene);

function simulate() {
  simulateScene(sim.scene);
}

bootstrapWithResize({ resize, onBeforeResize: setupScene });
startAnimationLoop({
  immediateStart: true,
  frame: () => {
    stats.begin();
    simulate();
    renderer.draw(sim.scene, sim.simWidth, sim.simHeight, canvas);
    stats.end();
  },
});
