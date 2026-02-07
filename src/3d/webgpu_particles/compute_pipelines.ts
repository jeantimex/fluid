/**
 * =============================================================================
 * Compute Pipeline Management for 3D SPH Fluid Simulation
 * =============================================================================
 *
 * This module manages all GPU compute pipelines used in the 3D simulation.
 * It orchestrates a complex parallel pipeline that includes physics calculations,
 * spatial data structures, and rendering preparation.
 *
 * ## Pipeline Categories
 *
 * ### 1. Physics Pipelines
 * - **External Forces**: Gravity, user interaction, position prediction
 * - **Density**: SPH density calculation with neighbor search
 * - **Pressure**: Pressure force from density gradients
 * - **Viscosity**: Velocity smoothing between neighbors
 * - **Integrate**: Position update and collision handling
 *
 * ### 2. Spatial Hash & Sort Pipelines
 * - **Hash**: Compute spatial hash key for each particle
 * - **Clear/Count**: Build histogram of particles per cell
 * - **Prefix Sum**: Parallel scan (Blelloch algorithm) in 3 levels
 * - **Scatter**: Place particles in sorted positions
 * - **Spatial Offsets**: Build cell → start index lookup table
 *
 * ### 3. Data Management Pipelines
 * - **Reorder**: Physically rearrange particle data for cache efficiency
 * - **CopyBack**: Copy sorted data back to main buffers
 *
 * ### 4. Rendering Pipelines
 * - **Cull**: GPU frustum culling for efficient rendering
 *
 * ## Execution Order
 *
 * ```
 * Per Substep:
 *   1. External Forces
 *   2. Hash → Clear → Count → PrefixSum (L0,L1,L2) → Combine (L1,L0) → Scatter
 *   3. Spatial Offsets (Init + Calculate)
 *   4. Reorder → CopyBack
 *   5. Density
 *   6. Pressure
 *   7. Viscosity (optional)
 *   8. Integrate
 *
 * Per Frame:
 *   9. Cull
 *   10. Render (handled by Renderer class)
 * ```
 *
 * ## Bind Group Organization
 *
 * Each pipeline has an associated bind group that connects it to the
 * appropriate GPU buffers. Bind groups are recreated when buffers change
 * (e.g., on simulation reset).
 *
 * @module compute_pipelines
 */

import type { SimulationBuffers } from './simulation_buffers.ts';

// Import shader source code as raw strings (Vite feature)
import externalForcesShader from '../common/shaders/external_forces.wgsl?raw';
import hashShader from '../common/shaders/hash.wgsl?raw';
import sortShader from '../common/shaders/sort.wgsl?raw';
import scatterShader from '../common/shaders/scatter.wgsl?raw';
import spatialOffsetsShader from '../common/shaders/spatial_offsets.wgsl?raw';
import densityShader from '../common/shaders/density.wgsl?raw';
import pressureShader from '../common/shaders/pressure.wgsl?raw';
import viscosityShader from '../common/shaders/viscosity.wgsl?raw';
import integrateShader from './shaders/integrate.wgsl?raw';
import prefixSumShader from '../common/shaders/prefix_sum.wgsl?raw';
import reorderShader from '../common/shaders/reorder.wgsl?raw';
import cullShader from '../common/shaders/cull.wgsl?raw';

/**
 * Collection of uniform buffers for passing parameters to compute shaders.
 *
 * Uniform buffers are small, read-only buffers optimized for frequently
 * updated data that's accessed uniformly by all shader invocations.
 * They're faster than storage buffers for this use case.
 */
export interface UniformBuffers {
  /**
   * External forces parameters.
   * Contents: deltaTime, gravity, interactionRadius, interactionStrength, inputPoint
   * Size: 32 bytes
   */
  compute: GPUBuffer;

  /**
   * Integration parameters.
   * Contents: deltaTime, collisionDamping, hasObstacle, halfBounds, obstacle params
   * Size: 64 bytes
   */
  integrate: GPUBuffer;

  /**
   * Spatial hash parameters.
   * Contents: smoothingRadius, particleCount
   * Size: 16 bytes
   */
  hash: GPUBuffer;

