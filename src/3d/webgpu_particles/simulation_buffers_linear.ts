/**
 * =============================================================================
 * GPU Buffer Management for 3D SPH Fluid Simulation (Linear Grid)
 * =============================================================================
 *
 * This module manages the lifecycle of all GPU buffers used in the simulation.
 * It handles allocation, initialization, and cleanup of GPU memory.
 *
 * ## Buffer Categories
 *
 * 1. **Particle Data** (Structure of Arrays layout)
 *    - Positions, velocities, predicted positions, densities
 *    - Stored as SoA for GPU-friendly memory access patterns
 *
 * 2. **Linear Grid & Sorting**
 *    - Hash keys (grid indices), sorted indices, cell start offsets
 *    - Used for O(1) neighbor lookup via Linear Grid Indexing
 *
 * 3. **Hierarchical Prefix Sum**
 *    - L1/L2 block sums for parallel scan algorithm
 *    - Enables sorting of arbitrary particle counts
 *
 * 4. **Sorted Physical Data** (Cache Optimization)
 *    - Physically reordered copies of particle data
 *    - Critical for cache-coherent neighbor iteration
 *
 * 5. **Rendering & Culling**
 *    - Visible particle indices from frustum culling
 *    - Indirect draw arguments for GPU-driven rendering
 *
 * @module simulation_buffers_linear
 */

import type { SpawnData } from '../common/types.ts';

/**
 * Manages all GPU buffers for the fluid simulation using Linear Grid.
 */
export class SimulationBuffersLinear {
  // ===========================================================================
  // Particle Data Buffers (Structure of Arrays)
  // ===========================================================================

  /**
   * Current particle positions.
   * Layout: vec4<f32> per particle (xyz = position, w = 1.0).
   * Size: particleCount × 16 bytes.
   */
  positions: GPUBuffer;

  /**
   * Predicted particle positions (for spatial hashing / neighbor search).
   * Computed as: position + velocity × predictionFactor.
   * Layout: vec4<f32> per particle (xyz = predicted position, w = 1.0).
   */
  predicted: GPUBuffer;

  /**
   * Particle velocities.
   * Layout: vec4<f32> per particle (xyz = velocity, w = 0.0).
   * Updated by external forces, pressure, viscosity, and collision response.
   */
  velocities: GPUBuffer;

  /**
   * Per-particle density values (standard + near-density).
   * Layout: vec2<f32> per particle (x = density, y = nearDensity).
   * Size: particleCount × 2 × 4 bytes.
   */
  densities: GPUBuffer;

  // ===========================================================================
  // Linear Grid & Sorting Buffers
  // ===========================================================================

  /**
   * Linear grid indices for each particle.
   * Layout: u32 per particle
   */
  keys: GPUBuffer;

  /**
   * Mapping from sorted position to original particle index.
   * indices[sortedPos] = originalIndex
   */
  indices: GPUBuffer;

  /**
   * Stores the "local rank" of a particle within its cell.
   * Computed during the Count phase using atomicAdd.
   */
  particleCellOffsets: GPUBuffer;

  /**
   * Grid cell start offsets (Histogram / Prefix Sum).
   * 
   * Layout: u32 per grid cell
   * Size: (gridTotalCells + 1) * 4 bytes
   *
   * Usage:
   * 1. Clear phase: All zeros
   * 2. Count phase: sortOffsets[key]++ (histogram of particles per cell)
   * 3. Prefix sum: In-place scan converts counts to start offsets
   * 4. Neighbor search: Used to find start/end of cells
   */
  sortOffsets: GPUBuffer;

  // ===========================================================================
  // Hierarchical Prefix Sum Buffers
  // ===========================================================================

  /**
   * Level-1 block sums for the Blelloch prefix scan.
   * Each element stores the total of one 512-element block from the L0 scan.
   * Size: ceil((gridTotalCells + 1) / 512) × 4 bytes.
   */
  groupSumsL1: GPUBuffer;

  /**
   * Level-2 block sums for the Blelloch prefix scan.
   * Each element stores the total of one 512-element block from the L1 scan.
   * Size: ceil(blocksL0 / 512) × 4 bytes.
   */
  groupSumsL2: GPUBuffer;

  /**
   * Scratch buffer for the top level of the prefix-sum hierarchy.
   * Only needed when the grid requires a third scan level.
   * Size: 4 bytes (single u32).
   */
  scanScratch: GPUBuffer;

  // ===========================================================================
  // Sorted Physical Data Buffers (Cache Optimisation)
  // ===========================================================================

  /**
   * Spatially-reordered copy of positions.
   * After the reorder pass, particles in the same grid cell are contiguous,
   * enabling cache-efficient neighbor iteration.
   * Layout: vec4<f32> per particle.
   */
  positionsSorted: GPUBuffer;

  /**
   * Spatially-reordered copy of predicted positions.
   * Layout: vec4<f32> per particle.
   */
  predictedSorted: GPUBuffer;

  /**
   * Spatially-reordered copy of velocities.
   * Layout: vec4<f32> per particle.
   */
  velocitiesSorted: GPUBuffer;

  // ===========================================================================
  // Rendering & Culling Buffers
  // ===========================================================================

  /**
   * Compact list of particle indices that passed the frustum cull test.
   * Written by the cull shader, read by the particle vertex shader via
   * `visibleIndices[instance_index]`.
   * Layout: u32 per visible particle.  Size: particleCount × 4 bytes (worst case).
   */
  visibleIndices: GPUBuffer;

