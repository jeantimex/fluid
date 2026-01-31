/**
 * =============================================================================
 * 3D Fluid Simulation Orchestrator for WebGPU (Linear Grid)
 * =============================================================================
 *
 * This class coordinates the entire SPH (Smoothed Particle Hydrodynamics)
 * simulation pipeline on the GPU. It manages the simulation state, GPU resources,
 * and the execution of compute passes in the correct order.
 *
 * This version uses the Linear Grid approach for O(1) neighbor search.
 *
 * @module fluid_simulation
 */

import type { SimConfig, SimState } from '../common/types.ts';
import { createSpawnData } from '../common/spawn.ts';
import { SimulationBuffersLinear } from './simulation_buffers_linear.ts';
import { ComputePipelinesLinear } from './compute_pipelines_linear.ts';
import { ScreenSpaceRenderer } from './screen_space/screen_space_renderer.ts';

/**
 * Orchestrates the full SPH fluid simulation pipeline on the GPU.
 *
 * Each simulation frame executes the following compute passes (per iteration):
 *   1. External forces & position prediction
 *   2. Spatial hashing (Linear Grid: hash → clear → count → prefix sum → scatter → reorder → copy back)
 *   3. Density estimation (Spiky² / Spiky³ kernels)
 *   4. Pressure forces (symmetric EOS with near-pressure)
 *   5. Viscosity damping (Poly6 kernel)
 *   6. Integration & boundary collision
 *
 * Rendering adds a frustum-culling pass followed by indirect instanced drawing.
 */
export class FluidSimulation {
  // ===========================================================================
  // Core References
  // ===========================================================================

  /** GPU device handle used for buffer writes and command submission. */
  private device: GPUDevice;

  /** Canvas context used to obtain the current swap-chain texture for rendering. */
  private context: GPUCanvasContext;

  /** Canvas element used for sizing screen-space passes. */
  private canvas: HTMLCanvasElement;

  /** Simulation configuration (bounds, radii, multipliers, etc.). */
  private config: SimConfig;

  // ===========================================================================
  // Subsystems
  // ===========================================================================

  /** GPU buffer manager — owns all particle and sorting buffers. */
  private buffers!: SimulationBuffersLinear;

  /** Compute pipeline manager — owns all pipelines and bind groups. */
  private pipelines: ComputePipelinesLinear;

  /** Render pipeline manager — owns the screen-space render passes. */
  private renderer: ScreenSpaceRenderer;

  /** CPU-side snapshot of simulation state (positions, velocities, input). */
  private state!: SimState;

  // ===========================================================================
  // Grid Configuration
  // ===========================================================================

  /** Number of threads per compute workgroup (matches shader @workgroup_size). */
  private workgroupSize = 256;

  /** Linear grid resolution along each axis: ceil(boundsSize / smoothingRadius). */
  private gridRes = { x: 0, y: 0, z: 0 };

  /** Total number of cells in the linear grid (gridRes.x × gridRes.y × gridRes.z). */
  private gridTotalCells = 0;

  // ===========================================================================
  // CPU-Side Uniform Staging Buffers
  // ===========================================================================
  // Pre-allocated typed arrays used to stage uniform data before uploading to
  // the GPU via `device.queue.writeBuffer()`. Sizes match the corresponding
  // WGSL struct layouts (including padding for 16-byte alignment).

  /** External forces params: [dt, gravity, interactionRadius, strength, inputX, inputY, inputZ, pad]. */
  private computeData = new Float32Array(8);

  /** Integration params: [dt, damping, hasObstacle, pad, halfBounds(3), pad, obstacleCenter(3), pad, obstacleHalf(3), pad]. */
  private integrateData = new Float32Array(16);

  /** Hash params: [radius, particleCount, minBoundsX/Y/Z, gridResX/Y/Z]. */
  private hashParamsData = new Float32Array(8);

  /** Sort params: [particleCount, gridTotalCells, pad, pad]. */
  private sortParamsData = new Uint32Array(8);

  /** Prefix-sum scan params for level 0: [elementCount, pad, pad, pad]. */
  private scanParamsDataL0 = new Uint32Array(4);

  /** Prefix-sum scan params for level 1: [elementCount, pad, pad, pad]. */
  private scanParamsDataL1 = new Uint32Array(4);

  /** Prefix-sum scan params for level 2: [elementCount, pad, pad, pad]. */
  private scanParamsDataL2 = new Uint32Array(4);

  /** Density params: [radius, spikyPow2Scale, spikyPow3Scale, particleCount, minBounds(3), pad, gridRes(3), pad]. */
  private densityParamsData = new Float32Array(12);

