import { createConfig } from '../../common/config.ts';
import { createDefaultEnvironmentConfig } from '../../common/environment.ts';
import { FluidSimulation } from '../../webgpu_particles/fluid_simulation.ts';
import type { ParticlesConfig } from '../../webgpu_particles/types.ts';
import type { OrbitCamera } from '../../webgpu_particles/orbit_camera.ts';
import type { InputState } from '../../common/types.ts';
import type { AdapterInitOptions, FluidAppAdapter } from '../types.ts';
import { resizeCanvasToDisplaySize } from './shared.ts';

export class ParticlesAdapter implements FluidAppAdapter<ParticlesConfig> {
  readonly name = 'Particles';
  readonly config: ParticlesConfig = {
    ...createConfig(),
    ...createDefaultEnvironmentConfig(),
    viscosityStrength: 0.001,
    iterationsPerFrame: 3,
    velocityDisplayMax: 6.5,
    gradientResolution: 64,
    densityTextureRes: 150,
    densityOffset: 0,
    densityMultiplier: 0.02,
    lightStepSize: 0.1,
    shadowSoftness: 1.0,
    extinctionCoefficients: { x: 2.12, y: 0.43, z: 0.3 },
    colorKeys: [
      { t: 4064 / 65535, r: 0.13363299, g: 0.34235913, b: 0.7264151 },
      { t: 33191 / 65535, r: 0.2980392, g: 1, b: 0.56327766 },
      { t: 46738 / 65535, r: 1, g: 0.9309917, b: 0 },
      { t: 1, r: 0.96862745, g: 0.28555763, b: 0.031372573 },
    ],
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
    this.simulation?.render(camera.viewMatrix);
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
