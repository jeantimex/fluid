/**
 * =============================================================================
 * Marching Cubes Renderer - Compute + Indirect Draw Pipeline
 * =============================================================================
 *
 * Pipeline:
 * 1. Marching cubes compute over the 3D density volume → vertex buffer
 * 2. Compute render args (triangleCount → vertexCount)
 * 3. DrawIndirect triangles with a basic Lambert shader
 *
 * @module renderer
 */

import marchingCubesShader from './shaders/marching_cubes.wgsl?raw';
import renderArgsShader from './shaders/render_args.wgsl?raw';
import drawShader from './shaders/marching_cubes_draw.wgsl?raw';
import obstacleFaceShader from './shaders/obstacle_face.wgsl?raw';
import backgroundShader from './shaders/background.wgsl?raw';
import shadowShader from '../common/shaders/shadow_mesh.wgsl?raw';
import wireframeShader from '../common/shaders/wireframe.wgsl?raw';
import environmentShader from '../common/shaders/environment.wgsl?raw';
import shadowCommonShader from '../common/shaders/shadow_common.wgsl?raw';
import {
  marchingCubesEdgeA,
  marchingCubesEdgeB,
  marchingCubesLengths,
  marchingCubesLut,
  marchingCubesOffsets,
} from './marching_cubes_tables.ts';
import type { OrbitCamera } from '../common/orbit_camera.ts';
import {
  mat4Multiply,
  mat4Perspective,
  mat4LookAt,
  mat4Ortho,
} from '../common/math_utils.ts';
import type { MarchingCubesConfig } from './types.ts';
import type { SimConfig } from '../common/types.ts';
import { writeEnvironmentUniforms } from '../common/environment.ts';
import { preprocessShader } from '../common/shader_preprocessor.ts';

export class MarchingCubesRenderer {
  /**
   * Beginner note:
   * This renderer is a 2-stage pipeline:
   * 1) compute marching cubes into a triangle buffer
   * 2) draw that buffer with a standard render pipeline.
   */
  private device: GPUDevice;
  private canvas: HTMLCanvasElement;

  private marchingPipeline: GPUComputePipeline;
  private renderArgsPipeline: GPUComputePipeline;
  private drawPipeline: GPURenderPipeline;
  private facePipeline: GPURenderPipeline;
  private backgroundPipeline: GPURenderPipeline;
  private shadowMeshPipeline: GPURenderPipeline;
  private shadowObstaclePipeline: GPURenderPipeline;
  private wireframePipeline: GPURenderPipeline;

  private sampler: GPUSampler;
  private shadowSampler: GPUSampler;

  private paramsBuffer: GPUBuffer;
  private paramsData: ArrayBuffer;
  private paramsF32: Float32Array;
  private paramsU32: Uint32Array;

  private renderUniformBuffer: GPUBuffer;
  private envUniformBuffer: GPUBuffer;
  private camUniformBuffer: GPUBuffer;
  private shadowUniformBuffer: GPUBuffer;

  private triangleBuffer!: GPUBuffer;
  private triangleCountBuffer!: GPUBuffer;
  private renderArgsBuffer!: GPUBuffer;
  private renderArgsParamsBuffer!: GPUBuffer;
  private triangleCountReadback!: GPUBuffer;

  private lutBuffer: GPUBuffer;
  private offsetsBuffer: GPUBuffer;
  private lengthsBuffer: GPUBuffer;
  private edgeABuffer: GPUBuffer;
  private edgeBBuffer: GPUBuffer;

  private computeBindGroup!: GPUBindGroup;
  private renderArgsBindGroup!: GPUBindGroup;
  private drawBindGroup!: GPUBindGroup;
  private faceBindGroup!: GPUBindGroup;
  private backgroundBindGroup!: GPUBindGroup;
  private shadowMeshBindGroup!: GPUBindGroup;
  private shadowObstacleBindGroup!: GPUBindGroup;
  private wireframeBindGroup!: GPUBindGroup;

  private lineVertexBuffer!: GPUBuffer;
  private lineVertexData: Float32Array;

  private wireframeVertexBuffer!: GPUBuffer;
  private wireframeVertexData: Float32Array;
  private wireframeUniformBuffer!: GPUBuffer;

  private densityTextureSize = { x: 1, y: 1, z: 1 };
  private dispatchSize = { x: 1, y: 1, z: 1 };
  private mcWorkgroup = { x: 8, y: 8, z: 4 };
  private maxTriangles = 1;

