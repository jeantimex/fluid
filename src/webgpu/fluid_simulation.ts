/**
 * Fluid Simulation Orchestrator for WebGPU
 *
 * This is the main entry point for the SPH (Smoothed Particle Hydrodynamics)
 * fluid simulation. It coordinates all the GPU compute and render operations
 * to simulate realistic fluid behavior.
 *
 * SPH Algorithm Overview:
 * SPH is a mesh-free method for simulating fluid dynamics. Instead of a grid,
 * it uses particles that carry properties like position, velocity, and density.
 * Forces between particles are computed using smoothing kernels that weight
 * contributions from nearby particles.
 *
 * Simulation Pipeline (per substep):
 * 1. External Forces  - Apply gravity and user interaction (mouse push/pull)
 * 2. Predict Position - Estimate where particles will be after this timestep
 * 3. Spatial Hashing  - Build acceleration structure for neighbor queries
 * 4. Density          - Calculate fluid density at each particle using SPH kernels
 * 5. Pressure         - Compute pressure forces from density gradients
 * 6. Viscosity        - Apply viscous forces to smooth velocity differences
 * 7. Integration      - Update positions and handle boundary collisions
 *
 * GPU/CPU Hybrid Mode:
 * The simulation supports running different stages on CPU or GPU, controlled
 * by SimulationOptions. By default, everything runs on GPU for maximum performance.
 */

import type { SimConfig, SimState } from '../common/types.ts';
import { createPhysics } from '../common/physics.ts';
import { createSpawnData } from '../common/spawn.ts';
import { SimulationBuffers } from './simulation_buffers.ts';
import { ComputePipelines } from './compute_pipelines.ts';
import { Renderer } from './renderer.ts';

/**
 * Configuration options for GPU/CPU execution modes.
 *
 * These flags allow fine-grained control over which simulation stages
 * run on GPU vs CPU. Useful for debugging, profiling, or fallback on
 * systems with limited GPU capabilities.
 */
export interface SimulationOptions {
  /** Run external forces and prediction on GPU (default: true) */
  useGpuExternalForces?: boolean;
  /** Run spatial hashing on GPU (default: true) */
  useGpuSpatialHash?: boolean;
  /** Run density calculation on GPU (default: true) */
  useGpuDensity?: boolean;
  /** Read density results back to CPU for debugging (default: false) */
  useGpuDensityReadback?: boolean;
  /** Use CPU spatial data with GPU density - for hybrid debugging (default: false) */
  useCpuSpatialDataForGpuDensity?: boolean;
  /** Run pressure calculation on GPU (default: true) */
  useGpuPressure?: boolean;
  /** Run viscosity calculation on GPU (default: true) */
  useGpuViscosity?: boolean;
}

/**
 * Default options: everything runs on GPU for maximum performance.
 */
const DEFAULT_OPTIONS: Required<SimulationOptions> = {
  useGpuExternalForces: true,
  useGpuSpatialHash: true,
  useGpuDensity: true,
  useGpuDensityReadback: false,
  useCpuSpatialDataForGpuDensity: false,
  useGpuPressure: true,
  useGpuViscosity: true,
};

/**
 * Main fluid simulation class that orchestrates GPU compute and rendering.
 *
 * This class manages:
 * - Simulation state (particle positions, velocities, densities)
 * - GPU buffers and compute pipelines
 * - The simulation loop with configurable substeps
 * - Rendering of particles and boundaries
 *
 * @example
 * ```typescript
 * const simulation = new FluidSimulation(device, context, canvas, config, format);
 *
 * // Animation loop
 * function frame(dt) {
 *   simulation.step(dt);
 *   simulation.render();
 *   requestAnimationFrame(frame);
 * }
 * ```
 */
export class FluidSimulation {
  /** WebGPU device for creating resources and submitting commands */
  private device: GPUDevice;
  /** Canvas context for presenting rendered frames */
  private context: GPUCanvasContext;
  /** Canvas element for size calculations */
  private canvas: HTMLCanvasElement;
  /** Simulation configuration (physics parameters, bounds, etc.) */
  private config: SimConfig;
  /** GPU/CPU execution mode options */
  private options: Required<SimulationOptions>;

