import type { SimConfig, SimState } from '../common/types.ts';
import { createSpawnData } from '../common/spawn.ts';
import { SimulationBuffers } from './simulation_buffers.ts';
import { ComputePipelines } from './compute_pipelines.ts';
import { Renderer } from './renderer.ts';
import { mat4Perspective, mat4Multiply } from './math_utils.ts';

export class FluidSimulation {
  private device: GPUDevice;
  private context: GPUCanvasContext;
  private config: SimConfig;

  private buffers!: SimulationBuffers;
  private pipelines: ComputePipelines;
  private renderer: Renderer;
  private state!: SimState;

  private workgroupSize = 256;

  private computeData = new Float32Array(8); // Increased to 8 floats (32 bytes)
  private integrateData = new Float32Array(16);
  private hashParamsData = new Float32Array(4);
  private sortParamsData = new Uint32Array(8);
  private scanParamsDataL0 = new Uint32Array(4);
  private scanParamsDataL1 = new Uint32Array(4);
  private scanParamsDataL2 = new Uint32Array(4);
  private densityParamsData = new Float32Array(8);
  private pressureParamsData = new Float32Array(12);
  private viscosityParamsData = new Float32Array(12);
  private cullParamsData = new Float32Array(20); // 80 bytes / 4 = 20 floats
  private indirectArgs = new Uint32Array([6, 0, 0, 0]);

