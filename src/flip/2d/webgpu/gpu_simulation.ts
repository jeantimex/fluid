/**
 * GPU Fluid Simulation Orchestrator
 *
 * This module coordinates the execution of compute shaders for the FLIP simulation.
 * Phase 1: Only particle integration runs on GPU, rest stays on CPU.
 */

import { GPUSimulationBuffers, SimulationParams } from './gpu_buffers';
import { GPUComputePipelines } from './gpu_pipelines';

export class GPUFluidSimulation {
  private device: GPUDevice;
  private buffers: GPUSimulationBuffers;
  private pipelines: GPUComputePipelines;
  private params: SimulationParams;

  constructor(device: GPUDevice, params: SimulationParams) {
    this.device = device;
    this.params = params;

    // Create buffers
    this.buffers = new GPUSimulationBuffers(device, params);

    // Create pipelines
    this.pipelines = new GPUComputePipelines(device, this.buffers);

    // Upload initial params
    this.buffers.updateSimParams(params);
  }

  /**
   * Get buffers for external access (e.g., rendering).
   */
  getBuffers(): GPUSimulationBuffers {
    return this.buffers;
  }

  /**
   * Update simulation parameters.
   */
  updateParams(params: Partial<SimulationParams>): void {
    Object.assign(this.params, params);
    this.buffers.updateSimParams(this.params);
  }

  /**
   * Update obstacle parameters.
   */
  updateObstacle(x: number, y: number, vx: number, vy: number, radius: number): void {
    this.buffers.updateObstacleParams(x, y, vx, vy, radius);
  }

  /**
   * Upload particle data from CPU to GPU.
   */
  uploadParticleData(
    positions: Float32Array,
    velocities: Float32Array,
    colors: Float32Array,
    count: number
  ): void {
    this.params.numParticles = count;
    this.buffers.updateSimParams(this.params);
    this.buffers.uploadParticlePos(positions, count);
    this.buffers.uploadParticleVel(velocities, count);
    this.buffers.uploadParticleColor(colors, count);
  }

  /**
   * Upload grid solid flags from CPU.
   */
  uploadGridS(data: Float32Array): void {
    this.buffers.uploadGridS(data);
  }

  /**
   * Run particle integration on GPU.
   * Returns a command encoder that can be submitted or extended with more passes.
   */
  integrate(): GPUCommandEncoder {
    const encoder = this.device.createCommandEncoder();
    const computePass = encoder.beginComputePass();

    computePass.setPipeline(this.pipelines.integratePipeline);
    computePass.setBindGroup(0, this.pipelines.integrateBindGroup);

    const workgroups = Math.ceil(this.params.numParticles / this.pipelines.workgroupSize);
    computePass.dispatchWorkgroups(workgroups);

    computePass.end();

    return encoder;
  }

  /**
   * Run integration and submit immediately.
   */
  runIntegrate(): void {
    const encoder = this.integrate();
    this.device.queue.submit([encoder.finish()]);
  }

  /**
   * Read particle positions back from GPU to CPU.
   * This is async and blocks until data is ready.
   */
  async readParticlePositions(count: number): Promise<Float32Array> {
    const size = count * 2 * 4;

    // Create staging buffer for readback
    const stagingBuffer = this.device.createBuffer({
      size,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });

    // Copy from GPU buffer to staging buffer
    const encoder = this.device.createCommandEncoder();
    encoder.copyBufferToBuffer(this.buffers.particlePos, 0, stagingBuffer, 0, size);
    this.device.queue.submit([encoder.finish()]);

    // Map and read
    await stagingBuffer.mapAsync(GPUMapMode.READ);
    const data = new Float32Array(stagingBuffer.getMappedRange().slice(0));
    stagingBuffer.unmap();
    stagingBuffer.destroy();

    return data;
  }

  /**
   * Read particle velocities back from GPU to CPU.
   */
  async readParticleVelocities(count: number): Promise<Float32Array> {
    const size = count * 2 * 4;

    const stagingBuffer = this.device.createBuffer({
      size,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });

    const encoder = this.device.createCommandEncoder();
    encoder.copyBufferToBuffer(this.buffers.particleVel, 0, stagingBuffer, 0, size);
    this.device.queue.submit([encoder.finish()]);

    await stagingBuffer.mapAsync(GPUMapMode.READ);
    const data = new Float32Array(stagingBuffer.getMappedRange().slice(0));
    stagingBuffer.unmap();
    stagingBuffer.destroy();

    return data;
  }

  /**
   * Clean up resources.
   */
  destroy(): void {
    this.buffers.destroy();
  }
}