  /** Pressure params: [dt, targetDensity, pressureMul, nearPressureMul, radius, pow2DerivScale, pow3DerivScale, count, minBounds(3), pad, gridRes(3), pad]. */
  private pressureParamsData = new Float32Array(16);

  /** Viscosity params: [dt, viscosity, radius, poly6Scale, count, minBounds(3), gridRes(3), pad]. */
  private viscosityParamsData = new Float32Array(12);

  /** Foam spawn params: [dt, airRate, airMin, airMax, kinMin, kinMax, maxFoam(u32), frameCount(u32), count(u32), radius, minBounds(3), gridRes(3), bubbleScale, pad(7)]. Total 28 floats = 112 bytes. */
  private foamSpawnData = new Float32Array(28);

  /** Foam update params: [dt, gravity, dragCoeff, buoyancy, boundsHalf(3), radius, minBounds(3), pad, gridRes(3), pad, minBubble(u32), maxSpray(u32), pad(2)]. Total 28 floats = 112 bytes. */
  private foamUpdateData = new Float32Array(28);

  /** Frame counter for foam RNG seed (increments each step call). */
  private foamFrameCount = 0;

  /** Accumulated simulation time for spawn-rate fade-in. */
  private simTimer = 0;

  /**
   * Creates a new fluid simulation instance.
   *
   * Initialises compute pipelines and the renderer, then calls {@link reset}
   * to spawn particles and allocate GPU buffers.
   *
   * @param device  - WebGPU device for resource creation
   * @param context - Canvas context for swap-chain texture access
   * @param canvas  - HTML canvas element (used by Renderer for sizing)
   * @param config  - Simulation parameters (bounds, radii, multipliers, etc.)
   * @param format  - Preferred swap-chain texture format (e.g. `'bgra8unorm'`)
   */
  constructor(
    device: GPUDevice,
    context: GPUCanvasContext,
    canvas: HTMLCanvasElement,
    config: SimConfig,
    format: GPUTextureFormat
  ) {
    this.device = device;
    this.context = context;
    this.canvas = canvas;
    this.config = config;

    this.pipelines = new ComputePipelinesLinear(device);
    this.renderer = new ScreenSpaceRenderer(device, canvas, format, config);

    this.reset();
  }

  /** Total number of active particles in the simulation. */
  get particleCount(): number {
    return this.buffers.particleCount;
  }

  /** CPU-side snapshot of the simulation state (positions, velocities, input). */
  get simulationState(): SimState {
    return this.state;
  }

  /**
   * Resets the simulation to its initial state.
   *
   * Re-computes the linear grid resolution from the current config, spawns new
   * particle data, re-creates all GPU buffers, and rebuilds bind groups for
   * both compute and render pipelines.
   */
  reset(): void {
    if (this.buffers) {
      this.buffers.destroy();
    }

    this.simTimer = 0;
    this.foamFrameCount = 0;

    const { boundsSize, smoothingRadius } = this.config;
    this.gridRes = {
      x: Math.ceil(boundsSize.x / smoothingRadius),
      y: Math.ceil(boundsSize.y / smoothingRadius),
      z: Math.ceil(boundsSize.z / smoothingRadius),
    };
    this.gridTotalCells = this.gridRes.x * this.gridRes.y * this.gridRes.z;

    const spawn = createSpawnData(this.config);
    this.state = this.createStateFromSpawn(spawn);

    this.buffers = new SimulationBuffersLinear(
      this.device,
      spawn,
      this.gridTotalCells
    );

    this.pipelines.createBindGroups(this.buffers);
    this.renderer.createBindGroups(this.buffers);
  }

  /**
   * Builds the CPU-side {@link SimState} from freshly spawned particle data.
   *
   * Allocates typed arrays for all per-particle properties and initialises the
   * user-input struct to a neutral state (no interaction).
   */
  private createStateFromSpawn(spawn: {
    positions: Float32Array;
    velocities: Float32Array;
    count: number;
  }): SimState {
    return {
      positions: spawn.positions,
      predicted: new Float32Array(spawn.positions),
      velocities: spawn.velocities,
      densities: new Float32Array(spawn.count * 2),
      keys: new Uint32Array(spawn.count),
      sortedKeys: new Uint32Array(spawn.count), // Not used in Linear but kept for interface compatibility
      indices: new Uint32Array(spawn.count),
      sortOffsets: new Uint32Array(spawn.count), // This might be wrong size for CPU state but it's for UI mainly?
      spatialOffsets: new Uint32Array(spawn.count),
      positionsSorted: new Float32Array(spawn.count * 4),
      predictedSorted: new Float32Array(spawn.count * 4),
      velocitiesSorted: new Float32Array(spawn.count * 4),
      count: spawn.count,
      input: { worldX: 0, worldY: 0, worldZ: 0, pull: false, push: false },
    };
  }

