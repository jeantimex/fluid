/**
 * WebGPU 3D Bootstrap - Canvas + Device init only.
 */

import './style.css';
import { createConfig } from '../common/config.ts';
import { createSpawnData } from '../common/spawn.ts';
import {
  configureContext,
  initWebGPU,
  WebGPUInitError,
} from '../../2d/webgpu/webgpu_utils.ts';
import { SimulationBuffers } from './simulation_buffers.ts';

function createCanvas(app: HTMLDivElement): HTMLCanvasElement {
  app.innerHTML =
    '<canvas id="sim-canvas" aria-label="Fluid simulation"></canvas>';
  const canvas = document.querySelector<HTMLCanvasElement>('#sim-canvas');
  if (!canvas) {
    throw new Error('Failed to create canvas element');
  }
  return canvas;
}

function setupResizeHandler(
  canvas: HTMLCanvasElement,
  context: GPUCanvasContext,
  device: GPUDevice,
  format: GPUTextureFormat,
  boundsSize: { x: number; y: number; z: number }
): () => void {
  let baseUnitsPerPixel: number | null = null;

  const resize = (): void => {
    const rect = canvas.getBoundingClientRect();
    if (baseUnitsPerPixel === null) {
      baseUnitsPerPixel = boundsSize.x / Math.max(1, rect.width);
    }

    const dpr = window.devicePixelRatio || 1;
    const nextWidth = Math.max(1, Math.round(rect.width * dpr));
    const nextHeight = Math.max(1, Math.round(rect.height * dpr));

    if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
      canvas.width = nextWidth;
      canvas.height = nextHeight;

      // Keep Z as-is for now; adjust X/Y to match viewport scale.
      boundsSize.x = (canvas.width / dpr) * baseUnitsPerPixel;
      boundsSize.y = (canvas.height / dpr) * baseUnitsPerPixel;

      configureContext(context, device, format);
    }
  };

  window.addEventListener('resize', resize);
  return resize;
}

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) {
  throw new Error('Missing #app container');
}

const canvas = createCanvas(app);
const config = createConfig();

async function main(): Promise<void> {
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

  const resize = setupResizeHandler(
    canvas,
    context,
    device,
    format,
    config.boundsSize
  );
  resize();

  const spawn = createSpawnData(config);
  const buffers = new SimulationBuffers(device, spawn);

  const frame = (): void => {
    const encoder = device.createCommandEncoder();
    const view = context.getCurrentTexture().createView();

    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view,
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: { r: 0.05, g: 0.07, b: 0.1, a: 1 },
        },
      ],
    });

    pass.end();
    device.queue.submit([encoder.finish()]);

    void buffers;
    requestAnimationFrame(frame);
  };

  requestAnimationFrame(frame);
}

void main();
