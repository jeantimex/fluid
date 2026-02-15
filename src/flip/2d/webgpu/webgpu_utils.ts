export interface WebGPUContext {
  device: GPUDevice;
  context: GPUCanvasContext;
  format: GPUTextureFormat;
}

export class WebGPUInitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebGPUInitError';
  }
}

export async function initWebGPU(
  canvas: HTMLCanvasElement
): Promise<WebGPUContext> {
  if (!navigator.gpu) {
    throw new WebGPUInitError('WebGPU is not supported in this browser.');
  }

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    throw new WebGPUInitError('Unable to acquire a WebGPU adapter.');
  }

  const device = await adapter.requestDevice();
  const context = canvas.getContext('webgpu');
  if (!context) {
    throw new WebGPUInitError('Unable to create a WebGPU context.');
  }

  const format = navigator.gpu.getPreferredCanvasFormat();

  return { device, context, format };
}

export function configureContext(
  context: GPUCanvasContext,
  device: GPUDevice,
  format: GPUTextureFormat
): void {
  context.configure({
    device,
    format,
    alphaMode: 'opaque',
  });
}
