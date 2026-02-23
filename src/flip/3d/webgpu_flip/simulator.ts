import flipSimulationShader from './shaders/flip_simulation.wgsl?raw';

/**
 * GPU FLIP Fluid Simulation Driver
 *
 * This class orchestrates the 3D FLIP (Fluid-Implicit-Particle) simulation
 * running entirely on the GPU via WebGPU compute shaders.
 *
 * ## Architecture
 *
 * The simulator owns:
 * - **Grid buffers**: MAC-staggered velocity grid, pressure, divergence, markers
 * - **Compute pipelines**: 11 pipelines for the 12-step simulation loop
 * - **Uniform buffer**: Per-frame parameters (grid dims, forces, timestep)
 *
 * Particle buffers (positions, velocities) are owned externally and passed
 * via bind groups, allowing the renderer to share them for visualization.
 *
 * ## Per-Frame Simulation Loop (12 steps)
 *
 * ```
 * 1. clearGrid        - Zero all grid arrays
 * 2. transferToGrid   - P2G: Splat particle momentum to grid
 * 3. markCells        - Flag cells containing fluid
 * 4. normalizeGrid    - Convert weighted sums to velocities, save snapshot
 * 5. addGravity       - Apply gravity and mouse forces
 * 6. enforceBoundary  - Apply wall boundary conditions
 * 7. computeDivergence- Calculate velocity divergence
 * 8. jacobi (x50)     - Solve pressure Poisson equation
 * 9. applyPressure    - Subtract pressure gradient
 * 10. enforceBoundary - Re-apply boundaries after projection
 * 11. gridToParticle  - G2P: Blend PIC/FLIP velocity update
 * 12. advect          - Move particles through velocity field
 * ```
 *
 * ## Grid Layout
 *
 * - **Velocity grid**: (nx+1) x (ny+1) x (nz+1) nodes, MAC-staggered
 * - **Scalar grid**: nx x ny x nz cells for pressure, divergence, markers
 *
 * @see flip_simulation.wgsl for the compute shader implementations
 */
export class Simulator {
  device: GPUDevice;

  // Grid resolution (number of cells along each axis)
  nx: number; // X-axis cell count
  ny: number; // Y-axis cell count
  nz: number; // Z-axis cell count

  // World-space container dimensions (can change at runtime for dynamic containers)
  gridWidth: number; // Container width (X)
  gridHeight: number; // Container height (Y)
  gridDepth: number; // Container depth (Z)

  // =========================================================================
  // MAC Grid Buffers
  // =========================================================================
  // The MAC (Marker-And-Cell) grid stores velocity components at staggered
  // positions on cell faces, which naturally aligns with the divergence/gradient
  // operators and prevents checkerboard pressure instabilities.
  //
  // Velocity grid size: (nx+1) x (ny+1) x (nz+1) nodes
  // Each node stores vec4: (Vx, Vy, Vz, scalarWeight)
  // Note: Each component lives at a DIFFERENT physical position (MAC staggering)
  // =========================================================================

  /** Atomic integer buffer for P2G weighted velocity accumulation (race-free). */
  gridVelocityBuffer: GPUBuffer;

  /** Atomic integer buffer for P2G weight accumulation. */
  gridWeightBuffer: GPUBuffer;

  /** Float buffer holding normalized (averaged) velocities after P2G. */
  gridVelocityFloatBuffer: GPUBuffer;

  /** Snapshot of grid velocity BEFORE pressure projection (for FLIP delta). */
  gridVelocityOrigBuffer: GPUBuffer;

  /** Cell markers: 0 = air (empty), 1 = fluid (contains particles). */
  gridMarkerBuffer: GPUBuffer;

  /** Pressure field (scalar per cell, cell-centered). */
  pressureBuffer: GPUBuffer;

  /** Divergence / temp buffer for Jacobi iteration (cell-centered). */
  pressureTempBuffer: GPUBuffer;

  /** Uniform block containing per-frame simulation parameters. */
  uniformBuffer: GPUBuffer;

  // =========================================================================
  // Compute Pipelines (11 pipelines for 12 steps - enforceBoundary runs twice)
  // =========================================================================

  /** Step 1: Zero all grid buffers at start of frame. */
  clearGridPipeline!: GPUComputePipeline;

  /** Step 2: P2G - Splat particle velocity/mass to grid nodes. */
  transferToGridPipeline!: GPUComputePipeline;