  /** GPU buffers for particle data and spatial hash structures */
  private buffers!: SimulationBuffers;
  /** Compute pipelines for all simulation stages */
  private pipelines: ComputePipelines;
  /** Renderer for particles and boundaries */
  private renderer: Renderer;
  /** CPU physics implementation for hybrid mode */
  private physics!: ReturnType<typeof createPhysics>;
  /** Current simulation state (positions, velocities, etc.) */
  private state!: SimState;

  /**
   * Number of threads per workgroup in compute shaders.
   * 256 is a good balance for most GPUs. Each dispatch processes
   * ceil(particleCount / workgroupSize) workgroups.
   */
  private workgroupSize = 256;

  // ============================================================================
  // Uniform Data Arrays
  // ============================================================================
  // These typed arrays hold uniform data before uploading to GPU buffers.
  // Pre-allocating avoids garbage collection during the simulation loop.

  /** External forces uniform data (8 floats) */
  private computeData = new Float32Array(8);
  /** Spatial hash uniform data (4 floats) */
  private hashParamsData = new Float32Array(4);
  /** Sort uniform data (4 uints) */
  private sortParamsData = new Uint32Array(4);
  /** Density uniform data (12 floats) */
  private densityParamsData = new Float32Array(12);
  /** Pressure uniform data (12 floats) */
  private pressureParamsData = new Float32Array(12);
  /** Viscosity uniform data (12 floats) */
  private viscosityParamsData = new Float32Array(12);
  /** Integration uniform data (16 floats) */
  private integrateParamsData = new Float32Array(16);

  /**
   * Creates a new fluid simulation.
   *
   * @param device - WebGPU device for GPU operations
   * @param context - Canvas context for rendering
   * @param canvas - Canvas element for size calculations
   * @param config - Simulation configuration
   * @param format - Texture format for rendering
   * @param options - Optional GPU/CPU execution mode settings
   */
  constructor(
    device: GPUDevice,
    context: GPUCanvasContext,
    canvas: HTMLCanvasElement,
    config: SimConfig,
    format: GPUTextureFormat,
    options: SimulationOptions = {}
  ) {
    this.device = device;
    this.context = context;
    this.canvas = canvas;
    this.config = config;
    this.options = { ...DEFAULT_OPTIONS, ...options };

    // Create compute pipelines (compiled shaders)
    this.pipelines = new ComputePipelines(device);

    // Create renderer for visualization
    this.renderer = new Renderer(device, format, config);

    // Initialize simulation state and buffers
    this.reset();
  }

  /** Returns the current number of particles in the simulation */
  get particleCount(): number {
    return this.buffers.particleCount;
  }

  /** Returns the current simulation state (for input handling) */
  get simulationState(): SimState {
    return this.state;
  }

  /**
   * Calculates the scale factor from world units to pixels.
   * Used for converting mouse coordinates and calculating padding.
   */
  private getScale(): number {
    return this.canvas.width / this.config.boundsSize.x;
  }

  /**
   * Resets the simulation to initial state.
   *
   * This destroys existing buffers, creates new particles based on
   * the current configuration, and reinitializes all GPU resources.
   */
  reset(): void {
    // Clean up existing GPU buffers to prevent memory leaks
    if (this.buffers) {
      this.buffers.destroy();
    }

    // Generate initial particle positions and velocities
    const spawn = createSpawnData(this.config);

    // Create CPU-side state arrays
    this.state = this.createStateFromSpawn(spawn);

    // Create GPU buffers with initial data
    this.buffers = new SimulationBuffers(this.device, spawn);

    // Create CPU physics implementation (for hybrid mode or debugging)
    this.physics = createPhysics(this.state, this.config, () =>
      this.getScale()
    );

    // Recreate bind groups with new buffers
    this.pipelines.createBindGroups(this.buffers);
    this.renderer.createBindGroup(this.buffers);
  }

  /**
   * Refreshes physics settings after config changes.
   * Called when parameters like smoothing radius change.
   */
  refreshSettings(): void {
    this.physics.refreshSettings();
  }

