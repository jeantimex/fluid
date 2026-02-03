/**
 * =============================================================================
 * 3D Fluid Simulation Orchestrator for WebGPU
 * =============================================================================
 *
 * This class coordinates the entire SPH (Smoothed Particle Hydrodynamics)
 * simulation pipeline on the GPU. It manages the simulation state, GPU resources,
 * and the execution of compute passes in the correct order.
 *
 * ## SPH Overview
 *
 * SPH is a computational method for simulating fluid dynamics. Key concepts:
 *
 * - **Particles**: The fluid is represented as discrete particles
 * - **Smoothing Kernel**: Each particle's properties are "smoothed" over nearby neighbors
 * - **Density**: Calculated by summing contributions from neighbors within smoothing radius
 * - **Pressure**: Derived from density using an Equation of State (EOS)
 * - **Forces**: Pressure gradients + viscosity + external forces (gravity, user input)
 *
 * ## Simulation Pipeline (Per Frame)
 *
 * ```
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │                     FOR EACH SUBSTEP                                 │
 * ├─────────────────────────────────────────────────────────────────────┤
 * │                                                                      │
 * │  1. EXTERNAL FORCES                                                  │
 * │     └─► Apply gravity and user interaction forces                    │
 * │     └─► Predict next position (for spatial hashing)                  │
 * │                                                                      │
 * │  2. SPATIAL HASH & SORT (Most Complex Part)                          │
 * │     └─► Hash: Compute grid cell key for each particle                │
 * │     └─► Count: Build histogram of particles per cell                 │
 * │     └─► Prefix Sum (3 Levels): Parallel scan for sort offsets        │
 * │     └─► Scatter: Place particles in sorted positions                 │
 * │     └─► Spatial Offsets: Build cell → start index lookup table       │
 * │     └─► Reorder: Physically rearrange particle data for cache        │
 * │     └─► CopyBack: Move sorted data back to main buffers              │
 * │                                                                      │
 * │  3. DENSITY                                                          │
 * │     └─► Calculate density using Spiky kernel                         │
 * │     └─► Calculate near-density using Spiky³ kernel (clumping)        │
 * │                                                                      │
 * │  4. PRESSURE                                                         │
 * │     └─► Calculate pressure from density (EOS)                        │
 * │     └─► Apply pressure forces (symmetric for momentum conservation)  │
 * │                                                                      │
 * │  5. VISCOSITY (Optional)                                             │
 * │     └─► Smooth velocity differences using Poly6 kernel               │
 * │                                                                      │
 * │  6. INTEGRATION                                                      │
 * │     └─► Update positions: pos += vel * dt                            │
 * │     └─► Handle boundary collisions                                   │
 * │                                                                      │
 * └─────────────────────────────────────────────────────────────────────┘
 *
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │                     RENDERING                                        │
 * ├─────────────────────────────────────────────────────────────────────┤
 * │  7. FRUSTUM CULLING                                                  │
 * │     └─► GPU-driven culling to find visible particles                 │
 * │     └─► Populate indirect draw buffer                                │
 * │                                                                      │
 * │  8. RENDER                                                           │
 * │     └─► Draw visible particles as billboards                         │
 * │     └─► Draw bounding box wireframe                                  │
 * └─────────────────────────────────────────────────────────────────────┘
 * ```
 *
 * ## Performance Optimizations
 *
 * 1. **Spatial Hashing**: O(n) neighbor search instead of O(n²)
 * 2. **Physical Reordering**: Cache-coherent memory access (10-50x faster neighbors)
 * 3. **Parallel Prefix Sum**: Logarithmic time sorting on GPU
 * 4. **Frustum Culling**: Only render visible particles
 * 5. **Indirect Draw**: No CPU-GPU sync for particle count
 *
 * @module fluid_simulation
 */

import type { SimState } from '../common/types.ts';
import { createSpawnData } from '../common/spawn.ts';
import { SimulationBuffersLinear } from '../webgpu_particles/simulation_buffers_linear.ts';
import { ComputePipelinesLinear } from '../webgpu_particles/compute_pipelines_linear.ts';
import { OrbitCamera } from '../webgpu_particles/orbit_camera.ts';
import { RaymarchRenderer } from './renderer.ts';
import { SplatPipeline } from './splat_pipeline.ts';
import type { RaymarchConfig } from './types.ts';
import type { GpuModel } from '../common/model_loader.ts';
import { SDFGenerator } from '../common/sdf_generator.ts';
import { mat4Invert } from '../webgpu_particles/math_utils.ts';

