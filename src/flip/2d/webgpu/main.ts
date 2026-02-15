import './style.css';
import { setupGui } from '../canvas2d/gui';
import { WebGPURenderer } from './renderer';
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

const canvas = document.getElementById("webgpuCanvas") as HTMLCanvasElement;
let device: GPUDevice;
let context: GPUCanvasContext;
let renderer: WebGPURenderer;
let presentationFormat: GPUTextureFormat;

const sim = createSimulationContext();
const setObstacleFn = createSetObstacle(sim.scene);
const runtime = {
  simulationBackend: 'gpu' as 'cpu' | 'gpu',
  gpuStatePrimed: false,
  gpuExperimental: true,
  gpuFullStep: false, // dev-only, intentionally hidden from GUI
  gpuDebugReadback: false,
  gpuParityMetrics: false,
  gpuParityLogEveryNFrames: 30,
  gpuPressureEnabled: true,
  gpuPressureIters: 50,
  gpuP2GVelXEnabled: false,
};

let parityFrameCounter = 0;

function resetGpuDebugState() {
  runtime.gpuStatePrimed = false;
  parityFrameCounter = 0;
}

function stepCpuReferenceIntegrateBoundary(
  scene: typeof sim.scene,
  inputPos: Float32Array,
  inputVel: Float32Array
) {
  const fluid = scene.fluid;
  if (!fluid) return null;

  const numParticles = fluid.numParticles;
  const pos = new Float32Array(inputPos);
  const vel = new Float32Array(inputVel);

  for (let i = 0; i < numParticles; i++) {
    const vxIdx = 2 * i;
    const vyIdx = vxIdx + 1;
    vel[vyIdx] += scene.dt * scene.gravity;
    pos[vxIdx] += vel[vxIdx] * scene.dt;
    pos[vyIdx] += vel[vyIdx] * scene.dt;
  }

  const obstacleRadius = scene.showObstacle ? scene.obstacleRadius : 0.0;
  const minDist = obstacleRadius + fluid.particleRadius;
  const minDist2 = minDist * minDist;
  const minX = fluid.cellSize + fluid.particleRadius;
  const maxX = (fluid.numX - 1) * fluid.cellSize - fluid.particleRadius;
  const minY = fluid.cellSize + fluid.particleRadius;
  const maxY = (fluid.numY - 1) * fluid.cellSize - fluid.particleRadius;

  for (let i = 0; i < numParticles; i++) {
    const xIdx = 2 * i;
    const yIdx = xIdx + 1;
    let x = pos[xIdx];
    let y = pos[yIdx];
    const dx = x - scene.obstacleX;
    const dy = y - scene.obstacleY;
    const d2 = dx * dx + dy * dy;

    if (d2 < minDist2 && d2 > 1e-12) {
      const d = Math.sqrt(d2);
      const s = (minDist - d) / d;
      x += dx * s;
      y += dy * s;
      vel[xIdx] = scene.obstacleVelX;
      vel[yIdx] = scene.obstacleVelY;
    }

    if (x < minX) { x = minX; vel[xIdx] = 0.0; }
    if (x > maxX) { x = maxX; vel[xIdx] = 0.0; }
    if (y < minY) { y = minY; vel[yIdx] = 0.0; }
    if (y > maxY) { y = maxY; vel[yIdx] = 0.0; }

    pos[xIdx] = x;
    pos[yIdx] = y;
  }

  return { pos, vel };
}

function computeRmseAndMaxDiff(a: Float32Array, b: Float32Array, count: number) {
  let sumSq = 0.0;
  let maxAbs = 0.0;
  for (let i = 0; i < count; i++) {
    const d = a[i] - b[i];
    const ad = Math.abs(d);
    if (ad > maxAbs) maxAbs = ad;
    sumSq += d * d;
  }
  const rmse = Math.sqrt(sumSq / Math.max(1, count));
  return { rmse, maxAbs };
}

