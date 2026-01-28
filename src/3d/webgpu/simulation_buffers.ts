/**
 * =============================================================================
 * GPU Buffer Management for 3D SPH Fluid Simulation
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
 * 2. **Spatial Hash & Sorting**
 *    - Hash keys, sorted indices, histogram offsets
 *    - Used for O(1) neighbor lookup
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
 * ## Memory Layout
 *
 * Most buffers use vec4 (16-byte) stride for alignment, even when only
 * 3 components are needed. This wastes some memory but ensures correct
 * alignment for GPU access.
 *
 * ```
 * positions[i]  = (x, y, z, mass/unused)  - 16 bytes
 * velocities[i] = (vx, vy, vz, unused)    - 16 bytes
 * densities[i]  = (density, nearDensity)  - 8 bytes
 * keys[i]       = hashKey                 - 4 bytes
 * ```
 *
 * ## Buffer Usage Flags
 *
 * - STORAGE: Can be read/written by compute shaders
 * - COPY_DST: Can receive data from CPU via writeBuffer
 * - COPY_SRC: Can be copied to readback buffers for debugging
 * - INDIRECT: Can be used as indirect draw arguments
 * - MAP_READ: Can be mapped to CPU for reading (debug only)
 *
 * @module simulation_buffers
 */

import type { SpawnData } from '../common/types.ts';

/**
 * Manages all GPU buffers for the fluid simulation.
 *
 * This class encapsulates buffer creation, initialization, and cleanup.
 * All buffers are created with appropriate usage flags for their purpose
 * in the simulation pipeline.
 */
export class SimulationBuffers {
  // ===========================================================================
  // Particle Data Buffers (Structure of Arrays)
  // ===========================================================================

  /**
   * Particle positions and mass.
   *
   * Layout: vec4<f32> per particle
   * - xyz: Position in world space
   * - w: Mass (currently unused, serves as padding)
   *
   * Usage: Read in most shaders, written by integrate shader
   * Size: particleCount * 16 bytes
   */
  positions: GPUBuffer;

  /**
   * Predicted particle positions for next timestep.
   *
   * Layout: vec4<f32> per particle
   * - xyz: Predicted position
   * - w: Padding
   *
   * Used for spatial hashing to determine where particles *will* be,
   * enabling more stable neighbor lookups during force calculation.
   *
   * Size: particleCount * 16 bytes
   */
  predicted: GPUBuffer;

  /**
   * Particle velocities.
   *
   * Layout: vec4<f32> per particle
   * - xyz: Velocity in units/second
   * - w: Padding
   *
   * Size: particleCount * 16 bytes
   */
  velocities: GPUBuffer;

  /**
   * Particle densities for SPH calculations.
   *
   * Layout: vec2<f32> per particle
   * - x: Standard density (sum of neighbor contributions)
   * - y: Near-density (sharper kernel, prevents clumping)
   *
   * Size: particleCount * 8 bytes
   */
  densities: GPUBuffer;

  // ===========================================================================
  // Spatial Hashing & Sorting Buffers
  // ===========================================================================

  /**
   * Spatial hash keys for each particle.
   *
   * Layout: u32 per particle
   * - Value: Hash of grid cell containing the particle
   *
   * Keys are computed from predicted positions and used to sort
   * particles for cache-coherent neighbor iteration.
   *
   * Size: particleCount * 4 bytes
   */
  keys: GPUBuffer;

  /**
   * Sorted copy of hash keys.
   *
   * Layout: u32 per sorted position
   * - sortedKeys[i] contains the hash key of the particle at sorted position i
   *
   * Used for neighbor search: iterate while sortedKeys[j] == targetKey
   *
   * Size: particleCount * 4 bytes
   */
  sortedKeys: GPUBuffer;

  /**
   * Mapping from sorted position to original particle index.
   *
   * Layout: u32 per sorted position
   * - indices[sortedPos] = originalIndex
   *
   * After sorting, indices[i] tells us which original particle
   * should be at sorted position i. Used for reordering.
   *
   * Size: particleCount * 4 bytes
   */
  indices: GPUBuffer;

  /**
   * Temporary buffer for counting sort / prefix sum.
   *
   * Layout: u32 per particle (double-duty buffer)
   *
   * Usage flow:
   * 1. Clear phase: All zeros
   * 2. Count phase: sortOffsets[key]++ for each particle (histogram)
   * 3. Prefix sum: In-place scan converts histogram to offsets
   * 4. Scatter phase: Atomically increment to get unique write positions
   *
   * Size: particleCount * 4 bytes
   */
  sortOffsets: GPUBuffer;

  /**
   * Grid cell lookup table.
   *
   * Layout: u32 per possible hash key
   * - spatialOffsets[key] = first index in sorted arrays where this key appears
   *
   * Enables O(1) lookup of all particles in a grid cell:
   * ```
   * start = spatialOffsets[key];
   * for (j = start; sortedKeys[j] == key; j++) {
   *   // Process particle at position j
   * }
   * ```
   *
   * Sentinel value (particleCount) indicates no particles have that key.
   *
   * Size: particleCount * 4 bytes
   */
  spatialOffsets: GPUBuffer;