/**
 * Main orchestrator class for the 3D SPH fluid simulation.
 *
 * This class manages:
 * - GPU resources (buffers, pipelines)
 * - Simulation state (positions, velocities, densities)
 * - Compute pass execution order
 * - Uniform buffer updates
 * - Rendering coordination
 */
export class FluidSimulation {
  // ===========================================================================
  // WebGPU Resources
  // ===========================================================================

  /** The WebGPU device used for all GPU operations */
  private device: GPUDevice;

  /** The canvas context for presenting rendered frames */
  private context: GPUCanvasContext;

  /** Simulation configuration (particle count, physics params, etc.) */
  private config: RaymarchConfig;

  // ===========================================================================
  // Component Modules
  // ===========================================================================

  /** Manages all GPU buffer allocations */
  private buffers!: SimulationBuffersLinear;

  /** Manages compute shader pipelines and bind groups */
  private pipelines: ComputePipelinesLinear;

  /** Manages the 3-pass density splatting system */
  private splatPipeline: SplatPipeline;

  /** SDF Generator for mesh collision */
  private sdfGenerator: SDFGenerator;
  private model: GpuModel | null = null;

  /** Handles raymarch rendering */
  private renderer: RaymarchRenderer;

  /** CPU-side simulation state (for UI and debugging) */
  private state!: SimState;

  // ===========================================================================
  // Compute Configuration
  // ===========================================================================

  /**
   * Number of threads per workgroup for compute shaders.
   * 256 is a common choice that works well on most GPUs.
   * Total threads = ceil(particleCount / 256) * 256
   */
  private workgroupSize = 256;

  // ===========================================================================
  // Grid Configuration
  // ===========================================================================

  /** Linear grid resolution along each axis: ceil(boundsSize / smoothingRadius). */
  private gridRes = { x: 0, y: 0, z: 0 };

  /** Total number of cells in the linear grid (gridRes.x × gridRes.y × gridRes.z). */
  private gridTotalCells = 0;

  // ===========================================================================
  // Pre-allocated Uniform Data Arrays
  // ===========================================================================
  // These TypedArrays are reused every frame to avoid garbage collection.
  // Each array corresponds to a uniform buffer in the GPU.

  /**
   * External forces uniform data.
   * Layout: [deltaTime, gravity, interactionRadius, interactionStrength,
   *          inputX, inputY, inputZ, padding]
   */
  private computeData = new Float32Array(8);

  /**
   * Integration uniform data.
   * Layout: [deltaTime, collisionDamping, hasObstacle, padding,
   *          halfBoundsX, halfBoundsY, halfBoundsZ, padding,
   *          obstacleX, obstacleY, obstacleZ, padding,
   *          obstacleHalfX, obstacleHalfY, obstacleHalfZ, padding,
   *          obstacleRotX, obstacleRotY, obstacleRotZ, padding]
   */
  private integrateData = new Float32Array(20);

  /** Hash params: [radius, particleCount, minBoundsX/Y/Z, gridResX/Y/Z]. */
  private hashParamsData = new Float32Array(8);

  /**
   * Sort uniform data.
   * Layout: [particleCount, padding, padding, padding, ...]
   */
  private sortParamsData = new Uint32Array(8);

  /**
   * Scan parameters for Level 0 (particle data → L1 block sums).
   * Layout: [elementCount, padding, padding, padding]
   */
  private scanParamsDataL0 = new Uint32Array(4);

  /**
   * Scan parameters for Level 1 (L1 sums → L2 block sums).
   * Layout: [elementCount, padding, padding, padding]
   */
  private scanParamsDataL1 = new Uint32Array(4);

  /**
   * Scan parameters for Level 2 (L2 sums → scratch).
   * Layout: [elementCount, padding, padding, padding]
   */
  private scanParamsDataL2 = new Uint32Array(4);

  /** Density params: [radius, spikyPow2Scale, spikyPow3Scale, particleCount, minBounds(3), pad, gridRes(3), pad]. */
  private densityParamsData = new Float32Array(12);

