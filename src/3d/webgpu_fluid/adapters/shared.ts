import { configureContext } from '../../webgpu_particles/webgpu_utils.ts';

export function resizeCanvasToDisplaySize(
  canvas: HTMLCanvasElement,
  context: GPUCanvasContext,
  device: GPUDevice,
  format: GPUTextureFormat
): void {
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.floor(window.innerWidth * dpr));
  const height = Math.max(1, Math.floor(window.innerHeight * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  configureContext(context, device, format);
}