  /**
   * General sort parameters.
   * Contents: particleCount
   * Size: 32 bytes
   */
  sort: GPUBuffer;

  /**
   * Prefix sum parameters for Level 0 (particles → L1 block sums).
   * Contents: elementCount
   * Size: 32 bytes (minimum for uniform buffer alignment)
   */
  scanParamsL0: GPUBuffer;

  /**
   * Prefix sum parameters for Level 1 (L1 sums → L2 block sums).
   * Contents: elementCount
   * Size: 32 bytes
   */
  scanParamsL1: GPUBuffer;

  /**
   * Prefix sum parameters for Level 2 (L2 sums → scratch).
   * Contents: elementCount
   * Size: 32 bytes
   */
  scanParamsL2: GPUBuffer;

  /**
   * Density calculation parameters.
   * Contents: radius, spikyPow2Scale, spikyPow3Scale, particleCount
   * Size: 32 bytes
   */
  density: GPUBuffer;

  /**
   * Pressure calculation parameters.
   * Contents: dt, targetDensity, pressureMultiplier, nearPressureMultiplier,
   *           radius, spikyPow2DerivScale, spikyPow3DerivScale, particleCount
   * Size: 48 bytes
   */
  pressure: GPUBuffer;

  /**
   * Viscosity calculation parameters.
   * Contents: dt, viscosityStrength, radius, poly6Scale, particleCount
   * Size: 48 bytes
   */
  viscosity: GPUBuffer;

  /**
   * Frustum culling parameters.
   * Contents: viewProjection matrix (64 bytes), radius, particleCount
   * Size: 80 bytes
   */
  cull: GPUBuffer;
}

/**
 * Manages all compute pipelines and their bind groups for the simulation.
 *
 * This class is responsible for:
 * - Creating shader modules from WGSL source
 * - Creating compute pipelines with 'auto' layout
 * - Creating bind groups that connect pipelines to buffers
 * - Managing uniform buffers for shader parameters
 */
export class ComputePipelines {
  // ===========================================================================
  // Physics Pipelines
  // ===========================================================================

  /**
   * Applies external forces (gravity, user interaction) and predicts positions.
   * Entry point: 'main'
   */
  externalForces: GPUComputePipeline;

  /**
   * Calculates SPH density using neighbor search.
   * Entry point: 'main'
   */
  density: GPUComputePipeline;

  /**
   * Calculates pressure forces from density gradients.
   * Entry point: 'main'
   */
  pressure: GPUComputePipeline;

  /**
   * Applies viscosity forces to smooth velocities.
   * Entry point: 'main'
   */
  viscosity: GPUComputePipeline;

  /**
   * Updates positions and handles boundary collisions.
   * Entry point: 'main'
   */
  integrate: GPUComputePipeline;

  // ===========================================================================
  // Spatial Hash & Sort Pipelines
  // ===========================================================================

  /**
   * Computes spatial hash key for each particle.
   * Entry point: 'main'
   */
  hash: GPUComputePipeline;

  /**
   * Clears the histogram array before counting.
   * Entry point: 'clearOffsets'
   */
  clearOffsets: GPUComputePipeline;

  /**
   * Counts particles per hash bucket (builds histogram).
   * Entry point: 'countOffsets'
   */
  countOffsets: GPUComputePipeline;

  /**
   * Parallel prefix sum (scan) using Blelloch algorithm.
   * Processes 512 elements per workgroup, outputs block sums.
   * Entry point: 'blockScan'
   */
  prefixScan: GPUComputePipeline;

  /**
   * Combines block-level prefix sums back to element level.
   * Adds scanned block sums to all elements in each block.
   * Entry point: 'blockCombine'
   */
  prefixCombine: GPUComputePipeline;

  /**
   * Scatters particles to sorted positions using prefix sum results.
   * Entry point: 'scatter'
   */
  scatter: GPUComputePipeline;

  /**
   * Initializes spatial offsets with sentinel value.
   * Entry point: 'initOffsets'
   */
  initSpatialOffsets: GPUComputePipeline;

  /**
   * Calculates spatial offsets (key → start index mapping).
   * Entry point: 'calculateOffsets'
   */
  updateSpatialOffsets: GPUComputePipeline;

