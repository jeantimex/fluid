import { Scene } from '../canvas2d/types';

const particleShaderWGSL = `
  struct Uniforms {
    domainSize: vec2f,
    pointSize: f32,
    drawDisk: f32,
  }

  @group(0) @binding(0) var<uniform> uniforms: Uniforms;

  struct VertexInput {
    @builtin(vertex_index) vertexIndex: u32,
    @builtin(instance_index) instanceIndex: u32,
    @location(0) position: vec2f,
    @location(1) color: vec3f,
  }

  struct VertexOutput {
    @builtin(position) pos: vec4f,
    @location(0) fragColor: vec3f,
    @location(1) uv: vec2f,
  }

  @vertex
  fn vs_main(input: VertexInput) -> VertexOutput {
    let pos = array<vec2f, 4>(
      vec2f(-1.0, -1.0), vec2f(1.0, -1.0),
      vec2f(-1.0,  1.0), vec2f(1.0,  1.0)
    );
    
    let uv = pos[input.vertexIndex];
    let worldPos = input.position + uv * (uniforms.pointSize * 0.5);
    
    // Transform to clip space [-1, 1]
    let clipX = (worldPos.x * (2.0 / uniforms.domainSize.x)) - 1.0;
    let clipY = (worldPos.y * (2.0 / uniforms.domainSize.y)) - 1.0;
    
    var output: VertexOutput;
    output.pos = vec4f(clipX, clipY, 0.0, 1.0);
    output.fragColor = input.color;
    output.uv = uv;
    return output;
  }

  @fragment
  fn fs_main(input: VertexOutput) -> @location(0) vec4f {
    if (uniforms.drawDisk > 0.5) {
      let r2 = dot(input.uv, input.uv);
      if (r2 > 1.0) {
        discard;
      }
    }
    return vec4f(input.fragColor, 1.0);
  }
`;

const meshShaderWGSL = `
  struct MeshUniforms {
    domainSize: vec2f,
    color: vec3f,
    translation: vec2f,
    scale: f32,
  }

  @group(0) @binding(0) var<uniform> uniforms: MeshUniforms;

  struct VertexInput {
    @builtin(vertex_index) vertexIndex: u32,
  }

  struct VertexOutput {
    @builtin(position) pos: vec4f,
  }

  @vertex
  fn vs_main(input: VertexInput) -> VertexOutput {
    let numSegs: u32 = 50u;
    var pos: vec2f;
    
    if (input.vertexIndex % 3u == 0u) {
      pos = vec2f(0.0, 0.0);
    } else {
      let i = f32(input.vertexIndex / 3u) + f32(input.vertexIndex % 3u - 1u);
      let angle = i * (2.0 * 3.14159265 / f32(numSegs));
      pos = vec2f(cos(angle), sin(angle));
    }

    let worldPos = uniforms.translation + pos * uniforms.scale;
    let clipX = (worldPos.x * (2.0 / uniforms.domainSize.x)) - 1.0;
    let clipY = (worldPos.y * (2.0 / uniforms.domainSize.y)) - 1.0;

    var output: VertexOutput;
    output.pos = vec4f(clipX, clipY, 0.0, 1.0);
    return output;
  }

  @fragment
  fn fs_main() -> @location(0) vec4f {
    return vec4f(uniforms.color, 1.0);
  }
`;

const boundaryCollisionShaderWGSL = `
  struct BoundaryUniforms {
    domainSize: vec2f,
    particleRadius: f32,
    numParticles: f32,
    obstaclePos: vec2f,
    obstacleRadius: f32,
    _pad0: f32,
    obstacleVel: vec2f,
    minX: f32,
    maxX: f32,
    minY: f32,
    maxY: f32,
    _pad1: vec2f,
  }

  @group(0) @binding(0) var<uniform> uniforms: BoundaryUniforms;
  @group(0) @binding(1) var<storage, read_write> positions: array<vec2f>;
  @group(0) @binding(2) var<storage, read_write> velocities: array<vec2f>;

  @compute @workgroup_size(64)
  fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i >= u32(uniforms.numParticles)) {
      return;
    }

    var p = positions[i];
    var v = velocities[i];

    if (uniforms.obstacleRadius > 0.0) {
      let dx = p.x - uniforms.obstaclePos.x;
      let dy = p.y - uniforms.obstaclePos.y;
      let d2 = dx * dx + dy * dy;
      let minDist = uniforms.obstacleRadius + uniforms.particleRadius;
      let minDist2 = minDist * minDist;

      if (d2 < minDist2 && d2 > 1e-12) {
        let d = sqrt(d2);
        let s = (minDist - d) / d;
        p.x = p.x + dx * s;
        p.y = p.y + dy * s;
        v = uniforms.obstacleVel;
      }
    }

    if (p.x < uniforms.minX) { p.x = uniforms.minX; v.x = 0.0; }
    if (p.x > uniforms.maxX) { p.x = uniforms.maxX; v.x = 0.0; }
    if (p.y < uniforms.minY) { p.y = uniforms.minY; v.y = 0.0; }
    if (p.y > uniforms.maxY) { p.y = uniforms.maxY; v.y = 0.0; }

    positions[i] = p;
    velocities[i] = v;
  }
`;