  /**
   * Indirect draw argument buffer for `drawIndirect()`.
   * Layout matches `GPUDrawIndirectArgs`:
   *   [vertexCount=6, instanceCount, firstVertex=0, firstInstance=0].
   * `instanceCount` is written atomically by the cull shader.
   */
  indirectDraw: GPUBuffer;

  // ===========================================================================
  // Readback Buffers (CPU Debugging / Visualisation)
  // ===========================================================================

  /**
   * MAP_READ staging buffer for copying velocity data back to the CPU.
   * Size: particleCount × 16 bytes (vec4<f32> per particle).
   */
  velocityReadback: GPUBuffer;

  /**
   * MAP_READ staging buffer for copying density data back to the CPU.
   * Size: particleCount × 8 bytes (vec2<f32> per particle).
   */
  densityReadback: GPUBuffer;

  // ===========================================================================
  // Metadata
  // ===========================================================================

  /** Total number of particles allocated in the current simulation run. */
  readonly particleCount: number;

  /** GPU device handle for buffer creation. */
  private device: GPUDevice;

  /**
   * Allocates and optionally initialises all GPU buffers.
   *
   * Particle data buffers (positions, velocities) are initialised from the
   * spawn data. Sorting and prefix-sum buffers are sized according to
   * `gridTotalCells`. Readback buffers are created with `MAP_READ` usage
   * for optional CPU-side inspection.
   *
   * @param device         - WebGPU device for buffer creation
   * @param spawn          - Initial particle positions, velocities, and count
   * @param gridTotalCells - Total number of cells in the linear grid
   */
  constructor(device: GPUDevice, spawn: SpawnData, gridTotalCells: number) {
    this.device = device;
    this.particleCount = spawn.count;

    // Particle Data
    this.positions = this.createBufferFromArray(spawn.positions, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
    this.predicted = this.createBufferFromArray(new Float32Array(spawn.positions), GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
    this.velocities = this.createBufferFromArray(spawn.velocities, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC);
    this.densities = this.createEmptyBuffer(spawn.count * 2 * 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC);

    // Linear Grid & Sorting
    this.keys = this.createEmptyBuffer(spawn.count * 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
    this.indices = this.createEmptyBuffer(spawn.count * 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
    this.particleCellOffsets = this.createEmptyBuffer(spawn.count * 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
    
    // sortOffsets covers all cells + 1 sentinel
    this.sortOffsets = this.createEmptyBuffer((gridTotalCells + 1) * 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);

    // Scan Buffers (Sized for gridTotalCells, not particleCount, because we scan the histogram)
    // We scan the sortOffsets array which has size gridTotalCells.
    const blocksL0 = Math.ceil((gridTotalCells + 1) / 512); // +1 for safety with sentinel
    const blocksL1 = Math.ceil(blocksL0 / 512);

    this.groupSumsL1 = this.createEmptyBuffer(blocksL0 * 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
    this.groupSumsL2 = this.createEmptyBuffer(blocksL1 * 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
    this.scanScratch = this.createEmptyBuffer(4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);

    // Culling
    this.visibleIndices = this.createEmptyBuffer(spawn.count * 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
    this.indirectDraw = this.createEmptyBuffer(4 * 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.INDIRECT);

    // Sorted Data
    this.positionsSorted = this.createEmptyBuffer(spawn.count * 4 * 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
    this.predictedSorted = this.createEmptyBuffer(spawn.count * 4 * 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
    this.velocitiesSorted = this.createEmptyBuffer(spawn.count * 4 * 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);

    // Readback
    this.velocityReadback = device.createBuffer({ size: spawn.count * 4 * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    this.densityReadback = device.createBuffer({ size: spawn.count * 2 * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  }

  /**
   * Creates a GPU buffer and immediately uploads the given typed array.
   *
   * Uses `mappedAtCreation: true` to avoid a staging buffer — the data is
   * copied directly into the mapped range and then unmapped.
   *
   * @param data  - Source data to upload
   * @param usage - GPUBufferUsage flags (e.g. STORAGE | COPY_DST)
   * @returns The newly created and populated GPU buffer
   */
  private createBufferFromArray(data: Float32Array | Uint32Array, usage: GPUBufferUsageFlags): GPUBuffer {
    const buffer = this.device.createBuffer({ size: data.byteLength, usage, mappedAtCreation: true });
    const mapping = data instanceof Float32Array ? new Float32Array(buffer.getMappedRange()) : new Uint32Array(buffer.getMappedRange());
    mapping.set(data);
    buffer.unmap();
    return buffer;
  }

  /**
   * Creates a zero-initialised GPU buffer of the given size.
   *
   * @param byteLength - Buffer size in bytes
   * @param usage      - GPUBufferUsage flags
   * @returns The newly created GPU buffer
   */
  private createEmptyBuffer(byteLength: number, usage: GPUBufferUsageFlags): GPUBuffer {
    return this.device.createBuffer({ size: byteLength, usage });
  }

  /** Releases all GPU buffer resources. Called on simulation reset. */
  destroy(): void {
    this.positions.destroy();
    this.predicted.destroy();
    this.velocities.destroy();
    this.densities.destroy();
    this.keys.destroy();
    this.indices.destroy();
    this.particleCellOffsets.destroy();
    this.sortOffsets.destroy();
    this.groupSumsL1.destroy();
    this.groupSumsL2.destroy();
    this.scanScratch.destroy();
    this.visibleIndices.destroy();
    this.indirectDraw.destroy();
    this.positionsSorted.destroy();
    this.predictedSorted.destroy();
    this.velocitiesSorted.destroy();
    this.velocityReadback.destroy();
    this.densityReadback.destroy();
  }
}