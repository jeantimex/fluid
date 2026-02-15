/**
 * WebGPU Initialization Utilities
 *
 * This module provides helper functions for initializing WebGPU, which is
 * a modern graphics API that provides low-level access to GPU hardware
 * for both rendering and compute operations.
 */

/**
 * Contains the essential WebGPU objects needed for rendering.
 */
export interface WebGPUContext {
  /** The logical GPU device used to create resources and submit commands */
  device: GPUDevice;
  /** The canvas context that manages the swap chain for presenting frames */
  context: GPUCanvasContext;
  /** The preferred texture format for the canvas (e.g., 'bgra8unorm') */
  format: GPUTextureFormat;
}

/**
 * Custom error class for WebGPU initialization failures.
 */
export class WebGPUInitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebGPUInitError';
  }
}

/**
 * Initializes WebGPU and returns the device, context, and preferred format.
 *
 * @param canvas - The HTML canvas element to use for rendering
 * @returns Promise resolving to WebGPU device, context, and texture format
 * @throws WebGPUInitError if WebGPU is not supported or initialization fails
 */
export async function initWebGPU(
  canvas: HTMLCanvasElement
): Promise<WebGPUContext> {
  // Check if WebGPU is available in this browser
  if (!navigator.gpu) {
    throw new WebGPUInitError('WebGPU is not supported in this browser.');
  }

  // Request a GPU adapter - this represents the physical GPU hardware
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    throw new WebGPUInitError('Unable to acquire a WebGPU adapter.');
  }

  // Request a logical device from the adapter
  const device = await adapter.requestDevice();

  // Get a WebGPU rendering context from the canvas
  const context = canvas.getContext('webgpu');
  if (!context) {
    throw new WebGPUInitError('Unable to create a WebGPU context.');
  }

  // Get the preferred texture format for this display
  const format = navigator.gpu.getPreferredCanvasFormat();

  // Configure the context
  context.configure({
    device,
    format,
    alphaMode: 'opaque',
  });

  return { device, context, format };
}