  /**
   * Creates the initial simulation state from spawn data.
   *
   * @param spawn - Initial particle positions and velocities
   * @returns Complete simulation state with all arrays initialized
   */
  private createStateFromSpawn(spawn: {
    positions: Float32Array;
    velocities: Float32Array;
    count: number;
  }): SimState {
    return {
      // Core particle data
      positions: spawn.positions,
      predicted: new Float32Array(spawn.positions), // Copy of positions
      velocities: spawn.velocities,
      densities: new Float32Array(spawn.count * 2), // density + nearDensity per particle

      // Spatial hash data structures
      keys: new Uint32Array(spawn.count),
      sortedKeys: new Uint32Array(spawn.count),
      indices: new Uint32Array(spawn.count),
      sortOffsets: new Uint32Array(spawn.count),
      spatialOffsets: new Uint32Array(spawn.count),

      // Sorted particle data (for cache-friendly access)
      positionsSorted: new Float32Array(spawn.count * 2),
      predictedSorted: new Float32Array(spawn.count * 2),
      velocitiesSorted: new Float32Array(spawn.count * 2),

      // Particle count
      count: spawn.count,

      // User input state (mouse interaction)
      input: {
        worldX: 0,
        worldY: 0,
        pull: false, // Left mouse button - attract particles
        push: false, // Right mouse button - repel particles
      },
    };
  }

