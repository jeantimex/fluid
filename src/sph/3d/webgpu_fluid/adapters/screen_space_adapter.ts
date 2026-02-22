import { createConfig } from '../../common/config.ts';
import { createDefaultEnvironmentConfig } from '../../common/environment.ts';
import { FluidSimulation } from '../../webgpu_screen_space/fluid_simulation.ts';
import type { ScreenSpaceConfig } from '../../webgpu_screen_space/types.ts';
import type { OrbitCamera } from '../../common/orbit_camera.ts';
import type { InputState } from '../../common/types.ts';
import type { AdapterInitOptions, FluidAppAdapter } from '../types.ts';
import { resizeCanvasToDisplaySize } from './shared.ts';

export class ScreenSpaceAdapter implements FluidAppAdapter<ScreenSpaceConfig> {
  readonly name = 'Screen Space';
  readonly config: ScreenSpaceConfig = {
    ...createConfig(),
    ...createDefaultEnvironmentConfig(),
    viscosityStrength: 0.01,
    iterationsPerFrame: 2,
    screenSpaceDebugMode: 4,

    foamSpawnRate: 70,
    trappedAirVelocityMin: 5,
    trappedAirVelocityMax: 25,
    foamKineticEnergyMin: 15,
    foamKineticEnergyMax: 80,
    bubbleBuoyancy: 1.4,
    bubbleScale: 0.3,
    foamLifetimeMin: 10,
    foamLifetimeMax: 30,
    waterColor: { r: 0.3, g: 0.9, b: 0.8 },
    deepWaterColor: { r: 0.02, g: 0.15, b: 0.45 },
    foamColor: { r: 0.95, g: 0.98, b: 1.0 },
    foamOpacity: 2.5,
    sprayClassifyMaxNeighbours: 5,
    bubbleClassifyMinNeighbours: 15,
    foamParticleRadius: 1.0,
    spawnRateFadeInTime: 0.75,
    spawnRateFadeStartTime: 0.1,
    bubbleChangeScaleSpeed: 7,

    extinctionCoeff: { x: 2.12, y: 0.43, z: 0.3 },
    extinctionMultiplier: 2.24,
    refractionStrength: 9.15,
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
  private supportsSubgroups!: boolean;
  private isMobile!: boolean;
  private simulation: FluidSimulation | null = null;

  init(options: AdapterInitOptions): void {
    this.device = options.device;
    this.context = options.context;
    this.canvas = options.canvas;
    this.format = options.format;
    this.supportsSubgroups = options.supportsSubgroups;
    this.isMobile = options.isMobile;

    this.simulation = new FluidSimulation(
      this.device,
      this.context,
      this.canvas,
      this.config,
      this.format,
      this.supportsSubgroups,
      this.isMobile
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
