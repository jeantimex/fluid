import './style.css';
import { setupGui } from './gui';
import { Scene } from './types';
import { Renderer } from './renderer';
import { applyObstacleToScene, createDefaultScene, setupFluidScene } from '../core/scene';
import { clientToWorld } from '../core/input';

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
  const world = clientToWorld(canvas, cScale, x, y);
  mouseDown = true;
  setObstacle(world.x, world.y, true);
  scene.paused = false;
}

function drag(x: number, y: number) {
  if (mouseDown) {
    const world = clientToWorld(canvas, cScale, x, y);
    setObstacle(world.x, world.y, false);
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