  /** Step 4: Convert atomic weighted sums to float averages. */
  normalizeGridPipeline!: GPUComputePipeline;

  /** Step 3: Mark cells containing particles as fluid (vs air). */
  markCellsPipeline!: GPUComputePipeline;

  /** Step 5: Apply gravity and mouse interaction forces. */
  addGravityPipeline!: GPUComputePipeline;

  /** Steps 6 & 10: Set wall-normal velocities to zero. */
  enforceBoundaryPipeline!: GPUComputePipeline;

  /** Step 7: Compute velocity divergence per cell. */
  divergencePipeline!: GPUComputePipeline;

  /** Step 8: One Jacobi iteration for pressure Poisson solve. */
  jacobiPipeline!: GPUComputePipeline;

  /** Step 8 (Red-Black GS): Update red cells (parity 0). */
  jacobiRedPipeline!: GPUComputePipeline;

  /** Step 8 (Red-Black GS): Update black cells (parity 1). */
  jacobiBlackPipeline!: GPUComputePipeline;

  /** Step 9: Subtract pressure gradient from velocity. */
  applyPressurePipeline!: GPUComputePipeline;

  /** Step 11: G2P - Blend PIC/FLIP velocity update to particles. */
  gridToParticlePipeline!: GPUComputePipeline;

  /** Step 12: Move particles through velocity field (RK2). */
  advectPipeline!: GPUComputePipeline;

  /** Primary bind group containing all simulation buffers. */
  simBindGroup: GPUBindGroup;

  /** Alternate bind group (reserved for ping-pong if needed). */
  simBindGroupAlt: GPUBindGroup;

  /** Frame counter for temporal effects (turbulence sampling). */
  frameNumber: number = 0;

  /** Current workgroup size for particle kernels (32, 64, 128, or 256). */
  particleWorkgroupSize: number = 64;

  /** Cached references for pipeline recreation. */
  private shaderModule: GPUShaderModule;
  private pipelineLayout: GPUPipelineLayout;

