/**
 * WebGPU Fluid Simulation - Entry Point
 */

import './style.css';
import { createConfig } from '../common/config.ts';
import { setupGui } from '../common/gui.ts';
import { FluidSimulation } from './fluid_simulation.ts';
import { initWebGPU, configureContext, WebGPUInitError } from './webgpu_utils.ts';
import type { SimConfig, InputState } from '../common/types.ts';

// ============================================================================
// Canvas Helpers
// ============================================================================

/**
 * Creates a canvas element inside the app container.
 */
function createCanvas(app: HTMLDivElement): HTMLCanvasElement {
  app.innerHTML = '<canvas id="sim-canvas" aria-label="Fluid simulation"></canvas>';
  const canvas = document.querySelector<HTMLCanvasElement>('#sim-canvas');
  if (!canvas) {
    throw new Error('Failed to create canvas element');
  }
  return canvas;
}

/**
 * Converts canvas coordinates to world coordinates.
 */
function canvasToWorld(
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
  scale: number
): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const px = (clientX - rect.left) * dpr;
  const py = (clientY - rect.top) * dpr;
  const originX = canvas.width * 0.5;
  const originY = canvas.height * 0.5;
  return {
    x: (px - originX) / scale,
    y: (originY - py) / scale,
  };
}

/**
 * Sets up mouse input handlers for the canvas.
 */
function setupInputHandlers(
  canvas: HTMLCanvasElement,
  getInput: () => InputState | undefined,
  getScale: () => number
): void {
  const updatePointer = (event: MouseEvent): void => {
    const input = getInput();
    if (!input) return;
    const world = canvasToWorld(canvas, event.clientX, event.clientY, getScale());
    input.worldX = world.x;
    input.worldY = world.y;
  };

  canvas.addEventListener('mousemove', updatePointer);

  canvas.addEventListener('mousedown', (event) => {
    const input = getInput();
    if (!input) return;
    updatePointer(event);
    if (event.button === 0) input.pull = true;
    if (event.button === 2) input.push = true;
  });

  canvas.addEventListener('mouseup', (event) => {
    const input = getInput();
    if (!input) return;
    if (event.button === 0) input.pull = false;
    if (event.button === 2) input.push = false;
  });

  canvas.addEventListener('mouseleave', () => {
    const input = getInput();
    if (!input) return;
    input.pull = false;
    input.push = false;
  });

  canvas.addEventListener('contextmenu', (event) => {
    event.preventDefault();
  });
}

/**
 * Sets up canvas resize handling.
 * Returns the resize function for immediate use.
 */
function setupResizeHandler(
  canvas: HTMLCanvasElement,
  config: SimConfig,
  context: GPUCanvasContext,
  device: GPUDevice,
  format: GPUTextureFormat
): () => void {
  let baseUnitsPerPixel: number | null = null;

  const resize = (): void => {
    const rect = canvas.getBoundingClientRect();
    if (baseUnitsPerPixel === null) {
      baseUnitsPerPixel = config.boundsSize.x / Math.max(1, rect.width);
    }
    const dpr = window.devicePixelRatio || 1;
    const nextWidth = Math.max(1, Math.round(rect.width * dpr));
    const nextHeight = Math.max(1, Math.round(rect.height * dpr));

    if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
      canvas.width = nextWidth;
      canvas.height = nextHeight;
      config.boundsSize = {
        x: (canvas.width / dpr) * baseUnitsPerPixel,
        y: (canvas.height / dpr) * baseUnitsPerPixel,
      };
      configureContext(context, device, format);
    }
  };

  window.addEventListener('resize', resize);
  return resize;
}

// ============================================================================
// Main Application
// ============================================================================

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) {
  throw new Error('Missing #app container');
}

const canvas = createCanvas(app);
const config = createConfig();
let simulation: FluidSimulation | null = null;

const { stats } = setupGui(
  config,
  {
    onReset: () => simulation?.reset(),
    onSmoothingRadiusChange: () => simulation?.refreshSettings(),
  },
  { trackGPU: true }
);

async function main(): Promise<void> {
  // Initialize WebGPU
  let device: GPUDevice;
  let context: GPUCanvasContext;
  let format: GPUTextureFormat;

  try {
    ({ device, context, format } = await initWebGPU(canvas));
  } catch (error) {
    if (error instanceof WebGPUInitError) {
      app.innerHTML = `<p>${error.message}</p>`;
      return;
    }
    throw error;
  }

  // Create simulation
  simulation = new FluidSimulation(device, context, canvas, config, format);

  // Setup canvas input and resize
  const getScale = (): number => canvas.width / config.boundsSize.x;
  setupInputHandlers(canvas, () => simulation?.simulationState.input, getScale);
  const resize = setupResizeHandler(canvas, config, context, device, format);
  resize();

  // Animation loop
  let lastTime = performance.now();

  const frame = async (now: number): Promise<void> => {
    stats.begin();

    const dt = Math.min(0.033, (now - lastTime) / 1000);
    lastTime = now;

    await simulation!.step(dt);
    simulation!.render();

    stats.end();
    stats.update();
    requestAnimationFrame(frame);
  };

  requestAnimationFrame(frame);
}

void main();