  /**
   * Advances the simulation by one frame.
   *
   * Runs {@link SimConfig.iterationsPerFrame} sub-steps, each executing the
   * full SPH pipeline: external forces → spatial hash → density → pressure →
   * viscosity → integration. The effective timestep is clamped by
   * `config.maxTimestepFPS` and scaled by `config.timeScale`.
   *
   * @param dt - Wall-clock delta time in seconds since the last frame
   */
  async step(dt: number): Promise<void> {
    const { config, buffers, pipelines, device, state } = this;

    const maxDeltaTime = config.maxTimestepFPS
      ? 1 / config.maxTimestepFPS
      : Number.POSITIVE_INFINITY;
    const frameTime = Math.min(dt * config.timeScale, maxDeltaTime);
    this.simTimer += frameTime;
    const timeStep = frameTime / config.iterationsPerFrame;

    for (let i = 0; i < config.iterationsPerFrame; i++) {
      // 1. External Forces
      let interactionStrength = 0;
      if (state.input.push) interactionStrength = -config.interactionStrength;
      else if (state.input.pull)
        interactionStrength = config.interactionStrength;

      this.computeData[0] = timeStep;
      this.computeData[1] = config.gravity;
      this.computeData[2] = config.interactionRadius;
      this.computeData[3] = interactionStrength;
      this.computeData[4] = state.input.worldX;
      this.computeData[5] = state.input.worldY;
      this.computeData[6] = state.input.worldZ;
      this.computeData[7] = 0;

      device.queue.writeBuffer(
        pipelines.uniformBuffers.compute,
        0,
        this.computeData
      );

      const encoder = device.createCommandEncoder();

      const computePass = encoder.beginComputePass();
      computePass.setPipeline(pipelines.externalForces);
      computePass.setBindGroup(0, pipelines.externalForcesBindGroup);
      computePass.dispatchWorkgroups(
        Math.ceil(buffers.particleCount / this.workgroupSize)
      );
      computePass.end();

      // 2. Spatial Hash (Linear Grid)
      this.dispatchSpatialHash(encoder);

      // 3. Density
      this.updateDensityUniforms();
      const densityPass = encoder.beginComputePass();
      densityPass.setPipeline(pipelines.density);
      densityPass.setBindGroup(0, pipelines.densityBindGroup);
      densityPass.dispatchWorkgroups(
        Math.ceil(buffers.particleCount / this.workgroupSize)
      );
      densityPass.end();

      // 4. Pressure
      this.updatePressureUniforms(timeStep);
      const pressurePass = encoder.beginComputePass();
      pressurePass.setPipeline(pipelines.pressure);
      pressurePass.setBindGroup(0, pipelines.pressureBindGroup);
      pressurePass.dispatchWorkgroups(
        Math.ceil(buffers.particleCount / this.workgroupSize)
      );
      pressurePass.end();

      // 5. Viscosity
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

      // 6. Integration
      this.updateIntegrateUniforms(timeStep);
      const integratePass = encoder.beginComputePass();
      integratePass.setPipeline(pipelines.integrate);
      integratePass.setBindGroup(0, pipelines.integrateBindGroup);
      integratePass.dispatchWorkgroups(
        Math.ceil(buffers.particleCount / this.workgroupSize)
      );
      integratePass.end();

      device.queue.submit([encoder.finish()]);
    }

    // Foam simulation (once per frame, not per iteration)
    this.dispatchFoam(frameTime);
  }

