/**
 * Main fluid simulation orchestrator for WebGPU.
 */

import type { SimConfig, SimState } from '../common/types.ts';
import { createPhysics } from '../common/physics.ts';
import { createSpawnData } from '../common/spawn.ts';
import { SimulationBuffers } from './simulation_buffers.ts';
import { ComputePipelines } from './compute_pipelines.ts';
import { Renderer } from './renderer.ts';

export interface SimulationOptions {
  useGpuExternalForces?: boolean;
  useGpuSpatialHash?: boolean;
  useGpuDensity?: boolean;
  useGpuDensityReadback?: boolean;
  useCpuSpatialDataForGpuDensity?: boolean;
  useGpuPressure?: boolean;
  useGpuViscosity?: boolean;
}

const DEFAULT_OPTIONS: Required<SimulationOptions> = {
  useGpuExternalForces: true,
  useGpuSpatialHash: true,
  useGpuDensity: true,
  useGpuDensityReadback: false,
  useCpuSpatialDataForGpuDensity: false,
  useGpuPressure: true,
  useGpuViscosity: true,
};

export class FluidSimulation {
  private device: GPUDevice;
  private context: GPUCanvasContext;
  private canvas: HTMLCanvasElement;
  private config: SimConfig;
  private options: Required<SimulationOptions>;

  private buffers!: SimulationBuffers;
  private pipelines: ComputePipelines;
  private renderer: Renderer;
  private physics!: ReturnType<typeof createPhysics>;
  private state!: SimState;

  private workgroupSize = 256;

  // Uniform data arrays
  private computeData = new Float32Array(8);
  private hashParamsData = new Float32Array(4);
  private sortParamsData = new Uint32Array(4);
  private densityParamsData = new Float32Array(12);
  private pressureParamsData = new Float32Array(12);
  private viscosityParamsData = new Float32Array(12);
  private integrateParamsData = new Float32Array(16);

  constructor(
    device: GPUDevice,
    context: GPUCanvasContext,
    canvas: HTMLCanvasElement,
    config: SimConfig,
    format: GPUTextureFormat,
    options: SimulationOptions = {}
  ) {
    this.device = device;
    this.context = context;
    this.canvas = canvas;
    this.config = config;
    this.options = { ...DEFAULT_OPTIONS, ...options };

    this.pipelines = new ComputePipelines(device);
    this.renderer = new Renderer(device, format, config);

    this.reset();
  }

  get particleCount(): number {
    return this.buffers.particleCount;
  }

  get simulationState(): SimState {
    return this.state;
  }

  private getScale(): number {
    return this.canvas.width / this.config.boundsSize.x;
  }

  reset(): void {
    // Destroy old buffers if they exist
    if (this.buffers) {
      this.buffers.destroy();
    }

    // Create new state and buffers
    const spawn = createSpawnData(this.config);
    this.state = this.createStateFromSpawn(spawn);
    this.buffers = new SimulationBuffers(this.device, spawn);
    this.physics = createPhysics(this.state, this.config, () =>
      this.getScale()
    );

    // Recreate bind groups
    this.pipelines.createBindGroups(this.buffers);
    this.renderer.createBindGroup(this.buffers);
  }

  refreshSettings(): void {
    this.physics.refreshSettings();
  }

  private createStateFromSpawn(spawn: {
    positions: Float32Array;
    velocities: Float32Array;
    count: number;
  }): SimState {
    return {
      positions: spawn.positions,
      predicted: new Float32Array(spawn.positions),
      velocities: spawn.velocities,
      densities: new Float32Array(spawn.count * 2),
      keys: new Uint32Array(spawn.count),
      sortedKeys: new Uint32Array(spawn.count),
      indices: new Uint32Array(spawn.count),
      sortOffsets: new Uint32Array(spawn.count),
      spatialOffsets: new Uint32Array(spawn.count),
      positionsSorted: new Float32Array(spawn.count * 2),
      predictedSorted: new Float32Array(spawn.count * 2),
      velocitiesSorted: new Float32Array(spawn.count * 2),
      count: spawn.count,
      input: {
        worldX: 0,
        worldY: 0,
        pull: false,
        push: false,
      },
    };
  }

