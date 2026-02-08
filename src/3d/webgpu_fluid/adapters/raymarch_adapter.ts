import { createConfig } from '../../common/config.ts';
import { createDefaultEnvironmentConfig } from '../../common/environment.ts';
import { FluidSimulation } from '../../webgpu_raymarch/fluid_simulation.ts';
import type { RaymarchConfig } from '../../webgpu_raymarch/types.ts';
import type { OrbitCamera } from '../../common/orbit_camera.ts';
import type { InputState } from '../../common/types.ts';
import type { AdapterInitOptions, FluidAppAdapter } from '../types.ts';
import { resizeCanvasToDisplaySize } from './shared.ts';

export class RaymarchAdapter implements FluidAppAdapter<RaymarchConfig> {
  readonly name = 'Raymarch';
  readonly config: RaymarchConfig = {
    ...createConfig(),
    ...createDefaultEnvironmentConfig(),
    viscosityStrength: 0.001,
    iterationsPerFrame: 2,
    densityTextureRes: 150,
    densityOffset: 200,
    densityMultiplier: 0.05,
    stepSize: 0.02,
    lightStepSize: 0.1,
    renderScale: 0.5,
    maxSteps: 512,
    extinctionCoefficients: { x: 12, y: 4, z: 4 },
    indexOfRefraction: 1.33,
    numRefractions: 4,
    tileDarkOffset: -0.35,
    shadowSoftness: 2.5,
    showFluidShadows: true,
    showBoundsWireframe: false,
    boundsWireframeColor: { r: 1.0, g: 1.0, b: 1.0 },
    obstacleColor: { r: 1.0, g: 0.0, b: 0.0 },
    obstacleAlpha: 1.0,
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