  /**
   * Advances the simulation by one frame.
   *
   * This method handles timestep calculation, runs multiple substeps
   * for stability, and dispatches GPU compute passes for each stage
   * of the SPH algorithm.
   *
   * @param dt - Delta time since last frame in seconds
   */
  async step(dt: number): Promise<void> {
    const { options, config, state, buffers, pipelines, device } = this;

    // ========================================================================
    // GPU Path: Run simulation on GPU
    // ========================================================================
    if (options.useGpuExternalForces) {
      // Calculate timestep with limits for stability
      const maxDeltaTime = config.maxTimestepFPS
        ? 1 / config.maxTimestepFPS
        : Number.POSITIVE_INFINITY;
      const frameTime = Math.min(dt * config.timeScale, maxDeltaTime);

      // Divide frame time into substeps for better stability
      // More substeps = more accurate but slower
      const timeStep = frameTime / config.iterationsPerFrame;

      // Calculate boundary padding to keep particles inside visible area
      // Scale by DPR since canvas.width uses device pixels but config uses CSS pixels
      const dpr = window.devicePixelRatio || 1;
      const paddingPx =
        (Math.max(1, Math.round(config.particleRadius)) + config.boundsPaddingPx) * dpr;
      const padding = paddingPx / this.getScale();
      const halfX = Math.max(0, config.boundsSize.x * 0.5 - padding);
      const halfY = Math.max(0, config.boundsSize.y * 0.5 - padding);

      // Check if obstacle is enabled
      const hasObstacle =
        config.obstacleSize.x > 0 && config.obstacleSize.y > 0;

      // ======================================================================
      // Run substeps
      // ======================================================================
      for (let i = 0; i < config.iterationsPerFrame; i++) {
        let shouldReadbackDensities = false;

        // Calculate interaction strength based on mouse buttons
        // Pull (left click) = positive, Push (right click) = negative
        const interactionStrength = state.input.push
          ? -config.interactionStrength
          : state.input.pull
            ? config.interactionStrength
            : 0;

        // ==================================================================
        // Stage 1: External Forces
        // ==================================================================
        // Apply gravity and user interaction, compute predicted positions

        // Pack uniform data for external forces shader
        this.computeData[0] = timeStep;
        this.computeData[1] = config.gravity;
        this.computeData[2] = config.interactionRadius;
        this.computeData[3] = interactionStrength;
        this.computeData[4] = state.input.worldX; // Mouse X in world coords
        this.computeData[5] = state.input.worldY; // Mouse Y in world coords
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

        // ==================================================================
        // Stage 2: Spatial Hashing (optional CPU fallback)
        // ==================================================================
        // Build spatial acceleration structure for neighbor queries

        if (!options.useGpuDensity || options.useCpuSpatialDataForGpuDensity) {
          // Run spatial hash on CPU (for hybrid mode or debugging)
          this.physics.predictPositions();
          this.physics.runSpatialHash();
        }

        // ==================================================================
        // Stage 3: Density Calculation
        // ==================================================================
        // Calculate fluid density at each particle position

        if (options.useGpuDensity) {
          if (options.useCpuSpatialDataForGpuDensity) {
            // Upload CPU spatial data to GPU for hybrid debugging
            device.queue.writeBuffer(
              buffers.predicted,
              0,
              state.predicted as Float32Array<ArrayBuffer>
            );
            device.queue.writeBuffer(
              buffers.sortedKeys,
              0,
              state.sortedKeys as Uint32Array<ArrayBuffer>
            );
            device.queue.writeBuffer(
              buffers.spatialOffsets,
              0,
              state.spatialOffsets as Uint32Array<ArrayBuffer>
            );
          } else if (options.useGpuSpatialHash) {
            // Run spatial hashing entirely on GPU
            this.dispatchSpatialHash(encoder);
          }

          // Dispatch density compute pass
          this.updateDensityUniforms();
          const densityPass = encoder.beginComputePass();
          densityPass.setPipeline(pipelines.density);
          densityPass.setBindGroup(0, pipelines.densityBindGroup);
          densityPass.dispatchWorkgroups(
            Math.ceil(buffers.particleCount / this.workgroupSize)
          );
          densityPass.end();

          // Optionally copy density results for CPU readback
          if (options.useGpuDensityReadback) {
            encoder.copyBufferToBuffer(
              buffers.densities,
              0,
              buffers.densityReadback,
              0,
              buffers.particleCount * 2 * 4
            );
            shouldReadbackDensities = true;
          }
        } else {
          // Run density calculation on CPU
          this.physics.calculateDensities();
          if (options.useGpuPressure) {
            // Upload CPU densities for GPU pressure calculation
            device.queue.writeBuffer(
              buffers.densities,
              0,
              state.densities as Float32Array<ArrayBuffer>
            );
          }
        }

        // ==================================================================
        // Stage 4: Pressure Forces
        // ==================================================================
        // Compute pressure forces from density gradients

        if (options.useGpuPressure) {
          this.updatePressureUniforms(timeStep);
          const pressurePass = encoder.beginComputePass();
          pressurePass.setPipeline(pipelines.pressure);
          pressurePass.setBindGroup(0, pipelines.pressureBindGroup);
          pressurePass.dispatchWorkgroups(
            Math.ceil(buffers.particleCount / this.workgroupSize)
          );
          pressurePass.end();
        } else {
          this.physics.calculatePressure(timeStep);
        }

        // ==================================================================
        // Stage 5: Viscosity Forces
        // ==================================================================
        // Apply viscous damping between neighboring particles

        if (options.useGpuViscosity) {
          this.updateViscosityUniforms(timeStep);
          const viscosityPass = encoder.beginComputePass();
          viscosityPass.setPipeline(pipelines.viscosity);
          viscosityPass.setBindGroup(0, pipelines.viscosityBindGroup);
          viscosityPass.dispatchWorkgroups(
            Math.ceil(buffers.particleCount / this.workgroupSize)
          );
          viscosityPass.end();
        } else {
          this.physics.calculateViscosity(timeStep);
        }

        // ==================================================================
        // Stage 6: Integration
        // ==================================================================
        // Update positions from velocities and handle boundary collisions

        this.updateIntegrateUniforms(timeStep, halfX, halfY, hasObstacle);
        const integratePass = encoder.beginComputePass();
        integratePass.setPipeline(pipelines.integrate);
        integratePass.setBindGroup(0, pipelines.integrateBindGroup);
        integratePass.dispatchWorkgroups(
          Math.ceil(buffers.particleCount / this.workgroupSize)
        );
        integratePass.end();

        // Submit all commands for this substep
        device.queue.submit([encoder.finish()]);

        // ==================================================================
        // Optional: Read back density data to CPU
        // ==================================================================
        if (shouldReadbackDensities) {
          await buffers.densityReadback.mapAsync(GPUMapMode.READ);
          const mapped = new Float32Array(
            buffers.densityReadback.getMappedRange()
          );
          state.densities.set(mapped);
          buffers.densityReadback.unmap();
        }
      }
    } else {
      // ======================================================================
      // CPU Path: Run entire simulation on CPU
      // ======================================================================
      this.physics.step(dt);
    }

    // ========================================================================
    // Sync CPU data to GPU (for CPU simulation mode)
    // ========================================================================
    if (!options.useGpuExternalForces) {
      device.queue.writeBuffer(
        buffers.positions,
        0,
        state.positions as Float32Array<ArrayBuffer>
      );
      device.queue.writeBuffer(
        buffers.velocities,
        0,
        state.velocities as Float32Array<ArrayBuffer>
      );
      device.queue.writeBuffer(
        buffers.predicted,
        0,
        state.predicted as Float32Array<ArrayBuffer>
      );
    }
  }