  constructor(
    device: GPUDevice,
    context: GPUCanvasContext,
    canvas: HTMLCanvasElement,
    config: SimConfig,
    format: GPUTextureFormat
  ) {
    this.device = device;
    this.context = context;
    this.config = config;

    this.pipelines = new ComputePipelines(device);
    this.renderer = new Renderer(device, canvas, format, config);

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

    const spawn = createSpawnData(this.config);
    this.state = this.createStateFromSpawn(spawn);
    this.buffers = new SimulationBuffers(this.device, spawn);

    this.pipelines.createBindGroups(this.buffers);
    this.renderer.createBindGroup(this.buffers);
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
      input: {
        worldX: 0,
        worldY: 0,
        worldZ: 0,
        pull: false,
        push: false,
      },
    };
  }

  async step(dt: number): Promise<void> {
    const { config, buffers, pipelines, device, state } = this;

    const maxDeltaTime = config.maxTimestepFPS
      ? 1 / config.maxTimestepFPS
      : Number.POSITIVE_INFINITY;
    const frameTime = Math.min(dt * config.timeScale, maxDeltaTime);
    const timeStep = frameTime / config.iterationsPerFrame;

    for (let i = 0; i < config.iterationsPerFrame; i++) {
      // External Forces & Interaction
      let interactionStrength = 0;
      if (state.input.push) interactionStrength = -config.interactionStrength;
      else if (state.input.pull)
        interactionStrength = config.interactionStrength;

      this.computeData[0] = timeStep;
      this.computeData[1] = config.gravity;
      this.computeData[2] = config.interactionRadius;
      this.computeData[3] = interactionStrength;
      this.computeData[4] = state.input.worldX;
      this.computeData[5] = state.input.worldY;
      this.computeData[6] = state.input.worldZ;
      this.computeData[7] = 0; // padding

      device.queue.writeBuffer(
        pipelines.uniformBuffers.compute,
        0,
        this.computeData
      );

      const encoder = device.createCommandEncoder();

      const computePass = encoder.beginComputePass();
      computePass.setPipeline(pipelines.externalForces);
      computePass.setBindGroup(0, pipelines.externalForcesBindGroup);
      computePass.dispatchWorkgroups(
        Math.ceil(buffers.particleCount / this.workgroupSize)
      );
      computePass.end();

      // Spatial Hash
      this.dispatchSpatialHash(encoder);

      // Density
      this.updateDensityUniforms();
      const densityPass = encoder.beginComputePass();
      densityPass.setPipeline(pipelines.density);
      densityPass.setBindGroup(0, pipelines.densityBindGroup);
      densityPass.dispatchWorkgroups(
        Math.ceil(buffers.particleCount / this.workgroupSize)
      );
      densityPass.end();

      // Pressure
      this.updatePressureUniforms(timeStep);
      const pressurePass = encoder.beginComputePass();
      pressurePass.setPipeline(pipelines.pressure);
      pressurePass.setBindGroup(0, pipelines.pressureBindGroup);
      pressurePass.dispatchWorkgroups(
        Math.ceil(buffers.particleCount / this.workgroupSize)
      );
      pressurePass.end();

      // Viscosity
      if (config.viscosityStrength > 0) {
        this.updateViscosityUniforms(timeStep);
        const viscosityPass = encoder.beginComputePass();
        viscosityPass.setPipeline(pipelines.viscosity);
        viscosityPass.setBindGroup(0, pipelines.viscosityBindGroup);
        viscosityPass.dispatchWorkgroups(
          Math.ceil(buffers.particleCount / this.workgroupSize)
        );
        viscosityPass.end();
      }

      // Integrate
      this.updateIntegrateUniforms(timeStep);
      const integratePass = encoder.beginComputePass();
      integratePass.setPipeline(pipelines.integrate);
      integratePass.setBindGroup(0, pipelines.integrateBindGroup);
      integratePass.dispatchWorkgroups(
        Math.ceil(buffers.particleCount / this.workgroupSize)
      );
      integratePass.end();

      device.queue.submit([encoder.finish()]);
    }
  }

  private dispatchSpatialHash(encoder: GPUCommandEncoder): void {
    const { pipelines, buffers } = this;
    const workgroups = Math.ceil(buffers.particleCount / this.workgroupSize);

    // Calculate blocks for each level
    // Level 0: particleCount items
    const blocksL0 = Math.ceil(buffers.particleCount / 512);
    // Level 1: blocksL0 items
    const blocksL1 = Math.ceil(blocksL0 / 512);
    // Level 2: blocksL1 items
    const blocksL2 = Math.ceil(blocksL1 / 512);

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

    // Update Scan Params
    this.scanParamsDataL0[0] = buffers.particleCount;
    this.device.queue.writeBuffer(
      pipelines.uniformBuffers.scanParamsL0,
      0,
      this.scanParamsDataL0
    );

    this.scanParamsDataL1[0] = blocksL0;
    this.device.queue.writeBuffer(
      pipelines.uniformBuffers.scanParamsL1,
      0,
      this.scanParamsDataL1
    );

    this.scanParamsDataL2[0] = blocksL1;
    this.device.queue.writeBuffer(
      pipelines.uniformBuffers.scanParamsL2,
      0,
      this.scanParamsDataL2
    );

    const hashPass = encoder.beginComputePass();
    hashPass.setPipeline(pipelines.hash);
    hashPass.setBindGroup(0, pipelines.hashBindGroup);
    hashPass.dispatchWorkgroups(workgroups);
    hashPass.end();

    const clearPass = encoder.beginComputePass();
    clearPass.setPipeline(pipelines.clearOffsets);
    clearPass.setBindGroup(0, pipelines.clearOffsetsBindGroup);
    clearPass.dispatchWorkgroups(workgroups);
    clearPass.end();

    const countPass = encoder.beginComputePass();
    countPass.setPipeline(pipelines.countOffsets);
    countPass.setBindGroup(1, pipelines.countOffsetsBindGroup);
    countPass.dispatchWorkgroups(workgroups);
    countPass.end();

    // ---------------------------------------------------------
    // Hierarchical Prefix Sum (3 Levels)
    // ---------------------------------------------------------

    // Level 0: Scan Data -> Write L1Sums
    const scanPass0 = encoder.beginComputePass();
    scanPass0.setPipeline(pipelines.prefixScan);
    scanPass0.setBindGroup(0, pipelines.scanPass0BindGroup);
    scanPass0.dispatchWorkgroups(blocksL0);
    scanPass0.end();

    // Level 1: Scan L1Sums -> Write L2Sums
    if (blocksL0 > 1) {
      const scanPass1 = encoder.beginComputePass();
      scanPass1.setPipeline(pipelines.prefixScan);
      scanPass1.setBindGroup(0, pipelines.scanPass1BindGroup);
      scanPass1.dispatchWorkgroups(blocksL1);
      scanPass1.end();
    }

    // Level 2: Scan L2Sums -> Write Scratch (In-place basically)
    if (blocksL1 > 1) {
      const scanPass2 = encoder.beginComputePass();
      scanPass2.setPipeline(pipelines.prefixScan);
      scanPass2.setBindGroup(0, pipelines.scanPass2BindGroup);
      scanPass2.dispatchWorkgroups(blocksL2);
      scanPass2.end();
    }

    // Combine Level 1: Add L2Sums to L1Sums
    if (blocksL1 > 1) {
      const combinePass1 = encoder.beginComputePass();
      combinePass1.setPipeline(pipelines.prefixCombine);
      combinePass1.setBindGroup(0, pipelines.combinePass1BindGroup);
      combinePass1.dispatchWorkgroups(blocksL1);
      combinePass1.end();
    }

    // Combine Level 0: Add L1Sums to Data
    if (blocksL0 > 1) {
      const combinePass0 = encoder.beginComputePass();
      combinePass0.setPipeline(pipelines.prefixCombine);
      combinePass0.setBindGroup(0, pipelines.combinePass0BindGroup);
      combinePass0.dispatchWorkgroups(blocksL0);
      combinePass0.end();
    }

    // ---------------------------------------------------------

    const scatterPass = encoder.beginComputePass();
    scatterPass.setPipeline(pipelines.scatter);
    scatterPass.setBindGroup(0, pipelines.scatterBindGroup);
    scatterPass.dispatchWorkgroups(workgroups);
    scatterPass.end();

    const initSpatialPass = encoder.beginComputePass();
    initSpatialPass.setPipeline(pipelines.initSpatialOffsets);
    initSpatialPass.setBindGroup(0, pipelines.initSpatialOffsetsBindGroup);
    initSpatialPass.dispatchWorkgroups(workgroups);
    initSpatialPass.end();

    const updateSpatialPass = encoder.beginComputePass();
    updateSpatialPass.setPipeline(pipelines.updateSpatialOffsets);
    updateSpatialPass.setBindGroup(0, pipelines.updateSpatialOffsetsBindGroup);
    updateSpatialPass.dispatchWorkgroups(workgroups);
    updateSpatialPass.end();

    const reorderPass = encoder.beginComputePass();
    reorderPass.setPipeline(pipelines.reorder);
    reorderPass.setBindGroup(0, pipelines.reorderBindGroup);
    reorderPass.dispatchWorkgroups(workgroups);
    reorderPass.end();

    const copyBackPass = encoder.beginComputePass();
    copyBackPass.setPipeline(pipelines.copyBack);
    copyBackPass.setBindGroup(0, pipelines.copyBackBindGroup);
    copyBackPass.dispatchWorkgroups(workgroups);
    copyBackPass.end();
  }

  private updateDensityUniforms(): void {
    const radius = this.config.smoothingRadius;
    // Proper 3D SPH kernel normalization constants
    const spikyPow2Scale = 15 / (2 * Math.PI * Math.pow(radius, 5));
    const spikyPow3Scale = 15 / (Math.PI * Math.pow(radius, 6));

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
    // Proper 3D SPH kernel derivative normalization constants
    const spikyPow2DerivScale = 15 / (Math.PI * Math.pow(radius, 5));
    const spikyPow3DerivScale = 45 / (Math.PI * Math.pow(radius, 6));

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
    // Proper 3D Poly6 kernel normalization constant
    const poly6Scale = 315 / (64 * Math.PI * Math.pow(radius, 9));

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

  private updateIntegrateUniforms(timeStep: number): void {
    this.integrateData[0] = timeStep;
    this.integrateData[1] = this.config.collisionDamping;
    this.integrateData[2] = 0; // hasObstacle

    const hx = this.config.boundsSize.x * 0.5;
    const hy = this.config.boundsSize.y * 0.5;
    const hz = this.config.boundsSize.z * 0.5;

    this.integrateData[4] = hx;
    this.integrateData[5] = hy;
    this.integrateData[6] = hz;

    this.device.queue.writeBuffer(
      this.pipelines.uniformBuffers.integrate,
      0,
      this.integrateData
    );
  }

  private dispatchCull(
    encoder: GPUCommandEncoder,
    viewMatrix: Float32Array
  ): void {
    const { pipelines, buffers, config } = this;

    // Reset indirect args (instanceCount = 0)
    this.device.queue.writeBuffer(buffers.indirectDraw, 0, this.indirectArgs);

    // Compute ViewProjection
    const aspect = this.context.canvas.width / this.context.canvas.height;
    const projection = mat4Perspective(Math.PI / 3, aspect, 0.1, 100.0);
    const viewProj = mat4Multiply(projection, viewMatrix);

    // Update Cull Params
    this.cullParamsData.set(viewProj); // First 16 floats
    this.cullParamsData[16] = config.particleRadius; // radius

    // particleCount is u32, use DataView or aliasing?
    // Since Float32Array and Uint32Array share buffer...
    const u32View = new Uint32Array(this.cullParamsData.buffer);
    u32View[17] = buffers.particleCount;

    this.device.queue.writeBuffer(
      pipelines.uniformBuffers.cull,
      0,
      this.cullParamsData
    );

    const pass = encoder.beginComputePass();
    pass.setPipeline(pipelines.cull);
    pass.setBindGroup(0, pipelines.cullBindGroup);
    pass.dispatchWorkgroups(
      Math.ceil(buffers.particleCount / this.workgroupSize)
    );
    pass.end();
  }

  render(viewMatrix: Float32Array): void {
    this.renderer.resize();
    const encoder = this.device.createCommandEncoder();

    this.dispatchCull(encoder, viewMatrix);

    this.renderer.render(
      encoder,
      this.context.getCurrentTexture().createView(),
      this.config,
      this.buffers,
      viewMatrix
    );
    this.device.queue.submit([encoder.finish()]);
  }
}