const integrateParticlesShaderWGSL = `
  struct IntegrateUniforms {
    dt: f32,
    gravity: f32,
    numParticles: f32,
    _pad0: f32,
  }

  @group(0) @binding(0) var<uniform> uniforms: IntegrateUniforms;
  @group(0) @binding(1) var<storage, read_write> positions: array<vec2f>;
  @group(0) @binding(2) var<storage, read_write> velocities: array<vec2f>;

  @compute @workgroup_size(64)
  fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i >= u32(uniforms.numParticles)) {
      return;
    }

    var v = velocities[i];
    var p = positions[i];
    v.y = v.y + uniforms.dt * uniforms.gravity;
    p = p + v * uniforms.dt;
    velocities[i] = v;
    positions[i] = p;
  }
`;

const particleColorFadeShaderWGSL = `
  struct ColorFadeUniforms {
    numParticles: f32,
    step: f32,
    _pad0: vec2f,
  }

  @group(0) @binding(0) var<uniform> uniforms: ColorFadeUniforms;
  @group(0) @binding(1) var<storage, read_write> colors: array<vec3f>;

  @compute @workgroup_size(64)
  fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i >= u32(uniforms.numParticles)) {
      return;
    }
    var c = colors[i];
    c.r = clamp(c.r - uniforms.step, 0.0, 1.0);
    c.g = clamp(c.g - uniforms.step, 0.0, 1.0);
    c.b = clamp(c.b + uniforms.step, 0.0, 1.0);
    colors[i] = c;
  }
`;

const particleSurfaceTintShaderWGSL = `
  struct SurfaceTintUniforms {
    numParticles: f32,
    invCellSize: f32,
    restDensity: f32,
    threshold: f32,
    bright: f32,
    numX: f32,
    numY: f32,
    _pad0: f32,
  }

  @group(0) @binding(0) var<uniform> uniforms: SurfaceTintUniforms;
  @group(0) @binding(1) var<storage, read_write> colors: array<vec3f>;
  @group(0) @binding(2) var<storage, read> positions: array<vec2f>;
  @group(0) @binding(3) var<storage, read> density: array<f32>;

  @compute @workgroup_size(64)
  fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i >= u32(uniforms.numParticles)) {
      return;
    }
    if (uniforms.restDensity <= 0.0) {
      return;
    }

    let p = positions[i];
    let xi = clamp(i32(floor(p.x * uniforms.invCellSize)), 1, i32(uniforms.numX) - 1);
    let yi = clamp(i32(floor(p.y * uniforms.invCellSize)), 1, i32(uniforms.numY) - 1);
    let cellNr = xi * i32(uniforms.numY) + yi;
    let relDensity = density[u32(cellNr)] / uniforms.restDensity;

    if (relDensity < uniforms.threshold) {
      colors[i] = vec3f(uniforms.bright, uniforms.bright, 1.0);
    }
  }
`;

const particleSeparationShaderWGSL = `
  struct SeparationUniforms {
    numParticles: f32,
    invSpacing: f32,
    gridNumX: f32,
    gridNumY: f32,
    minDist: f32,
    minDist2: f32,
    _unused: f32,
    _pad0: f32,
  }

  @group(0) @binding(0) var<uniform> uniforms: SeparationUniforms;
  @group(0) @binding(1) var<storage, read> positionsIn: array<vec2f>;
  @group(0) @binding(2) var<storage, read_write> positionsOut: array<vec2f>;
  @group(0) @binding(3) var<storage, read> firstCellParticle: array<u32>;
  @group(0) @binding(4) var<storage, read> cellParticleIds: array<u32>;

  @compute @workgroup_size(64)
  fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i >= u32(uniforms.numParticles)) {
      return;
    }

    var p = positionsIn[i];
    let pxi = i32(floor(p.x * uniforms.invSpacing));
    let pyi = i32(floor(p.y * uniforms.invSpacing));
    let x0 = max(pxi - 1, 0);
    let y0 = max(pyi - 1, 0);
    let x1 = min(pxi + 1, i32(uniforms.gridNumX) - 1);
    let y1 = min(pyi + 1, i32(uniforms.gridNumY) - 1);

    for (var xi = x0; xi <= x1; xi = xi + 1) {
      for (var yi = y0; yi <= y1; yi = yi + 1) {
        let cellNr = u32(xi * i32(uniforms.gridNumY) + yi);
        let firstIdx = firstCellParticle[cellNr];
        let lastIdx = firstCellParticle[cellNr + 1u];
        for (var j = firstIdx; j < lastIdx; j = j + 1u) {
          let id = cellParticleIds[j];
          if (id == i) {
            continue;
          }
          let q = positionsIn[id];
          let dx = q.x - p.x;
          let dy = q.y - p.y;
          let d2 = dx * dx + dy * dy;
          if (d2 > uniforms.minDist2 || d2 <= 1e-12) {
            continue;
          }
          let d = sqrt(d2);
          let correction = (0.5 * (uniforms.minDist - d)) / d;
          p.x = p.x - dx * correction;
          p.y = p.y - dy * correction;

        }
      }
    }

    positionsOut[i] = p;
  }
`;