  // ===========================================================================
  // Data Management Pipelines
  // ===========================================================================

  /**
   * Reorders particle data to match sorted order.
   * Copies from scattered positions to contiguous memory.
   * Entry point: 'reorder'
   */
  reorder: GPUComputePipeline;

  /**
   * Copies sorted data back to main buffers.
   * Entry point: 'copyBack'
   */
  copyBack: GPUComputePipeline;

  // ===========================================================================
  // Rendering Pipelines
  // ===========================================================================

  /**
   * GPU frustum culling to filter visible particles.
   * Populates indirect draw buffer with visible count.
   * Entry point: 'main'
   */
  cull: GPUComputePipeline;

  // ===========================================================================
  // Bind Groups
  // ===========================================================================
  // Bind groups connect pipelines to their required buffers.
  // They are recreated when buffers change (e.g., simulation reset).

  /** Bind group for external forces shader */
  externalForcesBindGroup!: GPUBindGroup;

  /** Bind group for integration shader */
  integrateBindGroup!: GPUBindGroup;

  /** Bind group for hash shader */
  hashBindGroup!: GPUBindGroup;

  /** Bind group for clear offsets shader (group 0) */
  clearOffsetsBindGroup!: GPUBindGroup;

  /** Bind group for count offsets shader (group 1) */
  countOffsetsBindGroup!: GPUBindGroup;

  /** Bind group for prefix sum Level 0 (particles → L1) */
  scanPass0BindGroup!: GPUBindGroup;

  /** Bind group for prefix sum Level 1 (L1 → L2) */
  scanPass1BindGroup!: GPUBindGroup;

  /** Bind group for prefix sum Level 2 (L2 → scratch) */
  scanPass2BindGroup!: GPUBindGroup;

  /** Bind group for combine Level 1 (add L2 sums to L1) */
  combinePass1BindGroup!: GPUBindGroup;

  /** Bind group for combine Level 0 (add L1 sums to particles) */
  combinePass0BindGroup!: GPUBindGroup;

  /** Bind group for scatter shader */
  scatterBindGroup!: GPUBindGroup;

  /** Bind group for init spatial offsets shader */
  initSpatialOffsetsBindGroup!: GPUBindGroup;

  /** Bind group for update spatial offsets shader */
  updateSpatialOffsetsBindGroup!: GPUBindGroup;

  /** Bind group for reorder shader */
  reorderBindGroup!: GPUBindGroup;

  /** Bind group for copy back shader */
  copyBackBindGroup!: GPUBindGroup;

  /** Bind group for cull shader */
  cullBindGroup!: GPUBindGroup;

  /** Bind group for density shader */
  densityBindGroup!: GPUBindGroup;

  /** Bind group for pressure shader */
  pressureBindGroup!: GPUBindGroup;

  /** Bind group for viscosity shader */
  viscosityBindGroup!: GPUBindGroup;

  // ===========================================================================
  // Uniform Buffers
  // ===========================================================================

  /** Collection of all uniform buffers */
  readonly uniformBuffers: UniformBuffers;

  /** Reference to GPU device */
  private device: GPUDevice;

  // ===========================================================================
  // Constructor
  // ===========================================================================

