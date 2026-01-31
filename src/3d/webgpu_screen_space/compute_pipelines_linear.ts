/**
 * =============================================================================
 * Compute Pipeline Management for 3D SPH Fluid Simulation (Linear Grid)
 * =============================================================================
 *
 * This module creates and manages all GPU compute pipelines and their bind
 * groups for the Linear Grid variant of the SPH simulation.
 *
 * ## Pipeline Inventory (14 pipelines)
 *
 * | Pipeline        | Shader               | Entry Point     | Purpose                                    |
 * |-----------------|----------------------|-----------------|--------------------------------------------|
 * | externalForces  | external_forces.wgsl | main            | Gravity, interaction, position prediction  |
 * | hash            | hash_linear.wgsl     | main            | Assign particles to linear grid indices    |
 * | clearOffsets    | sort_linear.wgsl     | clearOffsets     | Zero the histogram buffer                  |
 * | countOffsets    | sort_linear.wgsl     | countOffsets     | Build histogram & compute cell-local ranks |
 * | prefixScan      | prefix_sum.wgsl      | blockScan       | Blelloch exclusive scan (per block)        |
 * | prefixCombine   | prefix_sum.wgsl      | blockCombine    | Add scanned group sums back into blocks    |
 * | scatter         | scatter_linear.wgsl  | scatter         | Place particles at sorted positions        |
 * | reorder         | reorder.wgsl         | reorder         | Gather particle data into sorted buffers   |
 * | copyBack        | reorder.wgsl         | copyBack        | Copy sorted data back to primary buffers   |
 * | density         | density_linear.wgsl  | main            | SPH density estimation (strip-optimised)   |
 * | pressure        | pressure_linear.wgsl | main            | Pressure forces (strip-optimised)          |
 * | viscosity       | viscosity_linear.wgsl| main            | Viscosity damping (strip-optimised)        |
 * | integrate       | integrate.wgsl       | main            | Euler integration & boundary collision     |
 * | cull            | cull.wgsl            | main            | GPU frustum culling for indirect draw      |
 *
 * ## Bind Group Strategy
 *
 * Each pipeline has a corresponding bind group that references the simulation
 * buffers and the relevant uniform buffer. Bind groups are (re-)created via
 * {@link createBindGroups} whenever the simulation resets.
 *
 * The hierarchical prefix-sum uses three pairs of scan/combine bind groups
 * (L0, L1, L2) to handle grids that exceed a single 512-element workgroup.
 *
 * @module compute_pipelines_linear
 */

import type { SimulationBuffersLinear } from './simulation_buffers_linear.ts';

// Import shader source code as raw strings
import externalForcesShader from './shaders/external_forces.wgsl?raw';
import hashShader from './shaders/hash_linear.wgsl?raw';
import sortShader from './shaders/sort_linear.wgsl?raw';
import scatterShader from './shaders/scatter_linear.wgsl?raw';
import densityShader from './shaders/density_linear.wgsl?raw';
import pressureShader from './shaders/pressure_linear.wgsl?raw';
import viscosityShader from './shaders/viscosity_linear.wgsl?raw';
import integrateShader from './shaders/integrate.wgsl?raw';
import prefixSumShader from './shaders/prefix_sum.wgsl?raw';
import reorderShader from './shaders/reorder.wgsl?raw';
import cullShader from './shaders/cull.wgsl?raw';
import foamSpawnShader from './shaders/foam_spawn.wgsl?raw';
import foamUpdateShader from './shaders/foam_update.wgsl?raw';
import foamClearCounterShader from './shaders/foam_clear_counter.wgsl?raw';

/**
 * Collection of GPU uniform buffers used to upload per-frame parameters
 * to each compute pipeline.
 *
 * Each buffer is created with `UNIFORM | COPY_DST` usage so the CPU can
 * write parameter data via `device.queue.writeBuffer()` every frame.
 */