const hashCountShaderWGSL = `
  struct HashCountUniforms {
    numParticles: u32,
    gridNumX: u32,
    gridNumY: u32,
    _pad0: u32,
    invSpacing: f32,
    _pad1: vec3f,
  }

  @group(0) @binding(0) var<uniform> uniforms: HashCountUniforms;
  @group(0) @binding(1) var<storage, read> positions: array<vec2f>;
  @group(0) @binding(2) var<storage, read_write> cellCounts: array<atomic<u32>>;

  @compute @workgroup_size(64)
  fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i >= uniforms.numParticles) {
      return;
    }
    let p = positions[i];
    let xi = clamp(u32(floor(p.x * uniforms.invSpacing)), 0u, uniforms.gridNumX - 1u);
    let yi = clamp(u32(floor(p.y * uniforms.invSpacing)), 0u, uniforms.gridNumY - 1u);
    let cellNr = xi * uniforms.gridNumY + yi;
    atomicAdd(&cellCounts[cellNr], 1u);
  }
`;

const hashFillShaderWGSL = `
  struct HashFillUniforms {
    numParticles: u32,
    gridNumX: u32,
    gridNumY: u32,
    _pad0: u32,
    invSpacing: f32,
    _pad1: vec3f,
  }

  @group(0) @binding(0) var<uniform> uniforms: HashFillUniforms;
  @group(0) @binding(1) var<storage, read> positions: array<vec2f>;
  @group(0) @binding(2) var<storage, read_write> cellOffsets: array<atomic<u32>>;
  @group(0) @binding(3) var<storage, read_write> cellParticleIds: array<u32>;

  @compute @workgroup_size(64)
  fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i >= uniforms.numParticles) {
      return;
    }
    let p = positions[i];
    let xi = clamp(u32(floor(p.x * uniforms.invSpacing)), 0u, uniforms.gridNumX - 1u);
    let yi = clamp(u32(floor(p.y * uniforms.invSpacing)), 0u, uniforms.gridNumY - 1u);
    let cellNr = xi * uniforms.gridNumY + yi;
    let dst = atomicAdd(&cellOffsets[cellNr], 1u);
    cellParticleIds[dst] = i;
  }
`;

export class WebGPURenderer {
  device: GPUDevice;
  format: GPUTextureFormat;
  
  particlePipeline: GPURenderPipeline;
  meshPipeline: GPURenderPipeline;
  boundaryCollisionPipeline: GPUComputePipeline;
  integrateParticlesPipeline: GPUComputePipeline;
  particleColorFadePipeline: GPUComputePipeline;
  particleSurfaceTintPipeline: GPUComputePipeline;
  particleSeparationPipeline: GPUComputePipeline;
  hashCountPipeline: GPUComputePipeline;
  hashFillPipeline: GPUComputePipeline;
  
  uniformBuffer: GPUBuffer;
  meshUniformBuffer: GPUBuffer;
  boundaryUniformBuffer: GPUBuffer;
  integrateUniformBuffer: GPUBuffer;
  particleColorFadeUniformBuffer: GPUBuffer;
  particleSurfaceTintUniformBuffer: GPUBuffer;
  particleSeparationUniformBuffer: GPUBuffer;
  hashCountUniformBuffer: GPUBuffer;
  hashFillUniformBuffer: GPUBuffer;
  bindGroup: GPUBindGroup;
  meshBindGroup: GPUBindGroup;
  
  particlePosBuffer: GPUBuffer | null = null;
  particleVelBuffer: GPUBuffer | null = null;
  particleColorBuffer: GPUBuffer | null = null;
  gridPosBuffer: GPUBuffer | null = null;
  gridColorBuffer: GPUBuffer | null = null;
  particleDensityBuffer: GPUBuffer | null = null;
  firstCellParticleBuffer: GPUBuffer | null = null;
  cellParticleIdsBuffer: GPUBuffer | null = null;
  hashCountsBuffer: GPUBuffer | null = null;
  hashOffsetsBuffer: GPUBuffer | null = null;
  hashCountsReadbackBuffer: GPUBuffer | null = null;
  hashBuildInFlight = false;
  particlePosScratchBuffer: GPUBuffer | null = null;
  particlePosReadbackBuffer: GPUBuffer | null = null;
  particleVelReadbackBuffer: GPUBuffer | null = null;
  particleColorReadbackBuffer: GPUBuffer | null = null;
  readbackInFlight = false;