  /**
   * Creates all compute pipelines and uniform buffers.
   *
   * @param device - The WebGPU device
   */
  constructor(device: GPUDevice) {
    this.device = device;

    // -------------------------------------------------------------------------
    // Create Uniform Buffers
    // -------------------------------------------------------------------------

    this.uniformBuffers = {
      compute: device.createBuffer({
        size: 32, // 8 floats
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      }),

      integrate: device.createBuffer({
        size: 80, // 20 floats
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      }),

      hash: device.createBuffer({
        size: 16, // 4 floats
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      }),

      sort: device.createBuffer({
        size: 32, // Minimum 32 bytes for uniform alignment
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      }),

      // Scan params must be at least 32 bytes for UNIFORM binding alignment
      scanParamsL0: device.createBuffer({
        size: 32,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      }),

      scanParamsL1: device.createBuffer({
        size: 32,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      }),

      scanParamsL2: device.createBuffer({
        size: 32,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      }),

      // Cull needs 80 bytes: mat4x4 (64) + float + uint + padding (16)
      cull: device.createBuffer({
        size: 80,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      }),

      density: device.createBuffer({
        size: 32,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      }),

      pressure: device.createBuffer({
        size: 48,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      }),

      viscosity: device.createBuffer({
        size: 48,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      }),
    };

    // -------------------------------------------------------------------------
    // Compile Pipelines
    // -------------------------------------------------------------------------
    // Each pipeline is created from a shader module with a specific entry point.
    // Using 'auto' layout lets WebGPU infer the bind group layout from the shader.

    // Physics pipelines
    this.externalForces = this.createPipeline(externalForcesShader, 'main');
    this.density = this.createPipeline(densityShader, 'main');
    this.pressure = this.createPipeline(pressureShader, 'main');
    this.viscosity = this.createPipeline(viscosityShader, 'main');
    this.integrate = this.createPipeline(integrateShader, 'main');

    // Spatial hash pipelines
    this.hash = this.createPipeline(hashShader, 'main');
    this.clearOffsets = this.createPipeline(sortShader, 'clearOffsets');
    this.countOffsets = this.createPipeline(sortShader, 'countOffsets');

    // Prefix sum pipelines (both from same shader module)
    this.prefixScan = this.createPipeline(prefixSumShader, 'blockScan');
    this.prefixCombine = this.createPipeline(prefixSumShader, 'blockCombine');

    // Scatter and spatial offsets
    this.scatter = this.createPipeline(scatterShader, 'scatter');
    this.initSpatialOffsets = this.createPipeline(
      spatialOffsetsShader,
      'initOffsets'
    );
    this.updateSpatialOffsets = this.createPipeline(
      spatialOffsetsShader,
      'calculateOffsets'
    );

    // Data management pipelines (both from same shader module)
    this.reorder = this.createPipeline(reorderShader, 'reorder');
    this.copyBack = this.createPipeline(reorderShader, 'copyBack');

    // Culling pipeline
    this.cull = this.createPipeline(cullShader, 'main');
  }

  // ===========================================================================
  // Pipeline Creation Helper
  // ===========================================================================

  /**
   * Creates a compute pipeline from WGSL source code.
   *
   * @param code - WGSL shader source code
   * @param entryPoint - Name of the compute entry point function
   * @returns The created compute pipeline
   */
  private createPipeline(code: string, entryPoint: string): GPUComputePipeline {
    // Create shader module from source
    const module = this.device.createShaderModule({ code });

    // Create pipeline with auto-generated bind group layout
    return this.device.createComputePipeline({
      layout: 'auto', // WebGPU infers layout from shader declarations
      compute: { module, entryPoint },
    });
  }

  // ===========================================================================
  // Bind Group Creation
  // ===========================================================================

