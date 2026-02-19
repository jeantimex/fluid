import flipSimulationShader from './shaders/flip_simulation.wgsl?raw';

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

    // Velocity grid is (nx+1) x (ny+1) x (nz+1) for staggered MAC grid
    const velGridCount = (nx + 1) * (ny + 1) * (nz + 1);
    // Scalar grid (pressure, markers) is nx x ny x nz
    const scalarGridCount = nx * ny * nz;

    const createBuffer = (size: number, usage = GPUBufferUsage.STORAGE) =>
      device.createBuffer({ size, usage });

    // Velocity buffers use vel grid size
    this.gridVelocityBuffer = createBuffer(velGridCount * 16); // vec4<i32> atomic
    this.gridWeightBuffer = createBuffer(velGridCount * 16); // vec4<i32> atomic weights
    this.gridVelocityFloatBuffer = createBuffer(velGridCount * 16); // vec4<f32>
    this.gridVelocityOrigBuffer = createBuffer(velGridCount * 16); // vec4<f32>

    // Marker uses scalar grid size
    this.gridMarkerBuffer = createBuffer(scalarGridCount * 4);

    // Pressure uses scalar grid size
    this.pressureBuffer = createBuffer(scalarGridCount * 4);
    this.pressureTempBuffer = createBuffer(scalarGridCount * 4);

    // Increased buffer size to accommodate mouse data
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

    // Alt bind group not needed for current implementation
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
    f32[8] = this.frameNumber; // Frame number for time-varying turbulence
    f32[9] = fluidity; // fluidity (FLIP ratio)
    f32[10] = gravity; // gravity
    f32[11] = particleDensity; // target density
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
    this.updateUniforms(
      particleCount,
      fluidity,
      gravity,
      particleDensity,
      mouseVelocity,
      mouseRayOrigin,
      mouseRayDirection
    );

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
    const particleWG = Math.ceil(particleCount / 64);

    pass.setBindGroup(0, this.simBindGroup);

    // 1. Clear grid (covers both velocity and scalar grids)
    pass.setPipeline(this.clearGridPipeline);
    pass.dispatchWorkgroups(velGridWG[0], velGridWG[1], velGridWG[2]);

    // 2. P2G: Transfer particle velocities to grid (staggered MAC)
    pass.setPipeline(this.transferToGridPipeline);
    pass.dispatchWorkgroups(particleWG);

    // 3. Mark cells with fluid
    pass.setPipeline(this.markCellsPipeline);
    pass.dispatchWorkgroups(particleWG);

    // 4. Normalize grid velocities
    pass.setPipeline(this.normalizeGridPipeline);
    pass.dispatchWorkgroups(velGridWG[0], velGridWG[1], velGridWG[2]);

    // 5. Add gravity
    pass.setPipeline(this.addGravityPipeline);
    pass.dispatchWorkgroups(velGridWG[0], velGridWG[1], velGridWG[2]);

    // 6. Enforce boundary conditions
    pass.setPipeline(this.enforceBoundaryPipeline);
    pass.dispatchWorkgroups(velGridWG[0], velGridWG[1], velGridWG[2]);

    // 7. Compute divergence (scalar grid)
    pass.setPipeline(this.divergencePipeline);
    pass.dispatchWorkgroups(scalarGridWG[0], scalarGridWG[1], scalarGridWG[2]);

    // 8. Jacobi pressure solve (50 iterations - match WebGL)
    for (let i = 0; i < 50; i++) {
      pass.setPipeline(this.jacobiPipeline);
      pass.dispatchWorkgroups(
        scalarGridWG[0],
        scalarGridWG[1],
        scalarGridWG[2]
      );
    }

    // 9. Apply pressure gradient (velocity grid)
    pass.setPipeline(this.applyPressurePipeline);
    pass.dispatchWorkgroups(velGridWG[0], velGridWG[1], velGridWG[2]);

    // 10. Enforce boundaries again after pressure
    pass.setPipeline(this.enforceBoundaryPipeline);
    pass.dispatchWorkgroups(velGridWG[0], velGridWG[1], velGridWG[2]);

    // 11. G2P: Transfer grid velocity back to particles (FLIP/PIC)
    pass.setPipeline(this.gridToParticlePipeline);
    pass.dispatchWorkgroups(particleWG);

    // 12. Advect particles using grid velocity
    pass.setPipeline(this.advectPipeline);
    pass.dispatchWorkgroups(particleWG);
  }
}
