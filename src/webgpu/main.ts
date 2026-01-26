/**
 * WebGPU Fluid Simulation - Entry Point
 */

import './style.css';
import { createConfig } from '../common/config.ts';
import { setupGui } from '../common/gui.ts';
import { FluidSimulation } from './fluid_simulation.ts';

// DOM Setup
const app = document.querySelector<HTMLDivElement>('#app');
if (!app) {
  throw new Error('Missing #app container');
}

app.innerHTML = '<canvas id="sim-canvas" aria-label="Fluid simulation"></canvas>';

const canvas = document.querySelector<HTMLCanvasElement>('#sim-canvas');
if (!canvas) {
  throw new Error('Missing canvas element');
}

// Configuration
const config = createConfig();
let simulation: FluidSimulation | null = null;

// GUI Setup
const { stats } = setupGui(
  config,
  {
    onReset: () => simulation?.reset(),
    onSmoothingRadiusChange: () => simulation?.refreshSettings(),
  },
  { trackGPU: true }
);

// Coordinate conversion utility
function canvasToWorld(
  x: number,
  y: number,
  scale: number
): { x: number; y: number } {
  const rect = canvas!.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const px = (x - rect.left) * dpr;
  const py = (y - rect.top) * dpr;
  const originX = canvas!.width * 0.5;
  const originY = canvas!.height * 0.5;
  return {
    x: (px - originX) / scale,
    y: (originY - py) / scale,
  };
}

// Initialize WebGPU
async function initWebGPU(): Promise<void> {
  if (!navigator.gpu) {
    app!.innerHTML = '<p>WebGPU is not supported in this browser.</p>';
    return;
  }

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    app!.innerHTML = '<p>Unable to acquire a WebGPU adapter.</p>';
    return;
  }

  const device = await adapter.requestDevice();
  const context = canvas!.getContext('webgpu');
  if (!context) {
    app!.innerHTML = '<p>Unable to create a WebGPU context.</p>';
    return;
  }

  const format = navigator.gpu.getPreferredCanvasFormat();

  // Create simulation
  simulation = new FluidSimulation(device, context, canvas!, config, format);

  // Input handling
  const getScale = (): number => canvas!.width / config.boundsSize.x;

  const updatePointer = (event: MouseEvent): void => {
    const state = simulation?.simulationState;
    if (!state) return;
    const scale = getScale();
    const world = canvasToWorld(event.clientX, event.clientY, scale);
    state.input.worldX = world.x;
    state.input.worldY = world.y;
  };

  canvas!.addEventListener('mousemove', updatePointer);
  canvas!.addEventListener('mousedown', (event) => {
    const state = simulation?.simulationState;
    if (!state) return;
    updatePointer(event);
    if (event.button === 0) state.input.pull = true;
    if (event.button === 2) state.input.push = true;
  });
  canvas!.addEventListener('mouseup', (event) => {
    const state = simulation?.simulationState;
    if (!state) return;
    if (event.button === 0) state.input.pull = false;
    if (event.button === 2) state.input.push = false;
  });
  canvas!.addEventListener('mouseleave', () => {
    const state = simulation?.simulationState;
    if (!state) return;
    state.input.pull = false;
    state.input.push = false;
  });
  canvas!.addEventListener('contextmenu', (event) => {
    event.preventDefault();
  });

  // Canvas resize handling
  let baseUnitsPerPixel: number | null = null;

  const resize = (): void => {
    const rect = canvas!.getBoundingClientRect();
    if (baseUnitsPerPixel === null) {
      baseUnitsPerPixel = config.boundsSize.x / Math.max(1, rect.width);
    }
    const dpr = window.devicePixelRatio || 1;
    const nextWidth = Math.max(1, Math.round(rect.width * dpr));
    const nextHeight = Math.max(1, Math.round(rect.height * dpr));

    if (canvas!.width !== nextWidth || canvas!.height !== nextHeight) {
      canvas!.width = nextWidth;
      canvas!.height = nextHeight;
      config.boundsSize = {
        x: (canvas!.width / dpr) * baseUnitsPerPixel,
        y: (canvas!.height / dpr) * baseUnitsPerPixel,
      };
      context.configure({
        device,
        format,
        alphaMode: 'opaque',
      });
    }
  };

  resize();
  window.addEventListener('resize', resize);

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

void initWebGPU();
