/**
 * Compute Pipeline Management for SPH Fluid Simulation
 *
 * This module manages all GPU compute pipelines used in the simulation.
 * Compute pipelines execute WGSL shader code on the GPU for parallel
 * data processing - essential for the performance-critical parts of SPH.
 *
 * SPH Simulation Pipeline Order:
 * 1. External Forces - Apply gravity and user interaction forces
 * 2. Spatial Hash    - Build spatial acceleration structure for neighbor search
 * 3. Density         - Calculate fluid density at each particle
 * 4. Pressure        - Compute pressure forces from density gradients
 * 5. Viscosity       - Apply viscous damping between neighboring particles
 * 6. Integration     - Update positions and handle boundary collisions
 *
 * WebGPU Concepts:
 * - Pipeline: Compiled shader program ready for execution
 * - Bind Group: Collection of resources (buffers) bound to shader bindings
 * - Uniform Buffer: Small buffer for per-frame constants (timestep, settings)
 * - Storage Buffer: Large buffer for particle data (read/write in shaders)
 */

import type { SimulationBuffers } from './simulation_buffers.ts';

// Import WGSL compute shaders as raw strings using Vite's ?raw suffix
import externalForcesShader from './shaders/external_forces.wgsl?raw';
import hashShader from './shaders/hash.wgsl?raw';
import sortShader from './shaders/sort.wgsl?raw';
import scatterShader from './shaders/scatter.wgsl?raw';
import spatialOffsetsShader from './shaders/spatial_offsets.wgsl?raw';
import densityShader from './shaders/density.wgsl?raw';
import pressureShader from './shaders/pressure.wgsl?raw';
import viscosityShader from './shaders/viscosity.wgsl?raw';
import integrateShader from './shaders/integrate.wgsl?raw';

/**
 * Collection of uniform buffers for passing parameters to compute shaders.
 * Uniform buffers are small, fast-access buffers for constants that
 * change each frame (timestep, settings) but are the same for all particles.
 */
export interface UniformBuffers {
  /** Parameters for external forces shader (timestep, gravity, interaction) */
  compute: GPUBuffer;
  /** Parameters for integration shader (timestep, bounds, obstacle) */
  integrate: GPUBuffer;
  /** Parameters for spatial hash shader (smoothing radius, count) */
  hash: GPUBuffer;
  /** Parameters for sort shaders (particle count) */
  sort: GPUBuffer;
  /** Parameters for density shader (radius, kernel scales, count) */
  density: GPUBuffer;
  /** Parameters for pressure shader (timestep, multipliers, kernel scales) */
  pressure: GPUBuffer;
  /** Parameters for viscosity shader (timestep, strength, kernel scale) */
  viscosity: GPUBuffer;
}

/**
 * Manages all compute pipelines and bind groups for the SPH simulation.
 *
 * This class handles:
 * 1. Creating compute pipelines from WGSL shader code
 * 2. Creating uniform buffers for shader parameters
 * 3. Creating bind groups that connect buffers to shader bindings
 *
 * Bind groups must be recreated when simulation buffers change (e.g., on reset),
 * but pipelines and uniform buffers persist for the lifetime of the simulation.
 */
export class ComputePipelines {
  // ============================================================================
  // Compute Pipelines
  // Each pipeline is a compiled shader program for a specific simulation stage
  // ============================================================================

  /**
   * Applies external forces to particles (gravity + user interaction).
   * Also computes predicted positions for the next timestep.
   */
  externalForces: GPUComputePipeline;

  /**
   * Computes spatial hash keys for each particle's predicted position.
   * Key = hash(floor(position / cellSize)) for efficient neighbor lookup.
   */
  hash: GPUComputePipeline;

  /**
   * Clears the sort offset counters before counting particles per bucket.
   * Part of the GPU counting sort implementation.
   */
  clearOffsets: GPUComputePipeline;

  /**
   * Counts particles in each hash bucket using atomic operations.
   * Part of the GPU counting sort implementation.
   */
  countOffsets: GPUComputePipeline;

  /**
   * Performs prefix sum and scatters particles to sorted positions.
   * Completes the counting sort by placing particles in final sorted order.
   */
  scatter: GPUComputePipeline;

  /**
   * Builds the spatial offset lookup table from sorted keys.
   * spatialOffsets[key] = first index where this key appears in sorted array.
   */
  spatialOffsets: GPUComputePipeline;

  /**
   * Calculates fluid density at each particle position using SPH kernels.
   * Computes both standard density and near-density for surface tension.
   */
  density: GPUComputePipeline;

  /**
   * Computes pressure forces from density gradients.
   * Particles move from high-density to low-density regions.
   */
  pressure: GPUComputePipeline;

  /**
   * Applies viscosity forces between neighboring particles.
   * Smooths velocity differences to simulate fluid viscosity.
   */
  viscosity: GPUComputePipeline;

  /**
   * Integrates velocities to update positions and handles boundary collisions.
   * Final step that produces the new particle positions for rendering.
   */
  integrate: GPUComputePipeline;

  // ============================================================================
  // Bind Groups
  // Bind groups connect buffers to shader bindings (binding points in WGSL)
  // These must be recreated when the simulation buffers change
  // ============================================================================

