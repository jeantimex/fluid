import './style.css';
import { createConfig } from '../common/config.ts';
import { setupGui } from '../common/gui.ts';
import { FluidSimulation } from './fluid_simulation.ts';
import {
  initWebGPU,
  configureContext,
  WebGPUInitError,
} from './webgpu_utils.ts';

function createCanvas(app: HTMLDivElement): HTMLCanvasElement {
  app.innerHTML =
    '<canvas id="sim-canvas" aria-label="Fluid simulation"></canvas>';
  const canvas = document.querySelector<HTMLCanvasElement>('#sim-canvas');
  if (!canvas) {
    throw new Error('Failed to create canvas element');
  }
  return canvas;
}

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Missing #app container');

const canvas = createCanvas(app);
const config = createConfig();
let simulation: FluidSimulation | null = null;

const { stats } = setupGui(
  config,
  {
    onReset: () => simulation?.reset(),
    onSmoothingRadiusChange: () => {
        // Need to update constants in pipelines? 
        // 2D version calls physics.refreshSettings() which updates uniforms
        // Our 3D simulation updates uniforms every frame in step(), so just wait for next frame.
    },
  },
  {
    trackGPU: true,
    title: 'WebGPU 3D Fluid',
    githubUrl: 'https://github.com/jeantimex/fluid',
  }
);

async function main() {
  let device: GPUDevice;
  let context: GPUCanvasContext;
  let format: GPUTextureFormat;

  try {
    ({ device, context, format } = await initWebGPU(canvas));
  } catch (error) {
    if (error instanceof WebGPUInitError) {
      app!.innerHTML = `<p>${error.message}</p>`;
      return;
    }
    throw error;
  }

  configureContext(context, device, format);

  simulation = new FluidSimulation(device, context, canvas, config, format);

  window.addEventListener('resize', () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    configureContext(context, device, format);
  });
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  configureContext(context, device, format);

  let lastTime = performance.now();

  const frame = async (now: number) => {
    stats.begin();
    
    const dt = Math.min(0.033, (now - lastTime) / 1000);
    lastTime = now;

    if (simulation) {
        await simulation.step(dt);
        simulation.render();
    }

    stats.end();
    stats.update();

    requestAnimationFrame(frame);
  };

  requestAnimationFrame(frame);
}

main();