export interface UniformBuffers {
  /** External forces params — 32 bytes (SimParams struct). */
  compute: GPUBuffer;
  /** Integration params — 64 bytes (IntegrateParams struct). */
  integrate: GPUBuffer;
  /** Hash params — 32 bytes (HashParams struct with grid resolution). */
  hash: GPUBuffer;
  /** Sort params — 32 bytes (SortParams struct: particleCount + gridTotalCells). */
  sort: GPUBuffer;
  /** Prefix-sum level-0 params — 32 bytes (element count for sortOffsets scan). */
  scanParamsL0: GPUBuffer;
  /** Prefix-sum level-1 params — 32 bytes (element count for L1 group sums). */
  scanParamsL1: GPUBuffer;
  /** Prefix-sum level-2 params — 32 bytes (element count for L2 group sums). */
  scanParamsL2: GPUBuffer;
  /** Density params — 48 bytes (DensityParams struct with grid bounds). */
  density: GPUBuffer;
  /** Pressure params — 64 bytes (PressureParams struct with grid bounds). */
  pressure: GPUBuffer;
  /** Viscosity params — 48 bytes (ViscosityParams struct with grid bounds). */
  viscosity: GPUBuffer;
  /** Frustum culling params — 80 bytes (CullParams struct: VP matrix + radius). */
  cull: GPUBuffer;
  /** Foam spawn params — 48 bytes (FoamSpawnParams struct). */
  foamSpawn: GPUBuffer;
  /** Foam update params — 32 bytes (FoamUpdateParams struct). */
  foamUpdate: GPUBuffer;
}

/**
 * Owns all compute pipelines and bind groups for the Linear Grid simulation.
 *
 * Pipelines are created once in the constructor and reused across resets.
 * Bind groups are recreated by {@link createBindGroups} whenever the
 * simulation buffers are reallocated (e.g. on particle count change).
 */
export class ComputePipelinesLinear {
  // ===========================================================================
  // SPH Physics Pipelines
  // ===========================================================================

  /** Applies gravity and user interaction, produces predicted positions. */
  externalForces: GPUComputePipeline;
  /** Computes SPH density at each particle using Spiky²/Spiky³ kernels. */
  density: GPUComputePipeline;
  /** Computes pressure forces from density (symmetric EOS). */
  pressure: GPUComputePipeline;
  /** Applies viscosity damping using Poly6 kernel. */
  viscosity: GPUComputePipeline;
  /** Euler integration of velocity→position and boundary collision. */
  integrate: GPUComputePipeline;

  // ===========================================================================
  // Linear Grid Sorting Pipelines
  // ===========================================================================

  /** Assigns linear grid indices to particles based on predicted position. */
  hash: GPUComputePipeline;
  /** Zeros the histogram (sortOffsets) buffer. */
  clearOffsets: GPUComputePipeline;
  /** Builds histogram of particles per grid cell and computes cell-local ranks. */
  countOffsets: GPUComputePipeline;
  /** Blelloch exclusive scan — processes one 512-element block per workgroup. */
  prefixScan: GPUComputePipeline;
  /** Adds scanned group sums back into each block's local scan. */
  prefixCombine: GPUComputePipeline;
  /** Places particles at sorted positions using rank + start (contention-free). */
  scatter: GPUComputePipeline;
  /** Gathers particle data from original order into spatially-sorted buffers. */
  reorder: GPUComputePipeline;
  /** Copies sorted particle data back to primary buffers. */
  copyBack: GPUComputePipeline;

  // ===========================================================================
  // Rendering Pipeline
  // ===========================================================================

  /** GPU frustum culling — builds compact visible-index list for indirect draw. */
  cull: GPUComputePipeline;

  // ===========================================================================
  // Foam Particle Pipelines
  // ===========================================================================

  /** Resets foam spawn counter to zero each frame. */
  foamClearCounter: GPUComputePipeline;
  /** Spawns foam particles from high-velocity surface fluid particles. */
  foamSpawn: GPUComputePipeline;
  /** Updates foam particle physics (gravity, drag, boundaries, lifetime). */
  foamUpdate: GPUComputePipeline;

  // ===========================================================================
  // Bind Groups — SPH Physics
  // ===========================================================================

  /** Bind group for the external forces pass (positions, velocities, predicted, params). */
  externalForcesBindGroup!: GPUBindGroup;
  /** Bind group for the integration pass (positions, velocities, params). */
  integrateBindGroup!: GPUBindGroup;
  /** Bind group for the density pass (predicted, sortOffsets, densities, params). */
  densityBindGroup!: GPUBindGroup;
  /** Bind group for the pressure pass (predicted, velocities, densities, sortOffsets, params). */
  pressureBindGroup!: GPUBindGroup;
  /** Bind group for the viscosity pass (predicted, velocities, sortOffsets, params). */
  viscosityBindGroup!: GPUBindGroup;

