/**
 * GPU Buffer Management for Fluid Simulation
 *
 * This module manages all GPU buffers used in the SPH (Smoothed Particle
 * Hydrodynamics) fluid simulation. Buffers are GPU memory allocations that
 * store data accessible by shaders during compute and render passes.
 *
 * Buffer categories:
 * 1. Particle Data Buffers - Store position, velocity, and density for each particle
 * 2. Spatial Hash Buffers - Store data structures for efficient neighbor search
 * 3. Sorted Particle Buffers - Store reordered particle data for cache-friendly access
 * 4. Readback Buffers - Allow reading GPU data back to CPU (for debugging/hybrid mode)
 *
 * Memory Layout:
 * - Positions/Velocities: Float32Array with 2 floats per particle (x, y)
 * - Densities: Float32Array with 2 floats per particle (density, near-density)
 * - Keys/Indices: Uint32Array with 1 uint per particle (spatial hash key, original index)
 */

import type { SpawnData } from '../common/types.ts';

/**
 * Manages all GPU buffers required for the fluid simulation.
 *
 * This class encapsulates the creation, initialization, and cleanup of
 * GPU buffers used throughout the simulation pipeline. Buffers are organized
 * by their purpose in the SPH algorithm.
 *
 * @example
 * ```typescript
 * const buffers = new SimulationBuffers(device, spawnData);
 * // Use buffers in bind groups...
 * buffers.destroy(); // Clean up when done
 * ```
 */
export class SimulationBuffers {
  // ============================================================================
  // Particle Data Buffers
  // These store the core per-particle simulation data
  // ============================================================================

  /**
   * Current particle positions in world space.
   * Layout: [x0, y0, x1, y1, ...] - 2 floats per particle
   * Updated by the integration shader after applying forces.
   */
  positions: GPUBuffer;

  /**
   * Predicted particle positions for the current timestep.
   * Layout: [x0, y0, x1, y1, ...] - 2 floats per particle
   * Used for neighbor searches and density calculations before final integration.
   * This allows forces to be calculated based on where particles will be.
   */
  predicted: GPUBuffer;

  /**
   * Particle velocities in world space.
   * Layout: [vx0, vy0, vx1, vy1, ...] - 2 floats per particle
   * Modified by pressure, viscosity, and external force calculations.
   */
  velocities: GPUBuffer;

  /**
   * Particle density values computed from neighbors.
   * Layout: [density0, nearDensity0, density1, nearDensity1, ...] - 2 floats per particle
   * - density: Standard SPH density from neighbors within smoothing radius
   * - nearDensity: Higher-order density for surface tension effects
   */
  densities: GPUBuffer;

  // ============================================================================
  // Spatial Hash Buffers
  // These enable O(n·k) neighbor searches instead of O(n²)
  // ============================================================================

  /**
   * Spatial hash keys for each particle.
   * Each particle's position is hashed to a cell key for spatial lookup.
   * Key = hash(cellX, cellY) where cell = floor(position / smoothingRadius)
   */
  keys: GPUBuffer;

  /**
   * Sorted spatial hash keys.
   * After sorting, particles with the same key are contiguous in memory,
   * enabling efficient iteration over neighbors in the same cell.
   */
  sortedKeys: GPUBuffer;

  /**
   * Original particle indices before sorting.
   * Used to map from sorted order back to original particle data.
   * indices[sortedIndex] = originalIndex
   */
  indices: GPUBuffer;

  /**
   * Temporary offsets used during counting sort.
   * Stores the count of particles in each hash bucket during the sort phase.
   */
  sortOffsets: GPUBuffer;

  /**
   * Start indices for each spatial cell in the sorted arrays.
   * spatialOffsets[key] = first index in sortedKeys where this key appears.
   * Used to quickly find all particles in a neighboring cell.
   */
  spatialOffsets: GPUBuffer;

  // ============================================================================
  // Sorted Particle Buffers
  // These store particle data reordered by spatial hash for cache efficiency
  // ============================================================================

  /**
   * Positions reordered by spatial hash key.
   * Currently allocated but not actively used in the simulation.
   */
  positionsSorted: GPUBuffer;

  /**
   * Predicted positions reordered by spatial hash key.
   * Currently allocated but not actively used in the simulation.
   */
  predictedSorted: GPUBuffer;

