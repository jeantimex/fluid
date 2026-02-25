import surfaceFieldShader from './shaders/surface_field.wgsl?raw';
import marchingCubesShader from './shaders/marching_cubes.wgsl?raw';

/**
 * Surface Renderer - Renders fluid as a smooth mesh using Marching Cubes
 *
 * This class handles:
 * 1. Computing a scalar field from particle positions
 * 2. Extracting a triangle mesh using Marching Cubes
 * 3. Rendering the mesh with proper shading
 */
export class SurfaceRenderer {
  private device: GPUDevice;

  // Grid dimensions
  private nx: number;
  private ny: number;
  private nz: number;

  // Buffers
  private uniformBuffer: GPUBuffer;
  private scalarFieldBuffer: GPUBuffer;
  private scalarFieldAtomicBuffer: GPUBuffer;
  private vertexBuffer: GPUBuffer;
  private normalBuffer: GPUBuffer;
  private triangleCountBuffer: GPUBuffer;
  private triangleCountStagingBuffer: GPUBuffer;

  // Pipelines
  private clearFieldPipeline: GPUComputePipeline;
  private computeFieldPipeline: GPUComputePipeline;
  private normalizeFieldPipeline: GPUComputePipeline;
  private marchingCubesPipeline: GPUComputePipeline;
  private resetCounterPipeline: GPUComputePipeline;

  // Bind groups
  private fieldBindGroup: GPUBindGroup;
  private marchingCubesBindGroup: GPUBindGroup;

  // Render pipeline
  private renderPipeline: GPURenderPipeline;
  private renderBindGroup: GPUBindGroup;
  private cameraUniformBuffer: GPUBuffer;

  // Shadow/AO pipelines
  private shadowPipeline: GPURenderPipeline;
  private aoPipeline: GPURenderPipeline;
  private shadowUniformBuffer: GPUBuffer;
  private shadowBindGroup: GPUBindGroup;

  // Configuration
  private maxTriangles: number;
  private kernelRadius: number = 1.0;
  private surfaceLevel: number = 0.2;  // Lower threshold for more surface

  // Cached triangle count for rendering
  private currentTriangleCount: number = 0;

  // Flag to prevent buffer mapping conflicts
  private isMappingPending: boolean = false;

  constructor(
    device: GPUDevice,
    nx: number,
    ny: number,
    nz: number,
    gridWidth: number,
    gridHeight: number,
    gridDepth: number,
    particlePositionBuffer: GPUBuffer,
    presentationFormat: GPUTextureFormat
  ) {
    this.device = device;
    this.nx = nx;
    this.ny = ny;
    this.nz = nz;

    // Field size is (nx+1) x (ny+1) x (nz+1)
    const fieldSize = (nx + 1) * (ny + 1) * (nz + 1);
    // Max triangles = 5 per cell (worst case)
    this.maxTriangles = nx * ny * nz * 5;

    // Create uniform buffer
    this.uniformBuffer = device.createBuffer({
      size: 48, // 12 floats
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Create scalar field buffer
    this.scalarFieldBuffer = device.createBuffer({
      size: fieldSize * 4,
      usage: GPUBufferUsage.STORAGE,
    });

    // Create atomic scalar field buffer for accumulation
    this.scalarFieldAtomicBuffer = device.createBuffer({
      size: fieldSize * 4,
      usage: GPUBufferUsage.STORAGE,
    });

    // Create mesh buffers (3 vertices per triangle)
    this.vertexBuffer = device.createBuffer({
      size: this.maxTriangles * 3 * 16, // vec4 per vertex
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX,
    });

    this.normalBuffer = device.createBuffer({
      size: this.maxTriangles * 3 * 16, // vec4 per normal
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX,
    });

    this.triangleCountBuffer = device.createBuffer({
      size: 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });

    this.triangleCountStagingBuffer = device.createBuffer({
      size: 4,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    // Camera uniform buffer for render pipeline
    this.cameraUniformBuffer = device.createBuffer({
      size: 256, // Enough for view + projection matrices
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Create compute pipelines
    const fieldModule = this.device.createShaderModule({ code: surfaceFieldShader });
    const mcModule = this.device.createShaderModule({ code: marchingCubesShader });

    // Field computation bind group layout (Shared for all 3 kernels)
    const fieldBindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } }, // atomicScalarField
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } }, // scalarField
      ],
    });