  // ===========================================================================
  // Bind Groups — Linear Grid Sorting
  // ===========================================================================

  /** Bind group for the hash pass (predicted, keys, indices, params). */
  hashBindGroup!: GPUBindGroup;
  /** Bind group 0 for clearOffsets (sortOffsets, params). */
  clearOffsetsBindGroup!: GPUBindGroup;
  /** Bind group 1 for countOffsets (keys, sortOffsets, params, particleCellOffsets). */
  countOffsetsBindGroup!: GPUBindGroup;
  /** Level-0 scan bind group (sortOffsets, groupSumsL1, scanParamsL0). */
  scanPass0BindGroup!: GPUBindGroup;
  /** Level-1 scan bind group (groupSumsL1, groupSumsL2, scanParamsL1). */
  scanPass1BindGroup!: GPUBindGroup;
  /** Level-2 scan bind group (groupSumsL2, scanScratch, scanParamsL2). */
  scanPass2BindGroup!: GPUBindGroup;
  /** Level-1 combine bind group (groupSumsL1, scanParamsL1, groupSumsL2). */
  combinePass1BindGroup!: GPUBindGroup;
  /** Level-0 combine bind group (sortOffsets, scanParamsL0, groupSumsL1). */
  combinePass0BindGroup!: GPUBindGroup;
  /** Bind group for the scatter pass (keys, sortOffsets, indices, params, particleCellOffsets). */
  scatterBindGroup!: GPUBindGroup;
  /** Bind group for the reorder pass (indices, positions/vel/pred → sorted copies, params). */
  reorderBindGroup!: GPUBindGroup;
  /** Bind group for the copyBack pass (sorted → primary buffers, params). */
  copyBackBindGroup!: GPUBindGroup;

  // ===========================================================================
  // Bind Groups — Rendering
  // ===========================================================================

  /** Bind group for the cull pass (positions, visibleIndices, indirectDraw, params). */
  cullBindGroup!: GPUBindGroup;

  // ===========================================================================
  // Bind Groups — Foam Particles
  // ===========================================================================

  /** Bind group for the foam clear counter pass. */
  foamClearCounterBindGroup!: GPUBindGroup;
  /** Bind group for the foam spawn pass. */
  foamSpawnBindGroup!: GPUBindGroup;
  /** Bind group for the foam update pass. */
  foamUpdateBindGroup!: GPUBindGroup;

  // ===========================================================================
  // Shared Resources
  // ===========================================================================

  /** Pre-allocated GPU uniform buffers for all compute passes. */
  readonly uniformBuffers: UniformBuffers;
  /** GPU device handle used for pipeline / bind group creation. */
  private device: GPUDevice;

  /**
   * Creates all compute pipelines and uniform buffers.
   *
   * Pipelines are created from WGSL shader source imported at build time.
   * Uniform buffers are pre-allocated to their required sizes (matching
   * the corresponding WGSL struct layouts).
   *
   * @param device - WebGPU device for resource creation
   */
  constructor(device: GPUDevice) {
    this.device = device;

    this.uniformBuffers = {
      compute: device.createBuffer({
        size: 32,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      }),
      integrate: device.createBuffer({
        size: 80,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      }),
      hash: device.createBuffer({
        size: 32,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      }), // Updated size 32
      sort: device.createBuffer({
        size: 32,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      }),
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
      cull: device.createBuffer({
        size: 80,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      }),
      density: device.createBuffer({
        size: 48,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      }), // Updated size 48
      pressure: device.createBuffer({
        size: 64,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      }), // Updated size 64
      viscosity: device.createBuffer({
        size: 48,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      }),
      foamSpawn: device.createBuffer({
        size: 112, // Expanded for neighbor search params
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      }),
      foamUpdate: device.createBuffer({
        size: 112, // Expanded for neighbor search params
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      }),
    };

    this.externalForces = this.createPipeline(externalForcesShader, 'main');
    this.density = this.createPipeline(densityShader, 'main');
    this.pressure = this.createPipeline(pressureShader, 'main');
    this.viscosity = this.createPipeline(viscosityShader, 'main');
    this.integrate = this.createPipeline(integrateShader, 'main');
    this.hash = this.createPipeline(hashShader, 'main');
    this.clearOffsets = this.createPipeline(sortShader, 'clearOffsets');
    this.countOffsets = this.createPipeline(sortShader, 'countOffsets');
    this.prefixScan = this.createPipeline(prefixSumShader, 'blockScan');
    this.prefixCombine = this.createPipeline(prefixSumShader, 'blockCombine');
    this.scatter = this.createPipeline(scatterShader, 'scatter');
    this.reorder = this.createPipeline(reorderShader, 'reorder');
    this.copyBack = this.createPipeline(reorderShader, 'copyBack');
    this.cull = this.createPipeline(cullShader, 'main');
    this.foamClearCounter = this.createPipeline(foamClearCounterShader, 'main');
    this.foamSpawn = this.createPipeline(foamSpawnShader, 'main');
    this.foamUpdate = this.createPipeline(foamUpdateShader, 'main');
  }

