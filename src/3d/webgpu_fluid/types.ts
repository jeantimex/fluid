import type { InputState, SimConfig } from '../common/types.ts';
import type { OrbitCamera } from '../webgpu_particles/orbit_camera.ts';

export interface AdapterInitOptions {
  device: GPUDevice;
  context: GPUCanvasContext;
  canvas: HTMLCanvasElement;
  format: GPUTextureFormat;
}

export interface FluidAppAdapter<TConfig extends SimConfig = SimConfig> {
  readonly name: string;
  readonly config: TConfig;

  init(options: AdapterInitOptions): Promise<void> | void;
  reset(): void;
  step(dt: number): Promise<void> | void;
  render(camera: OrbitCamera): void;
  resize(): void;

  applyCameraDefaults(camera: OrbitCamera): void;
  getInputState(): InputState | undefined;

  destroy?(): void;
}
