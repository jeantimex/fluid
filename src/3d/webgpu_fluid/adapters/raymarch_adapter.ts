import { createConfig } from '../../common/config.ts';
import { createDefaultEnvironmentConfig } from '../../common/environment.ts';
import { FluidSimulation } from '../../webgpu_raymarch/fluid_simulation.ts';
import type { RaymarchConfig } from '../../webgpu_raymarch/types.ts';
import type { OrbitCamera } from '../../webgpu_particles/orbit_camera.ts';
import type { InputState } from '../../common/types.ts';
import type { AdapterInitOptions, FluidAppAdapter } from '../types.ts';
import { resizeCanvasToDisplaySize } from './shared.ts';

export class RaymarchAdapter implements FluidAppAdapter<RaymarchConfig> {
  readonly name = 'Raymarch';
  readonly config: RaymarchConfig = {
    ...createConfig(),
    ...createDefaultEnvironmentConfig(),
    viscosityStrength: 0,
    iterationsPerFrame: 2,
    fluidColor: { r: 0.4, g: 0.7, b: 1.0 },
    densityTextureRes: 150,
    densityOffset: 200,
    densityMultiplier: 0.03,
    stepSize: 0.08,
    lightStepSize: 0.1,
    shadowSoftness: 1.0,
    maxSteps: 512,
    extinctionCoefficients: { x: 18, y: 8, z: 2 },
    indexOfRefraction: 1.33,
    numRefractions: 4,
    tileDarkOffset: 0.1,
    obstacleColor: { r: 1, g: 0, b: 0 },
    obstacleAlpha: 0.8,
  };

  private device!: GPUDevice;
  private context!: GPUCanvasContext;
  private canvas!: HTMLCanvasElement;
  private format!: GPUTextureFormat;
  private simulation: FluidSimulation | null = null;

  init(options: AdapterInitOptions): void {
    this.device = options.device;
    this.context = options.context;
    this.canvas = options.canvas;
    this.format = options.format;

    this.simulation = new FluidSimulation(
      this.device,
      this.context,
      this.canvas,
      this.config,
      this.format
    );
  }

  applyCameraDefaults(camera: OrbitCamera): void {
    camera.radius = 30.0;
    camera.theta = Math.PI / 6;
    camera.phi = Math.PI / 2.5;
  }

  getInputState(): InputState | undefined {
    return this.simulation?.simulationState.input;
  }

  reset(): void {
    this.simulation?.reset();
  }

  async step(dt: number): Promise<void> {
    if (!this.simulation) return;
    await this.simulation.step(dt);
  }

  render(camera: OrbitCamera): void {
    this.simulation?.render(camera);
  }

  resize(): void {
    resizeCanvasToDisplaySize(
      this.canvas,
      this.context,
      this.device,
      this.format
    );
  }
}