  /**
   * Creates a single compute pipeline from WGSL source and entry point.
   *
   * Uses `layout: 'auto'` so WebGPU infers the bind group layout from
   * the shader's `@group` / `@binding` declarations.
   *
   * @param code       - WGSL shader source string
   * @param entryPoint - Name of the `@compute` entry function
   * @returns The created compute pipeline
   */
  private createPipeline(code: string, entryPoint: string): GPUComputePipeline {
    const module = this.device.createShaderModule({ code });
    return this.device.createComputePipeline({
      layout: 'auto',
      compute: { module, entryPoint },
    });
  }

  /**
   * Creates (or recreates) all bind groups by binding simulation buffers
   * and uniform buffers to each pipeline's layout.
   *
   * This must be called after every simulation reset because buffer
   * handles change when the simulation is re-initialised.
   *
   * @param buffers - The simulation's GPU buffer manager
   */
  createBindGroups(buffers: SimulationBuffersLinear): void {
    this.externalForcesBindGroup = this.device.createBindGroup({
      layout: this.externalForces.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.positions } },
        { binding: 1, resource: { buffer: buffers.velocities } },
        { binding: 2, resource: { buffer: buffers.predicted } },
        { binding: 3, resource: { buffer: this.uniformBuffers.compute } },
      ],
    });

    this.integrateBindGroup = this.device.createBindGroup({
      layout: this.integrate.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.positions } },
        { binding: 1, resource: { buffer: buffers.velocities } },
        { binding: 2, resource: { buffer: this.uniformBuffers.integrate } },
      ],
    });

    this.hashBindGroup = this.device.createBindGroup({
      layout: this.hash.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.predicted } },
        { binding: 1, resource: { buffer: buffers.keys } },
        { binding: 2, resource: { buffer: buffers.indices } },
        { binding: 3, resource: { buffer: this.uniformBuffers.hash } },
      ],
    });

    this.clearOffsetsBindGroup = this.device.createBindGroup({
      layout: this.clearOffsets.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.sortOffsets } },
        { binding: 1, resource: { buffer: this.uniformBuffers.sort } },
      ],
    });

    this.countOffsetsBindGroup = this.device.createBindGroup({
      layout: this.countOffsets.getBindGroupLayout(1),
      entries: [
        { binding: 0, resource: { buffer: buffers.keys } },
        { binding: 1, resource: { buffer: buffers.sortOffsets } },
        { binding: 2, resource: { buffer: this.uniformBuffers.sort } },
        { binding: 3, resource: { buffer: buffers.particleCellOffsets } },
      ],
    });

    this.scanPass0BindGroup = this.device.createBindGroup({
      layout: this.prefixScan.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.sortOffsets } },
        { binding: 1, resource: { buffer: buffers.groupSumsL1 } },
        { binding: 2, resource: { buffer: this.uniformBuffers.scanParamsL0 } },
      ],
    });

    this.scanPass1BindGroup = this.device.createBindGroup({
      layout: this.prefixScan.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.groupSumsL1 } },
        { binding: 1, resource: { buffer: buffers.groupSumsL2 } },
        { binding: 2, resource: { buffer: this.uniformBuffers.scanParamsL1 } },
      ],
    });

    this.scanPass2BindGroup = this.device.createBindGroup({
      layout: this.prefixScan.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.groupSumsL2 } },
        { binding: 1, resource: { buffer: buffers.scanScratch } },
        { binding: 2, resource: { buffer: this.uniformBuffers.scanParamsL2 } },
      ],
    });

    this.combinePass1BindGroup = this.device.createBindGroup({
      layout: this.prefixCombine.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.groupSumsL1 } },
        { binding: 2, resource: { buffer: this.uniformBuffers.scanParamsL1 } },
        { binding: 3, resource: { buffer: buffers.groupSumsL2 } },
      ],
    });

    this.combinePass0BindGroup = this.device.createBindGroup({
      layout: this.prefixCombine.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.sortOffsets } },
        { binding: 2, resource: { buffer: this.uniformBuffers.scanParamsL0 } },
        { binding: 3, resource: { buffer: buffers.groupSumsL1 } },
      ],
    });

    this.scatterBindGroup = this.device.createBindGroup({
      layout: this.scatter.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.keys } },
        { binding: 1, resource: { buffer: buffers.sortOffsets } },
        { binding: 2, resource: { buffer: buffers.indices } },
        { binding: 3, resource: { buffer: this.uniformBuffers.sort } },
        { binding: 4, resource: { buffer: buffers.particleCellOffsets } },
      ],
    });

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

    this.cullBindGroup = this.device.createBindGroup({
      layout: this.cull.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.positions } },
        { binding: 1, resource: { buffer: buffers.visibleIndices } },
        { binding: 2, resource: { buffer: buffers.indirectDraw } },
        { binding: 3, resource: { buffer: this.uniformBuffers.cull } },
      ],
    });

    this.densityBindGroup = this.device.createBindGroup({
      layout: this.density.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.predicted } },
        { binding: 1, resource: { buffer: buffers.sortOffsets } },
        { binding: 2, resource: { buffer: buffers.densities } },
        { binding: 3, resource: { buffer: this.uniformBuffers.density } },
      ],
    });

    this.pressureBindGroup = this.device.createBindGroup({
      layout: this.pressure.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.predicted } },
        { binding: 1, resource: { buffer: buffers.velocities } },
        { binding: 2, resource: { buffer: buffers.densities } },
        { binding: 3, resource: { buffer: buffers.sortOffsets } },
        { binding: 4, resource: { buffer: this.uniformBuffers.pressure } },
      ],
    });

    this.viscosityBindGroup = this.device.createBindGroup({
      layout: this.viscosity.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.predicted } },
        { binding: 1, resource: { buffer: buffers.velocities } },
        { binding: 2, resource: { buffer: buffers.sortOffsets } },
        { binding: 4, resource: { buffer: this.uniformBuffers.viscosity } },
      ],
    });

    // Foam bind groups (only for SimulationBuffersLinear which has foam buffers)
    if ('foamPositions' in buffers) {
      this.foamClearCounterBindGroup = this.device.createBindGroup({
        layout: this.foamClearCounter.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: buffers.foamCounter } }],
      });

      this.foamSpawnBindGroup = this.device.createBindGroup({
        layout: this.foamSpawn.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: buffers.predicted } },
          { binding: 1, resource: { buffer: buffers.velocities } },
          { binding: 3, resource: { buffer: buffers.foamPositions } },
          { binding: 4, resource: { buffer: buffers.foamVelocities } },
          { binding: 5, resource: { buffer: buffers.foamCounter } },
          { binding: 6, resource: { buffer: this.uniformBuffers.foamSpawn } },
          { binding: 7, resource: { buffer: buffers.sortOffsets } },
        ],
      });

      this.foamUpdateBindGroup = this.device.createBindGroup({
        layout: this.foamUpdate.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: buffers.foamPositions } },
          { binding: 1, resource: { buffer: buffers.foamVelocities } },
          { binding: 2, resource: { buffer: this.uniformBuffers.foamUpdate } },
          { binding: 3, resource: { buffer: buffers.predicted } },
          { binding: 4, resource: { buffer: buffers.velocities } },
          { binding: 5, resource: { buffer: buffers.sortOffsets } },
        ],
      });
    }
  }
}