  /** Pressure params: [dt, targetDensity, pressureMul, nearPressureMul, radius, pow2DerivScale, pow3DerivScale, count, minBounds(3), pad, gridRes(3), pad]. */
  private pressureParamsData = new Float32Array(16);

  /** Viscosity params: [dt, viscosity, radius, poly6Scale, count, minBounds(3), gridRes(3), pad]. */
  private viscosityParamsData = new Float32Array(12);

  // ===========================================================================
  // Constructor
  // ===========================================================================

  /**
   * Creates a new FluidSimulation instance.
   *
   * @param device - The WebGPU device for GPU operations
   * @param context - The canvas context for rendering
   * @param canvas - The HTML canvas element
   * @param config - Simulation configuration
   * @param format - The preferred texture format for rendering
   */
  constructor(
    device: GPUDevice,
    context: GPUCanvasContext,
    canvas: HTMLCanvasElement,
    config: RaymarchConfig,
    format: GPUTextureFormat
  ) {
    this.device = device;
    this.context = context;
    this.config = config;

    // Create compute pipelines (compiles all shaders)
    this.pipelines = new ComputePipelinesLinear(device);

    // Create splat pipeline (density volume splatting)
    this.splatPipeline = new SplatPipeline(device);

    this.sdfGenerator = new SDFGenerator(device);

    // Create renderer (raymarched volume)
    this.renderer = new RaymarchRenderer(device, canvas, format);

    // Initialize simulation state and buffers
    this.reset();
  }

  // ===========================================================================
  // Public Getters
  // ===========================================================================

  /**
   * Returns the current number of particles in the simulation.
   */
  get particleCount(): number {
    return this.buffers.particleCount;
  }

  /**
   * Returns the current simulation state.
   * Includes input state for UI interaction.
   */
  get simulationState(): SimState {
    return this.state;
  }

  // ===========================================================================
  // Simulation Control
  // ===========================================================================

  /**
   * Resets the simulation to its initial state.
   *
   * This destroys existing GPU buffers and recreates them with fresh
   * particle data based on the current configuration.
   */
  reset(): void {
    // Destroy existing buffers if present
    if (this.buffers) {
      this.buffers.destroy();
    }

    const { boundsSize, smoothingRadius } = this.config;
    this.gridRes = {
      x: Math.ceil(boundsSize.x / smoothingRadius),
      y: Math.ceil(boundsSize.y / smoothingRadius),
      z: Math.ceil(boundsSize.z / smoothingRadius),
    };
    this.gridTotalCells = this.gridRes.x * this.gridRes.y * this.gridRes.z;

    // Generate initial particle positions and velocities
    const spawn = createSpawnData(this.config);

    // Create CPU-side state for UI/debugging
    this.state = this.createStateFromSpawn(spawn);

    // Allocate GPU buffers with initial data
    this.buffers = new SimulationBuffersLinear(
      this.device,
      spawn,
      this.gridTotalCells
    );

    // Recreate bind groups to point to new buffers
    this.pipelines.createBindGroups(
      this.buffers,
      this.sdfGenerator.textureView
    );

    this.splatPipeline.recreate(this.config, this.buffers.predicted);
    this.renderer.createBindGroup(
      this.splatPipeline.textureView,
      this.buffers.positions
    );
  }

  /**
   * Creates the CPU-side simulation state from spawn data.
   *
   * @param spawn - Initial particle positions and velocities
   * @returns SimState object with all required arrays
   */
  private createStateFromSpawn(spawn: {
    positions: Float32Array;
    velocities: Float32Array;
    count: number;
  }): SimState {
    return {
      // Particle data arrays (mirrored on GPU)
      positions: spawn.positions,
      predicted: new Float32Array(spawn.positions),
      velocities: spawn.velocities,
      densities: new Float32Array(spawn.count * 2), // density + nearDensity

      // Spatial hash arrays
      keys: new Uint32Array(spawn.count),
      sortedKeys: new Uint32Array(spawn.count),
      indices: new Uint32Array(spawn.count),
      sortOffsets: new Uint32Array(spawn.count),
      spatialOffsets: new Uint32Array(spawn.count),

      // Sorted data arrays (for cache optimization)
      positionsSorted: new Float32Array(spawn.count * 4),
      predictedSorted: new Float32Array(spawn.count * 4),
      velocitiesSorted: new Float32Array(spawn.count * 4),

      // Metadata
      count: spawn.count,

      // Input state for user interaction
      input: {
        worldX: 0,
        worldY: 0,
        worldZ: 0,
        pull: false,
        push: false,
      },
    };
  }