  // ===========================================================================
  // Hierarchical Prefix Sum (Scan) Buffers
  // ===========================================================================
  // The parallel prefix sum algorithm processes data in 512-element blocks.
  // For large particle counts, we need multiple levels of scan.

  /**
   * Level 1 block sums from prefix sum.
   *
   * Layout: u32 per L0 block
   * - groupSumsL1[blockIndex] = sum of all elements in that 512-element block
   *
   * After scanning the main data, each block's total is written here.
   * These sums are then scanned at Level 1 to propagate prefix sums across blocks.
   *
   * Size: ceil(particleCount / 512) * 4 bytes
   */
  groupSumsL1: GPUBuffer;

  /**
   * Level 2 block sums from prefix sum.
   *
   * Layout: u32 per L1 block
   * - groupSumsL2[blockIndex] = sum of 512 L1 block sums
   *
   * For very large particle counts (> 262,144), we need a third level.
   *
   * Size: ceil(blocksL0 / 512) * 4 bytes
   */
  groupSumsL2: GPUBuffer;

  /**
   * Scratch buffer for top-level scan.
   *
   * Layout: Single u32
   * - Used as output for L2 scan (usually not needed for typical particle counts)
   *
   * Size: 4 bytes
   */
  scanScratch: GPUBuffer;

  // ===========================================================================
  // Sorted Physical Data Buffers (Cache Optimization)
  // ===========================================================================
  // These buffers hold physically reordered copies of particle data.
  // After sorting, particles in the same grid cell are contiguous in memory,
  // dramatically improving cache hit rates during neighbor iteration.

  /**
   * Positions reordered to match sorted key order.
   *
   * Layout: vec4<f32> per sorted position
   *
   * positionsSorted[sortedPos] = positions[indices[sortedPos]]
   *
   * Size: particleCount * 16 bytes
   */
  positionsSorted: GPUBuffer;

  /**
   * Predicted positions reordered to match sorted key order.
   *
   * Layout: vec4<f32> per sorted position
   *
   * Size: particleCount * 16 bytes
   */
  predictedSorted: GPUBuffer;

  /**
   * Velocities reordered to match sorted key order.
   *
   * Layout: vec4<f32> per sorted position
   *
   * Size: particleCount * 16 bytes
   */
  velocitiesSorted: GPUBuffer;

  // ===========================================================================
  // Rendering & Culling Buffers
  // ===========================================================================

  /**
   * Indices of particles that passed frustum culling.
   *
   * Layout: u32 per visible particle (compacted)
   * - visibleIndices[0..visibleCount-1] contain indices of visible particles
   *
   * The cull shader atomically increments a counter and writes visible
   * particle indices to this array. The render shader then reads from here.
   *
   * Size: particleCount * 4 bytes (worst case: all visible)
   */
  visibleIndices: GPUBuffer;

  /**
   * Indirect draw arguments for GPU-driven rendering.
   *
   * Layout: GPUDrawIndirectArgs structure
   * ```
   * {
   *   vertexCount: 6,        // 2 triangles per particle quad
   *   instanceCount: 0,      // Atomically incremented by cull shader
   *   firstVertex: 0,
   *   firstInstance: 0
   * }
   * ```
   *
   * The cull shader atomically increments instanceCount for each visible
   * particle. The render pass then uses drawIndirect to render exactly
   * that many instances without CPU-GPU synchronization.
   *
   * Size: 16 bytes (4 u32s)
   */
  indirectDraw: GPUBuffer;

  // ===========================================================================
  // CPU Readback Buffers (Debugging)
  // ===========================================================================
  // These buffers can be mapped to CPU memory for debugging purposes.
  // They're not used during normal simulation.

  /**
   * Velocity readback buffer for debugging.
   *
   * Usage: Copy velocities buffer here, then map to read on CPU.
   *
   * Size: particleCount * 16 bytes
   */
  velocityReadback: GPUBuffer;

  /**
   * Density readback buffer for debugging.
   *
   * Usage: Copy densities buffer here, then map to read on CPU.
   *
   * Size: particleCount * 8 bytes
   */
  densityReadback: GPUBuffer;

  // ===========================================================================
  // Metadata
  // ===========================================================================

  /** Total number of particles in the simulation */
  readonly particleCount: number;

  /** Reference to GPU device for buffer creation */
  private device: GPUDevice;

  // ===========================================================================
  // Constructor
  // ===========================================================================