  async step(dt: number): Promise<void> {
    const { options, config, state, buffers, pipelines, device } = this;

    if (options.useGpuExternalForces) {
      const maxDeltaTime = config.maxTimestepFPS
        ? 1 / config.maxTimestepFPS
        : Number.POSITIVE_INFINITY;
      const frameTime = Math.min(dt * config.timeScale, maxDeltaTime);
      const timeStep = frameTime / config.iterationsPerFrame;
      const paddingPx =
        Math.max(1, Math.round(config.particleRadius)) + config.boundsPaddingPx;
      const padding = paddingPx / this.getScale();
      const halfX = Math.max(0, config.boundsSize.x * 0.5 - padding);
      const halfY = Math.max(0, config.boundsSize.y * 0.5 - padding);
      const hasObstacle =
        config.obstacleSize.x > 0 && config.obstacleSize.y > 0;

      for (let i = 0; i < config.iterationsPerFrame; i++) {
        let shouldReadbackDensities = false;
        const interactionStrength = state.input.push
          ? -config.interactionStrength
          : state.input.pull
            ? config.interactionStrength
            : 0;

        // Update external forces uniforms
        this.computeData[0] = timeStep;
        this.computeData[1] = config.gravity;
        this.computeData[2] = config.interactionRadius;
        this.computeData[3] = interactionStrength;
        this.computeData[4] = state.input.worldX;
        this.computeData[5] = state.input.worldY;
        device.queue.writeBuffer(
          pipelines.uniformBuffers.compute,
          0,
          this.computeData
        );

        const encoder = device.createCommandEncoder();

        // External forces pass
        const computePass = encoder.beginComputePass();
        computePass.setPipeline(pipelines.externalForces);
        computePass.setBindGroup(0, pipelines.externalForcesBindGroup);
        computePass.dispatchWorkgroups(
          Math.ceil(buffers.particleCount / this.workgroupSize)
        );
        computePass.end();

        // CPU spatial hash fallback
        if (!options.useGpuDensity || options.useCpuSpatialDataForGpuDensity) {
          this.physics.predictPositions();
          this.physics.runSpatialHash();
        }

        // Density calculation
        if (options.useGpuDensity) {
          if (options.useCpuSpatialDataForGpuDensity) {
            device.queue.writeBuffer(
              buffers.predicted,
              0,
              state.predicted as Float32Array<ArrayBuffer>
            );
            device.queue.writeBuffer(
              buffers.sortedKeys,
              0,
              state.sortedKeys as Uint32Array<ArrayBuffer>
            );
            device.queue.writeBuffer(
              buffers.spatialOffsets,
              0,
              state.spatialOffsets as Uint32Array<ArrayBuffer>
            );
          } else if (options.useGpuSpatialHash) {
            this.dispatchSpatialHash(encoder);
          }

          this.updateDensityUniforms();
          const densityPass = encoder.beginComputePass();
          densityPass.setPipeline(pipelines.density);
          densityPass.setBindGroup(0, pipelines.densityBindGroup);
          densityPass.dispatchWorkgroups(
            Math.ceil(buffers.particleCount / this.workgroupSize)
          );
          densityPass.end();

          if (options.useGpuDensityReadback) {
            encoder.copyBufferToBuffer(
              buffers.densities,
              0,
              buffers.densityReadback,
              0,
              buffers.particleCount * 2 * 4
            );
            shouldReadbackDensities = true;
          }
        } else {
          this.physics.calculateDensities();
          if (options.useGpuPressure) {
            device.queue.writeBuffer(
              buffers.densities,
              0,
              state.densities as Float32Array<ArrayBuffer>
            );
          }
        }

        // Pressure calculation
        if (options.useGpuPressure) {
          this.updatePressureUniforms(timeStep);
          const pressurePass = encoder.beginComputePass();
          pressurePass.setPipeline(pipelines.pressure);
          pressurePass.setBindGroup(0, pipelines.pressureBindGroup);
          pressurePass.dispatchWorkgroups(
            Math.ceil(buffers.particleCount / this.workgroupSize)
          );
          pressurePass.end();
        } else {
          this.physics.calculatePressure(timeStep);
        }

        // Viscosity calculation
        if (options.useGpuViscosity) {
          this.updateViscosityUniforms(timeStep);
          const viscosityPass = encoder.beginComputePass();
          viscosityPass.setPipeline(pipelines.viscosity);
          viscosityPass.setBindGroup(0, pipelines.viscosityBindGroup);
          viscosityPass.dispatchWorkgroups(
            Math.ceil(buffers.particleCount / this.workgroupSize)
          );
          viscosityPass.end();
        } else {
          this.physics.calculateViscosity(timeStep);
        }

        // Integration
        this.updateIntegrateUniforms(timeStep, halfX, halfY, hasObstacle);
        const integratePass = encoder.beginComputePass();
        integratePass.setPipeline(pipelines.integrate);
        integratePass.setBindGroup(0, pipelines.integrateBindGroup);
        integratePass.dispatchWorkgroups(
          Math.ceil(buffers.particleCount / this.workgroupSize)
        );
        integratePass.end();

        device.queue.submit([encoder.finish()]);

        if (shouldReadbackDensities) {
          await buffers.densityReadback.mapAsync(GPUMapMode.READ);
          const mapped = new Float32Array(
            buffers.densityReadback.getMappedRange()
          );
          state.densities.set(mapped);
          buffers.densityReadback.unmap();
        }
      }
    } else {
      this.physics.step(dt);
    }

    // Sync CPU data to GPU if not using GPU external forces
    if (!options.useGpuExternalForces) {
      device.queue.writeBuffer(
        buffers.positions,
        0,
        state.positions as Float32Array<ArrayBuffer>
      );
      device.queue.writeBuffer(
        buffers.velocities,
        0,
        state.velocities as Float32Array<ArrayBuffer>
      );
      device.queue.writeBuffer(
        buffers.predicted,
        0,
        state.predicted as Float32Array<ArrayBuffer>
      );
    }
  }