  // ===========================================================================
  // Main Simulation Step
  // ===========================================================================

  /**
   * Advances the simulation by one frame.
   *
   * The frame time is divided into multiple substeps for stability.
   * More substeps = more accurate but slower simulation.
   *
   * @param dt - Delta time in seconds since last frame
   */
  async step(dt: number): Promise<void> {
    const { config, buffers, pipelines, device, state } = this;

    // -------------------------------------------------------------------------
    // Time Step Calculation
    // -------------------------------------------------------------------------

    // Cap maximum time step to prevent instability
    const maxDeltaTime = config.maxTimestepFPS
      ? 1 / config.maxTimestepFPS
      : Number.POSITIVE_INFINITY;

    // Apply time scale and cap
    const frameTime = Math.min(dt * config.timeScale, maxDeltaTime);

    // Divide frame time into substeps
    const timeStep = frameTime / config.iterationsPerFrame;

    // -------------------------------------------------------------------------
    // Substep Loop
    // -------------------------------------------------------------------------

    for (let i = 0; i < config.iterationsPerFrame; i++) {
      // -----------------------------------------------------------------------
      // 1. External Forces & Prediction
      // -----------------------------------------------------------------------

      // Determine interaction strength from user input
      let interactionStrength = 0;
      if (state.input.push) interactionStrength = -config.interactionStrength;
      else if (state.input.pull)
        interactionStrength = config.interactionStrength;

      // Pack uniform data for external forces shader
      this.computeData[0] = timeStep;
      this.computeData[1] = config.gravity;
      this.computeData[2] = config.interactionRadius;
      this.computeData[3] = interactionStrength;
      this.computeData[4] = state.input.worldX;
      this.computeData[5] = state.input.worldY;
      this.computeData[6] = state.input.worldZ;
      this.computeData[7] = 0; // padding

      // Upload uniform data to GPU
      device.queue.writeBuffer(
        pipelines.uniformBuffers.compute,
        0,
        this.computeData
      );

      // Create command encoder for this substep
      const encoder = device.createCommandEncoder();

      // Dispatch external forces compute pass
      const computePass = encoder.beginComputePass();
      computePass.setPipeline(pipelines.externalForces);
      computePass.setBindGroup(0, pipelines.externalForcesBindGroup);
      computePass.dispatchWorkgroups(
        Math.ceil(buffers.particleCount / this.workgroupSize)
      );
      computePass.end();

      // -----------------------------------------------------------------------
      // 2. Spatial Hash, Sort, and Reorder
      // -----------------------------------------------------------------------
      // This is the most complex part of the simulation.
      // It builds an acceleration structure for O(1) neighbor lookup and
      // physically reorders particle data for cache-coherent access.
      this.dispatchSpatialHash(encoder);

      // -----------------------------------------------------------------------
      // 3. Density Calculation
      // -----------------------------------------------------------------------
      this.updateDensityUniforms();
      const densityPass = encoder.beginComputePass();
      densityPass.setPipeline(pipelines.density);
      densityPass.setBindGroup(0, pipelines.densityBindGroup);
      densityPass.dispatchWorkgroups(
        Math.ceil(buffers.particleCount / this.workgroupSize)
      );
      densityPass.end();

      // -----------------------------------------------------------------------
      // 4. Pressure Force Calculation
      // -----------------------------------------------------------------------
      this.updatePressureUniforms(timeStep);
      const pressurePass = encoder.beginComputePass();
      pressurePass.setPipeline(pipelines.pressure);
      pressurePass.setBindGroup(0, pipelines.pressureBindGroup);
      pressurePass.dispatchWorkgroups(
        Math.ceil(buffers.particleCount / this.workgroupSize)
      );
      pressurePass.end();

      // -----------------------------------------------------------------------
      // 5. Viscosity (Optional)
      // -----------------------------------------------------------------------
      // Only apply viscosity if strength is non-zero
      if (config.viscosityStrength > 0) {
        this.updateViscosityUniforms(timeStep);
        const viscosityPass = encoder.beginComputePass();
        viscosityPass.setPipeline(pipelines.viscosity);
        viscosityPass.setBindGroup(0, pipelines.viscosityBindGroup);
        viscosityPass.dispatchWorkgroups(
          Math.ceil(buffers.particleCount / this.workgroupSize)
        );
        viscosityPass.end();
      }

      // -----------------------------------------------------------------------
      // 6. Integration (Position Update + Collision)
      // -----------------------------------------------------------------------
      this.updateIntegrateUniforms(timeStep);
      this.updateSDFUniforms();
      const integratePass = encoder.beginComputePass();
      integratePass.setPipeline(pipelines.integrate);
      integratePass.setBindGroup(0, pipelines.integrateBindGroup);
      integratePass.dispatchWorkgroups(
        Math.ceil(buffers.particleCount / this.workgroupSize)
      );
      integratePass.end();

      // Submit all compute passes for this substep
      device.queue.submit([encoder.finish()]);
    }

    // -----------------------------------------------------------------------
    // 7. Density Volume Texture (Particle Splatting: Clear -> Splat -> Resolve)
    // -----------------------------------------------------------------------
    const splatEncoder = device.createCommandEncoder();
    this.splatPipeline.dispatch(splatEncoder, buffers.particleCount, config);
    device.queue.submit([splatEncoder.finish()]);
  }