  /**
   * Velocities reordered by spatial hash key.
   * Currently allocated but not actively used in the simulation.
   */
  velocitiesSorted: GPUBuffer;

  // ============================================================================
  // Readback Buffers
  // These allow GPU data to be read back to CPU for debugging or hybrid mode
  // ============================================================================

  /**
   * Buffer for reading velocity data back to CPU.
   * Has MAP_READ usage flag to allow mapAsync() calls.
   */
  velocityReadback: GPUBuffer;

  /**
   * Buffer for reading density data back to CPU.
   * Has MAP_READ usage flag to allow mapAsync() calls.
   * Used when useGpuDensityReadback option is enabled.
   */
  densityReadback: GPUBuffer;

  /** Total number of particles in the simulation */
  readonly particleCount: number;

  /** Reference to the GPU device for buffer creation */
  private device: GPUDevice;

  /**
   * Creates all GPU buffers needed for the simulation.
   *
   * @param device - The WebGPU device to create buffers on
   * @param spawn - Initial particle data (positions, velocities, count)
   */
  constructor(device: GPUDevice, spawn: SpawnData) {
    this.device = device;
    this.particleCount = spawn.count;

    // ========================================================================
    // Create particle data buffers
    // ========================================================================

    // Positions buffer - initialized with spawn positions
    // STORAGE: Can be read/written by compute shaders
    // COPY_DST: Can receive data from CPU via writeBuffer()
    this.positions = this.createBufferFromArray(
      spawn.positions,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    );

    // Predicted positions - copy of initial positions
    this.predicted = this.createBufferFromArray(
      new Float32Array(spawn.positions),
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    );

    // Velocities - initialized with spawn velocities
    // COPY_SRC: Can be source for buffer copies (for readback)
    this.velocities = this.createBufferFromArray(
      spawn.velocities,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
    );

    // Densities - 2 floats per particle (density, nearDensity)
    // Size = count * 2 components * 4 bytes per float
    this.densities = this.createEmptyBuffer(
      spawn.count * 2 * 4,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
    );

    // ========================================================================
    // Create spatial hash buffers
    // ========================================================================

    // All spatial hash buffers store 1 uint32 per particle
    // Size = count * 4 bytes per uint32
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

    // ========================================================================
    // Create sorted particle buffers
    // ========================================================================

    // 2 floats per particle (x, y)
    // Size = count * 2 components * 4 bytes per float
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

    // ========================================================================
    // Create readback buffers
    // ========================================================================

    // MAP_READ: Allows the buffer to be mapped for CPU reading
    // COPY_DST: Can receive data copied from other buffers
    this.velocityReadback = device.createBuffer({
      size: spawn.count * 2 * 4,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    this.densityReadback = device.createBuffer({
      size: spawn.count * 2 * 4,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
  }

  /**
   * Creates a GPU buffer initialized with the given typed array data.
   *
   * Uses mappedAtCreation for efficient initialization - the buffer is
   * created in a mapped state, data is copied, then it's unmapped for use.
   *
   * @param data - The typed array data to copy into the buffer
   * @param usage - GPU buffer usage flags
   * @returns The created and initialized GPU buffer
   */
  private createBufferFromArray(
    data: Float32Array | Uint32Array,
    usage: GPUBufferUsageFlags
  ): GPUBuffer {
    const buffer = this.device.createBuffer({
      size: data.byteLength,
      usage,
      mappedAtCreation: true, // Create already mapped for immediate write
    });

    // Create a typed array view into the mapped buffer memory
    const mapping =
      data instanceof Float32Array
        ? new Float32Array(buffer.getMappedRange())
        : new Uint32Array(buffer.getMappedRange());

    // Copy data into the buffer
    mapping.set(data);

    // Unmap to make the buffer usable by the GPU
    buffer.unmap();

    return buffer;
  }

  /**
   * Creates an empty GPU buffer of the specified size.
   *
   * @param byteLength - Size of the buffer in bytes
   * @param usage - GPU buffer usage flags
   * @returns The created GPU buffer (contents are uninitialized)
   */
  private createEmptyBuffer(
    byteLength: number,
    usage: GPUBufferUsageFlags
  ): GPUBuffer {
    return this.device.createBuffer({
      size: byteLength,
      usage,
    });
  }

  /**
   * Destroys all GPU buffers to free GPU memory.
   *
   * Should be called when the simulation is reset or destroyed
   * to prevent memory leaks on the GPU.
   */
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
