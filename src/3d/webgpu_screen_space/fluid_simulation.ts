/**
 * =============================================================================
 * 3D Fluid Simulation Orchestrator for WebGPU (Linear Grid)
 * =============================================================================
 */

import type { SimState } from '../common/types.ts';
import type { ScreenSpaceConfig } from './types.ts';
import { createSpawnData } from '../common/spawn.ts';
import { FluidBuffers } from '../common/fluid_buffers.ts';
import { SpatialGrid, type SpatialGridUniforms } from '../common/spatial_grid.ts';
import { FluidPhysics, type PhysicsUniforms } from '../common/fluid_physics.ts';
import { FoamPipeline, type FoamUniforms } from '../common/foam_pipeline.ts';
import { ScreenSpaceRenderer } from './screen_space/screen_space_renderer.ts';

export class FluidSimulation {
  /**
   * Beginner note:
   * This class records compute passes for SPH + foam, then hands particle
   * buffers to the screen-space renderer for post-processing.
   */
  private device: GPUDevice;
  private context: GPUCanvasContext;
  private canvas: HTMLCanvasElement;
  private config: ScreenSpaceConfig;

  // --- Subsystems (Modular) ---
  private buffers!: FluidBuffers;
  private physics: FluidPhysics;
  private grid: SpatialGrid;
  private foam: FoamPipeline;
  private renderer: ScreenSpaceRenderer;

  private state!: SimState;

  // --- Grid Configuration ---
  private gridRes = { x: 0, y: 0, z: 0 };
  private gridTotalCells = 0;

  // --- Uniform Buffers ---
  private physicsUniforms!: PhysicsUniforms;
  private gridUniforms!: SpatialGridUniforms;
  private foamUniforms!: FoamUniforms;

  // --- CPU Staging Buffers ---
  private computeData = new Float32Array(8);
  private integrateData = new Float32Array(24);
  private hashParamsData = new Float32Array(8);
  private sortParamsData = new Uint32Array(8);
  private scanParamsDataL0 = new Uint32Array(4);
  private scanParamsDataL1 = new Uint32Array(4);
  private scanParamsDataL2 = new Uint32Array(4);
  private densityParamsData = new Float32Array(12);
  private pressureParamsData = new Float32Array(16);
  private viscosityParamsData = new Float32Array(12);
  private foamSpawnData = new Float32Array(28);
  private foamUpdateData = new Float32Array(28);

  private foamFrameCount = 0;
  private simTimer = 0;

