/**
 * Manages all GPU buffers for the fluid simulation.
 */

import type { SpawnData } from '../common/types.ts';

export class SimulationBuffers {
  // Particle data buffers
  positions: GPUBuffer;
  predicted: GPUBuffer;
  velocities: GPUBuffer;
  densities: GPUBuffer;

  // Spatial hash buffers
  keys: GPUBuffer;
  sortedKeys: GPUBuffer;
  indices: GPUBuffer;
  sortOffsets: GPUBuffer;
  spatialOffsets: GPUBuffer;

  // Sorted particle buffers (unused but allocated)
  positionsSorted: GPUBuffer;
  predictedSorted: GPUBuffer;
  velocitiesSorted: GPUBuffer;

  // Readback buffers
  velocityReadback: GPUBuffer;
  densityReadback: GPUBuffer;

  readonly particleCount: number;

  private device: GPUDevice;

  constructor(device: GPUDevice, spawn: SpawnData) {
    this.device = device;
    this.particleCount = spawn.count;

    // Create particle data buffers
    this.positions = this.createBufferFromArray(
      spawn.positions,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    );
    this.predicted = this.createBufferFromArray(
      new Float32Array(spawn.positions),
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    );
    this.velocities = this.createBufferFromArray(
      spawn.velocities,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
    );
    this.densities = this.createEmptyBuffer(
      spawn.count * 2 * 4,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
    );

    // Create spatial hash buffers
    this.keys = this.createEmptyBuffer(
      spawn.count * 4,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    );
    this.sortedKeys = this.createEmptyBuffer(
      spawn.count * 4,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    );
    this.indices = this.createEmptyBuffer(
      spawn.count * 4,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    );
    this.sortOffsets = this.createEmptyBuffer(
      spawn.count * 4,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    );
    this.spatialOffsets = this.createEmptyBuffer(
      spawn.count * 4,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    );

    // Create sorted particle buffers
    this.positionsSorted = this.createEmptyBuffer(
      spawn.count * 2 * 4,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    );
    this.predictedSorted = this.createEmptyBuffer(
      spawn.count * 2 * 4,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    );
    this.velocitiesSorted = this.createEmptyBuffer(
      spawn.count * 2 * 4,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    );

    // Create readback buffers
    this.velocityReadback = device.createBuffer({
      size: spawn.count * 2 * 4,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    this.densityReadback = device.createBuffer({
      size: spawn.count * 2 * 4,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
  }

  private createBufferFromArray(
    data: Float32Array | Uint32Array,
    usage: GPUBufferUsageFlags
  ): GPUBuffer {
    const buffer = this.device.createBuffer({
      size: data.byteLength,
      usage,
      mappedAtCreation: true,
    });
    const mapping =
      data instanceof Float32Array
        ? new Float32Array(buffer.getMappedRange())
        : new Uint32Array(buffer.getMappedRange());
    mapping.set(data);
    buffer.unmap();
    return buffer;
  }

  private createEmptyBuffer(
    byteLength: number,
    usage: GPUBufferUsageFlags
  ): GPUBuffer {
    return this.device.createBuffer({
      size: byteLength,
      usage,
    });
  }

  destroy(): void {
    this.positions.destroy();
    this.predicted.destroy();
    this.velocities.destroy();
    this.densities.destroy();
    this.keys.destroy();
    this.sortedKeys.destroy();
    this.indices.destroy();
    this.sortOffsets.destroy();
    this.spatialOffsets.destroy();
    this.positionsSorted.destroy();
    this.predictedSorted.destroy();
    this.velocitiesSorted.destroy();
    this.velocityReadback.destroy();
    this.densityReadback.destroy();
  }
}
