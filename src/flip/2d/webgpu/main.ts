import './style.css';
import { setupGui } from '../canvas2d/gui';
import { Scene } from '../canvas2d/types';
import { WebGPURenderer } from './renderer';
import { applyObstacleToScene, createDefaultScene, setupFluidScene } from '../core/scene';
import { bindObstaclePointerControls } from '../core/interaction';

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
  const dpr = window.devicePixelRatio || 1;
  const width = window.innerWidth;
  const height = window.innerHeight;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';
  if (context) {
    context.configure({
      device,
      format: presentationFormat,
      alphaMode: 'premultiplied',
    });
  }
  
  cScale = 300.0 * dpr;
  simHeight = canvas.height / cScale;
  simWidth = canvas.width / cScale;
  setupScene();
}

bindObstaclePointerControls({
  canvas,
  scene,
  getScale: () => cScale,
  setObstacle,
});

document.addEventListener("keydown", (e) => {
  if (e.key === "p") {
    scene.paused = !scene.paused;
    pauseController?.name(scene.paused ? 'Resume' : 'Pause');
  }
  if (e.key === "m") {
    scene.paused = false;
    simulate();
    scene.paused = true;
    pauseController?.name('Resume');
  }
});

const guiState = {
  togglePause: () => {
    scene.paused = !scene.paused;
    if (pauseController) pauseController.name(scene.paused ? 'Resume' : 'Pause');
  },
  reset: () => setupScene(),
};

let pauseController: any;

function simulate() {
  if (!scene.paused && scene.fluid) {
    const r_obstacle = scene.showObstacle ? scene.obstacleRadius : 0;
    scene.fluid.simulate(
      scene.dt, scene.gravity, scene.flipRatio, scene.numPressureIters, scene.numParticleIters,
      scene.overRelaxation, scene.compensateDrift, scene.separateParticles,
      scene.obstacleX, scene.obstacleY, r_obstacle, scene.obstacleVelX, scene.obstacleVelY
    );
  }
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
    {
      onReset: guiState.reset,
      onToggleObstacle: () => setObstacle(scene.obstacleX, scene.obstacleY, true),
    },
    {
      title: 'WebGPU FLIP Fluid',
      subtitle: 'Hybrid FLIP/PIC (GPU Render)',
      features: ['WebGPU Renderer', 'FLIP/PIC Solver', 'Staggered MAC Grid', 'Interactive Obstacle'],
      interactions: ['Click & Drag: Move Obstacle', 'P: Pause/Resume', 'M: Step Simulation', 'Click Reset to apply Fluid > Setup'],
      githubUrl: 'https://github.com/jeantimex/fluid',
    }
  );

  pauseController = gui.add(guiState, 'togglePause').name(scene.paused ? 'Resume' : 'Pause');
  gui.add(guiState, 'reset').name('Reset Simulation');

  resize();
  window.addEventListener("resize", resize);

  function frame() {
    stats.begin();
    simulate();
    renderer.draw(scene, simWidth, simHeight, context);
    stats.end();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

init().catch(err => {
  console.error(err);
  document.body.innerHTML = `<h1 style='color:red'>${err.message}</h1>`;
});