  private depthTexture!: GPUTexture;
  private depthWidth = 0;
  private depthHeight = 0;
  
  private shadowTexture!: GPUTexture;
  private shadowMapSize = 2048;

  private resetCounterData = new Uint32Array([0]);

  constructor(
    device: GPUDevice,
    canvas: HTMLCanvasElement,
    format: GPUTextureFormat
  ) {
    this.device = device;
    this.canvas = canvas;
    const marchingModule = device.createShaderModule({
      code: marchingCubesShader,
    });
    this.marchingPipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module: marchingModule, entryPoint: 'main' },
    });

    const renderArgsModule = device.createShaderModule({
      code: renderArgsShader,
    });
    this.renderArgsPipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module: renderArgsModule, entryPoint: 'main' },
    });

    const drawCode = preprocessShader(drawShader, {
      '../../common/shaders/shadow_common.wgsl': shadowCommonShader,
    });
    const drawModule = device.createShaderModule({ code: drawCode });
    this.drawPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: drawModule, entryPoint: 'vs_main' },
      fragment: {
        module: drawModule,
        entryPoint: 'fs_main',
        targets: [{ format }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: true,
        depthCompare: 'less',
      },
    });

    // -------------------------------------------------------------------------
    // Create Face Render Pipeline (Obstacle)
    // -------------------------------------------------------------------------
    const faceCode = preprocessShader(obstacleFaceShader, {
      '../../common/shaders/shadow_common.wgsl': shadowCommonShader,
    });
    const faceModule = device.createShaderModule({ code: faceCode });
    this.facePipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: faceModule,
        entryPoint: 'vs_main',
        buffers: [
          {
            arrayStride: 40, // pos(12) + normal(12) + color(16)
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x3' }, // pos
              { shaderLocation: 1, offset: 12, format: 'float32x3' }, // normal
              { shaderLocation: 2, offset: 24, format: 'float32x4' }, // color
            ],
          },
        ],
      },
      fragment: {
        module: faceModule,
        entryPoint: 'fs_main',
        targets: [
          {
            format,
            blend: {
              color: {
                srcFactor: 'src-alpha',
                dstFactor: 'one-minus-src-alpha',
                operation: 'add',
              },
              alpha: {
                srcFactor: 'one',
                dstFactor: 'one-minus-src-alpha',
                operation: 'add',
              },
            },
          },
        ],
      },
      primitive: { topology: 'triangle-list', cullMode: 'back' },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: false, // Transparent faces don't write depth
        depthCompare: 'less',
      },
    });

    // -------------------------------------------------------------------------
    // Create Background Render Pipeline
    // -------------------------------------------------------------------------
    const bgCode = preprocessShader(backgroundShader, {
      '../../common/shaders/environment.wgsl': environmentShader,
      '../../common/shaders/shadow_common.wgsl': shadowCommonShader,
    });
    const bgModule = device.createShaderModule({ code: bgCode });
    this.backgroundPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: bgModule, entryPoint: 'vs_main' },
      fragment: {
        module: bgModule,
        entryPoint: 'fs_main',
        targets: [{ format }],
      },
      primitive: { topology: 'triangle-list' },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: false,
        depthCompare: 'always',
      },
    });

    // -------------------------------------------------------------------------
    // Create Shadow Render Pipelines
    // -------------------------------------------------------------------------
    const shadowCode = preprocessShader(shadowShader, {
      'shadow_common.wgsl': shadowCommonShader,
    });
    const shadowModule = device.createShaderModule({ code: shadowCode });
    
    // Mesh Shadow Pipeline
    this.shadowMeshPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: shadowModule, entryPoint: 'vs_mesh' },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: true,
        depthCompare: 'less',
      },
    });

    // Obstacle Shadow Pipeline
    this.shadowObstaclePipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { 
        module: shadowModule, 
        entryPoint: 'vs_obstacle',
        buffers: [
          {
            arrayStride: 40,
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x3' }, // pos
            ],
          },
        ],
      },
      primitive: { topology: 'triangle-list', cullMode: 'back' },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: true,
        depthCompare: 'less',
      },
    });

    // Allocate for face vertices (36 × 10 floats) + edge vertices (24 × 7 floats) + headroom
    this.lineVertexData = new Float32Array(720); // 36×10 + 24×7 = 528, with headroom

    this.lineVertexBuffer = device.createBuffer({
      size: 720 * 4, // 2880 bytes
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });

    // -------------------------------------------------------------------------
    // Create Wireframe Render Pipeline (for bounds visualization)
    // -------------------------------------------------------------------------
    const wireframeModule = device.createShaderModule({ code: wireframeShader });

    this.wireframePipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: wireframeModule,
        entryPoint: 'vs_main',
        buffers: [
          {
            arrayStride: 28, // 3 floats pos + 4 floats color = 7 floats = 28 bytes
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x3' }, // position
              { shaderLocation: 1, offset: 12, format: 'float32x4' }, // color
            ],
          },
        ],
      },
      fragment: {
        module: wireframeModule,
        entryPoint: 'fs_main',
        targets: [{ format }],
      },
      primitive: { topology: 'line-list' },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: true,
        depthCompare: 'less',
      },
    });

    // Wireframe uniform buffer (just viewProjection matrix = 64 bytes)
    this.wireframeUniformBuffer = device.createBuffer({
      size: 64,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Wireframe vertex buffer: 12 edges × 2 vertices × 7 floats = 168 floats
    this.wireframeVertexData = new Float32Array(168);
    this.wireframeVertexBuffer = device.createBuffer({
      size: this.wireframeVertexData.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });

    this.sampler = device.createSampler({
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
      addressModeW: 'clamp-to-edge',
      magFilter: 'linear',
      minFilter: 'linear',
    });

    this.shadowSampler = device.createSampler({
      compare: 'less',
      magFilter: 'linear',
      minFilter: 'linear',
    });

    // Params (std140): vec3<u32> + u32 + f32 + vec3<f32> padding + vec3<f32> + f32 = 64 bytes
    this.paramsData = new ArrayBuffer(64);
    this.paramsF32 = new Float32Array(this.paramsData);
    this.paramsU32 = new Uint32Array(this.paramsData);
    this.paramsBuffer = device.createBuffer({
      size: 64,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Render uniforms: viewProjection (64) + color (16) + lightDir (12) + ambient (4) + exposure (4) = 100 bytes. Round to 112.
    this.renderUniformBuffer = device.createBuffer({
      size: 112,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Environment uniforms: 240 bytes
    this.envUniformBuffer = device.createBuffer({
      size: 240,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Camera uniforms for background: 80 bytes
    this.camUniformBuffer = device.createBuffer({
      size: 80,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Shadow uniforms: lightViewProjection (64) + params (16) + padding (16) = 96 bytes
    this.shadowUniformBuffer = device.createBuffer({
      size: 96,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.lutBuffer = device.createBuffer({
      size: marchingCubesLut.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.lutBuffer, 0, marchingCubesLut);

    this.offsetsBuffer = device.createBuffer({
      size: marchingCubesOffsets.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.offsetsBuffer, 0, marchingCubesOffsets);

    this.lengthsBuffer = device.createBuffer({
      size: marchingCubesLengths.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.lengthsBuffer, 0, marchingCubesLengths);

    this.edgeABuffer = device.createBuffer({
      size: marchingCubesEdgeA.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.edgeABuffer, 0, marchingCubesEdgeA);

    this.edgeBBuffer = device.createBuffer({
      size: marchingCubesEdgeB.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.edgeBBuffer, 0, marchingCubesEdgeB);

    this.shadowObstacleBindGroup = device.createBindGroup({
      layout: this.shadowObstaclePipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.shadowUniformBuffer } }],
    });

    this.wireframeBindGroup = device.createBindGroup({
      layout: this.wireframePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.wireframeUniformBuffer } },
      ],
    });
  }

  recreate(
    densityTextureView: GPUTextureView,
    size: { x: number; y: number; z: number }
  ): void {
    this.densityTextureSize = { ...size };

    const voxelsX = Math.max(1, size.x - 1);
    const voxelsY = Math.max(1, size.y - 1);
    const voxelsZ = Math.max(1, size.z - 1);
    const numVoxels = voxelsX * voxelsY * voxelsZ;
    const maxStorage =
      this.device.limits.maxStorageBufferBindingSize ?? 268_435_456;
    const maxBuffer = this.device.limits.maxBufferSize ?? 268_435_456;
    const maxBytes = Math.min(maxStorage, maxBuffer);
    const vertexStride = 32; // vec3 position + vec3 normal (std430 alignment)
    const maxVertices = Math.floor(maxBytes / vertexStride);
    const maxTriangleCap = Math.max(1, Math.floor(maxVertices / 3));
    this.maxTriangles = Math.max(1, Math.min(numVoxels * 5, maxTriangleCap));

    this.dispatchSize = {
      x: Math.ceil(voxelsX / this.mcWorkgroup.x),
      y: Math.ceil(voxelsY / this.mcWorkgroup.y),
      z: Math.ceil(voxelsZ / this.mcWorkgroup.z),
    };

    if (this.triangleBuffer) this.triangleBuffer.destroy();
    if (this.triangleCountBuffer) this.triangleCountBuffer.destroy();
    if (this.renderArgsBuffer) this.renderArgsBuffer.destroy();
    if (this.renderArgsParamsBuffer) this.renderArgsParamsBuffer.destroy();
    if (this.triangleCountReadback) this.triangleCountReadback.destroy();
    if (this.shadowTexture) this.shadowTexture.destroy();

    const totalVertices = this.maxTriangles * 3;
    this.triangleBuffer = this.device.createBuffer({
      size: totalVertices * vertexStride,
      usage: GPUBufferUsage.STORAGE,
    });

    this.triangleCountBuffer = this.device.createBuffer({
      size: 4,
      usage:
        GPUBufferUsage.STORAGE |
        GPUBufferUsage.COPY_DST |
        GPUBufferUsage.COPY_SRC,
    });
    this.triangleCountReadback = this.device.createBuffer({
      size: 4,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });

    this.renderArgsBuffer = this.device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.INDIRECT | GPUBufferUsage.STORAGE,
    });

    this.renderArgsParamsBuffer = this.device.createBuffer({
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const argsParams = new Uint32Array([this.maxTriangles, 0, 0, 0]);
    this.device.queue.writeBuffer(this.renderArgsParamsBuffer, 0, argsParams);

    // Create shadow texture
    this.shadowTexture = this.device.createTexture({
      size: [this.shadowMapSize, this.shadowMapSize],
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });

    this.computeBindGroup = this.device.createBindGroup({
      layout: this.marchingPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: densityTextureView },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: { buffer: this.paramsBuffer } },
        { binding: 3, resource: { buffer: this.triangleBuffer } },
        { binding: 4, resource: { buffer: this.triangleCountBuffer } },
        { binding: 5, resource: { buffer: this.lutBuffer } },
        { binding: 6, resource: { buffer: this.offsetsBuffer } },
        { binding: 7, resource: { buffer: this.lengthsBuffer } },
        { binding: 8, resource: { buffer: this.edgeABuffer } },
        { binding: 9, resource: { buffer: this.edgeBBuffer } },
      ],
    });

    this.renderArgsBindGroup = this.device.createBindGroup({
      layout: this.renderArgsPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.triangleCountBuffer } },
        { binding: 1, resource: { buffer: this.renderArgsBuffer } },
        { binding: 2, resource: { buffer: this.renderArgsParamsBuffer } },
      ],
    });

    // Include shadow resources in draw bind group
    this.drawBindGroup = this.device.createBindGroup({
      layout: this.drawPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.triangleBuffer } },
        { binding: 1, resource: { buffer: this.renderUniformBuffer } },
        { binding: 2, resource: this.shadowTexture.createView() },
        { binding: 3, resource: this.shadowSampler },
        { binding: 4, resource: { buffer: this.shadowUniformBuffer } },
      ],
    });

    this.faceBindGroup = this.device.createBindGroup({
      layout: this.facePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.renderUniformBuffer } },
        { binding: 1, resource: this.shadowTexture.createView() },
        { binding: 2, resource: this.shadowSampler },
        { binding: 3, resource: { buffer: this.shadowUniformBuffer } },
      ],
    });

    // Include shadow resources in background bind group
    this.backgroundBindGroup = this.device.createBindGroup({
      layout: this.backgroundPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.envUniformBuffer } },
        { binding: 1, resource: { buffer: this.camUniformBuffer } },
        { binding: 2, resource: this.shadowTexture.createView() },
        { binding: 3, resource: this.shadowSampler },
        { binding: 4, resource: { buffer: this.shadowUniformBuffer } },
      ],
    });

    this.shadowMeshBindGroup = this.device.createBindGroup({
      layout: this.shadowMeshPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.shadowUniformBuffer } },
        { binding: 1, resource: { buffer: this.triangleBuffer } },
      ],
    });
  }

  /**
   * Builds obstacle box geometry (filled faces + wireframe edges).
   */
  private buildObstacleGeometry(config: SimConfig): {
    faceCount: number;
    edgeCount: number;
  } {
    const hx = config.obstacleSize.x * 0.5;
    const hy = config.obstacleSize.y * 0.5;
    const hz = config.obstacleSize.z * 0.5;

    if (hx <= 0 || hy <= 0 || hz <= 0) {
      return { faceCount: 0, edgeCount: 0 };
    }

    // obstacleCentre.y is the bottom, compute actual center
    const cx = config.obstacleCentre.x;
    const cy = config.obstacleCentre.y + config.obstacleSize.y * 0.5;
    const cz = config.obstacleCentre.z;

    const color = config.obstacleColor ?? { r: 1, g: 0, b: 0 };
    const alpha = config.obstacleAlpha ?? 0.8;

    // Rotation (degrees → radians)
    const degToRad = Math.PI / 180;
    const rx = config.obstacleRotation.x * degToRad;
    const ry = config.obstacleRotation.y * degToRad;
    const rz = config.obstacleRotation.z * degToRad;
    const cosX = Math.cos(rx),
      sinX = Math.sin(rx);
    const cosY = Math.cos(ry),
      sinY = Math.sin(ry);
    const cosZ = Math.cos(rz),
      sinZ = Math.sin(rz);

    const rotate = (
      lx: number,
      ly: number,
      lz: number
    ): [number, number, number] => {
      const y1 = ly * cosX - lz * sinX;
      const z1 = ly * sinX + lz * cosX;
      const x2 = lx * cosY + z1 * sinY;
      const z2 = -lx * sinY + z1 * cosY;
      const x3 = x2 * cosZ - y1 * sinZ;
      const y3 = x2 * sinZ + y1 * cosZ;
      return [x3 + cx, y3 + cy, z2 + cz];
    };

    const c = [
      rotate(-hx, -hy, -hz), // 0
      rotate(+hx, -hy, -hz), // 1
      rotate(+hx, +hy, -hz), // 2
      rotate(-hx, +hy, -hz), // 3
      rotate(-hx, -hy, +hz), // 4
      rotate(+hx, -hy, +hz), // 5
      rotate(+hx, +hy, +hz), // 6
      rotate(-hx, +hy, +hz), // 7
    ];

    // Rotate a direction vector (no translation)
    const rotateDir = (
      lx: number,
      ly: number,
      lz: number
    ): [number, number, number] => {
      const y1 = ly * cosX - lz * sinX;
      const z1 = ly * sinX + lz * cosX;
      const x2 = lx * cosY + z1 * sinY;
      const z2 = -lx * sinY + z1 * cosY;
      const x3 = x2 * cosZ - y1 * sinZ;
      const y3 = x2 * sinZ + y1 * cosZ;
      return [x3, y3, z2];
    };

    // Per-face outward normals in local space, rotated to world space.
    const faceNormals: [number, number, number][] = [
      rotateDir(0, 0, -1), // -Z back
      rotateDir(0, 0, +1), // +Z front
      rotateDir(-1, 0, 0), // -X left
      rotateDir(+1, 0, 0), // +X right
      rotateDir(0, -1, 0), // -Y bottom
      rotateDir(0, +1, 0), // +Y top
    ];

    let offset = 0;

    // Face vertex: pos(3) + normal(3) + color(4) = 10 floats
    const faceVert = (
      p: [number, number, number],
      n: [number, number, number]
    ) => {
      this.lineVertexData[offset++] = p[0];
      this.lineVertexData[offset++] = p[1];
      this.lineVertexData[offset++] = p[2];
      this.lineVertexData[offset++] = n[0];
      this.lineVertexData[offset++] = n[1];
      this.lineVertexData[offset++] = n[2];
      this.lineVertexData[offset++] = color.r;
      this.lineVertexData[offset++] = color.g;
      this.lineVertexData[offset++] = color.b;
      this.lineVertexData[offset++] = alpha;
    };

    // Edge vertex: pos(3) + color(4) = 7 floats
    const edgeVert = (p: [number, number, number]) => {
      this.lineVertexData[offset++] = p[0];
      this.lineVertexData[offset++] = p[1];
      this.lineVertexData[offset++] = p[2];
      this.lineVertexData[offset++] = color.r;
      this.lineVertexData[offset++] = color.g;
      this.lineVertexData[offset++] = color.b;
      this.lineVertexData[offset++] = alpha;
    };

    const faces = [
      [0, 2, 1, 0, 3, 2], // -Z back
      [4, 5, 6, 4, 6, 7], // +Z front
      [0, 4, 7, 0, 7, 3], // -X left
      [1, 2, 6, 1, 6, 5], // +X right
      [0, 1, 5, 0, 5, 4], // -Y bottom
      [3, 7, 6, 3, 6, 2], // +Y top
    ];

    for (let fi = 0; fi < faces.length; fi++) {
      const n = faceNormals[fi];
      for (const idx of faces[fi]) {
        faceVert(c[idx], n);
      }
    }

    const faceCount = 36;

    const edges = [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0], // back face (-z)
      [4, 5],
      [5, 6],
      [6, 7],
      [7, 4], // front face (+z)
      [0, 4],
      [1, 5],
      [2, 6],
      [3, 7], // connecting edges
    ];

    for (const [a, b] of edges) {
      edgeVert(c[a]);
      edgeVert(c[b]);
    }

    const edgeCount = 24;

    return { faceCount, edgeCount };
  }

  /**
   * Builds wireframe geometry for the simulation bounds.
   * Creates 12 edges (lines) representing the bounding box.
   */
  private buildBoundsWireframe(config: MarchingCubesConfig): number {
    const hx = config.boundsSize.x * 0.5;
    const hy = config.boundsSize.y * 0.5;
    const hz = config.boundsSize.z * 0.5;

    // Bounds center is at origin, bottom at -hy (adjusted for floor)
    const cy = hy - 5.0; // Offset to match the density bounds minY = -5.0

    const color = config.boundsWireframeColor ?? { r: 1, g: 1, b: 1 };

    // 8 corners of the bounding box
    const corners = [
      [-hx, cy - hy, -hz], // 0: back-bottom-left
      [+hx, cy - hy, -hz], // 1: back-bottom-right
      [+hx, cy + hy, -hz], // 2: back-top-right
      [-hx, cy + hy, -hz], // 3: back-top-left
      [-hx, cy - hy, +hz], // 4: front-bottom-left
      [+hx, cy - hy, +hz], // 5: front-bottom-right
      [+hx, cy + hy, +hz], // 6: front-top-right
      [-hx, cy + hy, +hz], // 7: front-top-left
    ];

    // 12 edges of the box (pairs of corner indices)
    const edges = [
      // Bottom face edges
      [0, 1], [1, 5], [5, 4], [4, 0],
      // Top face edges
      [3, 2], [2, 6], [6, 7], [7, 3],
      // Vertical edges
      [0, 3], [1, 2], [5, 6], [4, 7],
    ];

    let offset = 0;
    const addVertex = (cornerIdx: number) => {
      const c = corners[cornerIdx];
      this.wireframeVertexData[offset++] = c[0];
      this.wireframeVertexData[offset++] = c[1];
      this.wireframeVertexData[offset++] = c[2];
      this.wireframeVertexData[offset++] = color.r;
      this.wireframeVertexData[offset++] = color.g;
      this.wireframeVertexData[offset++] = color.b;
      this.wireframeVertexData[offset++] = 1.0; // alpha
    };

    for (const [a, b] of edges) {
      addVertex(a);
      addVertex(b);
    }

    return edges.length * 2; // 24 vertices
  }

  render(
    encoder: GPUCommandEncoder,
    targetView: GPUTextureView,
    camera: OrbitCamera,
    config: MarchingCubesConfig
  ): void {
    if (!this.computeBindGroup) return;

    this.ensureDepthTexture();

    // Update marching cubes params
    this.paramsU32[0] = this.densityTextureSize.x;
    this.paramsU32[1] = this.densityTextureSize.y;
    this.paramsU32[2] = this.densityTextureSize.z;
    this.paramsU32[3] = this.maxTriangles;
    this.paramsF32[4] = config.isoLevel;
    this.paramsF32[5] = config.densityTextureRes / 20; // voxelsPerUnit

    const size = config.boundsSize;
    const hx = size.x * 0.5;
    const hz = size.z * 0.5;
    const minY = -5.0; // Fixed bottom

    // minBounds
    this.paramsF32[8] = -hx;
    this.paramsF32[9] = minY;
    this.paramsF32[10] = -hz;

    // maxBounds
    this.paramsF32[12] = hx;
    this.paramsF32[13] = minY + size.y;
    this.paramsF32[14] = hz;

    this.device.queue.writeBuffer(this.paramsBuffer, 0, this.paramsData);

    // Reset triangle counter
    this.device.queue.writeBuffer(
      this.triangleCountBuffer,
      0,
      this.resetCounterData
    );

    // Marching cubes compute pass
    const mcPass = encoder.beginComputePass();
    mcPass.setPipeline(this.marchingPipeline);
    mcPass.setBindGroup(0, this.computeBindGroup);
    mcPass.dispatchWorkgroups(
      this.dispatchSize.x,
      this.dispatchSize.y,
      this.dispatchSize.z
    );
    mcPass.end();

    // Render args compute pass
    const argsPass = encoder.beginComputePass();
    argsPass.setPipeline(this.renderArgsPipeline);
    argsPass.setBindGroup(0, this.renderArgsBindGroup);
    argsPass.dispatchWorkgroups(1);
    argsPass.end();

    // -----------------------------------------------------------------------
    // Shadow Pass Calculations & Rendering
    // -----------------------------------------------------------------------
    
    // Calculate Shadow View-Projection
    const bounds = config.boundsSize;
    const floor = config.floorSize; // from EnvironmentConfig (config extends SimConfig, EnvironmentConfig)
    const sunDir = config.dirToSun;
    
    // Ortho bounds covering scene
    const lightDistance = Math.max(bounds.x + bounds.z, floor.x + floor.z);
    const orthoSize = lightDistance * 0.6;
    
    const lightPos = {
      x: sunDir.x * lightDistance,
      y: sunDir.y * lightDistance,
      z: sunDir.z * lightDistance,
    };
    
    const lightView = mat4LookAt(
      lightPos,
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 }
    );
    
    const lightProj = mat4Ortho(
      -orthoSize,
      orthoSize,
      -orthoSize,
      orthoSize,
      0.1,
      -lightDistance * 3.0
    );
    const lightViewProj = mat4Multiply(lightProj, lightView);

    // Upload to ShadowUniformBuffer
    const shadowUniforms = new Float32Array(20);
    shadowUniforms.set(lightViewProj); // 0-15
    shadowUniforms[16] = config.shadowSoftness ?? 1.0;
    shadowUniforms[17] = 0; // particleShadowRadius (not used in mesh)
    shadowUniforms[18] = 0; // pad0
    shadowUniforms[19] = 0; // pad1
    this.device.queue.writeBuffer(this.shadowUniformBuffer, 0, shadowUniforms);

    // Build Obstacle Geometry (used in shadow and main pass)
    const { faceCount, edgeCount } = this.buildObstacleGeometry(config);
    const totalFloats = faceCount * 10 + edgeCount * 7;
    if (totalFloats > 0) {
      this.device.queue.writeBuffer(
        this.lineVertexBuffer,
        0,
        this.lineVertexData.buffer,
        this.lineVertexData.byteOffset,
        totalFloats * 4
      );
    }

    // Build & Upload Bounds Wireframe Geometry
    let wireframeVertexCount = 0;
    if (config.showBoundsWireframe) {
      wireframeVertexCount = this.buildBoundsWireframe(config);
      this.device.queue.writeBuffer(
        this.wireframeVertexBuffer,
        0,
        this.wireframeVertexData.buffer,
        this.wireframeVertexData.byteOffset,
        wireframeVertexCount * 7 * 4
      );
    }

    // --- SHADOW PASS ---
    const shadowPass = encoder.beginRenderPass({
      colorAttachments: [],
      depthStencilAttachment: {
        view: this.shadowTexture.createView(),
        depthClearValue: 1.0,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    });

    // Only render shadows if enabled
    if (config.showFluidShadows) {
      // Mesh shadows
      shadowPass.setPipeline(this.shadowMeshPipeline);
      shadowPass.setBindGroup(0, this.shadowMeshBindGroup);
      shadowPass.drawIndirect(this.renderArgsBuffer, 0);

      // Obstacle shadows
      if (faceCount > 0) {
        shadowPass.setPipeline(this.shadowObstaclePipeline);
        shadowPass.setBindGroup(0, this.shadowObstacleBindGroup);
        shadowPass.setVertexBuffer(0, this.lineVertexBuffer, 0);
        shadowPass.draw(faceCount);
      }
    }
    shadowPass.end();

    // -----------------------------------------------------------------------
    // Main Rendering
    // -----------------------------------------------------------------------

    // Update Environment Uniforms
    const envData = new Float32Array(60);
    writeEnvironmentUniforms(envData, 0, config, config);
    this.device.queue.writeBuffer(this.envUniformBuffer, 0, envData);

    // Update Camera Uniforms for Background
    const viewMatrix = camera.viewMatrix;
    const camRight = { x: viewMatrix[0], y: viewMatrix[4], z: viewMatrix[8] };
    const camUp    = { x: viewMatrix[1], y: viewMatrix[5], z: viewMatrix[9] };
    const camBack  = { x: viewMatrix[2], y: viewMatrix[6], z: viewMatrix[10] };
    const camFwd   = { x: -camBack.x, y: -camBack.y, z: -camBack.z };
    
    const tx = viewMatrix[12];
    const ty = viewMatrix[13];
    const tz = viewMatrix[14];
    
    const eyeX = -(camRight.x * tx + camUp.x * ty + camBack.x * tz);
    const eyeY = -(camRight.y * tx + camUp.y * ty + camBack.y * tz);
    const eyeZ = -(camRight.z * tx + camUp.z * ty + camBack.z * tz);

    const aspect = this.canvas.width / this.canvas.height;
    const camFullData = new Float32Array(20);
    camFullData[0] = eyeX; camFullData[1] = eyeY; camFullData[2] = eyeZ; camFullData[3] = 0;
    camFullData[4] = camFwd.x; camFullData[5] = camFwd.y; camFullData[6] = camFwd.z; camFullData[7] = 0;
    camFullData[8] = camRight.x; camFullData[9] = camRight.y; camFullData[10] = camRight.z; camFullData[11] = 0;
    camFullData[12] = camUp.x; camFullData[13] = camUp.y; camFullData[14] = camUp.z; camFullData[15] = 0;
    camFullData[16] = Math.PI / 3;
    camFullData[17] = aspect;
    this.device.queue.writeBuffer(this.camUniformBuffer, 0, camFullData);

    // Update render uniforms
    const projection = mat4Perspective(Math.PI / 3, aspect, 0.1, 200.0);
    const viewProj = mat4Multiply(projection, camera.viewMatrix);

    const uniforms = new Float32Array(28);
    uniforms.set(viewProj);
    uniforms[16] = config.surfaceColor.r;
    uniforms[17] = config.surfaceColor.g;
    uniforms[18] = config.surfaceColor.b;
    uniforms[19] = 1.0;
    // Light dir updated to match environment sun dir
    uniforms[20] = config.dirToSun.x;
    uniforms[21] = config.dirToSun.y;
    uniforms[22] = config.dirToSun.z;
    uniforms[23] = config.floorAmbient;
    uniforms[24] = config.sceneExposure;
    uniforms[25] = config.sunBrightness;
    this.device.queue.writeBuffer(this.renderUniformBuffer, 0, uniforms);

    // Update wireframe uniform buffer with viewProjection
    if (config.showBoundsWireframe) {
      this.device.queue.writeBuffer(
        this.wireframeUniformBuffer,
        0,
        viewProj.buffer,
        viewProj.byteOffset,
        viewProj.byteLength
      );
    }

    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: targetView,
          clearValue: { r: 0.05, g: 0.05, b: 0.08, a: 1 }, // Irrelevant
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
      depthStencilAttachment: {
        view: this.depthTexture.createView(),
        depthClearValue: 1.0,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    });

    // 1. Draw Background
    pass.setPipeline(this.backgroundPipeline);
    pass.setBindGroup(0, this.backgroundBindGroup);
    pass.draw(3, 1, 0, 0);

    // 2. Draw Marching Cubes Mesh
    pass.setPipeline(this.drawPipeline);
    pass.setBindGroup(0, this.drawBindGroup);
    pass.drawIndirect(this.renderArgsBuffer, 0);

    // 3. Draw Obstacle
    if (faceCount > 0) {
      pass.setPipeline(this.facePipeline);
      pass.setBindGroup(0, this.faceBindGroup);
      pass.setVertexBuffer(0, this.lineVertexBuffer, 0);
      pass.draw(faceCount);
    }

    // 4. Draw Bounds Wireframe
    if (config.showBoundsWireframe && wireframeVertexCount > 0) {
      pass.setPipeline(this.wireframePipeline);
      pass.setBindGroup(0, this.wireframeBindGroup);
      pass.setVertexBuffer(0, this.wireframeVertexBuffer, 0);
      pass.draw(wireframeVertexCount);
    }

    pass.end();
  }

  private ensureDepthTexture(): void {
    const width = Math.max(1, this.canvas.width);
    const height = Math.max(1, this.canvas.height);
    if (
      this.depthTexture &&
      width === this.depthWidth &&
      height === this.depthHeight
    ) {
      return;
    }

    if (this.depthTexture) {
      this.depthTexture.destroy();
    }

    this.depthTexture = this.device.createTexture({
      size: [width, height],
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.depthWidth = width;
    this.depthHeight = height;
  }
}
