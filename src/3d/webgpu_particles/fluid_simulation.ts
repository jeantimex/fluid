/**
 * =============================================================================
 * 3D Fluid Simulation Orchestrator for WebGPU (Linear Grid)
 * =============================================================================
 *
 * This class coordinates the entire SPH (Smoothed Particle Hydrodynamics)
 * simulation pipeline on the GPU. It manages the simulation state, GPU resources,
 * and the execution of compute passes in the correct order.
 *
 * This version uses the Linear Grid approach for O(1) neighbor search.
 *
 * @module fluid_simulation
 */

import type { SimConfig, SimState } from '../common/types.ts';
import { createSpawnData } from '../common/spawn.ts';
import { SimulationBuffersLinear } from './simulation_buffers_linear.ts';
import { ComputePipelinesLinear } from './compute_pipelines_linear.ts';
import { Renderer } from './renderer.ts';
import { mat4Perspective, mat4Multiply } from './math_utils.ts';

export class FluidSimulation {
  private device: GPUDevice;
  private context: GPUCanvasContext;
  private config: SimConfig;

  private buffers!: SimulationBuffersLinear;
  private pipelines: ComputePipelinesLinear;
  private renderer: Renderer;
  private state!: SimState;

  private workgroupSize = 256;
  private gridRes = { x: 0, y: 0, z: 0 };
  private gridTotalCells = 0;

  // Uniform Data Arrays
  private computeData = new Float32Array(8);
  private integrateData = new Float32Array(16);
  private hashParamsData = new Float32Array(8); // Increased size
  private sortParamsData = new Uint32Array(8);
  private scanParamsDataL0 = new Uint32Array(4);
  private scanParamsDataL1 = new Uint32Array(4);
  private scanParamsDataL2 = new Uint32Array(4);
  private densityParamsData = new Float32Array(12); // Increased size
  private pressureParamsData = new Float32Array(16); // Increased size
  private viscosityParamsData = new Float32Array(12); // Increased size
  private cullParamsData = new Float32Array(20);
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

    this.pipelines = new ComputePipelinesLinear(device);
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

    const { boundsSize, smoothingRadius } = this.config;
    this.gridRes = {
      x: Math.ceil(boundsSize.x / smoothingRadius),
      y: Math.ceil(boundsSize.y / smoothingRadius),
      z: Math.ceil(boundsSize.z / smoothingRadius),
    };
    this.gridTotalCells = this.gridRes.x * this.gridRes.y * this.gridRes.z;

    const spawn = createSpawnData(this.config);
    this.state = this.createStateFromSpawn(spawn);

    this.buffers = new SimulationBuffersLinear(this.device, spawn, this.gridTotalCells);

