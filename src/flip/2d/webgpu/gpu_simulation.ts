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
   * Upload grid density from CPU.
   */
  uploadGridDensity(data: Float32Array): void {
    this.buffers.uploadGridDensity(data);
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
   * Run particle color update on GPU.
   */
  runUpdateColors(): void {
    const encoder = this.device.createCommandEncoder();
    const computePass = encoder.beginComputePass();

    computePass.setPipeline(this.pipelines.updateColorsPipeline);
    computePass.setBindGroup(0, this.pipelines.updateColorsBindGroup);

    const workgroups = Math.ceil(this.params.numParticles / this.pipelines.workgroupSize);
    computePass.dispatchWorkgroups(workgroups);

    computePass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  /**
   * Run particle collision handling on GPU.
   */
  runCollisions(): void {
    const encoder = this.device.createCommandEncoder();
    const computePass = encoder.beginComputePass();

    computePass.setPipeline(this.pipelines.collisionsPipeline);
    computePass.setBindGroup(0, this.pipelines.collisionsBindGroup);

    const workgroups = Math.ceil(this.params.numParticles / this.pipelines.workgroupSize);
    computePass.dispatchWorkgroups(workgroups);

    computePass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  /**
   * Run G2P (Grid to Particle) velocity transfer on GPU.
   */
  runG2P(): void {
    const encoder = this.device.createCommandEncoder();
    const computePass = encoder.beginComputePass();

    computePass.setPipeline(this.pipelines.g2pPipeline);
    computePass.setBindGroup(0, this.pipelines.g2pBindGroup);

    const workgroups = Math.ceil(this.params.numParticles / this.pipelines.workgroupSize);
    computePass.dispatchWorkgroups(workgroups);

    computePass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  /**
   * Upload grid data needed for G2P transfer.
   */
  uploadGridDataForG2P(
    u: Float32Array,
    v: Float32Array,
    prevU: Float32Array,
    prevV: Float32Array,
    cellType: Int32Array
  ): void {
    this.buffers.uploadGridU(u);
    this.buffers.uploadGridV(v);
    this.buffers.uploadPrevU(prevU);
    this.buffers.uploadPrevV(prevV);
    this.buffers.uploadCellType(cellType);
  }

  /**
   * Clear cell count buffer (needed before counting).
   */
  clearCellCount(): void {
    const zeros = new Uint32Array(this.params.pNumCells);
    this.device.queue.writeBuffer(this.buffers.cellCount, 0, zeros);
  }

  /**
   * Clear density accumulation buffer.
   */
  clearDensityBuffer(): void {
    const zeros = new Int32Array(this.params.fNumCells);
    this.device.queue.writeBuffer(this.buffers.densityAccum, 0, zeros);
  }

  /**
   * Run density computation on GPU.
   */
  runDensity(): void {
    // Clear density accumulation buffer
    this.clearDensityBuffer();

    const encoder = this.device.createCommandEncoder();

    // Step 1: Accumulate density from particles
    {
      const pass = encoder.beginComputePass();
      pass.setPipeline(this.pipelines.densityPipeline);
      pass.setBindGroup(0, this.pipelines.densityBindGroup);
      pass.dispatchWorkgroups(Math.ceil(this.params.numParticles / this.pipelines.workgroupSize));
      pass.end();
    }

    // Step 2: Normalize density (convert from fixed-point to float)
    {
      const pass = encoder.beginComputePass();
      pass.setPipeline(this.pipelines.normalizeDensityPipeline);
      pass.setBindGroup(0, this.pipelines.normalizeDensityBindGroup);
      pass.dispatchWorkgroups(Math.ceil(this.params.fNumCells / this.pipelines.workgroupSize));
      pass.end();
    }

    this.device.queue.submit([encoder.finish()]);
  }

  /**
   * Read density values back from GPU to CPU.
   */
  async readDensity(): Promise<Float32Array> {
    const size = this.params.fNumCells * 4;

    const stagingBuffer = this.device.createBuffer({
      size,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });

    const encoder = this.device.createCommandEncoder();
    encoder.copyBufferToBuffer(this.buffers.gridDensity, 0, stagingBuffer, 0, size);
    this.device.queue.submit([encoder.finish()]);

    await stagingBuffer.mapAsync(GPUMapMode.READ);
    const data = new Float32Array(stagingBuffer.getMappedRange().slice(0));
    stagingBuffer.unmap();
    stagingBuffer.destroy();

    return data;
  }

  /**
   * Clear atomic accumulation buffers (needed before P2G).
   */
  clearP2GBuffers(): void {
    const zeros = new Int32Array(this.params.fNumCells);
    this.device.queue.writeBuffer(this.buffers.gridUAccum, 0, zeros);
    this.device.queue.writeBuffer(this.buffers.gridVAccum, 0, zeros);
    this.device.queue.writeBuffer(this.buffers.gridDUAccum, 0, zeros);
    this.device.queue.writeBuffer(this.buffers.gridDVAccum, 0, zeros);
  }

  /**
   * Run P2G (Particle to Grid) transfer on GPU.
   * This includes: clear grid, mark cells, P2G transfer, normalize.
   */
  runP2G(): void {
    // Clear atomic accumulation buffers
    this.clearP2GBuffers();

    const encoder = this.device.createCommandEncoder();

    // Step 1: Clear grid velocities and copy to prev
    {
      const pass = encoder.beginComputePass();
      pass.setPipeline(this.pipelines.clearGridPipeline);
      pass.setBindGroup(0, this.pipelines.clearGridBindGroup);
      pass.dispatchWorkgroups(Math.ceil(this.params.fNumCells / this.pipelines.workgroupSize));
      pass.end();
    }

    // Step 2: Mark cells as SOLID/AIR based on solid flag
    {
      const pass = encoder.beginComputePass();
      pass.setPipeline(this.pipelines.markCellsPipeline);
      pass.setBindGroup(0, this.pipelines.markCellsBindGroup);
      pass.dispatchWorkgroups(Math.ceil(this.params.fNumCells / this.pipelines.workgroupSize));
      pass.end();
    }

    // Step 3: Mark cells as FLUID based on particle positions
    {
      const pass = encoder.beginComputePass();
      pass.setPipeline(this.pipelines.markFluidPipeline);
      pass.setBindGroup(0, this.pipelines.markFluidBindGroup);
      pass.dispatchWorkgroups(Math.ceil(this.params.numParticles / this.pipelines.workgroupSize));
      pass.end();
    }

    // Step 4: P2G atomic accumulation
    {
      const pass = encoder.beginComputePass();
      pass.setPipeline(this.pipelines.p2gPipeline);
      pass.setBindGroup(0, this.pipelines.p2gBindGroup);
      pass.dispatchWorkgroups(Math.ceil(this.params.numParticles / this.pipelines.workgroupSize));
      pass.end();
    }

    // Step 5: Normalize grid velocities
    {
      const pass = encoder.beginComputePass();
      pass.setPipeline(this.pipelines.normalizeGridPipeline);
      pass.setBindGroup(0, this.pipelines.normalizeGridBindGroup);
      pass.dispatchWorkgroups(Math.ceil(this.params.fNumCells / this.pipelines.workgroupSize));
      pass.end();
    }

    this.device.queue.submit([encoder.finish()]);
  }

  /**
   * Run spatial hash computation (hash + count + prefix sum + reorder).
   */
  runSpatialHash(): void {
    // Clear cell counts
    this.clearCellCount();

    const encoder = this.device.createCommandEncoder();

    // Step 1: Compute hash keys
    {
      const pass = encoder.beginComputePass();
      pass.setPipeline(this.pipelines.hashPipeline);
      pass.setBindGroup(0, this.pipelines.hashBindGroup);
      pass.dispatchWorkgroups(Math.ceil(this.params.numParticles / this.pipelines.workgroupSize));
      pass.end();
    }

    // Step 2: Count particles per cell
    {
      const pass = encoder.beginComputePass();
      pass.setPipeline(this.pipelines.countPipeline);
      pass.setBindGroup(0, this.pipelines.countBindGroup);
      pass.dispatchWorkgroups(Math.ceil(this.params.numParticles / this.pipelines.workgroupSize));
      pass.end();
    }

    // Step 3: Prefix sum (single workgroup)
    {
      const pass = encoder.beginComputePass();
      pass.setPipeline(this.pipelines.prefixSumPipeline);
      pass.setBindGroup(0, this.pipelines.prefixSumBindGroup);
      pass.dispatchWorkgroups(1);
      pass.end();
    }

    // Step 4: Reorder particles
    {
      const pass = encoder.beginComputePass();
      pass.setPipeline(this.pipelines.reorderPipeline);
      pass.setBindGroup(0, this.pipelines.reorderBindGroup);
      pass.dispatchWorkgroups(Math.ceil(this.params.numParticles / this.pipelines.workgroupSize));
      pass.end();
    }

    this.device.queue.submit([encoder.finish()]);

    // Re-run prefix sum to restore offsets (reorder modified them)
    const encoder2 = this.device.createCommandEncoder();
    {
      const pass = encoder2.beginComputePass();
      pass.setPipeline(this.pipelines.prefixSumPipeline);
      pass.setBindGroup(0, this.pipelines.prefixSumBindGroup);
      pass.dispatchWorkgroups(1);
      pass.end();
    }
    this.device.queue.submit([encoder2.finish()]);
  }

  /**
   * Run push particles apart on GPU.
   */
  runPushApart(): void {
    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginComputePass();

    pass.setPipeline(this.pipelines.pushApartPipeline);
    pass.setBindGroup(0, this.pipelines.pushApartBindGroup);
    pass.dispatchWorkgroups(Math.ceil(this.params.numParticles / this.pipelines.workgroupSize));

    pass.end();
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
   * Read particle colors back from GPU to CPU (RGBA format).
   */
  async readParticleColors(count: number): Promise<Float32Array> {
    const size = count * 4 * 4; // vec4<f32> per particle

    const stagingBuffer = this.device.createBuffer({
      size,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });

    const encoder = this.device.createCommandEncoder();
    encoder.copyBufferToBuffer(this.buffers.particleColor, 0, stagingBuffer, 0, size);
    this.device.queue.submit([encoder.finish()]);

    await stagingBuffer.mapAsync(GPUMapMode.READ);
    const data = new Float32Array(stagingBuffer.getMappedRange().slice(0));
    stagingBuffer.unmap();
    stagingBuffer.destroy();

    return data;
  }

  /**
   * Read grid U velocities back from GPU to CPU.
   */
  async readGridU(): Promise<Float32Array> {
    const size = this.params.fNumCells * 4;

    const stagingBuffer = this.device.createBuffer({
      size,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });

    const encoder = this.device.createCommandEncoder();
    encoder.copyBufferToBuffer(this.buffers.gridU, 0, stagingBuffer, 0, size);
    this.device.queue.submit([encoder.finish()]);

    await stagingBuffer.mapAsync(GPUMapMode.READ);
    const data = new Float32Array(stagingBuffer.getMappedRange().slice(0));
    stagingBuffer.unmap();
    stagingBuffer.destroy();

    return data;
  }

  /**
   * Read grid V velocities back from GPU to CPU.
   */
  async readGridV(): Promise<Float32Array> {
    const size = this.params.fNumCells * 4;

    const stagingBuffer = this.device.createBuffer({
      size,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });

    const encoder = this.device.createCommandEncoder();
    encoder.copyBufferToBuffer(this.buffers.gridV, 0, stagingBuffer, 0, size);
    this.device.queue.submit([encoder.finish()]);

    await stagingBuffer.mapAsync(GPUMapMode.READ);
    const data = new Float32Array(stagingBuffer.getMappedRange().slice(0));
    stagingBuffer.unmap();
    stagingBuffer.destroy();

    return data;
  }

  /**
   * Read cell types back from GPU to CPU.
   */
  async readCellType(): Promise<Int32Array> {
    const size = this.params.fNumCells * 4;

    const stagingBuffer = this.device.createBuffer({
      size,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });

    const encoder = this.device.createCommandEncoder();
    encoder.copyBufferToBuffer(this.buffers.gridCellType, 0, stagingBuffer, 0, size);
    this.device.queue.submit([encoder.finish()]);

    await stagingBuffer.mapAsync(GPUMapMode.READ);
    const data = new Int32Array(stagingBuffer.getMappedRange().slice(0));
    stagingBuffer.unmap();
    stagingBuffer.destroy();

    return data;
  }

  /**
   * Read previous U velocities back from GPU to CPU.
   */
  async readPrevU(): Promise<Float32Array> {
    const size = this.params.fNumCells * 4;

    const stagingBuffer = this.device.createBuffer({
      size,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });

    const encoder = this.device.createCommandEncoder();
    encoder.copyBufferToBuffer(this.buffers.gridPrevU, 0, stagingBuffer, 0, size);
    this.device.queue.submit([encoder.finish()]);

    await stagingBuffer.mapAsync(GPUMapMode.READ);
    const data = new Float32Array(stagingBuffer.getMappedRange().slice(0));
    stagingBuffer.unmap();
    stagingBuffer.destroy();

    return data;
  }

  /**
   * Read previous V velocities back from GPU to CPU.
   */
  async readPrevV(): Promise<Float32Array> {
    const size = this.params.fNumCells * 4;

    const stagingBuffer = this.device.createBuffer({
      size,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });

    const encoder = this.device.createCommandEncoder();
    encoder.copyBufferToBuffer(this.buffers.gridPrevV, 0, stagingBuffer, 0, size);
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