  private dispatchSpatialHash(encoder: GPUCommandEncoder): void {
    const { pipelines, buffers } = this;
    const workgroups = Math.ceil(buffers.particleCount / this.workgroupSize);

    // Update uniforms
    this.hashParamsData[0] = this.config.smoothingRadius;
    this.hashParamsData[1] = buffers.particleCount;
    this.device.queue.writeBuffer(
      pipelines.uniformBuffers.hash,
      0,
      this.hashParamsData
    );

    this.sortParamsData[0] = buffers.particleCount;
    this.device.queue.writeBuffer(
      pipelines.uniformBuffers.sort,
      0,
      this.sortParamsData
    );

    // Hash pass
    const hashPass = encoder.beginComputePass();
    hashPass.setPipeline(pipelines.hash);
    hashPass.setBindGroup(0, pipelines.hashBindGroup);
    hashPass.dispatchWorkgroups(workgroups);
    hashPass.end();

    // Clear offsets pass
    const clearPass = encoder.beginComputePass();
    clearPass.setPipeline(pipelines.clearOffsets);
    clearPass.setBindGroup(0, pipelines.clearOffsetsBindGroup);
    clearPass.dispatchWorkgroups(workgroups);
    clearPass.end();

    // Count offsets pass
    const countPass = encoder.beginComputePass();
    countPass.setPipeline(pipelines.countOffsets);
    countPass.setBindGroup(1, pipelines.countOffsetsBindGroup);
    countPass.dispatchWorkgroups(workgroups);
    countPass.end();

    // Scatter pass
    const scatterPass = encoder.beginComputePass();
    scatterPass.setPipeline(pipelines.scatter);
    scatterPass.setBindGroup(0, pipelines.scatterBindGroup);
    scatterPass.dispatchWorkgroups(1);
    scatterPass.end();

    // Build spatial offsets pass
    const spatialPass = encoder.beginComputePass();
    spatialPass.setPipeline(pipelines.spatialOffsets);
    spatialPass.setBindGroup(0, pipelines.spatialOffsetsBindGroup);
    spatialPass.dispatchWorkgroups(1);
    spatialPass.end();
  }