  constructor(device: GPUDevice, format: GPUTextureFormat) {
    this.device = device;
    this.format = format;

    // --- Particle Pipeline ---
    const particleModule = device.createShaderModule({ code: particleShaderWGSL });
    this.particlePipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: particleModule,
        entryPoint: 'vs_main',
        buffers: [
          { // Position buffer
            arrayStride: 8,
            stepMode: 'instance',
            attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }],
          },
          { // Color buffer
            arrayStride: 12,
            stepMode: 'instance',
            attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x3' }],
          },
        ],
      },
      fragment: {
        module: particleModule,
        entryPoint: 'fs_main',
        targets: [{ format }],
      },
      primitive: { topology: 'triangle-strip' },
    });

    // --- Mesh (Obstacle) Pipeline ---
    const meshModule = device.createShaderModule({ code: meshShaderWGSL });
    this.meshPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: meshModule,
        entryPoint: 'vs_main',
      },
      fragment: {
        module: meshModule,
        entryPoint: 'fs_main',
        targets: [{ format }],
      },
      primitive: { topology: 'triangle-list' },
    });

    const boundaryModule = device.createShaderModule({ code: boundaryCollisionShaderWGSL });
    this.boundaryCollisionPipeline = device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: boundaryModule,
        entryPoint: 'main',
      },
    });
    const integrateModule = device.createShaderModule({ code: integrateParticlesShaderWGSL });
    this.integrateParticlesPipeline = device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: integrateModule,
        entryPoint: 'main',
      },
    });
    const colorFadeModule = device.createShaderModule({ code: particleColorFadeShaderWGSL });
    this.particleColorFadePipeline = device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: colorFadeModule,
        entryPoint: 'main',
      },
    });
    const surfaceTintModule = device.createShaderModule({ code: particleSurfaceTintShaderWGSL });
    this.particleSurfaceTintPipeline = device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: surfaceTintModule,
        entryPoint: 'main',
      },
    });
    const particleSeparationModule = device.createShaderModule({ code: particleSeparationShaderWGSL });
    this.particleSeparationPipeline = device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: particleSeparationModule,
        entryPoint: 'main',
      },
    });
    const hashCountModule = device.createShaderModule({ code: hashCountShaderWGSL });
    this.hashCountPipeline = device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: hashCountModule,
        entryPoint: 'main',
      },
    });
    const hashFillModule = device.createShaderModule({ code: hashFillShaderWGSL });
    this.hashFillPipeline = device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: hashFillModule,
        entryPoint: 'main',
      },
    });

    // --- Uniforms ---
    this.uniformBuffer = device.createBuffer({
      size: 16, // domainSize(8), pointSize(4), drawDisk(4)
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.meshUniformBuffer = device.createBuffer({
      size: 48, // domainSize(8), pad(8), color(12), pad(4), translation(8), scale(4), pad(4)
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.boundaryUniformBuffer = device.createBuffer({
      size: 64,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.integrateUniformBuffer = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.particleColorFadeUniformBuffer = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.particleSurfaceTintUniformBuffer = device.createBuffer({
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.particleSeparationUniformBuffer = device.createBuffer({
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.hashCountUniformBuffer = device.createBuffer({
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.hashFillUniformBuffer = device.createBuffer({
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.bindGroup = device.createBindGroup({
      layout: this.particlePipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
    });

    this.meshBindGroup = device.createBindGroup({
      layout: this.meshPipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.meshUniformBuffer } }],
    });
  }

  private createOrUpdateBuffer(data: Float32Array, existingBuffer: GPUBuffer | null, usage: GPUBufferUsageFlags): GPUBuffer {
    if (existingBuffer && existingBuffer.size === data.byteLength) {
      this.writeFloat32(existingBuffer, 0, data);
      return existingBuffer;
    }
    if (existingBuffer) existingBuffer.destroy();
    const buffer = this.device.createBuffer({
      size: data.byteLength,
      usage: usage | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Float32Array(buffer.getMappedRange()).set(data);
    buffer.unmap();
    return buffer;
  }

  private ensureReadbackBuffer(existing: GPUBuffer | null, size: number): GPUBuffer {
    if (existing && existing.size === size) return existing;
    if (existing) existing.destroy();
    return this.device.createBuffer({
      size,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
  }

  private writeFloat32(target: GPUBuffer, offset: number, data: Float32Array) {
    this.device.queue.writeBuffer(
      target,
      offset,
      data.buffer as ArrayBuffer,
      data.byteOffset,
      data.byteLength
    );
  }

  private createOrUpdateIntBuffer(data: Int32Array, existingBuffer: GPUBuffer | null, usage: GPUBufferUsageFlags): GPUBuffer {
    if (existingBuffer && existingBuffer.size === data.byteLength) {
      this.device.queue.writeBuffer(
        existingBuffer,
        0,
        data.buffer as ArrayBuffer,
        data.byteOffset,
        data.byteLength
      );
      return existingBuffer;
    }
    if (existingBuffer) existingBuffer.destroy();
    const buffer = this.device.createBuffer({
      size: data.byteLength,
      usage: usage | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Int32Array(buffer.getMappedRange()).set(data);
    buffer.unmap();
    return buffer;
  }

  private createOrUpdateUintBuffer(data: Uint32Array, existingBuffer: GPUBuffer | null, usage: GPUBufferUsageFlags): GPUBuffer {
    if (existingBuffer && existingBuffer.size === data.byteLength) {
      this.device.queue.writeBuffer(
        existingBuffer,
        0,
        data.buffer as ArrayBuffer,
        data.byteOffset,
        data.byteLength
      );
      return existingBuffer;
    }
    if (existingBuffer) existingBuffer.destroy();
    const buffer = this.device.createBuffer({
      size: data.byteLength,
      usage: usage | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Uint32Array(buffer.getMappedRange()).set(data);
    buffer.unmap();
    return buffer;
  }

  async buildSpatialHashHybrid(scene: Scene, options: { useGpuState?: boolean } = {}) {
    const fluid = scene.fluid;
    if (!fluid || fluid.numParticles === 0 || this.hashBuildInFlight) return;
    const useGpuState = options.useGpuState ?? false;

    const canReuseGpuState =
      useGpuState &&
      this.particlePosBuffer != null &&
      this.particlePosBuffer.size === fluid.particlePos.byteLength;

    if (!canReuseGpuState) {
      this.particlePosBuffer = this.createOrUpdateBuffer(
        fluid.particlePos,
        this.particlePosBuffer,
        GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
      );
    }

    const gridCells = fluid.spatialGridTotalCells;
    const numParticles = fluid.numParticles;
    const countsSize = gridCells * Uint32Array.BYTES_PER_ELEMENT;
    this.hashCountsBuffer = this.createOrUpdateUintBuffer(
      new Uint32Array(gridCells),
      this.hashCountsBuffer,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
    );
    this.hashCountsReadbackBuffer = this.ensureReadbackBuffer(this.hashCountsReadbackBuffer, countsSize);

    const hashUniformData = new Float32Array(8);
    hashUniformData[0] = numParticles;
    hashUniformData[1] = fluid.spatialGridNumX;
    hashUniformData[2] = fluid.spatialGridNumY;
    hashUniformData[4] = fluid.spatialGridInvSpacing;
    this.writeFloat32(this.hashCountUniformBuffer, 0, hashUniformData);
    this.writeFloat32(this.hashFillUniformBuffer, 0, hashUniformData);

    const countBindGroup = this.device.createBindGroup({
      layout: this.hashCountPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.hashCountUniformBuffer } },
        { binding: 1, resource: { buffer: this.particlePosBuffer! } },
        { binding: 2, resource: { buffer: this.hashCountsBuffer } },
      ],
    });

    const countEncoder = this.device.createCommandEncoder();
    const countPass = countEncoder.beginComputePass();
    countPass.setPipeline(this.hashCountPipeline);
    countPass.setBindGroup(0, countBindGroup);
    countPass.dispatchWorkgroups(Math.ceil(numParticles / 64));
    countPass.end();
    countEncoder.copyBufferToBuffer(this.hashCountsBuffer, 0, this.hashCountsReadbackBuffer, 0, countsSize);
    this.device.queue.submit([countEncoder.finish()]);

    this.hashBuildInFlight = true;
    try {
      await this.hashCountsReadbackBuffer.mapAsync(GPUMapMode.READ);
      const counts = new Uint32Array(this.hashCountsReadbackBuffer.getMappedRange());
      const starts = new Uint32Array(gridCells + 1);
      for (let i = 0; i < gridCells; i++) {
        starts[i + 1] = starts[i] + counts[i];
      }
      this.hashCountsReadbackBuffer.unmap();

      this.firstCellParticleBuffer = this.createOrUpdateUintBuffer(
        starts,
        this.firstCellParticleBuffer,
        GPUBufferUsage.STORAGE
      );
      this.hashOffsetsBuffer = this.createOrUpdateUintBuffer(
        starts.subarray(0, gridCells),
        this.hashOffsetsBuffer,
        GPUBufferUsage.STORAGE
      );
      this.cellParticleIdsBuffer = this.createOrUpdateUintBuffer(
        new Uint32Array(numParticles),
        this.cellParticleIdsBuffer,
        GPUBufferUsage.STORAGE
      );

      const fillBindGroup = this.device.createBindGroup({
        layout: this.hashFillPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.hashFillUniformBuffer } },
          { binding: 1, resource: { buffer: this.particlePosBuffer! } },
          { binding: 2, resource: { buffer: this.hashOffsetsBuffer } },
          { binding: 3, resource: { buffer: this.cellParticleIdsBuffer } },
        ],
      });

      const fillEncoder = this.device.createCommandEncoder();
      const fillPass = fillEncoder.beginComputePass();
      fillPass.setPipeline(this.hashFillPipeline);
      fillPass.setBindGroup(0, fillBindGroup);
      fillPass.dispatchWorkgroups(Math.ceil(numParticles / 64));
      fillPass.end();
      this.device.queue.submit([fillEncoder.finish()]);
    } finally {
      this.hashBuildInFlight = false;
    }
  }

  applyBoundaryCollision(
    scene: Scene,
    simWidth: number,
    simHeight: number,
    options: { useGpuState?: boolean } = {}
  ) {
    const fluid = scene.fluid!;
    if (!fluid || fluid.numParticles === 0) return;
    const useGpuState = options.useGpuState ?? false;

    const canReuseGpuState =
      useGpuState &&
      this.particlePosBuffer != null &&
      this.particleVelBuffer != null &&
      this.particlePosBuffer.size === fluid.particlePos.byteLength &&
      this.particleVelBuffer.size === fluid.particleVel.byteLength;

    if (!canReuseGpuState) {
      this.particlePosBuffer = this.createOrUpdateBuffer(
        fluid.particlePos,
        this.particlePosBuffer,
        GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
      );
      this.particleVelBuffer = this.createOrUpdateBuffer(
        fluid.particleVel,
        this.particleVelBuffer,
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
      );
    }
    const posBuffer = this.particlePosBuffer!;
    const velBuffer = this.particleVelBuffer!;

    const obstacleRadius = scene.showObstacle ? scene.obstacleRadius : 0.0;
    const minX = fluid.cellSize + fluid.particleRadius;
    const maxX = (fluid.numX - 1) * fluid.cellSize - fluid.particleRadius;
    const minY = fluid.cellSize + fluid.particleRadius;
    const maxY = (fluid.numY - 1) * fluid.cellSize - fluid.particleRadius;

    const boundaryData = new Float32Array(16);
    boundaryData[0] = simWidth;
    boundaryData[1] = simHeight;
    boundaryData[2] = fluid.particleRadius;
    boundaryData[3] = fluid.numParticles;
    boundaryData[4] = scene.obstacleX;
    boundaryData[5] = scene.obstacleY;
    boundaryData[6] = obstacleRadius;
    boundaryData[8] = scene.obstacleVelX;
    boundaryData[9] = scene.obstacleVelY;
    boundaryData[10] = minX;
    boundaryData[11] = maxX;
    boundaryData[12] = minY;
    boundaryData[13] = maxY;
    this.writeFloat32(this.boundaryUniformBuffer, 0, boundaryData);

    const boundaryBindGroup = this.device.createBindGroup({
      layout: this.boundaryCollisionPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.boundaryUniformBuffer } },
        { binding: 1, resource: { buffer: posBuffer } },
        { binding: 2, resource: { buffer: velBuffer } },
      ],
    });

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.boundaryCollisionPipeline);
    pass.setBindGroup(0, boundaryBindGroup);
    pass.dispatchWorkgroups(Math.ceil(fluid.numParticles / 64));
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  applyIntegrateParticles(scene: Scene, options: { useGpuState?: boolean } = {}) {
    const fluid = scene.fluid!;
    if (!fluid || fluid.numParticles === 0) return;
    const useGpuState = options.useGpuState ?? false;

    const canReuseGpuState =
      useGpuState &&
      this.particlePosBuffer != null &&
      this.particleVelBuffer != null &&
      this.particlePosBuffer.size === fluid.particlePos.byteLength &&
      this.particleVelBuffer.size === fluid.particleVel.byteLength;

    if (!canReuseGpuState) {
      this.particlePosBuffer = this.createOrUpdateBuffer(
        fluid.particlePos,
        this.particlePosBuffer,
        GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
      );
      this.particleVelBuffer = this.createOrUpdateBuffer(
        fluid.particleVel,
        this.particleVelBuffer,
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
      );
    }
    const posBuffer = this.particlePosBuffer!;
    const velBuffer = this.particleVelBuffer!;

    const integrateData = new Float32Array(4);
    integrateData[0] = scene.dt;
    integrateData[1] = scene.gravity;
    integrateData[2] = fluid.numParticles;
    this.writeFloat32(this.integrateUniformBuffer, 0, integrateData);

    const integrateBindGroup = this.device.createBindGroup({
      layout: this.integrateParticlesPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.integrateUniformBuffer } },
        { binding: 1, resource: { buffer: posBuffer } },
        { binding: 2, resource: { buffer: velBuffer } },
      ],
    });

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.integrateParticlesPipeline);
    pass.setBindGroup(0, integrateBindGroup);
    pass.dispatchWorkgroups(Math.ceil(fluid.numParticles / 64));
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  applyParticleColorFade(scene: Scene, step: number = 0.01, options: { useGpuState?: boolean } = {}) {
    const fluid = scene.fluid!;
    if (!fluid || fluid.numParticles === 0) return;
    const useGpuState = options.useGpuState ?? false;

    const canReuseGpuState =
      useGpuState &&
      this.particleColorBuffer != null &&
      this.particleColorBuffer.size === fluid.particleColor.byteLength;

    if (!canReuseGpuState) {
      this.particleColorBuffer = this.createOrUpdateBuffer(
        fluid.particleColor,
        this.particleColorBuffer,
        GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
      );
    }
    const colorBuffer = this.particleColorBuffer!;

    const colorFadeData = new Float32Array(4);
    colorFadeData[0] = fluid.numParticles;
    colorFadeData[1] = step;
    this.writeFloat32(this.particleColorFadeUniformBuffer, 0, colorFadeData);

    const colorFadeBindGroup = this.device.createBindGroup({
      layout: this.particleColorFadePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.particleColorFadeUniformBuffer } },
        { binding: 1, resource: { buffer: colorBuffer } },
      ],
    });

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.particleColorFadePipeline);
    pass.setBindGroup(0, colorFadeBindGroup);
    pass.dispatchWorkgroups(Math.ceil(fluid.numParticles / 64));
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  applyParticleSurfaceTint(
    scene: Scene,
    threshold: number = 0.7,
    bright: number = 0.8,
    options: { useGpuState?: boolean } = {}
  ) {
    const fluid = scene.fluid!;
    if (!fluid || fluid.numParticles === 0 || fluid.particleRestDensity <= 0.0) return;
    const useGpuState = options.useGpuState ?? false;

    const canReuseGpuState =
      useGpuState &&
      this.particlePosBuffer != null &&
      this.particleColorBuffer != null &&
      this.particlePosBuffer.size === fluid.particlePos.byteLength &&
      this.particleColorBuffer.size === fluid.particleColor.byteLength;

    if (!canReuseGpuState) {
      this.particleColorBuffer = this.createOrUpdateBuffer(
        fluid.particleColor,
        this.particleColorBuffer,
        GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
      );
      this.particlePosBuffer = this.createOrUpdateBuffer(
        fluid.particlePos,
        this.particlePosBuffer,
        GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
      );
    }
    this.particleDensityBuffer = this.createOrUpdateBuffer(
      fluid.particleDensity,
      this.particleDensityBuffer,
      GPUBufferUsage.STORAGE
    );

    const surfaceTintData = new Float32Array(8);
    surfaceTintData[0] = fluid.numParticles;
    surfaceTintData[1] = fluid.invCellSize;
    surfaceTintData[2] = fluid.particleRestDensity;
    surfaceTintData[3] = threshold;
    surfaceTintData[4] = bright;
    surfaceTintData[5] = fluid.numX;
    surfaceTintData[6] = fluid.numY;
    this.writeFloat32(this.particleSurfaceTintUniformBuffer, 0, surfaceTintData);

    const tintBindGroup = this.device.createBindGroup({
      layout: this.particleSurfaceTintPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.particleSurfaceTintUniformBuffer } },
        { binding: 1, resource: { buffer: this.particleColorBuffer! } },
        { binding: 2, resource: { buffer: this.particlePosBuffer! } },
        { binding: 3, resource: { buffer: this.particleDensityBuffer! } },
      ],
    });

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.particleSurfaceTintPipeline);
    pass.setBindGroup(0, tintBindGroup);
    pass.dispatchWorkgroups(Math.ceil(fluid.numParticles / 64));
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  applyParticleSeparation(scene: Scene, numIters: number = 1, options: { useGpuState?: boolean } = {}) {
    const fluid = scene.fluid!;
    if (!fluid || fluid.numParticles === 0) return;
    const useGpuState = options.useGpuState ?? false;

    const canReuseGpuState =
      useGpuState &&
      this.particlePosBuffer != null &&
      this.particlePosBuffer.size === fluid.particlePos.byteLength;

    if (!canReuseGpuState) {
      this.particlePosBuffer = this.createOrUpdateBuffer(
        fluid.particlePos,
        this.particlePosBuffer,
        GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
      );
    }
    this.particlePosScratchBuffer = this.createOrUpdateBuffer(
      fluid.particlePos,
      this.particlePosScratchBuffer,
      GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
    );

    this.firstCellParticleBuffer = this.createOrUpdateIntBuffer(
      fluid.firstCellParticle,
      this.firstCellParticleBuffer,
      GPUBufferUsage.STORAGE
    );
    this.cellParticleIdsBuffer = this.createOrUpdateIntBuffer(
      fluid.cellParticleIds,
      this.cellParticleIdsBuffer,
      GPUBufferUsage.STORAGE
    );

    const minDist = 2.0 * fluid.particleRadius;
    const separationData = new Float32Array(8);
    separationData[0] = fluid.numParticles;
    separationData[1] = fluid.spatialGridInvSpacing;
    separationData[2] = fluid.spatialGridNumX;
    separationData[3] = fluid.spatialGridNumY;
    separationData[4] = minDist;
    separationData[5] = minDist * minDist;
    this.writeFloat32(this.particleSeparationUniformBuffer, 0, separationData);

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.particleSeparationPipeline);

    const iters = Math.max(1, Math.floor(numIters));
    for (let iter = 0; iter < iters; iter++) {
      const bindGroup = this.device.createBindGroup({
        layout: this.particleSeparationPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.particleSeparationUniformBuffer } },
          { binding: 1, resource: { buffer: this.particlePosBuffer! } },
          { binding: 2, resource: { buffer: this.particlePosScratchBuffer! } },
          { binding: 3, resource: { buffer: this.firstCellParticleBuffer! } },
          { binding: 4, resource: { buffer: this.cellParticleIdsBuffer! } },
        ],
      });

      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(Math.ceil(fluid.numParticles / 64));

      const posTmp: GPUBuffer | null = this.particlePosBuffer;
      this.particlePosBuffer = this.particlePosScratchBuffer;
      this.particlePosScratchBuffer = posTmp;
    }

    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  syncParticlesToCpu(scene: Scene, options: { includeColor?: boolean } = {}) {
    const fluid = scene.fluid;
    if (!fluid || !this.particlePosBuffer || !this.particleVelBuffer || this.readbackInFlight) return;
    const includeColor = options.includeColor ?? false;
    if (includeColor && !this.particleColorBuffer) return;

    this.particlePosReadbackBuffer = this.ensureReadbackBuffer(this.particlePosReadbackBuffer, fluid.particlePos.byteLength);
    this.particleVelReadbackBuffer = this.ensureReadbackBuffer(this.particleVelReadbackBuffer, fluid.particleVel.byteLength);
    if (includeColor) {
      this.particleColorReadbackBuffer = this.ensureReadbackBuffer(this.particleColorReadbackBuffer, fluid.particleColor.byteLength);
    }

    const encoder = this.device.createCommandEncoder();
    encoder.copyBufferToBuffer(this.particlePosBuffer, 0, this.particlePosReadbackBuffer, 0, fluid.particlePos.byteLength);
    encoder.copyBufferToBuffer(this.particleVelBuffer, 0, this.particleVelReadbackBuffer, 0, fluid.particleVel.byteLength);
    if (includeColor) {
      encoder.copyBufferToBuffer(this.particleColorBuffer!, 0, this.particleColorReadbackBuffer!, 0, fluid.particleColor.byteLength);
    }
    this.device.queue.submit([encoder.finish()]);

    this.readbackInFlight = true;
    const maps: Promise<void>[] = [
      this.particlePosReadbackBuffer.mapAsync(GPUMapMode.READ),
      this.particleVelReadbackBuffer.mapAsync(GPUMapMode.READ),
    ];
    if (includeColor) maps.push(this.particleColorReadbackBuffer!.mapAsync(GPUMapMode.READ));
    Promise.all(maps)
      .then(() => {
        const posData = new Float32Array(this.particlePosReadbackBuffer!.getMappedRange());
        const velData = new Float32Array(this.particleVelReadbackBuffer!.getMappedRange());
        fluid.particlePos.set(posData);
        fluid.particleVel.set(velData);
        this.particlePosReadbackBuffer!.unmap();
        this.particleVelReadbackBuffer!.unmap();
        if (includeColor) {
          const colorData = new Float32Array(this.particleColorReadbackBuffer!.getMappedRange());
          fluid.particleColor.set(colorData);
          this.particleColorReadbackBuffer!.unmap();
        }
      })
      .finally(() => {
        this.readbackInFlight = false;
      });
  }

  draw(
    scene: Scene,
    simWidth: number,
    simHeight: number,
    context: GPUCanvasContext,
    options: { useGpuParticles?: boolean; useGpuParticleColors?: boolean } = {}
  ) {
    const fluid = scene.fluid!;
    if (!fluid) return;
    const useGpuParticles = options.useGpuParticles ?? false;
    const useGpuParticleColors = options.useGpuParticleColors ?? false;

    // 1. Update Uniforms
    this.writeFloat32(this.uniformBuffer, 0, new Float32Array([simWidth, simHeight]));

    const commandEncoder = this.device.createCommandEncoder();
    const renderPass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: context.getCurrentTexture().createView(),
        clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });

    // 2. Draw Grid
    if (scene.showGrid) {
      if (!this.gridPosBuffer) {
        const centers = new Float32Array(2 * fluid.totalCells);
        let p_idx = 0;
        for (let i = 0; i < fluid.numX; i++) {
          for (let j = 0; j < fluid.numY; j++) {
            centers[p_idx++] = (i + 0.5) * fluid.cellSize;
            centers[p_idx++] = (j + 0.5) * fluid.cellSize;
          }
        }
        this.gridPosBuffer = this.createOrUpdateBuffer(centers, null, GPUBufferUsage.VERTEX);
      }
      this.gridColorBuffer = this.createOrUpdateBuffer(fluid.cellColor, this.gridColorBuffer, GPUBufferUsage.VERTEX);

      const gridSize = fluid.cellSize * 0.9;
      this.writeFloat32(this.uniformBuffer, 8, new Float32Array([gridSize, 0.0])); // pointSize, drawDisk

      renderPass.setPipeline(this.particlePipeline);
      renderPass.setBindGroup(0, this.bindGroup);
      renderPass.setVertexBuffer(0, this.gridPosBuffer);
      renderPass.setVertexBuffer(1, this.gridColorBuffer);
      renderPass.draw(4, fluid.totalCells);
    }

    // 3. Draw Particles
    if (scene.showParticles) {
      if (!useGpuParticles || this.particlePosBuffer == null || this.particlePosBuffer.size !== fluid.particlePos.byteLength) {
        this.particlePosBuffer = this.createOrUpdateBuffer(
          fluid.particlePos,
          this.particlePosBuffer,
          GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
        );
      }
      if (!useGpuParticleColors || this.particleColorBuffer == null || this.particleColorBuffer.size !== fluid.particleColor.byteLength) {
        this.particleColorBuffer = this.createOrUpdateBuffer(
          fluid.particleColor,
          this.particleColorBuffer,
          GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
        );
      }

      const pSize = fluid.particleRadius * 2.0;
      this.writeFloat32(this.uniformBuffer, 8, new Float32Array([pSize, 1.0])); // pointSize, drawDisk

      renderPass.setPipeline(this.particlePipeline);
      renderPass.setBindGroup(0, this.bindGroup);
      renderPass.setVertexBuffer(0, this.particlePosBuffer);
      renderPass.setVertexBuffer(1, this.particleColorBuffer);
      renderPass.draw(4, fluid.numParticles);
    }

    // 4. Draw Obstacle
    if (scene.showObstacle) {
      // Mesh Uniforms (Respecting 16-byte alignment for vec3f)
      const meshData = new Float32Array(12); // 48 bytes
      meshData[0] = simWidth;
      meshData[1] = simHeight;
      // meshData[2,3] are padding
      meshData[4] = 1.0; // color.r (offset 16)
      meshData[5] = 0.0; // color.g
      meshData[6] = 0.0; // color.b
      // meshData[7] is padding
      meshData[8] = scene.obstacleX; // translation.x (offset 32)
      meshData[9] = scene.obstacleY; // translation.y
      meshData[10] = scene.obstacleRadius; // scale (offset 40)
      // meshData[11] is padding
      
      this.writeFloat32(this.meshUniformBuffer, 0, meshData);

      renderPass.setPipeline(this.meshPipeline);
      renderPass.setBindGroup(0, this.meshBindGroup);
      renderPass.draw(50 * 3); // 50 triangles for the disk
    }

    renderPass.end();
    this.device.queue.submit([commandEncoder.finish()]);
  }

  resetGridBuffer() {
    this.gridPosBuffer?.destroy();
    this.gridPosBuffer = null;
  }
}