  /**
   * Dispatches the full Linear Grid spatial hashing pipeline.
   *
   * Encodes seven sequential compute passes into the given command encoder:
   *   1. **Hash** — assign each particle a linear grid index
   *   2. **Clear** — zero the histogram (sortOffsets) buffer
   *   3. **Count** — build a histogram of particles per grid cell
   *   4. **Prefix Sum** — convert histogram to exclusive scan (start offsets),
   *      using a 3-level hierarchical Blelloch scan when the grid exceeds 512 cells
   *   5. **Scatter** — place each particle at its sorted position (contention-free)
   *   6. **Reorder** — gather particle data into spatially sorted buffers
   *   7. **Copy Back** — write sorted data back to primary buffers
   *
   * After this method returns, particle buffers (positions, velocities,
   * predicted) are physically reordered so that particles in the same grid
   * cell are contiguous in memory, enabling cache-efficient neighbor search.
   *
   * @param encoder - Active command encoder to record compute passes into
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

  /**
   * Dispatches the foam particle system compute passes.
   *
   * Runs three passes per frame:
   *   1. Clear foam spawn counter (single thread)
   *   2. Spawn foam particles from high-velocity surface fluid particles
   *   3. Update foam particle physics (gravity, drag, lifetime, boundaries)
   *
   * @param frameTime - Total frame delta time in seconds
   */
  private dispatchFoam(frameTime: number): void {
    const { pipelines, buffers, device, config } = this;
    const maxFoam = SimulationBuffersLinear.MAX_FOAM_PARTICLES;

    this.foamFrameCount++;

    // ========================================================================
    // Update foam spawn uniforms - MATCHING CONFIG/UNITY
    // ========================================================================
    // Apply spawn-rate fade-in (quadratic ease-in)
    const fadeInT =
      config.spawnRateFadeInTime <= 0
        ? 1
        : Math.min(
            1,
            Math.max(
              0,
              (this.simTimer - config.spawnRateFadeStartTime) /
                config.spawnRateFadeInTime
            )
          );

    this.foamSpawnData[0] = frameTime;
    this.foamSpawnData[1] = config.foamSpawnRate * fadeInT * fadeInT;
    this.foamSpawnData[2] = config.trappedAirVelocityMin;
    this.foamSpawnData[3] = config.trappedAirVelocityMax;
    this.foamSpawnData[4] = config.foamKineticEnergyMin;
    this.foamSpawnData[5] = config.foamKineticEnergyMax;

    const u32SpawnView = new Uint32Array(this.foamSpawnData.buffer);
    u32SpawnView[6] = maxFoam;
    u32SpawnView[7] = this.foamFrameCount;
    this.foamSpawnData[8] = buffers.particleCount;

    this.foamSpawnData[9] = config.smoothingRadius;
    this.foamSpawnData[10] = config.foamLifetimeMin;
    this.foamSpawnData[11] = config.foamLifetimeMax;

    this.foamSpawnData[12] = -config.boundsSize.x * 0.5;
    this.foamSpawnData[13] = -config.boundsSize.y * 0.5;
    this.foamSpawnData[14] = -config.boundsSize.z * 0.5;
    // Padding at 15 (alignment for vec3)
    this.foamSpawnData[16] = this.gridRes.x;
    this.foamSpawnData[17] = this.gridRes.y;
    this.foamSpawnData[18] = this.gridRes.z;
    this.foamSpawnData[19] = config.bubbleScale;

    device.queue.writeBuffer(
      pipelines.uniformBuffers.foamSpawn,
      0,
      this.foamSpawnData
    );

    // ========================================================================
    // Update foam update uniforms - MATCHING CONFIG/UNITY
    // ========================================================================
    this.foamUpdateData[0] = frameTime;
    this.foamUpdateData[1] = config.gravity;
    this.foamUpdateData[2] = 0.04; // dragCoeff (internal constant in Unity shader)
    this.foamUpdateData[3] = config.bubbleBuoyancy;

    this.foamUpdateData[4] = config.boundsSize.x * 0.5;
    this.foamUpdateData[5] = config.boundsSize.y * 0.5;
    this.foamUpdateData[6] = config.boundsSize.z * 0.5;
    this.foamUpdateData[7] = config.smoothingRadius;

    this.foamUpdateData[8] = -config.boundsSize.x * 0.5;
    this.foamUpdateData[9] = -config.boundsSize.y * 0.5;
    this.foamUpdateData[10] = -config.boundsSize.z * 0.5;
    this.foamUpdateData[11] = 0; // pad

    this.foamUpdateData[12] = this.gridRes.x;
    this.foamUpdateData[13] = this.gridRes.y;
    this.foamUpdateData[14] = this.gridRes.z;
    this.foamUpdateData[15] = 0; // pad

    // Classification counts: [minBubble, maxSpray]
    const u32Update = new Uint32Array(this.foamUpdateData.buffer);
    u32Update[16] = config.bubbleClassifyMinNeighbours;
    u32Update[17] = config.sprayClassifyMaxNeighbours;
    this.foamUpdateData[18] = config.bubbleScale;
    this.foamUpdateData[19] = config.bubbleChangeScaleSpeed;

    device.queue.writeBuffer(
      pipelines.uniformBuffers.foamUpdate,
      0,
      this.foamUpdateData
    );

    const encoder = device.createCommandEncoder();

    // 1. Clear foam spawn counter - REMOVED to allow ring buffer accumulation
    // The counter should wrap around MAX_FOAM naturally

    // 2. Spawn foam particles (per fluid particle)
    const spawnPass = encoder.beginComputePass();
    spawnPass.setPipeline(pipelines.foamSpawn);
    spawnPass.setBindGroup(0, pipelines.foamSpawnBindGroup);
    spawnPass.dispatchWorkgroups(
      Math.ceil(buffers.particleCount / this.workgroupSize)
    );
    spawnPass.end();

    // 3. Update foam particles (per MAX_FOAM)
    const updatePass = encoder.beginComputePass();
    updatePass.setPipeline(pipelines.foamUpdate);
    updatePass.setBindGroup(0, pipelines.foamUpdateBindGroup);
    updatePass.dispatchWorkgroups(Math.ceil(maxFoam / this.workgroupSize));
    updatePass.end();

    device.queue.submit([encoder.finish()]);
  }

