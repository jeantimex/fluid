import type { SpawnData } from './types.ts';

/**
 * Options for FluidBuffers allocation.
 */
export interface FluidBuffersOptions {
  /** Total number of cells in the linear grid (if using linear mode). */
  gridTotalCells?: number;
  /** Whether to allocate foam particle buffers. */
  includeFoam?: boolean;
  /** Maximum number of foam particles (defaults to 1,280,000). */
  maxFoamParticles?: number;
}

/**
 * Unified GPU buffer management for 3D SPH Fluid Simulation.
 * Supports both standard Spatial Hashing and Linear Grid modes.
 */
export class FluidBuffers {
  // --- Core Particle Data (SoA) ---
  positions: GPUBuffer;
  predicted: GPUBuffer;
  velocities: GPUBuffer;
  densities: GPUBuffer;

  // --- Spatial Hashing / Sorting ---
  keys: GPUBuffer;
  indices: GPUBuffer;
  sortOffsets: GPUBuffer;
  
  // Linear Grid specific
  particleCellOffsets: GPUBuffer | null = null;
  // Standard specific
  spatialOffsets: GPUBuffer | null = null;
  sortedKeys: GPUBuffer | null = null;

  // --- Hierarchical Prefix Sum ---
  groupSumsL1: GPUBuffer;
  groupSumsL2: GPUBuffer;
  scanScratch: GPUBuffer;

  // --- Sorted Physical Data (Cache optimization) ---
  positionsSorted: GPUBuffer;
  predictedSorted: GPUBuffer;
  velocitiesSorted: GPUBuffer;

  // --- Rendering & Culling ---
  visibleIndices: GPUBuffer;
  indirectDraw: GPUBuffer;

  // --- Optional Foam System ---
  foamPositions: GPUBuffer | null = null;
  foamVelocities: GPUBuffer | null = null;
  foamCounter: GPUBuffer | null = null;

  // --- Readback (Debug) ---
  velocityReadback: GPUBuffer;
  densityReadback: GPUBuffer;

  readonly particleCount: number;
  private device: GPUDevice;

  constructor(device: GPUDevice, spawn: SpawnData, options: FluidBuffersOptions = {}) {
    this.device = device;
    this.particleCount = spawn.count;

    const { gridTotalCells, includeFoam, maxFoamParticles = 1_280_000 } = options;

    // 1. Core Particle Data
    this.positions = this.createBufferFromArray(spawn.positions, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
    this.predicted = this.createBufferFromArray(new Float32Array(spawn.positions), GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
    this.velocities = this.createBufferFromArray(spawn.velocities, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC);
    this.densities = this.createEmptyBuffer(spawn.count * 2 * 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC);

    // 2. Spatial Hashing / Sorting
    this.keys = this.createEmptyBuffer(spawn.count * 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
    this.indices = this.createEmptyBuffer(spawn.count * 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
    
    if (gridTotalCells !== undefined) {
      // Linear Grid Mode
      this.particleCellOffsets = this.createEmptyBuffer(spawn.count * 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
      this.sortOffsets = this.createEmptyBuffer((gridTotalCells + 1) * 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
      
      const blocksL0 = Math.ceil((gridTotalCells + 1) / 512);
      const blocksL1 = Math.ceil(blocksL0 / 512);
      this.groupSumsL1 = this.createEmptyBuffer(blocksL0 * 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
      this.groupSumsL2 = this.createEmptyBuffer(blocksL1 * 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
    } else {
      // Standard Spatial Hash Mode
      this.sortOffsets = this.createEmptyBuffer(spawn.count * 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
      this.spatialOffsets = this.createEmptyBuffer(spawn.count * 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
      this.sortedKeys = this.createEmptyBuffer(spawn.count * 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
      
      const blocksL0 = Math.ceil(spawn.count / 512);
      const blocksL1 = Math.ceil(blocksL0 / 512);
      this.groupSumsL1 = this.createEmptyBuffer(blocksL0 * 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
      this.groupSumsL2 = this.createEmptyBuffer(blocksL1 * 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
    }
    this.scanScratch = this.createEmptyBuffer(4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);

    // 3. Sorted Physical Data
    this.positionsSorted = this.createEmptyBuffer(spawn.count * 16, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
    this.predictedSorted = this.createEmptyBuffer(spawn.count * 16, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
    this.velocitiesSorted = this.createEmptyBuffer(spawn.count * 16, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);

    // 4. Rendering & Culling
    this.visibleIndices = this.createEmptyBuffer(spawn.count * 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
    this.indirectDraw = this.createEmptyBuffer(16, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.INDIRECT);

    // 5. Optional Foam
    if (includeFoam) {
      this.foamPositions = this.createEmptyBuffer(maxFoamParticles * 16, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
      this.foamVelocities = this.createEmptyBuffer(maxFoamParticles * 16, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
      this.foamCounter = this.createEmptyBuffer(4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
    }

    // 6. Readback
    this.velocityReadback = device.createBuffer({ size: spawn.count * 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    this.densityReadback = device.createBuffer({ size: spawn.count * 8, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  }

  private createBufferFromArray(data: Float32Array | Uint32Array, usage: GPUBufferUsageFlags): GPUBuffer {
    const buffer = this.device.createBuffer({ size: data.byteLength, usage, mappedAtCreation: true });
    const mapping = data instanceof Float32Array ? new Float32Array(buffer.getMappedRange()) : new Uint32Array(buffer.getMappedRange());
    mapping.set(data);
    buffer.unmap();
    return buffer;
  }

  private createEmptyBuffer(byteLength: number, usage: GPUBufferUsageFlags): GPUBuffer {
    return this.device.createBuffer({ size: byteLength, usage });
  }

  destroy(): void {
    this.positions.destroy();
    this.predicted.destroy();
    this.velocities.destroy();
    this.densities.destroy();
    this.keys.destroy();
    this.indices.destroy();
    this.sortOffsets.destroy();
    this.groupSumsL1.destroy();
    this.groupSumsL2.destroy();
    this.scanScratch.destroy();
    this.positionsSorted.destroy();
    this.predictedSorted.destroy();
    this.velocitiesSorted.destroy();
    this.visibleIndices.destroy();
    this.indirectDraw.destroy();
    this.velocityReadback.destroy();
    this.densityReadback.destroy();

    this.particleCellOffsets?.destroy();
    this.spatialOffsets?.destroy();
    this.sortedKeys?.destroy();
    this.foamPositions?.destroy();
    this.foamVelocities?.destroy();
    this.foamCounter?.destroy();
  }
}