  /**
   * Creates all GPU buffers for the simulation.
   *
   * @param device - The WebGPU device
   * @param spawn - Initial particle data (positions and velocities)
   */
  constructor(device: GPUDevice, spawn: SpawnData) {
    this.device = device;
    this.particleCount = spawn.count;

    // -------------------------------------------------------------------------
    // Particle Data Buffers
    // -------------------------------------------------------------------------

    // Positions: Initialize with spawn data
    // Stride: 4 floats (16 bytes) per particle - (x, y, z, w)
    this.positions = this.createBufferFromArray(
      spawn.positions,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    );

    // Predicted: Initialize as copy of positions
    this.predicted = this.createBufferFromArray(
      new Float32Array(spawn.positions),
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    );

    // Velocities: Initialize with spawn data
    // COPY_SRC enables copying to readback buffer for debugging
    this.velocities = this.createBufferFromArray(
      spawn.velocities,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
    );

    // Densities: Stride 2 floats (8 bytes) per particle - (density, nearDensity)
    this.densities = this.createEmptyBuffer(
      spawn.count * 2 * 4, // 2 floats * 4 bytes
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
    );

    // -------------------------------------------------------------------------
    // Spatial Hash Buffers (1 u32 = 4 bytes per particle)
    // -------------------------------------------------------------------------

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

    // -------------------------------------------------------------------------
    // Hierarchical Scan Buffers
    // -------------------------------------------------------------------------

    // Calculate block counts for each level
    const blocksL0 = Math.ceil(spawn.count / 512);
    const blocksL1 = Math.ceil(blocksL0 / 512);

    // L1 sums: One u32 per 512-particle block
    this.groupSumsL1 = this.createEmptyBuffer(
      blocksL0 * 4,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    );

    // L2 sums: One u32 per 512 L1 blocks
    this.groupSumsL2 = this.createEmptyBuffer(
      blocksL1 * 4,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    );

    // Scratch: Single u32 for top-level
    this.scanScratch = this.createEmptyBuffer(
      4,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    );

    // -------------------------------------------------------------------------
    // Culling Buffers
    // -------------------------------------------------------------------------

    // Visible indices: Up to particleCount visible particles
    this.visibleIndices = this.createEmptyBuffer(
      spawn.count * 4,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    );

    // Indirect draw: 4 u32s for draw arguments
    // INDIRECT flag enables use with drawIndirect
    this.indirectDraw = this.createEmptyBuffer(
      4 * 4, // 4 u32s * 4 bytes
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.INDIRECT
    );

    // -------------------------------------------------------------------------
    // Sorted Data Buffers (4 floats = 16 bytes per particle)
    // -------------------------------------------------------------------------

    this.positionsSorted = this.createEmptyBuffer(
      spawn.count * 4 * 4,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    );

    this.predictedSorted = this.createEmptyBuffer(
      spawn.count * 4 * 4,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    );

    this.velocitiesSorted = this.createEmptyBuffer(
      spawn.count * 4 * 4,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    );

    // -------------------------------------------------------------------------
    // Readback Buffers (Debug only)
    // -------------------------------------------------------------------------

    // MAP_READ enables mapping to CPU, but prevents GPU writes
    this.velocityReadback = device.createBuffer({
      size: spawn.count * 4 * 4,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });

    this.densityReadback = device.createBuffer({
      size: spawn.count * 2 * 4,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
  }

  // ===========================================================================
  // Buffer Creation Helpers
  // ===========================================================================

  /**
   * Creates a GPU buffer and initializes it with data from a TypedArray.
   *
   * Uses mappedAtCreation for efficient initial data upload without
   * an extra staging buffer copy.
   *
   * @param data - The data to upload to the buffer
   * @param usage - GPU buffer usage flags
   * @returns The created GPU buffer
   */
  private createBufferFromArray(
    data: Float32Array | Uint32Array,
    usage: GPUBufferUsageFlags
  ): GPUBuffer {
    // Create buffer with mapping enabled for immediate write
    const buffer = this.device.createBuffer({
      size: data.byteLength,
      usage,
      mappedAtCreation: true, // Buffer starts mapped for writing
    });

    // Get a TypedArray view of the mapped memory
    const mapping =
      data instanceof Float32Array
        ? new Float32Array(buffer.getMappedRange())
        : new Uint32Array(buffer.getMappedRange());

    // Copy data to GPU memory
    mapping.set(data);

    // Unmap to make buffer available for GPU use
    buffer.unmap();

    return buffer;
  }

  /**
   * Creates an empty GPU buffer of specified size.
   *
   * Buffer contents are undefined until written to.
   *
   * @param byteLength - Size of buffer in bytes
   * @param usage - GPU buffer usage flags
   * @returns The created GPU buffer
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

  // ===========================================================================
  // Cleanup
  // ===========================================================================

  /**
   * Destroys all GPU buffers and releases GPU memory.
   *
   * Must be called when the simulation is reset or destroyed to prevent
   * memory leaks. GPU buffers are not automatically garbage collected.
   */
  destroy(): void {
    // Particle data
    this.positions.destroy();
    this.predicted.destroy();
    this.velocities.destroy();
    this.densities.destroy();

    // Spatial hash
    this.keys.destroy();
    this.sortedKeys.destroy();
    this.indices.destroy();
    this.sortOffsets.destroy();
    this.spatialOffsets.destroy();

    // Prefix sum
    this.groupSumsL1.destroy();
    this.groupSumsL2.destroy();
    this.scanScratch.destroy();

    // Culling
    this.visibleIndices.destroy();
    this.indirectDraw.destroy();

    // Sorted data
    this.positionsSorted.destroy();
    this.predictedSorted.destroy();
    this.velocitiesSorted.destroy();

    // Readback
    this.velocityReadback.destroy();
    this.densityReadback.destroy();
  }
}