  async setModel(model: GpuModel | null): Promise<void> {
    this.model = model;
    this.renderer.setModel(model);
    
    if (model) {
      await this.sdfGenerator.generate(model);
      this.pipelines.createBindGroups(
        this.buffers,
        this.sdfGenerator.textureView
      );
    }
  }

  private updateSDFUniforms(): void {
    const { config, model } = this;
    const { min, max } = this.sdfGenerator.bounds;

    // Calculate Model Matrix (same as in renderer)
    const modelScale = 0.04;
    const modelTx = 0;
    const modelTy = -config.boundsSize.y * 0.5 - (model?.boundsMinY ?? 0) * modelScale;
    const modelTz = 0;

    // Construct Model Matrix (Column-Major)
    const modelMatrix = new Float32Array([
      -modelScale, 0, 0, 0,
      0, modelScale, 0, 0,
      0, 0, -modelScale, 0,
      modelTx, modelTy, modelTz, 1,
    ]);

    // Calculate Inverse Model Matrix (for transforming particles to model space)
    const modelInv = mat4Invert(modelMatrix);

    const data = new Float32Array(40); // 3+1 + 3+1 + 16 + 16
    
    // minBounds (vec3 + pad)
    data[0] = min[0]; data[1] = min[1]; data[2] = min[2]; data[3] = 0;
    
    // maxBounds (vec3 + pad)
    data[4] = max[0]; data[5] = max[1]; data[6] = max[2]; data[7] = 0;
    
    // modelInv (mat4)
    data.set(modelInv, 8);
    
    // modelMatrix (mat4)
    data.set(modelMatrix, 24);

    this.device.queue.writeBuffer(
      this.pipelines.uniformBuffers.sdfParams,
      0,
      data
    );
  }

  // ===========================================================================
  // Spatial Hash Pipeline
  // ===========================================================================

