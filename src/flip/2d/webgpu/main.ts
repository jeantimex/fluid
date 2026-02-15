import './style.css';
import { setupGui } from '../canvas2d/gui';
import { Scene } from '../canvas2d/types';
import { WebGPURenderer } from './renderer';
import { applyObstacleToScene, createDefaultScene, setupFluidScene } from '../core/scene';
import { bindObstaclePointerControls } from '../core/interaction';
import { bindSimulationKeyboardControls } from '../core/keyboard';
import { simulateScene } from '../core/simulation';
import { resizeSimulationCanvas } from '../core/resize';
import { createGuiState } from '../core/gui';
import { createFluidGuiOptions } from '../core/gui-options';
import { startAnimationLoop } from '../core/loop';
import { createFluidGuiCallbacks } from '../core/gui-callbacks';

const canvas = document.getElementById("webgpuCanvas") as HTMLCanvasElement;
let device: GPUDevice;
let context: GPUCanvasContext;
let renderer: WebGPURenderer;
let presentationFormat: GPUTextureFormat;

let simHeight = 3.0;
let cScale = 300.0;
let simWidth = 1.0;

const scene: Scene = createDefaultScene();

function setupScene() {
  if (renderer) renderer.resetGridBuffer();
  setupFluidScene(scene, simWidth, simHeight);
}

function setObstacle(x: number, y: number, reset: boolean) {
  applyObstacleToScene(scene, x, y, reset);
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

bindSimulationKeyboardControls({
  scene,
  simulate,
  onPauseStateChanged: (paused) => {
    pauseController?.name(paused ? 'Resume' : 'Pause');
  },
});

const guiState = createGuiState({
  scene,
  onReset: setupScene,
  onPauseStateChanged: (paused) => {
    if (pauseController) pauseController.name(paused ? 'Resume' : 'Pause');
  },
});

let pauseController: any;

function simulate() {
  simulateScene(scene);
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
    scene,
    createFluidGuiCallbacks({ scene, onReset: guiState.reset, setObstacle }),
    createFluidGuiOptions({
      title: 'WebGPU FLIP Fluid',
      subtitle: 'Hybrid FLIP/PIC (GPU Render)',
      features: ['WebGPU Renderer', 'FLIP/PIC Solver', 'Staggered MAC Grid', 'Interactive Obstacle'],
    })
  );

  pauseController = gui.add(guiState, 'togglePause').name(scene.paused ? 'Resume' : 'Pause');
  gui.add(guiState, 'reset').name('Reset Simulation');

  resize();
  window.addEventListener("resize", resize);

  startAnimationLoop({
    frame: () => {
      stats.begin();
      simulate();
      renderer.draw(scene, simWidth, simHeight, context);
      stats.end();
    },
  });
}

init().catch(err => {
  console.error(err);
  document.body.innerHTML = `<h1 style='color:red'>${err.message}</h1>`;
});