function setupScene() {
  resetGridRenderer(renderer);
  setupFluidScene(sim.scene, sim.simWidth, sim.simHeight);
  resetGpuDebugState();
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

async function simulate() {
  if (runtime.simulationBackend === 'cpu') {
    simulateScene(sim.scene);
    resetGpuDebugState();
    return;
  }

  const fluid = sim.scene.fluid;
  const parityInputPos = runtime.gpuFullStep && runtime.gpuParityMetrics && runtime.gpuDebugReadback && fluid
    ? fluid.particlePos.slice(0, 2 * fluid.numParticles)
    : null;
  const parityInputVel = runtime.gpuFullStep && runtime.gpuParityMetrics && runtime.gpuDebugReadback && fluid
    ? fluid.particleVel.slice(0, 2 * fluid.numParticles)
    : null;

  const useGpuState = runtime.gpuFullStep ? runtime.gpuStatePrimed : false;
  renderer.applyIntegrateParticles(sim.scene, { useGpuState });
  renderer.applyBoundaryCollision(sim.scene, sim.simWidth, sim.simHeight, {
    useGpuState: true,
  });

  if (runtime.gpuExperimental) {
    renderer.buildGridDensity(sim.scene, { useGpuState: true });
    renderer.buildCellTypes(sim.scene);
    renderer.prepareGridSolverState(sim.scene);
    if (runtime.gpuP2GVelXEnabled) {
      renderer.buildVelocitiesFromParticles(sim.scene, { useGpuState: true });
    }
    if (runtime.gpuPressureEnabled) {
      renderer.applyPressureSkeleton(sim.scene, runtime.gpuPressureIters);
    }
    if (runtime.gpuFullStep && runtime.gpuP2GVelXEnabled) {
      renderer.applyGridToParticleVelocities(sim.scene, { useGpuState: true });
    }
  }

  const needsCpuSync = !runtime.gpuFullStep || runtime.gpuDebugReadback || runtime.gpuParityMetrics;
  if (needsCpuSync) {
    await renderer.syncParticlesToCpu(sim.scene);
  }

  if (!runtime.gpuFullStep) {
    simulateScene(sim.scene, {
      enableObstacleCollision: false,
      enableWallCollision: false,
      enableParticleIntegration: false,
      enableParticleColorAgeFade: false,
      enableParticleColorSurfaceTint: false,
    });
  } else if (runtime.gpuParityMetrics && parityInputPos && parityInputVel && fluid) {
    const ref = stepCpuReferenceIntegrateBoundary(sim.scene, parityInputPos, parityInputVel);
    if (ref) {
      const posCount = 2 * fluid.numParticles;
      const velCount = 2 * fluid.numParticles;
      const posMetrics = computeRmseAndMaxDiff(fluid.particlePos, ref.pos, posCount);
      const velMetrics = computeRmseAndMaxDiff(fluid.particleVel, ref.vel, velCount);

      parityFrameCounter++;
      if (parityFrameCounter % Math.max(1, Math.floor(runtime.gpuParityLogEveryNFrames)) === 0) {
        console.info(
          `[GPU parity][integrate+boundary] frame=${parityFrameCounter} ` +
          `posRMSE=${posMetrics.rmse.toExponential(4)} posMax=${posMetrics.maxAbs.toExponential(4)} ` +
          `velRMSE=${velMetrics.rmse.toExponential(4)} velMax=${velMetrics.maxAbs.toExponential(4)}`
        );
      }
    }
  }

  renderer.applyParticleColorFade(sim.scene, 0.01, { useGpuState: runtime.gpuStatePrimed });
  renderer.applyParticleSurfaceTint(sim.scene, 0.7, 0.8, {
    useGpuState: runtime.gpuStatePrimed,
    useGpuDensity: false,
  });
  runtime.gpuStatePrimed = true;
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
  gui.add(runtime, 'simulationBackend', ['cpu', 'gpu']).name('Sim Backend').onChange(() => {
    resetGpuDebugState();
  });
  gui.add(runtime, 'gpuExperimental').name('GPU Experimental').onChange(() => {
    resetGpuDebugState();
  });
  gui.add(runtime, 'gpuPressureEnabled').name('GPU Pressure');
  gui.add(runtime, 'gpuPressureIters', 1, 200, 1).name('GPU Pressure Iters');
  gui.add(runtime, 'gpuP2GVelXEnabled').name('GPU P2G VelXY');

  bootstrapWithResize({ resize });

  startAnimationLoop({
    frame: async () => {
      stats.begin();
      await simulate();
      renderer.draw(sim.scene, sim.simWidth, sim.simHeight, context, {
        useGpuParticles: runtime.simulationBackend === 'gpu',
        useGpuParticleColors: runtime.simulationBackend === 'gpu',
      });
      stats.end();
    },
  });
}

init().catch(err => {
  console.error(err);
  document.body.innerHTML = `<h1 style='color:red'>${err.message}</h1>`;
});