    this.pipelines.createBindGroups(this.buffers);
    this.renderer.createBindGroup(this.buffers); // Renderer type might need update if it depends on buffer type? 
    // Renderer expects 'SimulationBuffers'. I need to check if SimulationBuffersLinear is compatible.
    // It has positions, velocities, visibleIndices, indirectDraw.
    // It should be compatible structurally for what Renderer uses.
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
      sortedKeys: new Uint32Array(spawn.count), // Not used in Linear but kept for interface compatibility
      indices: new Uint32Array(spawn.count),
      sortOffsets: new Uint32Array(spawn.count), // This might be wrong size for CPU state but it's for UI mainly?
      spatialOffsets: new Uint32Array(spawn.count),
      positionsSorted: new Float32Array(spawn.count * 4),
      predictedSorted: new Float32Array(spawn.count * 4),
      velocitiesSorted: new Float32Array(spawn.count * 4),
      count: spawn.count,
      input: { worldX: 0, worldY: 0, worldZ: 0, pull: false, push: false },
    };
  }

  async step(dt: number): Promise<void> {
    const { config, buffers, pipelines, device, state } = this;

    const maxDeltaTime = config.maxTimestepFPS ? 1 / config.maxTimestepFPS : Number.POSITIVE_INFINITY;
    const frameTime = Math.min(dt * config.timeScale, maxDeltaTime);
    const timeStep = frameTime / config.iterationsPerFrame;

    for (let i = 0; i < config.iterationsPerFrame; i++) {
      // 1. External Forces
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

      device.queue.writeBuffer(pipelines.uniformBuffers.compute, 0, this.computeData);

      const encoder = device.createCommandEncoder();

      const computePass = encoder.beginComputePass();
      computePass.setPipeline(pipelines.externalForces);
      computePass.setBindGroup(0, pipelines.externalForcesBindGroup);
      computePass.dispatchWorkgroups(Math.ceil(buffers.particleCount / this.workgroupSize));
      computePass.end();

      // 2. Spatial Hash (Linear Grid)
      this.dispatchSpatialHash(encoder);

      // 3. Density
      this.updateDensityUniforms();
      const densityPass = encoder.beginComputePass();
      densityPass.setPipeline(pipelines.density);
      densityPass.setBindGroup(0, pipelines.densityBindGroup);
      densityPass.dispatchWorkgroups(Math.ceil(buffers.particleCount / this.workgroupSize));
      densityPass.end();

      // 4. Pressure
      this.updatePressureUniforms(timeStep);
      const pressurePass = encoder.beginComputePass();
      pressurePass.setPipeline(pipelines.pressure);
      pressurePass.setBindGroup(0, pipelines.pressureBindGroup);
      pressurePass.dispatchWorkgroups(Math.ceil(buffers.particleCount / this.workgroupSize));
      pressurePass.end();

      // 5. Viscosity
      if (config.viscosityStrength > 0) {
        this.updateViscosityUniforms(timeStep);
        const viscosityPass = encoder.beginComputePass();
        viscosityPass.setPipeline(pipelines.viscosity);
        viscosityPass.setBindGroup(0, pipelines.viscosityBindGroup);
        viscosityPass.dispatchWorkgroups(Math.ceil(buffers.particleCount / this.workgroupSize));
        viscosityPass.end();
      }

      // 6. Integration
      this.updateIntegrateUniforms(timeStep);
      const integratePass = encoder.beginComputePass();
      integratePass.setPipeline(pipelines.integrate);
      integratePass.setBindGroup(0, pipelines.integrateBindGroup);
      integratePass.dispatchWorkgroups(Math.ceil(buffers.particleCount / this.workgroupSize));
      integratePass.end();

      device.queue.submit([encoder.finish()]);
    }
  }

  private dispatchSpatialHash(encoder: GPUCommandEncoder): void {
    const { pipelines, buffers } = this;
    const workgroups = Math.ceil(buffers.particleCount / this.workgroupSize);

    // Scan block counts (based on grid total cells for Linear Grid)
    const blocksL0 = Math.ceil((this.gridTotalCells + 1) / 512);
    const blocksL1 = Math.ceil(blocksL0 / 512);
    const blocksL2 = Math.ceil(blocksL1 / 512);

    // Update Uniforms
    this.hashParamsData[0] = this.config.smoothingRadius;
    this.hashParamsData[1] = buffers.particleCount;
    this.hashParamsData[2] = -this.config.boundsSize.x * 0.5;
    this.hashParamsData[3] = -this.config.boundsSize.y * 0.5;
    this.hashParamsData[4] = -this.config.boundsSize.z * 0.5;
    this.hashParamsData[5] = this.gridRes.x;
    this.hashParamsData[6] = this.gridRes.y;
    this.hashParamsData[7] = this.gridRes.z;
    this.device.queue.writeBuffer(pipelines.uniformBuffers.hash, 0, this.hashParamsData);

    this.sortParamsData[0] = buffers.particleCount;
    this.sortParamsData[1] = this.gridTotalCells;
    this.device.queue.writeBuffer(pipelines.uniformBuffers.sort, 0, this.sortParamsData);

    this.scanParamsDataL0[0] = this.gridTotalCells + 1;
    this.device.queue.writeBuffer(pipelines.uniformBuffers.scanParamsL0, 0, this.scanParamsDataL0);

    this.scanParamsDataL1[0] = blocksL0;
    this.device.queue.writeBuffer(pipelines.uniformBuffers.scanParamsL1, 0, this.scanParamsDataL1);

    this.scanParamsDataL2[0] = blocksL1;
    this.device.queue.writeBuffer(pipelines.uniformBuffers.scanParamsL2, 0, this.scanParamsDataL2);

    // 1. Hash
    const hashPass = encoder.beginComputePass();
    hashPass.setPipeline(pipelines.hash);
    hashPass.setBindGroup(0, pipelines.hashBindGroup);
    hashPass.dispatchWorkgroups(workgroups);
    hashPass.end();

    // 2. Clear
    const clearPass = encoder.beginComputePass();
    clearPass.setPipeline(pipelines.clearOffsets);
    clearPass.setBindGroup(0, pipelines.clearOffsetsBindGroup);
    clearPass.dispatchWorkgroups(Math.ceil((this.gridTotalCells + 1) / 256));
    clearPass.end();

    // 3. Count
    const countPass = encoder.beginComputePass();
    countPass.setPipeline(pipelines.countOffsets);
    countPass.setBindGroup(1, pipelines.countOffsetsBindGroup);
    countPass.dispatchWorkgroups(workgroups);
    countPass.end();

    // 4. Prefix Sum
    const scanPass0 = encoder.beginComputePass();
    scanPass0.setPipeline(pipelines.prefixScan);
    scanPass0.setBindGroup(0, pipelines.scanPass0BindGroup);
    scanPass0.dispatchWorkgroups(blocksL0);
    scanPass0.end();

    if (blocksL0 > 1) {
      const scanPass1 = encoder.beginComputePass();
      scanPass1.setPipeline(pipelines.prefixScan);
      scanPass1.setBindGroup(0, pipelines.scanPass1BindGroup);
      scanPass1.dispatchWorkgroups(blocksL1);
      scanPass1.end();
    }

    if (blocksL1 > 1) {
      const scanPass2 = encoder.beginComputePass();
      scanPass2.setPipeline(pipelines.prefixScan);
      scanPass2.setBindGroup(0, pipelines.scanPass2BindGroup);
      scanPass2.dispatchWorkgroups(blocksL2);
      scanPass2.end();
    }

    if (blocksL1 > 1) {
      const combinePass1 = encoder.beginComputePass();
      combinePass1.setPipeline(pipelines.prefixCombine);
      combinePass1.setBindGroup(0, pipelines.combinePass1BindGroup);
      combinePass1.dispatchWorkgroups(blocksL1);
      combinePass1.end();
    }

    if (blocksL0 > 1) {
      const combinePass0 = encoder.beginComputePass();
      combinePass0.setPipeline(pipelines.prefixCombine);
      combinePass0.setBindGroup(0, pipelines.combinePass0BindGroup);
      combinePass0.dispatchWorkgroups(blocksL0);
      combinePass0.end();
    }

    // 5. Scatter
    const scatterPass = encoder.beginComputePass();
    scatterPass.setPipeline(pipelines.scatter);
    scatterPass.setBindGroup(0, pipelines.scatterBindGroup);
    scatterPass.dispatchWorkgroups(workgroups);
    scatterPass.end();

    // 6. Reorder
    const reorderPass = encoder.beginComputePass();
    reorderPass.setPipeline(pipelines.reorder);
    reorderPass.setBindGroup(0, pipelines.reorderBindGroup);
    reorderPass.dispatchWorkgroups(workgroups);
    reorderPass.end();

    // 7. Copy Back
    const copyBackPass = encoder.beginComputePass();
    copyBackPass.setPipeline(pipelines.copyBack);
    copyBackPass.setBindGroup(0, pipelines.copyBackBindGroup);
    copyBackPass.dispatchWorkgroups(workgroups);
    copyBackPass.end();
  }

  private updateDensityUniforms(): void {
    const radius = this.config.smoothingRadius;
    const spikyPow2Scale = 15 / (2 * Math.PI * Math.pow(radius, 5));
    const spikyPow3Scale = 15 / (Math.PI * Math.pow(radius, 6));

    this.densityParamsData[0] = radius;
    this.densityParamsData[1] = spikyPow2Scale;
    this.densityParamsData[2] = spikyPow3Scale;
    this.densityParamsData[3] = this.buffers.particleCount;
    this.densityParamsData[4] = -this.config.boundsSize.x * 0.5;
    this.densityParamsData[5] = -this.config.boundsSize.y * 0.5;
    this.densityParamsData[6] = -this.config.boundsSize.z * 0.5;
    this.densityParamsData[7] = 0; // pad
    this.densityParamsData[8] = this.gridRes.x;
    this.densityParamsData[9] = this.gridRes.y;
    this.densityParamsData[10] = this.gridRes.z;
    this.densityParamsData[11] = 0; // pad

    this.device.queue.writeBuffer(this.pipelines.uniformBuffers.density, 0, this.densityParamsData);
  }

  private updatePressureUniforms(timeStep: number): void {
    const radius = this.config.smoothingRadius;
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
    this.pressureParamsData[8] = -this.config.boundsSize.x * 0.5;
    this.pressureParamsData[9] = -this.config.boundsSize.y * 0.5;
    this.pressureParamsData[10] = -this.config.boundsSize.z * 0.5;
    this.pressureParamsData[11] = 0; // pad
    this.pressureParamsData[12] = this.gridRes.x;
    this.pressureParamsData[13] = this.gridRes.y;
    this.pressureParamsData[14] = this.gridRes.z;
    this.pressureParamsData[15] = 0; // pad

    this.device.queue.writeBuffer(this.pipelines.uniformBuffers.pressure, 0, this.pressureParamsData);
  }

  private updateViscosityUniforms(timeStep: number): void {
    const radius = this.config.smoothingRadius;
    const poly6Scale = 315 / (64 * Math.PI * Math.pow(radius, 9));

    this.viscosityParamsData[0] = timeStep;
    this.viscosityParamsData[1] = this.config.viscosityStrength;
    this.viscosityParamsData[2] = radius;
    this.viscosityParamsData[3] = poly6Scale;
    this.viscosityParamsData[4] = this.buffers.particleCount;
    this.viscosityParamsData[5] = -this.config.boundsSize.x * 0.5;
    this.viscosityParamsData[6] = -this.config.boundsSize.y * 0.5;
    this.viscosityParamsData[7] = -this.config.boundsSize.z * 0.5;
    this.viscosityParamsData[8] = this.gridRes.x;
    this.viscosityParamsData[9] = this.gridRes.y;
    this.viscosityParamsData[10] = this.gridRes.z;
    this.viscosityParamsData[11] = 0; // pad

    this.device.queue.writeBuffer(this.pipelines.uniformBuffers.viscosity, 0, this.viscosityParamsData);
  }

  private updateIntegrateUniforms(timeStep: number): void {
    this.integrateData[0] = timeStep;
    this.integrateData[1] = this.config.collisionDamping;
    const hasObstacle = this.config.obstacleSize.x > 0 && this.config.obstacleSize.y > 0 && this.config.obstacleSize.z > 0;
    this.integrateData[2] = hasObstacle ? 1 : 0;
    const hx = this.config.boundsSize.x * 0.5;
    const hy = this.config.boundsSize.y * 0.5;
    const hz = this.config.boundsSize.z * 0.5;
    this.integrateData[4] = hx;
    this.integrateData[5] = hy;
    this.integrateData[6] = hz;
    this.integrateData[8] = this.config.obstacleCentre.x;
    this.integrateData[9] = this.config.obstacleCentre.y;
    this.integrateData[10] = this.config.obstacleCentre.z;
    this.integrateData[12] = this.config.obstacleSize.x * 0.5;
    this.integrateData[13] = this.config.obstacleSize.y * 0.5;
    this.integrateData[14] = this.config.obstacleSize.z * 0.5;

    this.device.queue.writeBuffer(this.pipelines.uniformBuffers.integrate, 0, this.integrateData);
  }

  private dispatchCull(encoder: GPUCommandEncoder, viewMatrix: Float32Array): void {
    const { pipelines, buffers, config } = this;
    this.device.queue.writeBuffer(buffers.indirectDraw, 0, this.indirectArgs);
    const aspect = this.context.canvas.width / this.context.canvas.height;
    const projection = mat4Perspective(Math.PI / 3, aspect, 0.1, 100.0);
    const viewProj = mat4Multiply(projection, viewMatrix);
    this.cullParamsData.set(viewProj);
    this.cullParamsData[16] = config.particleRadius;
    const u32View = new Uint32Array(this.cullParamsData.buffer);
    u32View[17] = buffers.particleCount;
    this.device.queue.writeBuffer(pipelines.uniformBuffers.cull, 0, this.cullParamsData);
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipelines.cull);
    pass.setBindGroup(0, pipelines.cullBindGroup);
    pass.dispatchWorkgroups(Math.ceil(buffers.particleCount / this.workgroupSize));
    pass.end();
  }

  render(viewMatrix: Float32Array): void {
    this.renderer.resize();
    const encoder = this.device.createCommandEncoder();
    this.dispatchCull(encoder, viewMatrix);
    // Renderer expects SimulationBuffers, but we pass SimulationBuffersLinear.
    // Structural typing should allow this if fields match.
    // SimulationBuffersLinear is missing 'sortedKeys' and 'spatialOffsets' from original SimulationBuffers.
    // Does Renderer use them?
    // Renderer uses: positions, velocities, visibleIndices, indirectDraw.
    // It creates bind group using these.
    // Renderer.ts:
    // entries: [ { buffer: buffers.positions }, { buffer: buffers.velocities }, { buffer: this.uniformBuffer }, { buffer: this.gradientBuffer }, { buffer: buffers.visibleIndices } ]
    // It does not use sortedKeys or spatialOffsets.
    // So it should work!
    this.renderer.render(
      encoder,
      this.context.getCurrentTexture().createView(),
      this.config,
      this.buffers as any, // Cast to any or compatible type if needed
      viewMatrix
    );
    this.device.queue.submit([encoder.finish()]);
  }
}