    this.clearFieldPipeline = this.device.createComputePipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [fieldBindGroupLayout] }),
      compute: { module: fieldModule, entryPoint: 'clearField' },
    });

    this.computeFieldPipeline = this.device.createComputePipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [fieldBindGroupLayout] }),
      compute: { module: fieldModule, entryPoint: 'computeField' },
    });

    this.normalizeFieldPipeline = this.device.createComputePipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [fieldBindGroupLayout] }),
      compute: { module: fieldModule, entryPoint: 'normalizeField' },
    });

    // Marching cubes bind group layout
    const mcBindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ],
    });

    this.marchingCubesPipeline = this.device.createComputePipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [mcBindGroupLayout] }),
      compute: { module: mcModule, entryPoint: 'marchingCubes' },
    });

    this.resetCounterPipeline = this.device.createComputePipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [mcBindGroupLayout] }),
      compute: { module: mcModule, entryPoint: 'resetCounter' },
    });

    // Create bind groups
    this.fieldBindGroup = this.device.createBindGroup({
      layout: fieldBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: { buffer: particlePositionBuffer } },
        { binding: 2, resource: { buffer: this.scalarFieldAtomicBuffer } },
        { binding: 3, resource: { buffer: this.scalarFieldBuffer } },
      ],
    });

    this.marchingCubesBindGroup = this.device.createBindGroup({
      layout: mcBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: { buffer: this.scalarFieldBuffer } },
        { binding: 2, resource: { buffer: this.vertexBuffer } },
        { binding: 3, resource: { buffer: this.normalBuffer } },
        { binding: 4, resource: { buffer: this.triangleCountBuffer } },
      ],
    });

    // Create render pipeline
    // Output G-buffer compatible data: (normal.xy, speed, viewZ)
    const renderShaderModule = device.createShaderModule({
      code: `
        struct CameraUniforms {
          viewProjection: mat4x4<f32>,
          viewMatrix: mat4x4<f32>,
          simOffset: vec3<f32>,
          _pad: f32,
        };

        @group(0) @binding(0) var<uniform> camera: CameraUniforms;

        struct VertexOutput {
          @builtin(position) position: vec4<f32>,
          @location(0) viewNormal: vec3<f32>,
          @location(1) viewZ: f32,
        };

        @vertex
        fn vs_main(
          @location(0) position: vec4<f32>,
          @location(1) normal: vec4<f32>
        ) -> VertexOutput {
          // Apply simulation offset to transform from sim space to world space
          let worldPos = position.xyz + camera.simOffset;
          let worldPos4 = vec4<f32>(worldPos, 1.0);

          var out: VertexOutput;
          out.position = camera.viewProjection * worldPos4;
          // Transform normal to view space
          out.viewNormal = (camera.viewMatrix * vec4<f32>(normal.xyz, 0.0)).xyz;
          // Get view-space Z for depth
          let viewPos = camera.viewMatrix * worldPos4;
          out.viewZ = viewPos.z;
          return out;
        }

        @fragment
        fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
          // Output G-buffer format: (normal.x, normal.y, speed, viewZ)
          let n = normalize(in.viewNormal);
          // Use 0 for speed since surface mesh doesn't have velocity
          return vec4<f32>(n.x, n.y, 0.0, in.viewZ);
        }
      `,
    });

    const renderBindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      ],
    });

    this.renderPipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [renderBindGroupLayout] }),
      vertex: {
        module: renderShaderModule,
        entryPoint: 'vs_main',
        buffers: [
          {
            arrayStride: 16,
            attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x4' }],
          },
          {
            arrayStride: 16,
            attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x4' }],
          },
        ],
      },
      fragment: {
        module: renderShaderModule,
        entryPoint: 'fs_main',
        targets: [
          {
            format: 'rgba16float',
          },
        ],
      },
      primitive: {
        topology: 'triangle-list',
        cullMode: 'none',  // Disable culling to debug winding order issues
      },
      depthStencil: {
        depthWriteEnabled: true,
        depthCompare: 'less',
        format: 'depth24plus',
      },
    });

    this.renderBindGroup = device.createBindGroup({
      layout: renderBindGroupLayout,
      entries: [{ binding: 0, resource: { buffer: this.cameraUniformBuffer } }],
    });

    // Shadow Pipeline
    this.shadowUniformBuffer = device.createBuffer({
      size: 128, // mat4x4 + vec3 offset
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const shadowShaderModule = device.createShaderModule({
      code: `
        struct ShadowUniforms {
          viewProjection: mat4x4<f32>,
          simOffset: vec3<f32>,
          _pad: f32,
        };
        @group(0) @binding(0) var<uniform> shadow: ShadowUniforms;
        @vertex
        fn vs_main(@location(0) position: vec4<f32>) -> @builtin(position) vec4<f32> {
          return shadow.viewProjection * vec4<f32>(position.xyz + shadow.simOffset, 1.0);
        }
        @fragment fn fs_main() {}
      `,
    });

    const shadowBindGroupLayout = device.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } }],
    });

    this.shadowPipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [shadowBindGroupLayout] }),
      vertex: {
        module: shadowShaderModule,
        entryPoint: 'vs_main',
        buffers: [{ arrayStride: 16, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x4' }] }],
      },
      fragment: { module: shadowShaderModule, entryPoint: 'fs_main', targets: [] },
      primitive: { topology: 'triangle-list', cullMode: 'back' },
      depthStencil: { depthWriteEnabled: true, depthCompare: 'less', format: 'depth32float' },
    });

    this.shadowBindGroup = device.createBindGroup({
      layout: shadowBindGroupLayout,
      entries: [{ binding: 0, resource: { buffer: this.shadowUniformBuffer } }],
    });

    // AO Pipeline (Simplified SSAO for mesh)
    // Reuse G-buffer vertex shader, just output to AO target
    this.aoPipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [renderBindGroupLayout] }),
      vertex: {
        module: renderShaderModule,
        entryPoint: 'vs_main',
        buffers: [
          { arrayStride: 16, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x4' }] },
          { arrayStride: 16, attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x4' }] },
        ],
      },
      fragment: {
        module: renderShaderModule,
        entryPoint: 'fs_main',
        targets: [{
          format: 'r16float',
          blend: {
            color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
          },
        }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { depthWriteEnabled: false, depthCompare: 'less', format: 'depth24plus' },
    });

    // Initialize uniforms
    this.updateUniforms(gridWidth, gridHeight, gridDepth, 0, this.kernelRadius);
  }

  /**
   * Update uniforms for surface field computation
   */
  updateUniforms(
    gridWidth: number,
    gridHeight: number,
    gridDepth: number,
    particleCount: number,
    kernelRadius?: number
  ) {
    if (kernelRadius !== undefined) {
      this.kernelRadius = kernelRadius;
    }

    const data = new ArrayBuffer(48);
    const u32View = new Uint32Array(data);
    const f32View = new Float32Array(data);

    // SurfaceFieldUniforms
    u32View[0] = this.nx;
    u32View[1] = this.ny;
    u32View[2] = this.nz;
    u32View[3] = particleCount;
    f32View[4] = gridWidth;
    f32View[5] = gridHeight;
    f32View[6] = gridDepth;
    f32View[7] = 0.1; // particleRadius (not used directly)
    f32View[8] = this.kernelRadius;
    f32View[9] = this.surfaceLevel;
    f32View[10] = 0; // pad
    f32View[11] = 0; // pad

    this.device.queue.writeBuffer(this.uniformBuffer, 0, data);
  }

  /**
   * Update camera matrices for rendering
   */
  updateCamera(viewProjection: Float32Array, viewMatrix: Float32Array, simOffset: [number, number, number]) {
    const data = new Float32Array(36); // 16 for viewProjection + 16 for viewMatrix + 4 for simOffset (with padding)
    data.set(viewProjection, 0);
    data.set(viewMatrix, 16);
    data[32] = simOffset[0];
    data[33] = simOffset[1];
    data[34] = simOffset[2];
    data[35] = 0; // padding
    this.device.queue.writeBuffer(this.cameraUniformBuffer, 0, data);
  }

  /**
   * Update shadow camera
   */
  updateShadowCamera(viewProjection: Float32Array, simOffset: [number, number, number]) {
    const data = new Float32Array(20);
    data.set(viewProjection, 0);
    data[16] = simOffset[0];
    data[17] = simOffset[1];
    data[18] = simOffset[2];
    data[19] = 0;
    this.device.queue.writeBuffer(this.shadowUniformBuffer, 0, data);
  }

  /**
   * Compute surface mesh from particles
   */
  computeSurface(
    commandEncoder: GPUCommandEncoder,
    particleCount: number,
    gridWidth: number,
    gridHeight: number,
    gridDepth: number
  ) {
    // Update uniforms with current particle count
    this.updateUniforms(gridWidth, gridHeight, gridDepth, particleCount);

    const pass = commandEncoder.beginComputePass();

    // Workgroup sizes
    const fieldWGx = Math.ceil((this.nx + 1) / 8);
    const fieldWGy = Math.ceil((this.ny + 1) / 4);
    const fieldWGz = Math.ceil((this.nz + 1) / 4);

    const cellWGx = Math.ceil(this.nx / 8);
    const cellWGy = Math.ceil(this.ny / 4);
    const cellWGz = Math.ceil(this.nz / 4);

    const particleWG = Math.ceil(particleCount / 64);

    // 1. Clear scalar field (atomic buffer)
    pass.setPipeline(this.clearFieldPipeline);
    pass.setBindGroup(0, this.fieldBindGroup);
    pass.dispatchWorkgroups(fieldWGx, fieldWGy, fieldWGz);

    // 2. Compute scalar field from particles (Scatter approach)
    pass.setPipeline(this.computeFieldPipeline);
    pass.setBindGroup(0, this.fieldBindGroup);
    pass.dispatchWorkgroups(particleWG);

    // 3. Normalize field (Convert Atomic Int to Float)
    pass.setPipeline(this.normalizeFieldPipeline);
    pass.setBindGroup(0, this.fieldBindGroup);
    pass.dispatchWorkgroups(fieldWGx, fieldWGy, fieldWGz);

    // 4. Reset triangle counter
    pass.setPipeline(this.resetCounterPipeline);
    pass.setBindGroup(0, this.marchingCubesBindGroup);
    pass.dispatchWorkgroups(1);

    // 5. Run marching cubes
    pass.setPipeline(this.marchingCubesPipeline);
    pass.setBindGroup(0, this.marchingCubesBindGroup);
    pass.dispatchWorkgroups(cellWGx, cellWGy, cellWGz);

    pass.end();

    // Copy triangle count for CPU readback (only if not currently mapping)
    if (!this.isMappingPending) {
      commandEncoder.copyBufferToBuffer(
        this.triangleCountBuffer,
        0,
        this.triangleCountStagingBuffer,
        0,
        4
      );
    }
  }

  /**
   * Read back triangle count (async)
   */
  async readTriangleCount(): Promise<number> {
    if (this.isMappingPending) {
      return this.currentTriangleCount;
    }

    this.isMappingPending = true;
    try {
      await this.triangleCountStagingBuffer.mapAsync(GPUMapMode.READ);
      const data = new Uint32Array(this.triangleCountStagingBuffer.getMappedRange());
      const count = data[0];
      this.triangleCountStagingBuffer.unmap();
      this.currentTriangleCount = Math.min(count, this.maxTriangles);
    } finally {
      this.isMappingPending = false;
    }
    return this.currentTriangleCount;
  }

  /**
   * Render the surface mesh
   */
  render(passEncoder: GPURenderPassEncoder) {
    if (this.currentTriangleCount === 0) return;

    passEncoder.setPipeline(this.renderPipeline);
    passEncoder.setBindGroup(0, this.renderBindGroup);
    passEncoder.setVertexBuffer(0, this.vertexBuffer);
    passEncoder.setVertexBuffer(1, this.normalBuffer);
    passEncoder.draw(this.currentTriangleCount * 3);
  }

  /**
   * Render the surface mesh to shadow map
   */
  renderShadow(passEncoder: GPURenderPassEncoder) {
    if (this.currentTriangleCount === 0) return;

    passEncoder.setPipeline(this.shadowPipeline);
    passEncoder.setBindGroup(0, this.shadowBindGroup);
    passEncoder.setVertexBuffer(0, this.vertexBuffer);
    passEncoder.draw(this.currentTriangleCount * 3);
  }

  /**
   * Render the surface mesh to AO
   */
  renderAO(passEncoder: GPURenderPassEncoder) {
    if (this.currentTriangleCount === 0) return;

    passEncoder.setPipeline(this.aoPipeline);
    passEncoder.setBindGroup(0, this.renderBindGroup);
    passEncoder.setVertexBuffer(0, this.vertexBuffer);
    passEncoder.setVertexBuffer(1, this.normalBuffer);
    passEncoder.draw(this.currentTriangleCount * 3);
  }

  /**
   * Set kernel radius for field computation
   */
  setKernelRadius(radius: number) {
    this.kernelRadius = radius;
  }

  /**
   * Set surface level for isosurface extraction
   */
  setSurfaceLevel(level: number) {
    this.surfaceLevel = level;
  }

  /**
   * Get current triangle count
   */
  getTriangleCount(): number {
    return this.currentTriangleCount;
  }
}