  constructor(
    device: GPUDevice,
    context: GPUCanvasContext,
    canvas: HTMLCanvasElement,
    config: ScreenSpaceConfig,
    format: GPUTextureFormat
  ) {
    this.device = device;
    this.context = context;
    this.canvas = canvas;
    this.config = config;

    this.physics = new FluidPhysics(device);
    this.grid = new SpatialGrid(device);
    this.foam = new FoamPipeline(device);
    this.renderer = new ScreenSpaceRenderer(device, canvas, format, config);

    this.physicsUniforms = {
      external: device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }),
      density: device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }),
      pressure: device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }),
      viscosity: device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }),
      integrate: device.createBuffer({ size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }),
    };

    this.gridUniforms = {
      hash: device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }),
      sort: device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }),
      scanL0: device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }),
      scanL1: device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }),
      scanL2: device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }),
    };

    this.foamUniforms = {
      spawn: device.createBuffer({ size: 112, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }),
      update: device.createBuffer({ size: 112, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }),
    };

    this.reset();
  }

  get particleCount(): number {
    return this.buffers.particleCount;
  }

  get simulationState(): SimState {
    return this.state;
  }

  reset(): void {
    if (this.buffers) {
      this.buffers.destroy();
    }

    this.simTimer = 0;
    this.foamFrameCount = 0;

    const { boundsSize, smoothingRadius } = this.config;
    this.gridRes = {
      x: Math.ceil(boundsSize.x / smoothingRadius),
      y: Math.ceil(boundsSize.y / smoothingRadius),
      z: Math.ceil(boundsSize.z / smoothingRadius),
    };
    this.gridTotalCells = this.gridRes.x * this.gridRes.y * this.gridRes.z;

    const spawn = createSpawnData(this.config);
    this.state = this.createStateFromSpawn(spawn);

    this.buffers = new FluidBuffers(this.device, spawn, {
      gridTotalCells: this.gridTotalCells,
      includeFoam: true,
      maxFoamParticles: FluidBuffers.DEFAULT_MAX_FOAM_PARTICLES,
    });

    this.physics.createBindGroups(this.buffers, this.physicsUniforms);
    this.grid.createBindGroups(this.buffers, this.gridUniforms);
    this.foam.createBindGroups(this.buffers, this.foamUniforms);
    this.renderer.createBindGroups(this.buffers);
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
      positionsSorted: new Float32Array(spawn.count * 4),
      predictedSorted: new Float32Array(spawn.count * 4),
      velocitiesSorted: new Float32Array(spawn.count * 4),
      count: spawn.count,
      input: { worldX: 0, worldY: 0, worldZ: 0, pull: false, push: false },
    };
  }

  async step(dt: number): Promise<void> {
    const { config, buffers, device } = this;

    const maxDeltaTime = config.maxTimestepFPS ? 1 / config.maxTimestepFPS : Number.POSITIVE_INFINITY;
    const frameTime = Math.min(dt * config.timeScale, maxDeltaTime);
    this.simTimer += frameTime;
    const timeStep = frameTime / config.iterationsPerFrame;

    this.updateUniforms(timeStep);

    const encoder = device.createCommandEncoder();
    const computePass = encoder.beginComputePass();
    for (let i = 0; i < config.iterationsPerFrame; i++) {
      this.physics.step(
        computePass,
        this.grid,
        buffers.particleCount,
        this.gridTotalCells,
        config.viscosityStrength > 0
      );
    }
    computePass.end();

    this.dispatchFoam(frameTime, encoder);

    device.queue.submit([encoder.finish()]);
  }

  private updateUniforms(timeStep: number): void {
    const { config, state, buffers, device } = this;

    // 1. External
    let interactionStrength = 0;
    if (state.input.push) interactionStrength = -config.interactionStrength;
    else if (state.input.pull) interactionStrength = config.interactionStrength;

    this.computeData[0] = timeStep;
    this.computeData[1] = config.gravity;
    this.computeData[2] = config.interactionRadius;
    this.computeData[3] = interactionStrength;
    this.computeData[4] = state.input.worldX;
    this.computeData[5] = state.input.worldY;
    this.computeData[6] = state.input.worldZ;
    this.computeData[7] = 0;
    device.queue.writeBuffer(this.physicsUniforms.external, 0, this.computeData);

    // 2. Hash
    this.hashParamsData[0] = config.smoothingRadius;
    this.hashParamsData[1] = buffers.particleCount;
    this.hashParamsData[2] = -config.boundsSize.x * 0.5;
    this.hashParamsData[3] = -5.0;
    this.hashParamsData[4] = -config.boundsSize.z * 0.5;
    this.hashParamsData[5] = this.gridRes.x;
    this.hashParamsData[6] = this.gridRes.y;
    this.hashParamsData[7] = this.gridRes.z;
    device.queue.writeBuffer(this.gridUniforms.hash, 0, this.hashParamsData);

    // 3. Sort
    this.sortParamsData[0] = buffers.particleCount;
    this.sortParamsData[1] = this.gridTotalCells;
    device.queue.writeBuffer(this.gridUniforms.sort, 0, this.sortParamsData);

    // 4. Scan
    const blocksL0 = Math.ceil((this.gridTotalCells + 1) / 512);
    const blocksL1 = Math.ceil(blocksL0 / 512);
    this.scanParamsDataL0[0] = this.gridTotalCells + 1;
    this.scanParamsDataL1[0] = blocksL0;
    this.scanParamsDataL2[0] = blocksL1;
    device.queue.writeBuffer(this.gridUniforms.scanL0, 0, this.scanParamsDataL0);
    device.queue.writeBuffer(this.gridUniforms.scanL1, 0, this.scanParamsDataL1);
    device.queue.writeBuffer(this.gridUniforms.scanL2, 0, this.scanParamsDataL2);

    // 5. Density
    const radius = config.smoothingRadius;
    const spikyPow2Scale = 15 / (2 * Math.PI * Math.pow(radius, 5));
    const spikyPow3Scale = 15 / (Math.PI * Math.pow(radius, 6));
    this.densityParamsData[0] = radius;
    this.densityParamsData[1] = spikyPow2Scale;
    this.densityParamsData[2] = spikyPow3Scale;
    this.densityParamsData[3] = buffers.particleCount;
    this.densityParamsData[4] = -config.boundsSize.x * 0.5;
    this.densityParamsData[5] = -5.0;
    this.densityParamsData[6] = -config.boundsSize.z * 0.5;
    this.densityParamsData[7] = 0;
    this.densityParamsData[8] = this.gridRes.x;
    this.densityParamsData[9] = this.gridRes.y;
    this.densityParamsData[10] = this.gridRes.z;
    this.densityParamsData[11] = 0;
    device.queue.writeBuffer(this.physicsUniforms.density, 0, this.densityParamsData);

    // 6. Pressure
    const spikyPow2DerivScale = 15 / (Math.PI * Math.pow(radius, 5));
    const spikyPow3DerivScale = 45 / (Math.PI * Math.pow(radius, 6));
    this.pressureParamsData[0] = timeStep;
    this.pressureParamsData[1] = config.targetDensity;
    this.pressureParamsData[2] = config.pressureMultiplier;
    this.pressureParamsData[3] = config.nearPressureMultiplier;
    this.pressureParamsData[4] = radius;
    this.pressureParamsData[5] = spikyPow2DerivScale;
    this.pressureParamsData[6] = spikyPow3DerivScale;
    this.pressureParamsData[7] = buffers.particleCount;
    this.pressureParamsData[8] = -config.boundsSize.x * 0.5;
    this.pressureParamsData[9] = -5.0;
    this.pressureParamsData[10] = -config.boundsSize.z * 0.5;
    this.pressureParamsData[11] = 0;
    this.pressureParamsData[12] = this.gridRes.x;
    this.pressureParamsData[13] = this.gridRes.y;
    this.pressureParamsData[14] = this.gridRes.z;
    this.pressureParamsData[15] = 0;
    device.queue.writeBuffer(this.physicsUniforms.pressure, 0, this.pressureParamsData);

    // 7. Viscosity
    const poly6Scale = 315 / (64 * Math.PI * Math.pow(radius, 9));
    this.viscosityParamsData[0] = timeStep;
    this.viscosityParamsData[1] = config.viscosityStrength;
    this.viscosityParamsData[2] = radius;
    this.viscosityParamsData[3] = poly6Scale;
    this.viscosityParamsData[4] = buffers.particleCount;
    this.viscosityParamsData[5] = -config.boundsSize.x * 0.5;
    this.viscosityParamsData[6] = -5.0;
    this.viscosityParamsData[7] = -config.boundsSize.z * 0.5;
    this.viscosityParamsData[8] = this.gridRes.x;
    this.viscosityParamsData[9] = this.gridRes.y;
    this.viscosityParamsData[10] = this.gridRes.z;
    this.viscosityParamsData[11] = 0;
    device.queue.writeBuffer(this.physicsUniforms.viscosity, 0, this.viscosityParamsData);

    // 8. Integrate
    this.integrateData[0] = timeStep;
    this.integrateData[1] = config.collisionDamping;
    const hasObstacle = (config.showObstacle !== false) &&
      config.obstacleSize.x > 0 &&
      config.obstacleSize.y > 0 &&
      config.obstacleSize.z > 0;
    this.integrateData[2] = hasObstacle ? 1 : 0;
    const size = config.boundsSize;
    const hx = size.x * 0.5;
    const hz = size.z * 0.5;
    const minY = -5.0;
    this.integrateData[4] = -hx;
    this.integrateData[5] = minY;
    this.integrateData[6] = -hz;
    this.integrateData[8] = hx;
    this.integrateData[9] = minY + size.y;
    this.integrateData[10] = hz;
    this.integrateData[12] = config.obstacleCentre.x;
    this.integrateData[13] = config.obstacleCentre.y + config.obstacleSize.y * 0.5;
    this.integrateData[14] = config.obstacleCentre.z;
    this.integrateData[16] = config.obstacleSize.x * 0.5;
    this.integrateData[17] = config.obstacleSize.y * 0.5;
    this.integrateData[18] = config.obstacleSize.z * 0.5;
    this.integrateData[20] = config.obstacleRotation.x;
    this.integrateData[21] = config.obstacleRotation.y;
    this.integrateData[22] = config.obstacleRotation.z;
    device.queue.writeBuffer(this.physicsUniforms.integrate, 0, this.integrateData);
  }

  private dispatchFoam(frameTime: number, encoder: GPUCommandEncoder): void {
    const { buffers, config, device } = this;
    const maxFoam = buffers.maxFoamParticles;

    this.foamFrameCount++;

    // Spawn uniforms
    const fadeInT =
      config.spawnRateFadeInTime <= 0
        ? 1
        : Math.min(
            1,
            Math.max(
              0,
              (this.simTimer - config.spawnRateFadeStartTime) /
                config.spawnRateFadeInTime
            )
          );

    this.foamSpawnData[0] = frameTime;
    this.foamSpawnData[1] = config.foamSpawnRate * fadeInT * fadeInT;
    this.foamSpawnData[2] = config.trappedAirVelocityMin;
    this.foamSpawnData[3] = config.trappedAirVelocityMax;
    this.foamSpawnData[4] = config.foamKineticEnergyMin;
    this.foamSpawnData[5] = config.foamKineticEnergyMax;

    const u32SpawnView = new Uint32Array(this.foamSpawnData.buffer);
    u32SpawnView[6] = maxFoam;
    u32SpawnView[7] = this.foamFrameCount;
    this.foamSpawnData[8] = buffers.particleCount;

    this.foamSpawnData[9] = config.smoothingRadius;
    this.foamSpawnData[10] = config.foamLifetimeMin;
    this.foamSpawnData[11] = config.foamLifetimeMax;

    this.foamSpawnData[12] = -config.boundsSize.x * 0.5;
    this.foamSpawnData[13] = -5.0;
    this.foamSpawnData[14] = -config.boundsSize.z * 0.5;
    this.foamSpawnData[16] = this.gridRes.x;
    this.foamSpawnData[17] = this.gridRes.y;
    this.foamSpawnData[18] = this.gridRes.z;
    this.foamSpawnData[19] = config.bubbleScale;

    device.queue.writeBuffer(this.foamUniforms.spawn, 0, this.foamSpawnData);

    // Update uniforms
    this.foamUpdateData[0] = frameTime;
    this.foamUpdateData[1] = config.gravity;
    this.foamUpdateData[2] = 0.04;
    this.foamUpdateData[3] = config.bubbleBuoyancy;

    const hx = config.boundsSize.x * 0.5;
    const hz = config.boundsSize.z * 0.5;
    const minY = -5.0;

    this.foamUpdateData[4] = hx;
    this.foamUpdateData[5] = minY + config.boundsSize.y;
    this.foamUpdateData[6] = hz;
    this.foamUpdateData[7] = config.smoothingRadius;

    this.foamUpdateData[8] = -hx;
    this.foamUpdateData[9] = minY;
    this.foamUpdateData[10] = -hz;
    this.foamUpdateData[11] = 0;

    this.foamUpdateData[12] = this.gridRes.x;
    this.foamUpdateData[13] = this.gridRes.y;
    this.foamUpdateData[14] = this.gridRes.z;
    this.foamUpdateData[15] = 0;

    const u32Update = new Uint32Array(this.foamUpdateData.buffer);
    u32Update[16] = config.bubbleClassifyMinNeighbours;
    u32Update[17] = config.sprayClassifyMaxNeighbours;
    this.foamUpdateData[18] = config.bubbleScale;
    this.foamUpdateData[19] = config.bubbleChangeScaleSpeed;

    device.queue.writeBuffer(this.foamUniforms.update, 0, this.foamUpdateData);

    this.foam.dispatch(encoder, buffers.particleCount, maxFoam, false);
  }

  render(viewMatrix: Float32Array): void {
    this.renderer.resize(this.canvas.width, this.canvas.height);
    const encoder = this.device.createCommandEncoder();
    this.renderer.render(
      encoder,
      this.context.getCurrentTexture().createView(),
      viewMatrix
    );
    this.device.queue.submit([encoder.finish()]);
  }
}