  /**
   * Executes the complete spatial hashing pipeline.
   *
   * This is the most complex part of the simulation, consisting of 7+ passes
   * that build an acceleration structure and physically reorder particle data.
   *
   * ## Pipeline Stages
   *
   * 1. **Hash**: Compute spatial hash key for each particle based on grid cell
   * 2. **Clear**: Zero the histogram buckets
   * 3. **Count**: Build histogram of particles per cell (atomic increment)
   * 4. **Prefix Sum** (3 levels): Parallel scan to convert histogram to offsets
   * 5. **Scatter**: Place particles into sorted positions using offsets
   * 6. **Spatial Offsets**: Build key → start index lookup table
   * 7. **Reorder**: Copy particle data to sorted buffers
   * 8. **CopyBack**: Copy sorted data back to main buffers
   *
   * ## Hierarchical Prefix Sum
   *
   * The prefix sum is computed in 3 levels to handle arbitrary particle counts:
   *
   * ```
   * Level 0: Process 512 particles per workgroup → output L1 block sums
   * Level 1: Process L1 block sums → output L2 block sums
   * Level 2: Process L2 block sums (small enough for single workgroup)
   *
   * Then combine in reverse order:
   * Combine L1: Add scanned L2 sums back to L1
   * Combine L0: Add scanned L1 sums back to original data
   * ```
   *
   * @param encoder - Command encoder to record compute passes to
   */
  private dispatchSpatialHash(encoder: GPUCommandEncoder): void {
    const { pipelines, buffers } = this;
    const workgroups = Math.ceil(buffers.particleCount / this.workgroupSize);

    // Scan block counts (based on grid total cells for Linear Grid)
    const blocksL0 = Math.ceil((this.gridTotalCells + 1) / 512);
    const blocksL1 = Math.ceil(blocksL0 / 512);
    const blocksL2 = Math.ceil(blocksL1 / 512);

    // Update Uniforms
    this.hashParamsData[0] = this.config.smoothingRadius;
    this.hashParamsData[1] = buffers.particleCount;
    this.hashParamsData[2] = -this.config.boundsSize.x * 0.5;
    this.hashParamsData[3] = -this.config.boundsSize.y * 0.5;
    this.hashParamsData[4] = -this.config.boundsSize.z * 0.5;
    this.hashParamsData[5] = this.gridRes.x;
    this.hashParamsData[6] = this.gridRes.y;
    this.hashParamsData[7] = this.gridRes.z;
    this.device.queue.writeBuffer(
      pipelines.uniformBuffers.hash,
      0,
      this.hashParamsData
    );

    this.sortParamsData[0] = buffers.particleCount;
    this.sortParamsData[1] = this.gridTotalCells;
    this.device.queue.writeBuffer(
      pipelines.uniformBuffers.sort,
      0,
      this.sortParamsData
    );

    this.scanParamsDataL0[0] = this.gridTotalCells + 1;
    this.device.queue.writeBuffer(
      pipelines.uniformBuffers.scanParamsL0,
      0,
      this.scanParamsDataL0
    );

    this.scanParamsDataL1[0] = blocksL0;
    this.device.queue.writeBuffer(
      pipelines.uniformBuffers.scanParamsL1,
      0,
      this.scanParamsDataL1
    );

    this.scanParamsDataL2[0] = blocksL1;
    this.device.queue.writeBuffer(
      pipelines.uniformBuffers.scanParamsL2,
      0,
      this.scanParamsDataL2
    );

    // 1. Hash
    const hashPass = encoder.beginComputePass();
    hashPass.setPipeline(pipelines.hash);
    hashPass.setBindGroup(0, pipelines.hashBindGroup);
    hashPass.dispatchWorkgroups(workgroups);
    hashPass.end();

    // 2. Clear
    const clearPass = encoder.beginComputePass();
    clearPass.setPipeline(pipelines.clearOffsets);
    clearPass.setBindGroup(0, pipelines.clearOffsetsBindGroup);
    clearPass.dispatchWorkgroups(Math.ceil((this.gridTotalCells + 1) / 256));
    clearPass.end();

    // 3. Count
    const countPass = encoder.beginComputePass();
    countPass.setPipeline(pipelines.countOffsets);
    countPass.setBindGroup(1, pipelines.countOffsetsBindGroup);
    countPass.dispatchWorkgroups(workgroups);
    countPass.end();

    // 4. Prefix Sum
    const scanPass0 = encoder.beginComputePass();
    scanPass0.setPipeline(pipelines.prefixScan);
    scanPass0.setBindGroup(0, pipelines.scanPass0BindGroup);
    scanPass0.dispatchWorkgroups(blocksL0);
    scanPass0.end();

    if (blocksL0 > 1) {
      const scanPass1 = encoder.beginComputePass();
      scanPass1.setPipeline(pipelines.prefixScan);
      scanPass1.setBindGroup(0, pipelines.scanPass1BindGroup);
      scanPass1.dispatchWorkgroups(blocksL1);
      scanPass1.end();
    }

    if (blocksL1 > 1) {
      const scanPass2 = encoder.beginComputePass();
      scanPass2.setPipeline(pipelines.prefixScan);
      scanPass2.setBindGroup(0, pipelines.scanPass2BindGroup);
      scanPass2.dispatchWorkgroups(blocksL2);
      scanPass2.end();
    }

    if (blocksL1 > 1) {
      const combinePass1 = encoder.beginComputePass();
      combinePass1.setPipeline(pipelines.prefixCombine);
      combinePass1.setBindGroup(0, pipelines.combinePass1BindGroup);
      combinePass1.dispatchWorkgroups(blocksL1);
      combinePass1.end();
    }

    if (blocksL0 > 1) {
      const combinePass0 = encoder.beginComputePass();
      combinePass0.setPipeline(pipelines.prefixCombine);
      combinePass0.setBindGroup(0, pipelines.combinePass0BindGroup);
      combinePass0.dispatchWorkgroups(blocksL0);
      combinePass0.end();
    }

    // 5. Scatter
    const scatterPass = encoder.beginComputePass();
    scatterPass.setPipeline(pipelines.scatter);
    scatterPass.setBindGroup(0, pipelines.scatterBindGroup);
    scatterPass.dispatchWorkgroups(workgroups);
    scatterPass.end();

    // 6. Reorder
    const reorderPass = encoder.beginComputePass();
    reorderPass.setPipeline(pipelines.reorder);
    reorderPass.setBindGroup(0, pipelines.reorderBindGroup);
    reorderPass.dispatchWorkgroups(workgroups);
    reorderPass.end();

    // 7. Copy Back
    const copyBackPass = encoder.beginComputePass();
    copyBackPass.setPipeline(pipelines.copyBack);
    copyBackPass.setBindGroup(0, pipelines.copyBackBindGroup);
    copyBackPass.dispatchWorkgroups(workgroups);
    copyBackPass.end();
  }

