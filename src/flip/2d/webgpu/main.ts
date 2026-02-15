import './style.css';
import { setupGui } from '../canvas2d/gui';
import { Scene } from '../canvas2d/types';
import { FlipFluid } from '../canvas2d/fluid';
import { WebGPURenderer } from './renderer';

const canvas = document.getElementById("webgpuCanvas") as HTMLCanvasElement;
let device: GPUDevice;
let context: GPUCanvasContext;
let renderer: WebGPURenderer;

let simHeight = 3.0;
let cScale = 300.0;
let simWidth = 1.0;

const scene: Scene = {
  gravity: -9.81,
  dt: 1.0 / 120.0,
  flipRatio: 0.9,
  numPressureIters: 100,
  numParticleIters: 2,
  overRelaxation: 1.9,
  compensateDrift: true,
  separateParticles: true,
  obstacleX: 0.0,
  obstacleY: 0.0,
  obstacleRadius: 0.15,
  paused: false,
  obstacleVelX: 0.0,
  obstacleVelY: 0.0,
  showParticles: true,
  showGrid: false,
  showObstacle: true,
  particleCount: 15000,
  particleRadiusScale: 0.3,
  fluid: null,
};

function setupScene() {
  scene.obstacleRadius = 0.15;
  scene.overRelaxation = 1.9;
  scene.dt = 1.0 / 60.0;
  scene.numPressureIters = 50;
  scene.numParticleIters = 2;

  if (renderer) renderer.resetGridBuffer();

  const cellSize = 0.03;
  const tankHeight = 1.0 * simHeight;
  const tankWidth = 1.0 * simWidth;
  const density = 1000.0;
  const r = scene.particleRadiusScale * cellSize;
  const dx_spawn = 2.0 * r;
  const dy_spawn = (Math.sqrt(3.0) / 2.0) * dx_spawn;

  const numX = Math.round(Math.sqrt(scene.particleCount * (dy_spawn / dx_spawn)));
  const numY = Math.floor(scene.particleCount / numX);
  const maxParticles = numX * numY;

  const f_sim = new FlipFluid(density, tankWidth, tankHeight, cellSize, r, maxParticles);
  scene.fluid = f_sim;
  f_sim.numParticles = maxParticles;
  let p_idx = 0;

  const blockWidth = (numX - 1) * dx_spawn;
  const blockHeight = (numY - 1) * dy_spawn;
  const offsetX = (tankWidth - blockWidth) / 2;
  const offsetY = (tankHeight - blockHeight) / 2;

  for (let i = 0; i < numX; i++) {
    for (let j = 0; j < numY; j++) {
      f_sim.particlePos[p_idx++] = offsetX + dx_spawn * i + (j % 2 === 0 ? 0.0 : r);
      f_sim.particlePos[p_idx++] = offsetY + dy_spawn * j;
    }
  }

  const n_cells_y = f_sim.numY;
  for (let i = 0; i < f_sim.numX; i++) {
    for (let j = 0; j < f_sim.numY; j++) {
      let s_val = 1.0;
      if (i === 0 || i === f_sim.numX - 1 || j === 0) s_val = 0.0;
      f_sim.solidMask[i * n_cells_y + j] = s_val;
    }
  }
  setObstacle(simWidth * 0.75, simHeight * 0.5, true);
}

function setObstacle(x: number, y: number, reset: boolean) {
  let vx = 0.0;
  let vy = 0.0;
  if (!reset) {
    vx = (x - scene.obstacleX) / scene.dt;
    vy = (y - scene.obstacleY) / scene.dt;
  }
  scene.obstacleX = x;
  scene.obstacleY = y;
  
  const r_obstacle = scene.showObstacle ? scene.obstacleRadius : 0;
  const f_val = scene.fluid;
  if (!f_val) return;

  const n_y = f_val.numY;

  for (let i = 1; i < f_val.numX - 2; i++) {
    for (let j = 1; j < f_val.numY - 2; j++) {
      f_val.solidMask[i * n_y + j] = 1.0;
      const dx = (i + 0.5) * f_val.cellSize - x;
      const dy = (j + 0.5) * f_val.cellSize - y;
      if (r_obstacle > 0 && dx * dx + dy * dy < r_obstacle * r_obstacle) {
        f_val.solidMask[i * n_y + j] = 0.0;
        f_val.velocityX[i * n_y + j] = vx;
        f_val.velocityX[(i + 1) * n_y + j] = vx;
        f_val.velocityY[i * n_y + j] = vy;
        f_val.velocityY[i * n_y + j + 1] = vy;
      }
    }
  }
  scene.obstacleVelX = vx;
  scene.obstacleVelY = vy;
}

function resize() {
  const dpr = window.devicePixelRatio || 1;
  const width = window.innerWidth;
  const height = window.innerHeight;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';
  
  cScale = 300.0 * dpr;
  simHeight = canvas.height / cScale;
  simWidth = canvas.width / cScale;
  setupScene();
}

let mouseDown = false;
function startDrag(x: number, y: number) {
  const bounds = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const mx = (x - bounds.left) * dpr;
  const my = (y - bounds.top) * dpr;
  mouseDown = true;
  const x_world = mx / cScale;
  const y_world = (canvas.height - my) / cScale;
  setObstacle(x_world, y_world, true);
  scene.paused = false;
}

function drag(x: number, y: number) {
  if (mouseDown) {
    const bounds = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const mx = (x - bounds.left) * dpr;
    const my = (y - bounds.top) * dpr;
    const x_world = mx / cScale;
    const y_world = (canvas.height - my) / cScale;
    setObstacle(x_world, y_world, false);
  }
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

document.addEventListener("keydown", (e) => {
  if (e.key === "p") scene.paused = !scene.paused;
});

const guiState = {
  togglePause: () => {
    scene.paused = !scene.paused;
    if (pauseController) pauseController.name(scene.paused ? 'Resume' : 'Pause');
  },
  reset: () => setupScene(),
};

let pauseController: any;

async function init() {
  if (!navigator.gpu) throw new Error("WebGPU not supported");
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error("No GPU adapter found");
  device = await adapter.requestDevice();
  context = canvas.getContext("webgpu")!;
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: 'premultiplied' });

  renderer = new WebGPURenderer(device, format);

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
      interactions: ['Click & Drag: Move Obstacle', 'P: Pause/Resume', 'Click Reset to apply Fluid > Setup'],
      githubUrl: 'https://github.com/jeantimex/fluid',
    }
  );

  pauseController = gui.add(guiState, 'togglePause').name(scene.paused ? 'Resume' : 'Pause');
  gui.add(guiState, 'reset').name('Reset Simulation');

  resize();
  window.addEventListener("resize", resize);

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