  /**
   * Uploads density shader uniforms to the GPU.
   *
   * Computes the Spiky² and Spiky³ kernel normalisation constants from the
   * current smoothing radius and writes them along with grid parameters
   * into the density uniform buffer.
   *
   * Kernel normalisations (3D):
   *   - spikyPow2Scale = 15 / (2π h⁵)
   *   - spikyPow3Scale = 15 / (π h⁶)
   */
  private updateDensityUniforms(): void {
    const radius = this.config.smoothingRadius;
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
   * Uploads pressure shader uniforms to the GPU.
   *
   * Computes the Spiky kernel *gradient* normalisation constants and writes
   * them along with the equation-of-state parameters and grid layout.
   *
   * Gradient normalisations (3D):
   *   - spikyPow2DerivScale = 15 / (π h⁵)
   *   - spikyPow3DerivScale = 45 / (π h⁶)
   *
   * @param timeStep - Sub-step delta time for velocity integration
   */
  private updatePressureUniforms(timeStep: number): void {
    const radius = this.config.smoothingRadius;
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
   * Uploads viscosity shader uniforms to the GPU.
   *
   * Computes the Poly6 kernel normalisation constant and writes it along
   * with viscosity strength, grid resolution, and bounds.
   *
   * Poly6 normalisation (3D):
   *   - poly6Scale = 315 / (64π h⁹)
   *
   * @param timeStep - Sub-step delta time for velocity integration
   */
  private updateViscosityUniforms(timeStep: number): void {
    const radius = this.config.smoothingRadius;
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
   * Uploads integration shader uniforms to the GPU.
   *
   * Packs the timestep, collision damping, boundary half-extents, and
   * optional obstacle parameters into the integration uniform buffer.
   *
   * The buffer layout matches the `IntegrateParams` WGSL struct (64 bytes):
   *   [dt, damping, hasObstacle, pad, halfBoundsXYZ, pad,
   *    obstacleCenterXYZ, pad, obstacleHalfXYZ, pad]
   *
   * @param timeStep - Sub-step delta time for position integration
   */
  private updateIntegrateUniforms(timeStep: number): void {
    this.integrateData[0] = timeStep;
    this.integrateData[1] = this.config.collisionDamping;
    const hasObstacle =
      this.config.obstacleSize.x > 0 &&
      this.config.obstacleSize.y > 0 &&
      this.config.obstacleSize.z > 0;
    this.integrateData[2] = hasObstacle ? 1 : 0;
    const hx = this.config.boundsSize.x * 0.5;
    const hy = this.config.boundsSize.y * 0.5;
    const hz = this.config.boundsSize.z * 0.5;
    this.integrateData[4] = hx;
    this.integrateData[5] = hy;
    this.integrateData[6] = hz;
    this.integrateData[8] = this.config.obstacleCentre.x;
    this.integrateData[9] = this.config.obstacleCentre.y;
    this.integrateData[10] = this.config.obstacleCentre.z;
    this.integrateData[12] = this.config.obstacleSize.x * 0.5;
    this.integrateData[13] = this.config.obstacleSize.y * 0.5;
    this.integrateData[14] = this.config.obstacleSize.z * 0.5;

    this.device.queue.writeBuffer(
      this.pipelines.uniformBuffers.integrate,
      0,
      this.integrateData
    );
  }

  /**
   * Renders the current simulation state.
   *
   * Handles canvas resize, dispatches the frustum-culling pass, and then
   * delegates to the {@link ScreenSpaceRenderer} for the actual draw calls.
   *
   * @param viewMatrix - 4×4 camera view matrix (column-major Float32Array)
   */
  render(viewMatrix: Float32Array): void {
    this.renderer.resize(this.canvas.width, this.canvas.height);
    const encoder = this.device.createCommandEncoder();
    this.renderer.render(
      encoder,
      this.context.getCurrentTexture().createView(),
      viewMatrix
    );
    this.device.queue.submit([encoder.finish()]);
  }
}