  /** Bind group for external forces pipeline */
  externalForcesBindGroup!: GPUBindGroup;
  /** Bind group for integration pipeline */
  integrateBindGroup!: GPUBindGroup;
  /** Bind group for hash pipeline */
  hashBindGroup!: GPUBindGroup;
  /** Bind group for clear offsets pipeline */
  clearOffsetsBindGroup!: GPUBindGroup;
  /** Bind group for count offsets pipeline */
  countOffsetsBindGroup!: GPUBindGroup;
  /** Bind group for scatter pipeline */
  scatterBindGroup!: GPUBindGroup;
  /** Bind group for spatial offsets pipeline */
  spatialOffsetsBindGroup!: GPUBindGroup;
  /** Bind group for density pipeline */
  densityBindGroup!: GPUBindGroup;
  /** Bind group for pressure pipeline */
  pressureBindGroup!: GPUBindGroup;
  /** Bind group for viscosity pipeline */
  viscosityBindGroup!: GPUBindGroup;

  /** Uniform buffers for passing parameters to shaders */
  readonly uniformBuffers: UniformBuffers;

  /** Reference to the GPU device */
  private device: GPUDevice;

  /**
   * Creates all compute pipelines and uniform buffers.
   *
   * Pipelines are compiled from WGSL shader source code. This is done once
   * at initialization since pipeline compilation can be expensive.
   *
   * @param device - The WebGPU device to create resources on
   */
  constructor(device: GPUDevice) {
    this.device = device;

    // ========================================================================
    // Create uniform buffers
    // ========================================================================
    // Uniform buffers store per-frame constants like timestep and settings.
    // Size is determined by the struct layout in each shader.
    // UNIFORM: Indicates this is a uniform buffer (fast, read-only in shader)
    // COPY_DST: Allows CPU to write data via writeBuffer()

    this.uniformBuffers = {
      // External forces: timestep(f32), gravity(f32), interactionRadius(f32),
      //                  interactionStrength(f32), mouseX(f32), mouseY(f32), padding(2xf32)
      compute: device.createBuffer({
        size: 32, // 8 floats * 4 bytes
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      }),

      // Integrate: timestep(f32), damping(f32), hasObstacle(f32), padding(f32),
      //            halfBoundsX(f32), halfBoundsY(f32), padding(2xf32),
      //            obstacleCenter(2xf32), obstacleHalfSize(2xf32), padding(4xf32)
      integrate: device.createBuffer({
        size: 64, // 16 floats * 4 bytes
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      }),

      // Hash: smoothingRadius(f32), particleCount(f32), padding(2xf32)
      hash: device.createBuffer({
        size: 32, // 8 floats * 4 bytes (padded)
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      }),

      // Sort: particleCount(u32), padding(7xu32)
      sort: device.createBuffer({
        size: 32, // 8 uints * 4 bytes
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      }),

      // Density: smoothingRadius(f32), spikyPow2Scale(f32), spikyPow3Scale(f32),
      //          particleCount(f32), padding(8xf32)
      density: device.createBuffer({
        size: 48, // 12 floats * 4 bytes
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      }),

      // Pressure: timestep(f32), targetDensity(f32), pressureMult(f32), nearPressureMult(f32),
      //           smoothingRadius(f32), spikyPow2DerivScale(f32), spikyPow3DerivScale(f32),
      //           particleCount(f32), padding(4xf32)
      pressure: device.createBuffer({
        size: 48, // 12 floats * 4 bytes
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      }),

      // Viscosity: timestep(f32), viscosityStrength(f32), smoothingRadius(f32),
      //            poly6Scale(f32), particleCount(f32), padding(7xf32)
      viscosity: device.createBuffer({
        size: 48, // 12 floats * 4 bytes
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      }),
    };

    // ========================================================================
    // Create compute pipelines
    // ========================================================================
    // Each pipeline is compiled from WGSL source and specifies an entry point.
    // Layout 'auto' lets WebGPU infer the bind group layout from the shader.

    this.externalForces = this.createPipeline(externalForcesShader, 'main');
    this.hash = this.createPipeline(hashShader, 'main');

    // Sort shader contains multiple entry points for different stages
    this.clearOffsets = this.createPipeline(sortShader, 'clearOffsets');
    this.countOffsets = this.createPipeline(sortShader, 'countOffsets');

    this.scatter = this.createPipeline(scatterShader, 'prefixAndScatter');
    this.spatialOffsets = this.createPipeline(
      spatialOffsetsShader,
      'buildOffsets'
    );
    this.density = this.createPipeline(densityShader, 'main');
    this.pressure = this.createPipeline(pressureShader, 'main');
    this.viscosity = this.createPipeline(viscosityShader, 'main');
    this.integrate = this.createPipeline(integrateShader, 'main');
  }