  private updateDensityUniforms(): void {
    const radius = this.config.smoothingRadius;
    const spikyPow2Scale = 6 / (Math.PI * Math.pow(radius, 4));
    const spikyPow3Scale = 10 / (Math.PI * Math.pow(radius, 5));
    this.densityParamsData[0] = radius;
    this.densityParamsData[1] = spikyPow2Scale;
    this.densityParamsData[2] = spikyPow3Scale;
    this.densityParamsData[3] = this.buffers.particleCount;
    this.device.queue.writeBuffer(
      this.pipelines.uniformBuffers.density,
      0,
      this.densityParamsData
    );
  }

  private updatePressureUniforms(timeStep: number): void {
    const radius = this.config.smoothingRadius;
    const spikyPow2DerivScale = 12 / (Math.PI * Math.pow(radius, 4));
    const spikyPow3DerivScale = 30 / (Math.PI * Math.pow(radius, 5));
    this.pressureParamsData[0] = timeStep;
    this.pressureParamsData[1] = this.config.targetDensity;
    this.pressureParamsData[2] = this.config.pressureMultiplier;
    this.pressureParamsData[3] = this.config.nearPressureMultiplier;
    this.pressureParamsData[4] = radius;
    this.pressureParamsData[5] = spikyPow2DerivScale;
    this.pressureParamsData[6] = spikyPow3DerivScale;
    this.pressureParamsData[7] = this.buffers.particleCount;
    this.device.queue.writeBuffer(
      this.pipelines.uniformBuffers.pressure,
      0,
      this.pressureParamsData
    );
  }

  private updateViscosityUniforms(timeStep: number): void {
    const radius = this.config.smoothingRadius;
    const poly6Scale = 4 / (Math.PI * Math.pow(radius, 8));
    this.viscosityParamsData[0] = timeStep;
    this.viscosityParamsData[1] = this.config.viscosityStrength;
    this.viscosityParamsData[2] = radius;
    this.viscosityParamsData[3] = poly6Scale;
    this.viscosityParamsData[4] = this.buffers.particleCount;
    this.device.queue.writeBuffer(
      this.pipelines.uniformBuffers.viscosity,
      0,
      this.viscosityParamsData
    );
  }

  private updateIntegrateUniforms(
    timeStep: number,
    halfX: number,
    halfY: number,
    hasObstacle: boolean
  ): void {
    this.integrateParamsData[0] = timeStep;
    this.integrateParamsData[1] = this.config.collisionDamping;
    this.integrateParamsData[2] = hasObstacle ? 1 : 0;
    this.integrateParamsData[3] = 0;
    this.integrateParamsData[4] = halfX;
    this.integrateParamsData[5] = halfY;
    this.integrateParamsData[6] = 0;
    this.integrateParamsData[7] = 0;
    this.integrateParamsData[8] = this.config.obstacleCentre.x;
    this.integrateParamsData[9] = this.config.obstacleCentre.y;
    this.integrateParamsData[10] = this.config.obstacleSize.x * 0.5;
    this.integrateParamsData[11] = this.config.obstacleSize.y * 0.5;
    this.device.queue.writeBuffer(
      this.pipelines.uniformBuffers.integrate,
      0,
      this.integrateParamsData
    );
  }

  render(): void {
    this.renderer.updateUniforms(
      this.config,
      this.canvas.width,
      this.canvas.height
    );
    const encoder = this.device.createCommandEncoder();
    this.renderer.render(
      encoder,
      this.context,
      this.config,
      this.buffers.particleCount
    );
    this.device.queue.submit([encoder.finish()]);
  }
}
