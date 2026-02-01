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
import densityProbeShader from './shaders/density_probe.wgsl?raw';
import renderArgsShader from './shaders/render_args.wgsl?raw';
import drawShader from './shaders/marching_cubes_draw.wgsl?raw';
import {
  marchingCubesEdgeA,
  marchingCubesEdgeB,
  marchingCubesLengths,
  marchingCubesLut,
  marchingCubesOffsets,
} from './marching_cubes_tables.ts';
import type { OrbitCamera } from '../webgpu_particles/orbit_camera.ts';
import { mat4Multiply, mat4Perspective } from '../webgpu_particles/math_utils.ts';
import type { MarchingCubesConfig } from './types.ts';

export class MarchingCubesRenderer {
  private device: GPUDevice;
  private canvas: HTMLCanvasElement;
  private format: GPUTextureFormat;

  private marchingPipeline: GPUComputePipeline;
  private renderArgsPipeline: GPUComputePipeline;
  private drawPipeline: GPURenderPipeline;

  private sampler: GPUSampler;

  private paramsBuffer: GPUBuffer;
  private paramsData: ArrayBuffer;
  private paramsF32: Float32Array;
  private paramsU32: Uint32Array;

  private renderUniformBuffer: GPUBuffer;

  private triangleBuffer!: GPUBuffer;
  private triangleCountBuffer!: GPUBuffer;
  private renderArgsBuffer!: GPUBuffer;
  private renderArgsParamsBuffer!: GPUBuffer;
  private triangleCountReadback!: GPUBuffer;
  private debugReadbackPending = false;
  private debugFrame = 0;
  private probePipeline: GPUComputePipeline;
  private probeParamsBuffer: GPUBuffer;
  private probeOutBuffer: GPUBuffer;
  private probeReadback: GPUBuffer;
  private probeBindGroup!: GPUBindGroup;
  private probePending = false;

  private lutBuffer: GPUBuffer;
  private offsetsBuffer: GPUBuffer;
  private lengthsBuffer: GPUBuffer;
  private edgeABuffer: GPUBuffer;
  private edgeBBuffer: GPUBuffer;

  private computeBindGroup!: GPUBindGroup;
  private renderArgsBindGroup!: GPUBindGroup;
  private drawBindGroup!: GPUBindGroup;

  private densityTextureSize = { x: 1, y: 1, z: 1 };
  private dispatchSize = { x: 1, y: 1, z: 1 };
  private mcWorkgroup = { x: 8, y: 8, z: 4 };
  private maxTriangles = 1;

  private depthTexture!: GPUTexture;
  private depthWidth = 0;
  private depthHeight = 0;
  private resetCounterData = new Uint32Array([0]);

  constructor(device: GPUDevice, canvas: HTMLCanvasElement, format: GPUTextureFormat) {
    this.device = device;
    this.canvas = canvas;
    this.format = format;

    const marchingModule = device.createShaderModule({ code: marchingCubesShader });
    this.marchingPipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module: marchingModule, entryPoint: 'main' },
    });

    const renderArgsModule = device.createShaderModule({ code: renderArgsShader });
    this.renderArgsPipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module: renderArgsModule, entryPoint: 'main' },
    });

    const probeModule = device.createShaderModule({ code: densityProbeShader });
    this.probePipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module: probeModule, entryPoint: 'main' },
    });

    const drawModule = device.createShaderModule({ code: drawShader });
    this.drawPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: drawModule, entryPoint: 'vs_main' },
      fragment: { module: drawModule, entryPoint: 'fs_main', targets: [{ format }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: true,
        depthCompare: 'less',
      },
    });

    this.sampler = device.createSampler({
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
      addressModeW: 'clamp-to-edge',
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

    // Render uniforms: viewProjection (64) + color (16) + lightDir (12) + pad (4) = 96 bytes
    this.renderUniformBuffer = device.createBuffer({
      size: 96,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.probeParamsBuffer = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.probeOutBuffer = device.createBuffer({
      size: 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    this.probeReadback = device.createBuffer({
      size: 4,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
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
  }

  recreate(densityTextureView: GPUTextureView, size: { x: number; y: number; z: number }): void {
    this.densityTextureSize = { ...size };

    const voxelsX = Math.max(1, size.x - 1);
    const voxelsY = Math.max(1, size.y - 1);
    const voxelsZ = Math.max(1, size.z - 1);
    const numVoxels = voxelsX * voxelsY * voxelsZ;
    const maxStorage = this.device.limits.maxStorageBufferBindingSize ?? 268_435_456;
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

    this.drawBindGroup = this.device.createBindGroup({
      layout: this.drawPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.triangleBuffer } },
        { binding: 1, resource: { buffer: this.renderUniformBuffer } },
      ],
    });

    this.probeBindGroup = this.device.createBindGroup({
      layout: this.probePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: densityTextureView },
        { binding: 1, resource: { buffer: this.probeParamsBuffer } },
        { binding: 2, resource: { buffer: this.probeOutBuffer } },
      ],
    });
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
    this.paramsF32[8] = config.boundsSize.x;
    this.paramsF32[9] = config.boundsSize.y;
    this.paramsF32[10] = config.boundsSize.z;
    this.device.queue.writeBuffer(this.paramsBuffer, 0, this.paramsData);

    // Reset triangle counter
    this.device.queue.writeBuffer(this.triangleCountBuffer, 0, this.resetCounterData);

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

    // Update render uniforms
    const aspect = this.canvas.width / this.canvas.height;
    const projection = mat4Perspective(Math.PI / 3, aspect, 0.1, 200.0);
    const viewProj = mat4Multiply(projection, camera.viewMatrix);

    const uniforms = new Float32Array(24);
    uniforms.set(viewProj);
    uniforms[16] = config.surfaceColor.r;
    uniforms[17] = config.surfaceColor.g;
    uniforms[18] = config.surfaceColor.b;
    uniforms[19] = 1.0;
    uniforms[20] = 0.83;
    uniforms[21] = 0.42;
    uniforms[22] = 0.36;
    uniforms[23] = 0;
    this.device.queue.writeBuffer(this.renderUniformBuffer, 0, uniforms);

    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: targetView,
          clearValue: { r: 0.05, g: 0.05, b: 0.08, a: 1 },
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

    pass.setPipeline(this.drawPipeline);
    pass.setBindGroup(0, this.drawBindGroup);
    pass.drawIndirect(this.renderArgsBuffer, 0);
    pass.end();
  }

  private ensureDepthTexture(): void {
    const width = Math.max(1, this.canvas.width);
    const height = Math.max(1, this.canvas.height);
    if (this.depthTexture && width === this.depthWidth && height === this.depthHeight) {
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