  /**
   * Creates a compute pipeline from WGSL shader code.
   *
   * @param code - WGSL shader source code
   * @param entryPoint - Name of the entry point function (e.g., 'main')
   * @returns Compiled compute pipeline ready for use
   */
  private createPipeline(code: string, entryPoint: string): GPUComputePipeline {
    // Create a shader module from the WGSL source
    const module = this.device.createShaderModule({ code });

    // Create the compute pipeline with automatic bind group layout inference
    return this.device.createComputePipeline({
      layout: 'auto', // WebGPU infers layout from shader @binding declarations
      compute: { module, entryPoint },
    });
  }

  /**
   * Creates bind groups that connect simulation buffers to shader bindings.
   *
   * Bind groups map GPU buffers to the @binding(N) declarations in WGSL shaders.
   * This must be called whenever the simulation buffers are recreated (e.g., on reset).
   *
   * Each bind group entry specifies:
   * - binding: The @binding(N) index in the shader
   * - resource: The GPU buffer to bind
   *
   * @param buffers - The simulation buffers to bind to shaders
   */
  createBindGroups(buffers: SimulationBuffers): void {
    // ========================================================================
    // External Forces Bind Group
    // ========================================================================
    // Reads positions/velocities, writes predicted positions
    this.externalForcesBindGroup = this.device.createBindGroup({
      layout: this.externalForces.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.positions } },
        { binding: 1, resource: { buffer: buffers.velocities } },
        { binding: 2, resource: { buffer: buffers.predicted } },
        { binding: 3, resource: { buffer: this.uniformBuffers.compute } },
      ],
    });

    // ========================================================================
    // Integration Bind Group
    // ========================================================================
    // Reads/writes positions and velocities for final integration
    this.integrateBindGroup = this.device.createBindGroup({
      layout: this.integrate.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.positions } },
        { binding: 1, resource: { buffer: buffers.velocities } },
        { binding: 2, resource: { buffer: this.uniformBuffers.integrate } },
      ],
    });

    // ========================================================================
    // Spatial Hash Bind Groups
    // ========================================================================

    // Hash: Computes spatial hash key for each particle
    this.hashBindGroup = this.device.createBindGroup({
      layout: this.hash.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.predicted } },
        { binding: 1, resource: { buffer: buffers.keys } },
        { binding: 2, resource: { buffer: buffers.indices } },
        { binding: 3, resource: { buffer: this.uniformBuffers.hash } },
      ],
    });

    // Clear Offsets: Zeroes the sort offset counters
    this.clearOffsetsBindGroup = this.device.createBindGroup({
      layout: this.clearOffsets.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.sortOffsets } },
        { binding: 1, resource: { buffer: this.uniformBuffers.sort } },
      ],
    });

    // Count Offsets: Counts particles per hash bucket
    // Note: Uses bind group layout 1 (different layout than clear)
    this.countOffsetsBindGroup = this.device.createBindGroup({
      layout: this.countOffsets.getBindGroupLayout(1),
      entries: [
        { binding: 0, resource: { buffer: buffers.keys } },
        { binding: 1, resource: { buffer: buffers.sortOffsets } },
        { binding: 2, resource: { buffer: this.uniformBuffers.sort } },
      ],
    });

    // Scatter: Performs prefix sum and places particles in sorted order
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

    // Spatial Offsets: Builds lookup table from sorted keys
    this.spatialOffsetsBindGroup = this.device.createBindGroup({
      layout: this.spatialOffsets.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.sortedKeys } },
        { binding: 1, resource: { buffer: buffers.spatialOffsets } },
        { binding: 2, resource: { buffer: this.uniformBuffers.sort } },
      ],
    });

    // ========================================================================
    // SPH Physics Bind Groups
    // ========================================================================

    // Density: Computes particle densities using SPH kernels
    this.densityBindGroup = this.device.createBindGroup({
      layout: this.density.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.predicted } },
        { binding: 1, resource: { buffer: buffers.sortedKeys } },
        { binding: 2, resource: { buffer: buffers.indices } },
        { binding: 3, resource: { buffer: buffers.spatialOffsets } },
        { binding: 4, resource: { buffer: buffers.densities } },
        { binding: 5, resource: { buffer: this.uniformBuffers.density } },
      ],
    });

    // Pressure: Computes pressure forces from density gradients
    this.pressureBindGroup = this.device.createBindGroup({
      layout: this.pressure.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.predicted } },
        { binding: 1, resource: { buffer: buffers.velocities } },
        { binding: 2, resource: { buffer: buffers.densities } },
        { binding: 3, resource: { buffer: buffers.sortedKeys } },
        { binding: 4, resource: { buffer: buffers.indices } },
        { binding: 5, resource: { buffer: buffers.spatialOffsets } },
        { binding: 6, resource: { buffer: this.uniformBuffers.pressure } },
      ],
    });

    // Viscosity: Applies viscosity forces between neighbors
    this.viscosityBindGroup = this.device.createBindGroup({
      layout: this.viscosity.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.predicted } },
        { binding: 1, resource: { buffer: buffers.velocities } },
        { binding: 2, resource: { buffer: buffers.sortedKeys } },
        { binding: 3, resource: { buffer: buffers.indices } },
        { binding: 4, resource: { buffer: buffers.spatialOffsets } },
        { binding: 5, resource: { buffer: this.uniformBuffers.viscosity } },
      ],
    });
  }
}