  constructor(
    device: GPUDevice,
    nx: number,
    ny: number,
    nz: number,
    width: number,
    height: number,
    depth: number,
    posBuffer: GPUBuffer,
    velBuffer: GPUBuffer,
    randomBuffer: GPUBuffer,
    particleWorkgroupSize: number = 64
  ) {
    this.device = device;
    this.nx = nx;
    this.ny = ny;
    this.nz = nz;
    this.gridWidth = width;
    this.gridHeight = height;
    this.gridDepth = depth;
    this.particleWorkgroupSize = particleWorkgroupSize;

    // Velocity grid has one extra sample per axis for MAC staggering.
    const velGridCount = (nx + 1) * (ny + 1) * (nz + 1);
    // Scalar quantities (pressure/markers/divergence) live at cell centers.
    const scalarGridCount = nx * ny * nz;

    const createBuffer = (size: number, usage = GPUBufferUsage.STORAGE) =>
      device.createBuffer({ size, usage });

    // Atomic accumulators store integer-scaled weighted sums during P2G.
    this.gridVelocityBuffer = createBuffer(velGridCount * 16); // vec4<i32>
    this.gridWeightBuffer = createBuffer(velGridCount * 16); // vec4<i32>
    // Float velocities after normalization; Orig preserves pre-pressure state.
    this.gridVelocityFloatBuffer = createBuffer(velGridCount * 16); // vec4<f32>
    this.gridVelocityOrigBuffer = createBuffer(velGridCount * 16); // vec4<f32>

    // Cell markers: 0 = air, 1 = fluid.
    this.gridMarkerBuffer = createBuffer(scalarGridCount * 4);

    // Pressure + divergence/temp buffers.
    this.pressureBuffer = createBuffer(scalarGridCount * 4);
    this.pressureTempBuffer = createBuffer(scalarGridCount * 4); // divergence

    // Uniform block mirrors `Uniforms` in `flip_simulation.wgsl` (112 bytes).
    this.uniformBuffer = createBuffer(
      112,
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    );

    this.shaderModule = device.createShaderModule({
      code: flipSimulationShader,
    });

    const bindGroupLayout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'uniform' },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'storage' },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'storage' },
        },
        {
          binding: 3,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'storage' },
        },
        {
          binding: 4,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'storage' },
        },
        {
          binding: 5,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'storage' },
        },
        {
          binding: 6,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'storage' },
        },
        {
          binding: 7,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'storage' },
        },
        {
          binding: 8,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'storage' },
        },
        {
          binding: 9,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'storage' },
        },
        {
          binding: 10,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'read-only-storage' },
        },
      ],
    });

    this.pipelineLayout = device.createPipelineLayout({
      bindGroupLayouts: [bindGroupLayout],
    });

    // Create all compute pipelines
    this.createPipelines();

    this.simBindGroup = device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: { buffer: posBuffer } },
        { binding: 2, resource: { buffer: velBuffer } },
        { binding: 3, resource: { buffer: this.gridVelocityBuffer } },
        { binding: 4, resource: { buffer: this.gridWeightBuffer } },
        { binding: 5, resource: { buffer: this.gridVelocityFloatBuffer } },
        { binding: 6, resource: { buffer: this.gridVelocityOrigBuffer } },
        { binding: 7, resource: { buffer: this.gridMarkerBuffer } },
        { binding: 8, resource: { buffer: this.pressureBuffer } },
        { binding: 9, resource: { buffer: this.pressureTempBuffer } },
        { binding: 10, resource: { buffer: randomBuffer } },
      ],
    });

    // Reserved for ping-pong variants; current solver uses a single group.
    this.simBindGroupAlt = this.simBindGroup;

    this.updateUniforms(0, 0.99, 40.0, 10.0, [0, 0, 0], [0, 0, 0], [0, 0, 1]);
  }

  /**
   * Create or recreate all compute pipelines.
   * Called during construction and when workgroup size changes.
   */
  private createPipelines() {
    // Helper to create grid pipelines (fixed workgroup size 8x4x4)
    const makeGridPipeline = (entry: string) =>
      this.device.createComputePipeline({
        layout: this.pipelineLayout,
        compute: { module: this.shaderModule, entryPoint: entry },
      });

    // Helper to create particle pipelines (configurable workgroup size)
    const makeParticlePipeline = (entry: string) =>
      this.device.createComputePipeline({
        layout: this.pipelineLayout,
        compute: {
          module: this.shaderModule,
          entryPoint: entry,
          constants: {
            PARTICLE_WORKGROUP_SIZE: this.particleWorkgroupSize,
          },
        },
      });

    // Grid-based pipelines (use fixed 8x4x4 workgroup size)
    this.clearGridPipeline = makeGridPipeline('clearGrid');
    this.normalizeGridPipeline = makeGridPipeline('normalizeGrid');
    this.addGravityPipeline = makeGridPipeline('addGravity');
    this.enforceBoundaryPipeline = makeGridPipeline('enforceBoundary');
    this.divergencePipeline = makeGridPipeline('computeDivergence');
    this.jacobiPipeline = makeGridPipeline('jacobi');
    this.jacobiRedPipeline = makeGridPipeline('jacobiRed');
    this.jacobiBlackPipeline = makeGridPipeline('jacobiBlack');
    this.applyPressurePipeline = makeGridPipeline('applyPressure');

    // Particle-based pipelines (use configurable workgroup size)
    this.transferToGridPipeline = makeParticlePipeline('transferToGrid');
    this.markCellsPipeline = makeParticlePipeline('markCells');
    this.gridToParticlePipeline = makeParticlePipeline('gridToParticle');
    this.advectPipeline = makeParticlePipeline('advect');
  }

  /**
   * Update the workgroup size for particle kernels.
   * This recreates the affected pipelines.
   * @param size - New workgroup size (32, 64, 128, or 256)
   */
  updateWorkgroupSize(size: number) {
    if (size === this.particleWorkgroupSize) return;
    this.particleWorkgroupSize = size;
    this.createPipelines();
    console.log(`Workgroup size updated to ${size}`);
  }

  updateUniforms(
    particleCount: number,
    fluidity: number,
    gravity: number,
    particleDensity: number,
    mouseVelocity: number[],
    mouseRayOrigin: number[],
    mouseRayDirection: number[]
  ) {
    // Explicit packing to avoid accidental layout drift between TS and WGSL.
    const data = new ArrayBuffer(112);
    const u32 = new Uint32Array(data);
    const f32 = new Float32Array(data);
    u32[0] = this.nx;
    u32[1] = this.ny;
    u32[2] = this.nz;
    u32[3] = particleCount;
    f32[4] = this.gridWidth;
    f32[5] = this.gridHeight;
    f32[6] = this.gridDepth;
    f32[7] = 1.0 / 60.0;
    f32[8] = this.frameNumber; // Drives temporal turbulence pattern.
    f32[9] = fluidity; // PIC/FLIP blend (0=PIC, 1=FLIP).
    f32[10] = gravity; // Gravity magnitude along -Y.
    f32[11] = particleDensity; // Density-restoring target.
    // Mouse velocity (vec3 + padding)
    f32[12] = mouseVelocity[0];
    f32[13] = mouseVelocity[1];
    f32[14] = mouseVelocity[2];
    f32[15] = 0.0; // padding
    // Mouse ray origin (vec3 + padding)
    f32[16] = mouseRayOrigin[0];
    f32[17] = mouseRayOrigin[1];
    f32[18] = mouseRayOrigin[2];
    f32[19] = 0.0; // padding
    // Mouse ray direction (vec3 + padding)
    f32[20] = mouseRayDirection[0];
    f32[21] = mouseRayDirection[1];
    f32[22] = mouseRayDirection[2];
    f32[23] = 0.0; // padding

    // Proper aspect-ratio handling for pressure solver
    const invDx = this.nx / this.gridWidth;
    const invDy = this.ny / this.gridHeight;
    const invDz = this.nz / this.gridDepth;
    const invDx2 = invDx * invDx;
    const invDy2 = invDy * invDy;
    const invDz2 = invDz * invDz;
    const precomputeJacobi = 1.0 / (2.0 * (invDx2 + invDy2 + invDz2));

    f32[24] = invDx;
    f32[25] = invDy;
    f32[26] = invDz;
    f32[27] = precomputeJacobi;

    this.device.queue.writeBuffer(this.uniformBuffer, 0, data);
    this.frameNumber++;
  }

  /**
   * Execute one simulation timestep.
   *
   * This dispatches 12 compute passes in sequence, implementing the full
   * FLIP algorithm: P2G transfer, pressure solve, G2P transfer, advection.
   *
   * @param pass - Active compute pass encoder to record commands into
   * @param particleCount - Number of active particles
   * @param fluidity - PIC/FLIP blend (0=PIC, 1=FLIP), typically 0.95-0.99
   * @param gravity - Gravity magnitude (positive = downward)
   * @param particleDensity - Target density for compression correction
   * @param jacobiIterations - Number of pressure solve iterations (1-100)
   * @param useRedBlackGS - Use Red-Black Gauss-Seidel instead of Jacobi
   * @param mouseVelocity - World-space velocity from mouse interaction
   * @param mouseRayOrigin - Mouse ray origin in world space
   * @param mouseRayDirection - Mouse ray direction (normalized)
   */
  step(
    pass: GPUComputePassEncoder,
    particleCount: number,
    fluidity: number,
    gravity: number,
    particleDensity: number,
    jacobiIterations: number,
    useRedBlackGS: boolean,
    mouseVelocity: number[],
    mouseRayOrigin: number[],
    mouseRayDirection: number[]
  ) {
    // Upload current frame uniforms once before dispatch sequence.
    this.updateUniforms(
      particleCount,
      fluidity,
      gravity,
      particleDensity,
      mouseVelocity,
      mouseRayOrigin,
      mouseRayDirection
    );

    // =========================================================================
    // Compute Workgroup Counts
    // =========================================================================
    // Each kernel uses a specific workgroup size; we compute dispatch counts
    // to cover the full grid/particle arrays.

    // Velocity grid: (nx+1) x (ny+1) x (nz+1), workgroup size (8, 4, 4)
    const velGridWG = [
      Math.ceil((this.nx + 1) / 8),
      Math.ceil((this.ny + 1) / 4),
      Math.ceil((this.nz + 1) / 4),
    ];

    // Scalar grid: nx x ny x nz cells, workgroup size (8, 4, 4)
    const scalarGridWG = [
      Math.ceil(this.nx / 8),
      Math.ceil(this.ny / 4),
      Math.ceil(this.nz / 4),
    ];

    // Particles: 1D dispatch, uses configurable workgroup size
    const particleWG = Math.ceil(particleCount / this.particleWorkgroupSize);

    pass.setBindGroup(0, this.simBindGroup);

    // =========================================================================
    // FLIP Simulation Loop (12 steps)
    // =========================================================================

    // Step 1: Clear all grid buffers to prepare for new frame
    pass.setPipeline(this.clearGridPipeline);
    pass.dispatchWorkgroups(velGridWG[0], velGridWG[1], velGridWG[2]);

    // Step 2: P2G (Particle-to-Grid) - Transfer particle momentum to grid
    // Each particle splats its weighted velocity to 8 neighboring nodes
    pass.setPipeline(this.transferToGridPipeline);
    pass.dispatchWorkgroups(particleWG);

    // Step 3: Mark cells - Flag cells containing particles as "fluid"
    pass.setPipeline(this.markCellsPipeline);
    pass.dispatchWorkgroups(particleWG);

    // Step 4: Normalize - Convert atomic weighted sums to average velocities
    // Also saves snapshot to gridVelOrig for FLIP delta calculation
    pass.setPipeline(this.normalizeGridPipeline);
    pass.dispatchWorkgroups(velGridWG[0], velGridWG[1], velGridWG[2]);

    // Step 5: External forces - Apply gravity and mouse interaction
    pass.setPipeline(this.addGravityPipeline);
    pass.dispatchWorkgroups(velGridWG[0], velGridWG[1], velGridWG[2]);

    // Step 6: Boundary conditions (pre-projection)
    // Zero wall-normal velocities at container boundaries
    pass.setPipeline(this.enforceBoundaryPipeline);
    pass.dispatchWorkgroups(velGridWG[0], velGridWG[1], velGridWG[2]);

    // Step 7: Compute divergence - Measure velocity field "expansion" per cell
    // This is the RHS of the pressure Poisson equation: ∇²P = ∇·v
    pass.setPipeline(this.divergencePipeline);
    pass.dispatchWorkgroups(scalarGridWG[0], scalarGridWG[1], scalarGridWG[2]);

    // Step 8: Pressure solve (configurable iterations)
    // Two solver options:
    //   - Jacobi: Simple, updates all cells simultaneously. Slower convergence.
    //   - Red-Black GS: Updates cells in two phases by parity. ~2x faster convergence.
    if (useRedBlackGS) {
      // Red-Black Gauss-Seidel: Each iteration has two phases
      // Red phase updates cells where (x+y+z) is even
      // Black phase updates cells where (x+y+z) is odd
      // Black cells see the updated red values, improving convergence
      for (let i = 0; i < jacobiIterations; i++) {
        // Red phase
        pass.setPipeline(this.jacobiRedPipeline);
        pass.dispatchWorkgroups(
          scalarGridWG[0],
          scalarGridWG[1],
          scalarGridWG[2]
        );
        // Black phase
        pass.setPipeline(this.jacobiBlackPipeline);
        pass.dispatchWorkgroups(
          scalarGridWG[0],
          scalarGridWG[1],
          scalarGridWG[2]
        );
      }
    } else {
      // Standard Jacobi iteration
      for (let i = 0; i < jacobiIterations; i++) {
        pass.setPipeline(this.jacobiPipeline);
        pass.dispatchWorkgroups(
          scalarGridWG[0],
          scalarGridWG[1],
          scalarGridWG[2]
        );
      }
    }

    // Step 9: Pressure projection - Subtract pressure gradient from velocity
    // This makes the velocity field divergence-free (incompressible)
    pass.setPipeline(this.applyPressurePipeline);
    pass.dispatchWorkgroups(velGridWG[0], velGridWG[1], velGridWG[2]);

    // Step 10: Boundary conditions (post-projection)
    // Re-apply boundaries since pressure correction may have introduced flow
    pass.setPipeline(this.enforceBoundaryPipeline);
    pass.dispatchWorkgroups(velGridWG[0], velGridWG[1], velGridWG[2]);

    // Step 11: G2P (Grid-to-Particle) - Transfer velocity back to particles
    // Blends PIC (stable) and FLIP (energetic) updates based on fluidity
    pass.setPipeline(this.gridToParticlePipeline);
    pass.dispatchWorkgroups(particleWG);

    // Step 12: Advect - Move particles through the velocity field
    // Uses RK2 (midpoint) integration + small turbulent noise
    pass.setPipeline(this.advectPipeline);
    pass.dispatchWorkgroups(particleWG);
  }
}
