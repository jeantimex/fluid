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
    viscosityStrength: 0.001,
    iterationsPerFrame: 2,
    fluidColor: { r: 0.4, g: 0.7, b: 1.0 },
    densityTextureRes: 150,
    densityOffset: 200,
    densityMultiplier: 0.03,
    stepSize: 0.08,
    lightStepSize: 0.1,
    shadowSoftness: 1.0,
    maxSteps: 512,
    tileCol1: { r: 126 / 255, g: 183 / 255, b: 231 / 255 },
    tileCol2: { r: 210 / 255, g: 165 / 255, b: 240 / 255 },
    tileCol3: { r: 153 / 255, g: 229 / 255, b: 199 / 255 },
    tileCol4: { r: 237 / 255, g: 225 / 255, b: 167 / 255 },
    tileColVariation: { x: 0, y: 0, z: 0 },
    tileScale: 1,
    tileDarkOffset: -0.35,
    tileDarkFactor: 0.5,
    floorAmbient: 0.58,
    sceneExposure: 1.1,
    debugFloorMode: 0,
    extinctionCoefficients: { x: 18, y: 8, z: 2 },
    indexOfRefraction: 1.33,
    numRefractions: 4,
    floorSize: { x: 80, y: 0.05, z: 80 },
    obstacleColor: { r: 1.0, g: 0.0, b: 0.0 },
    obstacleAlpha: 0.8,
    showBoundsWireframe: false,
    boundsWireframeColor: { r: 1.0, g: 1.0, b: 1.0 },
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