  /**
   * Dispatches all spatial hashing compute passes.
   *
   * Spatial hashing allows O(n·k) neighbor lookups instead of O(n²).
   * The algorithm:
   * 1. Hash: Compute spatial hash key for each particle
   * 2. Clear: Zero the bucket counters
   * 3. Count: Count particles per bucket using atomics
   * 4. Scatter: Prefix sum + scatter to sorted order
   * 5. Build Offsets: Create lookup table for each cell
   *
   * @param encoder - Command encoder to record compute passes
   */
  private dispatchSpatialHash(encoder: GPUCommandEncoder): void {
    const { pipelines, buffers } = this;
    const workgroups = Math.ceil(buffers.particleCount / this.workgroupSize);

    // Update hash uniforms (smoothing radius determines cell size)
    this.hashParamsData[0] = this.config.smoothingRadius;
    this.hashParamsData[1] = buffers.particleCount;
    this.device.queue.writeBuffer(
      pipelines.uniformBuffers.hash,
      0,
      this.hashParamsData
    );

    // Update sort uniforms
    this.sortParamsData[0] = buffers.particleCount;
    this.device.queue.writeBuffer(
      pipelines.uniformBuffers.sort,
      0,
      this.sortParamsData
    );

    // Pass 1: Compute spatial hash key for each particle
    const hashPass = encoder.beginComputePass();
    hashPass.setPipeline(pipelines.hash);
    hashPass.setBindGroup(0, pipelines.hashBindGroup);
    hashPass.dispatchWorkgroups(workgroups);
    hashPass.end();

    // Pass 2: Clear bucket counters to zero
    const clearPass = encoder.beginComputePass();
    clearPass.setPipeline(pipelines.clearOffsets);
    clearPass.setBindGroup(0, pipelines.clearOffsetsBindGroup);
    clearPass.dispatchWorkgroups(workgroups);
    clearPass.end();

    // Pass 3: Count particles per bucket using atomic operations
    const countPass = encoder.beginComputePass();
    countPass.setPipeline(pipelines.countOffsets);
    countPass.setBindGroup(1, pipelines.countOffsetsBindGroup);
    countPass.dispatchWorkgroups(workgroups);
    countPass.end();

    // Pass 4: Prefix sum + scatter particles to sorted positions
    // This runs as a single workgroup to compute prefix sum sequentially
    const scatterPass = encoder.beginComputePass();
    scatterPass.setPipeline(pipelines.scatter);
    scatterPass.setBindGroup(0, pipelines.scatterBindGroup);
    scatterPass.dispatchWorkgroups(1);
    scatterPass.end();

    // Pass 5: Build spatial offset lookup table
    // spatialOffsets[key] = first index where key appears in sorted array
    const spatialPass = encoder.beginComputePass();
    spatialPass.setPipeline(pipelines.spatialOffsets);
    spatialPass.setBindGroup(0, pipelines.spatialOffsetsBindGroup);
    spatialPass.dispatchWorkgroups(1);
    spatialPass.end();
  }

  /**
   * Updates uniform buffer for density calculation.
   *
   * Precomputes SPH kernel scaling factors to avoid redundant
   * calculations in the shader.
   */
  private updateDensityUniforms(): void {
    const radius = this.config.smoothingRadius;

    // Spiky kernel scaling factors for density estimation
    // These are derived from the kernel normalization constants
    const spikyPow2Scale = 6 / (Math.PI * Math.pow(radius, 4));
    const spikyPow3Scale = 10 / (Math.PI * Math.pow(radius, 5));

    this.densityParamsData[0] = radius;
    this.densityParamsData[1] = spikyPow2Scale;
    this.densityParamsData[2] = spikyPow3Scale;
    this.densityParamsData[3] = this.buffers.particleCount;

    this.device.queue.writeBuffer(
      this.pipelines.uniformBuffers.density,
      0,
      this.densityParamsData
    );
  }