  // ===========================================================================
  // Uniform Buffer Updates
  // ===========================================================================

  /**
   * Updates the uniform buffer for density calculation.
   *
   * SPH Kernel Normalization Constants (3D):
   * - spikyPow2Scale = 15 / (2π * r⁵) for standard density kernel
   * - spikyPow3Scale = 15 / (π * r⁶) for near-density kernel
   *
   * These constants ensure the kernel integrates to 1 over the support volume.
   */
  private updateDensityUniforms(): void {
    const radius = this.config.smoothingRadius;

    // Proper 3D SPH kernel normalization constants
    const spikyPow2Scale = 15 / (2 * Math.PI * Math.pow(radius, 5));
    const spikyPow3Scale = 15 / (Math.PI * Math.pow(radius, 6));

    this.densityParamsData[0] = radius;
    this.densityParamsData[1] = spikyPow2Scale;
    this.densityParamsData[2] = spikyPow3Scale;
    this.densityParamsData[3] = this.buffers.particleCount;
    this.densityParamsData[4] = -this.config.boundsSize.x * 0.5;
    this.densityParamsData[5] = -this.config.boundsSize.y * 0.5;
    this.densityParamsData[6] = -this.config.boundsSize.z * 0.5;
    this.densityParamsData[7] = 0; // pad
    this.densityParamsData[8] = this.gridRes.x;
    this.densityParamsData[9] = this.gridRes.y;
    this.densityParamsData[10] = this.gridRes.z;
    this.densityParamsData[11] = 0; // pad

    this.device.queue.writeBuffer(
      this.pipelines.uniformBuffers.density,
      0,
      this.densityParamsData
    );
  }

  /**
   * Updates the uniform buffer for pressure calculation.
   *
   * SPH Kernel Derivative Normalization Constants (3D):
   * - spikyPow2DerivScale = 15 / (π * r⁵) for pressure gradient
   * - spikyPow3DerivScale = 45 / (π * r⁶) for near-pressure gradient
   *
   * These are the derivatives of the density kernels used for force calculation.
   *
   * @param timeStep - Current simulation time step
   */
  private updatePressureUniforms(timeStep: number): void {
    const radius = this.config.smoothingRadius;

    // Proper 3D SPH kernel derivative normalization constants
    const spikyPow2DerivScale = 15 / (Math.PI * Math.pow(radius, 5));
    const spikyPow3DerivScale = 45 / (Math.PI * Math.pow(radius, 6));

    this.pressureParamsData[0] = timeStep;
    this.pressureParamsData[1] = this.config.targetDensity;
    this.pressureParamsData[2] = this.config.pressureMultiplier;
    this.pressureParamsData[3] = this.config.nearPressureMultiplier;
    this.pressureParamsData[4] = radius;
    this.pressureParamsData[5] = spikyPow2DerivScale;
    this.pressureParamsData[6] = spikyPow3DerivScale;
    this.pressureParamsData[7] = this.buffers.particleCount;
    this.pressureParamsData[8] = -this.config.boundsSize.x * 0.5;
    this.pressureParamsData[9] = -this.config.boundsSize.y * 0.5;
    this.pressureParamsData[10] = -this.config.boundsSize.z * 0.5;
    this.pressureParamsData[11] = 0; // pad
    this.pressureParamsData[12] = this.gridRes.x;
    this.pressureParamsData[13] = this.gridRes.y;
    this.pressureParamsData[14] = this.gridRes.z;
    this.pressureParamsData[15] = 0; // pad

    this.device.queue.writeBuffer(
      this.pipelines.uniformBuffers.pressure,
      0,
      this.pressureParamsData
    );
  }

