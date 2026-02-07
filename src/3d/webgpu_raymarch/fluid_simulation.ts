/**
 * =============================================================================
 * 3D Fluid Simulation Orchestrator for WebGPU (Linear Grid)
 * =============================================================================
 */

import type { SimState } from '../common/types.ts';
import { createSpawnData } from '../common/spawn.ts';
import { FluidBuffers } from '../common/fluid_buffers.ts';
import { SpatialGrid, type SpatialGridUniforms } from '../common/spatial_grid.ts';
import { FluidPhysics, type PhysicsUniforms } from '../common/fluid_physics.ts';
import { OrbitCamera } from '../common/orbit_camera.ts';
import { RaymarchRenderer } from './renderer.ts';
import { SplatPipeline } from './splat_pipeline.ts';
import type { RaymarchConfig } from './types.ts';

/**
 * Orchestrates the full SPH fluid simulation pipeline on the GPU.
 */
export class FluidSimulation {
  /**
   * Beginner note:
   * Computes SPH simulation on GPU, then the raymarch renderer visualizes
   * the density volume produced by the splat pipeline.
   */
  private device: GPUDevice;
  private context: GPUCanvasContext;
  private config: RaymarchConfig;

  // --- Subsystems (Modular) ---
  private buffers!: FluidBuffers;
  private physics: FluidPhysics;
  private grid: SpatialGrid;
  private splatPipeline: SplatPipeline;
  private renderer: RaymarchRenderer;

  private state!: SimState;

  // --- Grid Configuration ---
  private gridRes = { x: 0, y: 0, z: 0 };
  private gridTotalCells = 0;

  // --- Uniform Buffers ---
  private physicsUniforms!: PhysicsUniforms;
  private gridUniforms!: SpatialGridUniforms;

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

  constructor(
    device: GPUDevice,
    context: GPUCanvasContext,
    canvas: HTMLCanvasElement,
    config: RaymarchConfig,
    format: GPUTextureFormat
  ) {
    this.device = device;
    this.context = context;
    this.config = config;

    this.physics = new FluidPhysics(device);
    this.grid = new SpatialGrid(device);
    this.splatPipeline = new SplatPipeline(device);
    this.renderer = new RaymarchRenderer(device, canvas, format);

    // Create all uniform buffers upfront
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
      gridTotalCells: this.gridTotalCells
    });

    this.physics.createBindGroups(this.buffers, this.physicsUniforms);
    this.grid.createBindGroups(this.buffers, this.gridUniforms);

    this.splatPipeline.recreate(this.config, this.buffers.predicted);
    this.renderer.createBindGroup(this.splatPipeline.textureView);
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

    this.splatPipeline.dispatch(encoder, buffers.particleCount, config);
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
    const obstacleShape = config.obstacleShape ?? 'box';
    const obstacleIsSphere = obstacleShape === 'sphere';
    const obstacleRadius = config.obstacleRadius ?? 0;
    const hasObstacle = (config.showObstacle !== false) &&
      (obstacleIsSphere
        ? obstacleRadius > 0
        : (config.obstacleSize.x > 0 &&
          config.obstacleSize.y > 0 &&
          config.obstacleSize.z > 0));
    this.integrateData[2] = hasObstacle ? 1 : 0;
    this.integrateData[3] = obstacleIsSphere ? 1 : 0;
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
    this.integrateData[13] = obstacleIsSphere
      ? config.obstacleCentre.y
      : config.obstacleCentre.y + config.obstacleSize.y * 0.5;
    this.integrateData[14] = config.obstacleCentre.z;
    const obsHalfX = obstacleIsSphere ? obstacleRadius : config.obstacleSize.x * 0.5;
    const obsHalfY = obstacleIsSphere ? obstacleRadius : config.obstacleSize.y * 0.5;
    const obsHalfZ = obstacleIsSphere ? obstacleRadius : config.obstacleSize.z * 0.5;
    this.integrateData[16] = obsHalfX;
    this.integrateData[17] = obsHalfY;
    this.integrateData[18] = obsHalfZ;
    this.integrateData[20] = config.obstacleRotation.x;
    this.integrateData[21] = config.obstacleRotation.y;
    this.integrateData[22] = config.obstacleRotation.z;
    device.queue.writeBuffer(this.physicsUniforms.integrate, 0, this.integrateData);
  }

  render(camera: OrbitCamera): void {
    const encoder = this.device.createCommandEncoder();
    this.renderer.render(
      encoder,
      this.context.getCurrentTexture().createView(),
      camera,
      this.config
    );
    this.device.queue.submit([encoder.finish()]);
  }
}
