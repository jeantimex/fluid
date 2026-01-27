import type { SimConfig } from '../common/types.ts';
import { createSpawnData } from '../common/spawn.ts';
import { SimulationBuffers } from './simulation_buffers.ts';
import { ComputePipelines } from './compute_pipelines.ts';
import { Renderer } from './renderer.ts';

export class FluidSimulation {
  private device: GPUDevice;
  private context: GPUCanvasContext;
  private config: SimConfig;

  private buffers!: SimulationBuffers;
  private pipelines: ComputePipelines;
  private renderer: Renderer;

  private workgroupSize = 256;

  private computeData = new Float32Array(4);
  private integrateData = new Float32Array(16);
  private hashParamsData = new Float32Array(4);
  private sortParamsData = new Uint32Array(8);
  private densityParamsData = new Float32Array(8);
  private pressureParamsData = new Float32Array(12);
  private viscosityParamsData = new Float32Array(12);

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
    this.renderer = new Renderer(device, canvas, format);

    this.reset();
  }

  get particleCount(): number {
    return this.buffers.particleCount;
  }

  reset(): void {
    if (this.buffers) {
      this.buffers.destroy();
    }

    const spawn = createSpawnData(this.config);
    // this.state = this.createStateFromSpawn(spawn);
    this.buffers = new SimulationBuffers(this.device, spawn);

    this.pipelines.createBindGroups(this.buffers);
    this.renderer.createBindGroup(this.buffers);
  }

  async step(dt: number): Promise<void> {
    const { config, buffers, pipelines, device } = this;

    const maxDeltaTime = config.maxTimestepFPS
      ? 1 / config.maxTimestepFPS
      : Number.POSITIVE_INFINITY;
    const frameTime = Math.min(dt * config.timeScale, maxDeltaTime);
    const timeStep = frameTime / config.iterationsPerFrame;

    for (let i = 0; i < config.iterationsPerFrame; i++) {
        
        // External Forces
        this.computeData[0] = timeStep;
        this.computeData[1] = config.gravity;
        device.queue.writeBuffer(pipelines.uniformBuffers.compute, 0, this.computeData);

        const encoder = device.createCommandEncoder();

        const computePass = encoder.beginComputePass();
        computePass.setPipeline(pipelines.externalForces);
        computePass.setBindGroup(0, pipelines.externalForcesBindGroup);
        computePass.dispatchWorkgroups(Math.ceil(buffers.particleCount / this.workgroupSize));
        computePass.end();

        // Spatial Hash
        this.dispatchSpatialHash(encoder);

        // Density
        this.updateDensityUniforms();
        const densityPass = encoder.beginComputePass();
        densityPass.setPipeline(pipelines.density);
        densityPass.setBindGroup(0, pipelines.densityBindGroup);
        densityPass.dispatchWorkgroups(Math.ceil(buffers.particleCount / this.workgroupSize));
        densityPass.end();

        // Pressure
        this.updatePressureUniforms(timeStep);
        const pressurePass = encoder.beginComputePass();
        pressurePass.setPipeline(pipelines.pressure);
        pressurePass.setBindGroup(0, pipelines.pressureBindGroup);
        pressurePass.dispatchWorkgroups(Math.ceil(buffers.particleCount / this.workgroupSize));
        pressurePass.end();

        // Viscosity
        if (config.viscosityStrength > 0) {
            this.updateViscosityUniforms(timeStep);
            const viscosityPass = encoder.beginComputePass();
            viscosityPass.setPipeline(pipelines.viscosity);
            viscosityPass.setBindGroup(0, pipelines.viscosityBindGroup);
            viscosityPass.dispatchWorkgroups(Math.ceil(buffers.particleCount / this.workgroupSize));
            viscosityPass.end();
        }

        // Integrate
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

    this.hashParamsData[0] = this.config.smoothingRadius;
    this.hashParamsData[1] = buffers.particleCount;
    this.device.queue.writeBuffer(pipelines.uniformBuffers.hash, 0, this.hashParamsData);

    this.sortParamsData[0] = buffers.particleCount;
    this.device.queue.writeBuffer(pipelines.uniformBuffers.sort, 0, this.sortParamsData);

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

    const scatterPass = encoder.beginComputePass();
    scatterPass.setPipeline(pipelines.scatter);
    scatterPass.setBindGroup(0, pipelines.scatterBindGroup);
    scatterPass.dispatchWorkgroups(1);
    scatterPass.end();

    const spatialPass = encoder.beginComputePass();
    spatialPass.setPipeline(pipelines.spatialOffsets);
    spatialPass.setBindGroup(0, pipelines.spatialOffsetsBindGroup);
    spatialPass.dispatchWorkgroups(1);
    spatialPass.end();
  }

  private updateDensityUniforms(): void {
    const radius = this.config.smoothingRadius;
    const spikyPow2 = 15 / (2 * Math.PI * Math.pow(radius, 5));
    const spikyPow3 = 15 / (Math.PI * Math.pow(radius, 6));

    this.densityParamsData[0] = radius;
    this.densityParamsData[1] = spikyPow2;
    this.densityParamsData[2] = spikyPow3;
    this.densityParamsData[3] = this.buffers.particleCount;

    this.device.queue.writeBuffer(this.pipelines.uniformBuffers.density, 0, this.densityParamsData);
  }

  private updatePressureUniforms(timeStep: number): void {
    const radius = this.config.smoothingRadius;
    const spikyPow2Deriv = 15 / (Math.PI * Math.pow(radius, 5));
    const spikyPow3Deriv = 45 / (Math.PI * Math.pow(radius, 6));

    this.pressureParamsData[0] = timeStep;
    this.pressureParamsData[1] = this.config.targetDensity;
    this.pressureParamsData[2] = this.config.pressureMultiplier;
    this.pressureParamsData[3] = this.config.nearPressureMultiplier;
    this.pressureParamsData[4] = radius;
    this.pressureParamsData[5] = spikyPow2Deriv;
    this.pressureParamsData[6] = spikyPow3Deriv;
    this.pressureParamsData[7] = this.buffers.particleCount;

    this.device.queue.writeBuffer(this.pipelines.uniformBuffers.pressure, 0, this.pressureParamsData);
  }

  private updateViscosityUniforms(timeStep: number): void {
    const radius = this.config.smoothingRadius;
    const poly6 = 315 / (64 * Math.PI * Math.pow(radius, 9)); 
    // Unity uses Poly6 for viscosity? Code said "Poly6ScalingFactor".
    // 2D TS used 4 / ...
    // Standard Poly6 is 315/64pi*r^9.
    // Let's stick to what Unity does if possible, but standard is fine.

    this.viscosityParamsData[0] = timeStep;
    this.viscosityParamsData[1] = this.config.viscosityStrength;
    this.viscosityParamsData[2] = radius;
    this.viscosityParamsData[3] = poly6; 
    this.viscosityParamsData[4] = this.buffers.particleCount;

    this.device.queue.writeBuffer(this.pipelines.uniformBuffers.viscosity, 0, this.viscosityParamsData);
  }

  private updateIntegrateUniforms(timeStep: number): void {
    // IntegrateParams: dt, damp, hasObs, pad0, halfBounds(3), pad1, obsCen(3), pad2, obsHalf(3), pad3
    
    this.integrateData[0] = timeStep;
    this.integrateData[1] = this.config.collisionDamping;
    this.integrateData[2] = 0; // hasObstacle (false for now)
    
    const hx = this.config.boundsSize.x * 0.5;
    const hy = this.config.boundsSize.y * 0.5;
    const hz = this.config.boundsSize.z * 0.5;
    
    this.integrateData[4] = hx;
    this.integrateData[5] = hy;
    this.integrateData[6] = hz;
    
    // Obstacle ignored (zeros)
    
    this.device.queue.writeBuffer(this.pipelines.uniformBuffers.integrate, 0, this.integrateData);
  }

  render(): void {
    this.renderer.resize(); // Handle resize dynamically?
    const encoder = this.device.createCommandEncoder();
    this.renderer.render(
      encoder,
      this.context.getCurrentTexture().createView(),
      this.config,
      this.buffers.particleCount
    );
    this.device.queue.submit([encoder.finish()]);
  }
}