  /**
   * Updates uniform buffer for pressure calculation.
   *
   * @param timeStep - Current timestep for force integration
   */
  private updatePressureUniforms(timeStep: number): void {
    const radius = this.config.smoothingRadius;

    // Spiky kernel derivative scaling factors for pressure gradient
    const spikyPow2DerivScale = 12 / (Math.PI * Math.pow(radius, 4));
    const spikyPow3DerivScale = 30 / (Math.PI * Math.pow(radius, 5));

    this.pressureParamsData[0] = timeStep;
    this.pressureParamsData[1] = this.config.targetDensity;
    this.pressureParamsData[2] = this.config.pressureMultiplier;
    this.pressureParamsData[3] = this.config.nearPressureMultiplier;
    this.pressureParamsData[4] = radius;
    this.pressureParamsData[5] = spikyPow2DerivScale;
    this.pressureParamsData[6] = spikyPow3DerivScale;
    this.pressureParamsData[7] = this.buffers.particleCount;

    this.device.queue.writeBuffer(
      this.pipelines.uniformBuffers.pressure,
      0,
      this.pressureParamsData
    );
  }

  /**
   * Updates uniform buffer for viscosity calculation.
   *
   * @param timeStep - Current timestep for force integration
   */
  private updateViscosityUniforms(timeStep: number): void {
    const radius = this.config.smoothingRadius;

    // Poly6 kernel scaling factor for viscosity smoothing
    const poly6Scale = 4 / (Math.PI * Math.pow(radius, 8));

    this.viscosityParamsData[0] = timeStep;
    this.viscosityParamsData[1] = this.config.viscosityStrength;
    this.viscosityParamsData[2] = radius;
    this.viscosityParamsData[3] = poly6Scale;
    this.viscosityParamsData[4] = this.buffers.particleCount;

    this.device.queue.writeBuffer(
      this.pipelines.uniformBuffers.viscosity,
      0,
      this.viscosityParamsData
    );
  }

  /**
   * Updates uniform buffer for position integration.
   *
   * @param timeStep - Current timestep
   * @param halfX - Half of the boundary width (for collision)
   * @param halfY - Half of the boundary height (for collision)
   * @param hasObstacle - Whether an obstacle is present
   */
  private updateIntegrateUniforms(
    timeStep: number,
    halfX: number,
    halfY: number,
    hasObstacle: boolean
  ): void {
    // Pack uniform data for integration shader
    this.integrateParamsData[0] = timeStep;
    this.integrateParamsData[1] = this.config.collisionDamping;
    this.integrateParamsData[2] = hasObstacle ? 1 : 0;
    this.integrateParamsData[3] = 0; // Padding

    // Boundary half-extents
    this.integrateParamsData[4] = halfX;
    this.integrateParamsData[5] = halfY;
    this.integrateParamsData[6] = 0; // Padding
    this.integrateParamsData[7] = 0; // Padding

    // Obstacle parameters
    this.integrateParamsData[8] = this.config.obstacleCentre.x;
    this.integrateParamsData[9] = this.config.obstacleCentre.y;
    this.integrateParamsData[10] = this.config.obstacleSize.x * 0.5;
    this.integrateParamsData[11] = this.config.obstacleSize.y * 0.5;

    this.device.queue.writeBuffer(
      this.pipelines.uniformBuffers.integrate,
      0,
      this.integrateParamsData
    );
  }

  /**
   * Renders the current simulation state.
   *
   * Updates uniforms, creates a command encoder, records render commands,
   * and submits to the GPU queue.
   */
  render(): void {
    // Update render uniforms (bounds size, canvas size, etc.)
    this.renderer.updateUniforms(
      this.config,
      this.canvas.width,
      this.canvas.height
    );

    // Create command encoder and record render pass
    const encoder = this.device.createCommandEncoder();
    this.renderer.render(
      encoder,
      this.context,
      this.config,
      this.buffers.particleCount
    );

    // Submit render commands to GPU
    this.device.queue.submit([encoder.finish()]);
  }
}
