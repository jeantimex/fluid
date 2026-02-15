import './style.css';
import { setupGui } from '../canvas2d/gui';
import { WebGPURenderer } from './renderer';
import { createSetObstacle, setupFluidScene } from '../core/scene';
import { bindObstaclePointerControls } from '../core/interaction';
import { bindSimulationKeyboardControls } from '../core/keyboard';
import { simulateScene, syncBoundaryCollisionToCpu } from '../core/simulation';
import { resizeSimulationCanvas } from '../core/resize';
import { createGuiState } from '../core/gui';
import { createFluidGuiOptions } from '../core/gui-options';
import { startAnimationLoop } from '../core/loop';
import { createFluidGuiCallbacks } from '../core/gui-callbacks';
import { resetGridRenderer } from '../core/render';
import { bootstrapWithResize } from '../core/bootstrap';
import { addPauseResetControls } from '../core/gui-controls';
import { createSimulationContext } from '../core/context';

const canvas = document.getElementById("webgpuCanvas") as HTMLCanvasElement;
let device: GPUDevice;
let context: GPUCanvasContext;
let renderer: WebGPURenderer;
let presentationFormat: GPUTextureFormat;

const sim = createSimulationContext();
const setObstacleFn = createSetObstacle(sim.scene);
const runtime = {
  simulationBackend: 'cpu' as 'cpu' | 'gpu',
};

function setupScene() {
  resetGridRenderer(renderer);
  setupFluidScene(sim.scene, sim.simWidth, sim.simHeight);
}

function resize() {
  const size = resizeSimulationCanvas(canvas);
  if (context) {
    context.configure({
      device,
      format: presentationFormat,
      alphaMode: 'premultiplied',
    });
  }

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

bindSimulationKeyboardControls({
  scene: sim.scene,
  simulate,
  onPauseStateChanged: (paused) => {
    pauseController?.name(paused ? 'Resume' : 'Pause');
  },
});

const guiState = createGuiState({
  scene: sim.scene,
  onReset: setupScene,
  onPauseStateChanged: (paused) => {
    if (pauseController) pauseController.name(paused ? 'Resume' : 'Pause');
  },
});

let pauseController: any;

function simulate() {
  if (runtime.simulationBackend === 'cpu') {
    simulateScene(sim.scene);
    return;
  }

  simulateScene(sim.scene, {
    enableObstacleCollision: false,
    enableWallCollision: false,
  });
  renderer.applyBoundaryCollision(sim.scene, sim.simWidth, sim.simHeight);
  syncBoundaryCollisionToCpu(sim.scene);
}

async function init() {
  if (!navigator.gpu) throw new Error("WebGPU not supported");
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error("No GPU adapter found");
  device = await adapter.requestDevice();
  context = canvas.getContext("webgpu")!;
  presentationFormat = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format: presentationFormat, alphaMode: 'premultiplied' });

  renderer = new WebGPURenderer(device, presentationFormat);

  const { stats, gui } = setupGui(
    sim.scene,
    createFluidGuiCallbacks({ scene: sim.scene, onReset: guiState.reset, setObstacle: setObstacleFn }),
    createFluidGuiOptions({
      title: 'WebGPU FLIP Fluid',
      subtitle: 'Hybrid FLIP/PIC (GPU Render)',
      features: ['WebGPU Renderer', 'FLIP/PIC Solver', 'Staggered MAC Grid', 'Interactive Obstacle'],
    })
  );

  pauseController = addPauseResetControls(gui, guiState, sim.scene);
  gui.add(runtime, 'simulationBackend', ['cpu', 'gpu']).name('Sim Backend');

  bootstrapWithResize({ resize });

  startAnimationLoop({
    frame: () => {
      stats.begin();
      simulate();
      renderer.draw(sim.scene, sim.simWidth, sim.simHeight, context, {
        useGpuParticles: runtime.simulationBackend === 'gpu',
      });
      stats.end();
    },
  });
}

init().catch(err => {
  console.error(err);
  document.body.innerHTML = `<h1 style='color:red'>${err.message}</h1>`;
});
