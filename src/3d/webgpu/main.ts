import './style.css';
import { createConfig } from '../common/config.ts';
import { setupGui } from '../common/gui.ts';
import { FluidSimulation } from './fluid_simulation.ts';
import {
  initWebGPU,
  configureContext,
  WebGPUInitError,
} from './webgpu_utils.ts';
import type { InputState } from '../common/types.ts';

function createCanvas(app: HTMLDivElement): HTMLCanvasElement {
  app.innerHTML =
    '<canvas id="sim-canvas" aria-label="Fluid simulation"></canvas>';
  const canvas = document.querySelector<HTMLCanvasElement>('#sim-canvas');
  if (!canvas) {
    throw new Error('Failed to create canvas element');
  }
  return canvas;
}

function setupInputHandlers(
  canvas: HTMLCanvasElement,
  getInput: () => InputState | undefined
) {
  const updatePointer = (event: MouseEvent) => {
    const input = getInput();
    if (!input) return;

    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    // Camera parameters (must match Renderer)
    const fov = Math.PI / 3;
    const distance = 5.0; // Camera Z = 5, Plane Z = 0
    const v = Math.tan(fov / 2);
    const aspect = canvas.width / canvas.height;

    // Map screen (0..w, 0..h) to world at Z=0
    // NDC: x [-1, 1], y [-1, 1]
    // World = NDC * scale * distance
    
    const nx = (x / rect.width) * 2 - 1;
    const ny = -((y / rect.height) * 2 - 1); // Invert Y (screen Y is down, world Y is up)

    input.worldX = nx * v * distance * aspect;
    input.worldY = ny * v * distance;
    input.worldZ = 0;
  };

  canvas.addEventListener('mousemove', updatePointer);
  
  canvas.addEventListener('mousedown', (e) => {
    const input = getInput();
    if (!input) return;
    updatePointer(e);
    if (e.button === 0) input.pull = true;
    if (e.button === 2) input.push = true;
  });

  canvas.addEventListener('mouseup', (e) => {
    const input = getInput();
    if (!input) return;
    if (e.button === 0) input.pull = false;
    if (e.button === 2) input.push = false;
  });

  canvas.addEventListener('mouseleave', () => {
      const input = getInput();
      if (!input) return;
      input.pull = false;
      input.push = false;
  });

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
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
    onSmoothingRadiusChange: () => {},
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
  
  // Setup inputs
  setupInputHandlers(canvas, () => simulation?.simulationState.input);

  window.addEventListener('resize', () => {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    configureContext(context, device, format);
  });
  const dpr = window.devicePixelRatio || 1;
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
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
