import './style.css';
import { setupGui } from './gui';
import { Scene } from './types';
import { FlipFluid } from './fluid';
import { Renderer } from './renderer';
import { applyObstacleToScene, createDefaultScene } from '../core/scene';

const canvas = document.getElementById("myCanvas") as HTMLCanvasElement;
const gl = canvas.getContext("webgl")!;
const renderer = new Renderer(gl);

canvas.focus();

let simHeight = 3.0;
let cScale = 300.0;
let simWidth = 1.0;

const scene: Scene = createDefaultScene();

function setupScene() {
  scene.obstacleRadius = 0.15;
  scene.overRelaxation = 1.9;
  scene.dt = 1.0 / 60.0;
  scene.numPressureIters = 50;
  scene.numParticleIters = 2;

  renderer.resetGridBuffer();

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

export function setObstacle(x: number, y: number, reset: boolean) {
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
  gl.viewport(0, 0, canvas.width, canvas.height);
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
  if (e.key === "m") { scene.paused = false; simulate(); scene.paused = true; }
});

const guiState = {
  togglePause: () => {
    scene.paused = !scene.paused;
    if (pauseController) pauseController.name(scene.paused ? 'Resume' : 'Pause');
  },
  reset: () => setupScene(),
};

const { stats, gui } = setupGui(
  scene,
  {
    onReset: guiState.reset,
    onToggleObstacle: () => setObstacle(scene.obstacleX, scene.obstacleY, true),
  },
  {
  title: 'Canvas 2D FLIP Fluid',
  subtitle: 'Hybrid FLIP/PIC Fluid Simulation',
  features: ['FLIP/PIC Hybrid Solver', 'Staggered MAC Grid', 'Incompressible Pressure Solver', 'Interactive Obstacle', 'Particle Drift Compensation'],
      interactions: [
        'Click & Drag: Move Obstacle',
        'P: Pause/Resume',
        'M: Step Simulation',
        'Click Reset to apply Fluid > Setup'
      ],
  githubUrl: 'https://github.com/jeantimex/fluid',
});

let pauseController = gui.add(guiState, 'togglePause').name(scene.paused ? 'Resume' : 'Pause');
gui.add(guiState, 'reset').name('Reset Simulation');

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

function update() {
  stats.begin();
  simulate();
  renderer.draw(scene, simWidth, simHeight, canvas);
  stats.end();
  requestAnimationFrame(update);
}

setupScene();
resize();
window.addEventListener("resize", resize);
update();