  /**
   * Creates all bind groups connecting pipelines to buffers.
   *
   * This must be called after buffers are created or recreated.
   * Bind groups define which buffers are accessible from each shader.
   *
   * @param buffers - The simulation buffers to bind
   */
  createBindGroups(buffers: SimulationBuffers): void {
    // -------------------------------------------------------------------------
    // 1. External Forces Bind Group
    // -------------------------------------------------------------------------
    // Bindings: positions (read), velocities (r/w), predicted (r/w), uniforms
    this.externalForcesBindGroup = this.device.createBindGroup({
      layout: this.externalForces.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.positions } },
        { binding: 1, resource: { buffer: buffers.velocities } },
        { binding: 2, resource: { buffer: buffers.predicted } },
        { binding: 3, resource: { buffer: this.uniformBuffers.compute } },
      ],
    });

    // -------------------------------------------------------------------------
    // 2. Integration Bind Group
    // -------------------------------------------------------------------------
    // Bindings: positions (r/w), velocities (r/w), uniforms
    this.integrateBindGroup = this.device.createBindGroup({
      layout: this.integrate.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.positions } },
        { binding: 1, resource: { buffer: buffers.velocities } },
        { binding: 2, resource: { buffer: this.uniformBuffers.integrate } },
      ],
    });

    // -------------------------------------------------------------------------
    // 3. Spatial Hash Bind Group
    // -------------------------------------------------------------------------
    // Bindings: predicted (read), keys (write), indices (write), uniforms
    this.hashBindGroup = this.device.createBindGroup({
      layout: this.hash.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.predicted } },
        { binding: 1, resource: { buffer: buffers.keys } },
        { binding: 2, resource: { buffer: buffers.indices } },
        { binding: 3, resource: { buffer: this.uniformBuffers.hash } },
      ],
    });

    // -------------------------------------------------------------------------
    // 4. Sort: Clear & Count Bind Groups
    // -------------------------------------------------------------------------

    // Clear offsets - zeros the histogram array
    this.clearOffsetsBindGroup = this.device.createBindGroup({
      layout: this.clearOffsets.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.sortOffsets } },
        { binding: 1, resource: { buffer: this.uniformBuffers.sort } },
      ],
    });

    // Count offsets - builds histogram using atomics
    // Note: Uses group 1 because clear and count have different layouts
    this.countOffsetsBindGroup = this.device.createBindGroup({
      layout: this.countOffsets.getBindGroupLayout(1),
      entries: [
        { binding: 0, resource: { buffer: buffers.keys } },
        { binding: 1, resource: { buffer: buffers.sortOffsets } },
        { binding: 2, resource: { buffer: this.uniformBuffers.sort } },
      ],
    });

    // -------------------------------------------------------------------------
    // 5. Parallel Prefix Sum Bind Groups
    // -------------------------------------------------------------------------

    // Level 0: Scan particle histogram → write L1 block sums
    this.scanPass0BindGroup = this.device.createBindGroup({
      layout: this.prefixScan.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.sortOffsets } },
        { binding: 1, resource: { buffer: buffers.groupSumsL1 } },
        { binding: 2, resource: { buffer: this.uniformBuffers.scanParamsL0 } },
      ],
    });

    // Level 1: Scan L1 block sums → write L2 block sums
    this.scanPass1BindGroup = this.device.createBindGroup({
      layout: this.prefixScan.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.groupSumsL1 } },
        { binding: 1, resource: { buffer: buffers.groupSumsL2 } },
        { binding: 2, resource: { buffer: this.uniformBuffers.scanParamsL1 } },
      ],
    });

    // Level 2: Scan L2 block sums (usually small enough for single block)
    this.scanPass2BindGroup = this.device.createBindGroup({
      layout: this.prefixScan.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.groupSumsL2 } },
        { binding: 1, resource: { buffer: buffers.scanScratch } },
        { binding: 2, resource: { buffer: this.uniformBuffers.scanParamsL2 } },
      ],
    });

    // Combine Level 1: Add scanned L2 sums back to L1 block results
    this.combinePass1BindGroup = this.device.createBindGroup({
      layout: this.prefixCombine.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.groupSumsL1 } },
        { binding: 2, resource: { buffer: this.uniformBuffers.scanParamsL1 } },
        { binding: 3, resource: { buffer: buffers.groupSumsL2 } },
      ],
    });

    // Combine Level 0: Add scanned L1 sums back to particle data
    this.combinePass0BindGroup = this.device.createBindGroup({
      layout: this.prefixCombine.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.sortOffsets } },
        { binding: 2, resource: { buffer: this.uniformBuffers.scanParamsL0 } },
        { binding: 3, resource: { buffer: buffers.groupSumsL1 } },
      ],
    });

    // -------------------------------------------------------------------------
    // 6. Scatter Bind Group
    // -------------------------------------------------------------------------
    // Uses prefix sum results to place particles in sorted positions
    this.scatterBindGroup = this.device.createBindGroup({
      layout: this.scatter.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.keys } },
        { binding: 1, resource: { buffer: buffers.sortOffsets } },
        { binding: 2, resource: { buffer: buffers.sortedKeys } },
        { binding: 3, resource: { buffer: buffers.indices } },
        { binding: 4, resource: { buffer: this.uniformBuffers.sort } },
      ],
    });

    // -------------------------------------------------------------------------
    // 7. Spatial Offsets Bind Groups
    // -------------------------------------------------------------------------

    // Init: Set all offsets to sentinel value
    this.initSpatialOffsetsBindGroup = this.device.createBindGroup({
      layout: this.initSpatialOffsets.getBindGroupLayout(0),
      entries: [
        { binding: 1, resource: { buffer: buffers.spatialOffsets } },
        { binding: 2, resource: { buffer: this.uniformBuffers.sort } },
      ],
    });

    // Update: Find key boundaries in sorted array
    this.updateSpatialOffsetsBindGroup = this.device.createBindGroup({
      layout: this.updateSpatialOffsets.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.sortedKeys } },
        { binding: 1, resource: { buffer: buffers.spatialOffsets } },
        { binding: 2, resource: { buffer: this.uniformBuffers.sort } },
      ],
    });

    // -------------------------------------------------------------------------
    // 8. Reorder Data Bind Groups
    // -------------------------------------------------------------------------

    // Reorder: Copy scattered data to contiguous sorted arrays
    this.reorderBindGroup = this.device.createBindGroup({
      layout: this.reorder.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.indices } },
        { binding: 1, resource: { buffer: buffers.positions } },
        { binding: 2, resource: { buffer: buffers.velocities } },
        { binding: 3, resource: { buffer: buffers.predicted } },
        { binding: 4, resource: { buffer: buffers.positionsSorted } },
        { binding: 5, resource: { buffer: buffers.velocitiesSorted } },
        { binding: 6, resource: { buffer: buffers.predictedSorted } },
        { binding: 7, resource: { buffer: this.uniformBuffers.sort } },
      ],
    });

    // CopyBack: Copy sorted data back to main buffers
    this.copyBackBindGroup = this.device.createBindGroup({
      layout: this.copyBack.getBindGroupLayout(0),
      entries: [
        { binding: 1, resource: { buffer: buffers.positions } },
        { binding: 2, resource: { buffer: buffers.velocities } },
        { binding: 3, resource: { buffer: buffers.predicted } },
        { binding: 4, resource: { buffer: buffers.positionsSorted } },
        { binding: 5, resource: { buffer: buffers.velocitiesSorted } },
        { binding: 6, resource: { buffer: buffers.predictedSorted } },
        { binding: 7, resource: { buffer: this.uniformBuffers.sort } },
      ],
    });

    // -------------------------------------------------------------------------
    // 9. Culling Bind Group
    // -------------------------------------------------------------------------
    this.cullBindGroup = this.device.createBindGroup({
      layout: this.cull.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.positions } },
        { binding: 1, resource: { buffer: buffers.visibleIndices } },
        { binding: 2, resource: { buffer: buffers.indirectDraw } },
        { binding: 3, resource: { buffer: this.uniformBuffers.cull } },
      ],
    });

    // -------------------------------------------------------------------------
    // 10. Density Bind Group
    // -------------------------------------------------------------------------
    this.densityBindGroup = this.device.createBindGroup({
      layout: this.density.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.predicted } },
        { binding: 1, resource: { buffer: buffers.sortedKeys } },
        { binding: 2, resource: { buffer: buffers.spatialOffsets } },
        { binding: 3, resource: { buffer: buffers.densities } },
        { binding: 4, resource: { buffer: this.uniformBuffers.density } },
      ],
    });

    // -------------------------------------------------------------------------
    // 11. Pressure Bind Group
    // -------------------------------------------------------------------------
    this.pressureBindGroup = this.device.createBindGroup({
      layout: this.pressure.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.predicted } },
        { binding: 1, resource: { buffer: buffers.velocities } },
        { binding: 2, resource: { buffer: buffers.densities } },
        { binding: 3, resource: { buffer: buffers.sortedKeys } },
        { binding: 4, resource: { buffer: buffers.spatialOffsets } },
        { binding: 5, resource: { buffer: this.uniformBuffers.pressure } },
      ],
    });

    // -------------------------------------------------------------------------
    // 12. Viscosity Bind Group
    // -------------------------------------------------------------------------
    this.viscosityBindGroup = this.device.createBindGroup({
      layout: this.viscosity.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.predicted } },
        { binding: 1, resource: { buffer: buffers.velocities } },
        { binding: 2, resource: { buffer: buffers.sortedKeys } },
        { binding: 3, resource: { buffer: buffers.spatialOffsets } },
        { binding: 4, resource: { buffer: this.uniformBuffers.viscosity } },
      ],
    });
  }
}
