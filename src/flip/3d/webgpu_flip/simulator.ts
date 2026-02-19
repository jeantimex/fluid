import flipSimulationShader from './shaders/flip_simulation.wgsl?raw';

/**
 * GPU FLIP solver driver.
 *
 * This class owns all simulation buffers, compute pipelines, and the exact
 * pass order used every frame:
 * clear -> P2G -> mark -> normalize -> forces -> boundaries -> divergence
 * -> pressure iterations -> project -> boundaries -> G2P -> advect.
 */
export class Simulator {
  device: GPUDevice;
  nx: number;
  ny: number;
  nz: number;
  gridWidth: number;
  gridHeight: number;
  gridDepth: number;

  // Staggered MAC grid buffers
  // We store velocity and weights separately for each component
  // gridVel stores (vx, vy, vz, scalarWeight) but each is at different staggered positions
  gridVelocityBuffer: GPUBuffer; // Atomic accumulator for weighted velocities
  gridWeightBuffer: GPUBuffer; // Atomic accumulator for weights
  gridVelocityFloatBuffer: GPUBuffer; // Normalized velocities
  gridVelocityOrigBuffer: GPUBuffer; // Original velocities before pressure solve
  gridMarkerBuffer: GPUBuffer; // Cell markers (fluid/air)
  pressureBuffer: GPUBuffer;
  pressureTempBuffer: GPUBuffer; // Stores divergence, then used as temp for Jacobi
  uniformBuffer: GPUBuffer;

  clearGridPipeline: GPUComputePipeline;
  transferToGridPipeline: GPUComputePipeline;
  normalizeGridPipeline: GPUComputePipeline;
  markCellsPipeline: GPUComputePipeline;
  addGravityPipeline: GPUComputePipeline;
  enforceBoundaryPipeline: GPUComputePipeline;
  divergencePipeline: GPUComputePipeline;
  jacobiPipeline: GPUComputePipeline;
  applyPressurePipeline: GPUComputePipeline;
  gridToParticlePipeline: GPUComputePipeline;
  advectPipeline: GPUComputePipeline;

  simBindGroup: GPUBindGroup;
  simBindGroupAlt: GPUBindGroup;
  frameNumber: number = 0;

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
    randomBuffer: GPUBuffer
  ) {
    this.device = device;
    this.nx = nx;
    this.ny = ny;
    this.nz = nz;
    this.gridWidth = width;
    this.gridHeight = height;
    this.gridDepth = depth;

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

    const shaderModule = device.createShaderModule({
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

    const pipelineLayout = device.createPipelineLayout({
      bindGroupLayouts: [bindGroupLayout],
    });
    const makePipeline = (entry: string) =>
      device.createComputePipeline({
        layout: pipelineLayout,
        compute: { module: shaderModule, entryPoint: entry },
      });

    this.clearGridPipeline = makePipeline('clearGrid');
    this.transferToGridPipeline = makePipeline('transferToGrid');
    this.normalizeGridPipeline = makePipeline('normalizeGrid');
    this.markCellsPipeline = makePipeline('markCells');
    this.addGravityPipeline = makePipeline('addGravity');
    this.enforceBoundaryPipeline = makePipeline('enforceBoundary');
    this.divergencePipeline = makePipeline('computeDivergence');
    this.jacobiPipeline = makePipeline('jacobi');
    this.applyPressurePipeline = makePipeline('applyPressure');
    this.gridToParticlePipeline = makePipeline('gridToParticle');
    this.advectPipeline = makePipeline('advect');

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
    this.device.queue.writeBuffer(this.uniformBuffer, 0, data);
    this.frameNumber++;
  }

  step(
    pass: GPUComputePassEncoder,
    particleCount: number,
    fluidity: number,
    gravity: number,
    particleDensity: number,
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

    // Workgroup counts mirror shader workgroup_size declarations.
    const velGridWG = [
      Math.ceil((this.nx + 1) / 8),
      Math.ceil((this.ny + 1) / 4),
      Math.ceil((this.nz + 1) / 4),
    ];
    const scalarGridWG = [
      Math.ceil(this.nx / 8),
      Math.ceil(this.ny / 4),
      Math.ceil(this.nz / 4),
    ];
    const particleWG = Math.ceil(particleCount / 64); // @workgroup_size(64)

    pass.setBindGroup(0, this.simBindGroup);

    // 1) Clear all simulation fields.
    pass.setPipeline(this.clearGridPipeline);
    pass.dispatchWorkgroups(velGridWG[0], velGridWG[1], velGridWG[2]);

    // 2) P2G: splat particle momentum to staggered grid nodes.
    pass.setPipeline(this.transferToGridPipeline);
    pass.dispatchWorkgroups(particleWG);

    // 3) Mark occupied scalar cells.
    pass.setPipeline(this.markCellsPipeline);
    pass.dispatchWorkgroups(particleWG);

    // 4) Convert weighted sums into average velocities.
    pass.setPipeline(this.normalizeGridPipeline);
    pass.dispatchWorkgroups(velGridWG[0], velGridWG[1], velGridWG[2]);

    // 5) External forces (gravity + mouse impulse).
    pass.setPipeline(this.addGravityPipeline);
    pass.dispatchWorkgroups(velGridWG[0], velGridWG[1], velGridWG[2]);

    // 6) Enforce container wall constraints.
    pass.setPipeline(this.enforceBoundaryPipeline);
    pass.dispatchWorkgroups(velGridWG[0], velGridWG[1], velGridWG[2]);

    // 7) Compute velocity divergence.
    pass.setPipeline(this.divergencePipeline);
    pass.dispatchWorkgroups(scalarGridWG[0], scalarGridWG[1], scalarGridWG[2]);

    // 8) Jacobi pressure iterations for incompressibility projection.
    for (let i = 0; i < 50; i++) {
      pass.setPipeline(this.jacobiPipeline);
      pass.dispatchWorkgroups(
        scalarGridWG[0],
        scalarGridWG[1],
        scalarGridWG[2]
      );
    }

    // 9) Subtract pressure gradient from velocity field.
    pass.setPipeline(this.applyPressurePipeline);
    pass.dispatchWorkgroups(velGridWG[0], velGridWG[1], velGridWG[2]);

    // 10) Re-apply boundaries after projection.
    pass.setPipeline(this.enforceBoundaryPipeline);
    pass.dispatchWorkgroups(velGridWG[0], velGridWG[1], velGridWG[2]);

    // 11) G2P: blend PIC and FLIP updates back to particles.
    pass.setPipeline(this.gridToParticlePipeline);
    pass.dispatchWorkgroups(particleWG);

    // 12) Advect particle positions with midpoint integration.
    pass.setPipeline(this.advectPipeline);
    pass.dispatchWorkgroups(particleWG);
  }
}