  /**
   * Updates the uniform buffer for viscosity calculation.
   *
   * Poly6 Kernel Normalization Constant (3D):
   * - poly6Scale = 315 / (64π * r⁹)
   *
   * Poly6 is used for viscosity because it's positive everywhere,
   * unlike spiky kernels which have discontinuities.
   *
   * @param timeStep - Current simulation time step
   */
  private updateViscosityUniforms(timeStep: number): void {
    const radius = this.config.smoothingRadius;

    // Proper 3D Poly6 kernel normalization constant
    const poly6Scale = 315 / (64 * Math.PI * Math.pow(radius, 9));

    this.viscosityParamsData[0] = timeStep;
    this.viscosityParamsData[1] = this.config.viscosityStrength;
    this.viscosityParamsData[2] = radius;
    this.viscosityParamsData[3] = poly6Scale;
    this.viscosityParamsData[4] = this.buffers.particleCount;
    this.viscosityParamsData[5] = -this.config.boundsSize.x * 0.5;
    this.viscosityParamsData[6] = -this.config.boundsSize.y * 0.5;
    this.viscosityParamsData[7] = -this.config.boundsSize.z * 0.5;
    this.viscosityParamsData[8] = this.gridRes.x;
    this.viscosityParamsData[9] = this.gridRes.y;
    this.viscosityParamsData[10] = this.gridRes.z;
    this.viscosityParamsData[11] = 0; // pad

    this.device.queue.writeBuffer(
      this.pipelines.uniformBuffers.viscosity,
      0,
      this.viscosityParamsData
    );
  }

  /**
   * Updates the uniform buffer for position integration and collision.
   *
   * @param timeStep - Current simulation time step
   */
  private updateIntegrateUniforms(timeStep: number): void {
    this.integrateData[0] = timeStep;
    this.integrateData[1] = this.config.collisionDamping;

    // Check if obstacle is active (has volume)
    const hasObstacle =
      this.config.obstacleSize.x > 0 &&
      this.config.obstacleSize.y > 0 &&
      this.config.obstacleSize.z > 0;
    this.integrateData[2] = hasObstacle ? 1 : 0;

    // Calculate half-extents of simulation bounds
    const hx = this.config.boundsSize.x * 0.5;
    const hy = this.config.boundsSize.y * 0.5;
    const hz = this.config.boundsSize.z * 0.5;

    this.integrateData[4] = hx;
    this.integrateData[5] = hy;
    this.integrateData[6] = hz;

    // Obstacle parameters
    this.integrateData[8] = this.config.obstacleCentre.x;
    this.integrateData[9] = this.config.obstacleCentre.y;
    this.integrateData[10] = this.config.obstacleCentre.z;

    this.integrateData[12] = this.config.obstacleSize.x * 0.5;
    this.integrateData[13] = this.config.obstacleSize.y * 0.5;
    this.integrateData[14] = this.config.obstacleSize.z * 0.5;
    this.integrateData[16] = this.config.obstacleRotation.x;
    this.integrateData[17] = this.config.obstacleRotation.y;
    this.integrateData[18] = this.config.obstacleRotation.z;

    this.device.queue.writeBuffer(
      this.pipelines.uniformBuffers.integrate,
      0,
      this.integrateData
    );
  }

  // ===========================================================================
  // Rendering
  // ===========================================================================

  /**
   * Renders the current simulation state.
   *
   * @param viewMatrix - The camera's view matrix
   */
  render(camera: OrbitCamera): void {
    const encoder = this.device.createCommandEncoder();

    this.renderer.render(
      encoder,
      this.context.getCurrentTexture().createView(),
      camera,
      this.config,
      this.buffers.particleCount
    );

    this.device.queue.submit([encoder.finish()]);
  }
}
