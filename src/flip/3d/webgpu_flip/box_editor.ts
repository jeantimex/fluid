import { AABB } from './aabb';
import { Camera } from './camera';
import boxEditorShader from './shaders/box_editor.wgsl?raw';

/**
 * Lightweight renderer for the simulation container wireframe.
 *
 * Notes:
 * - The "editor" naming comes from the original system, but this class is
 *   currently render-only (it does not expose interactive box editing tools).
 * - It draws boundary guides in world space, aligned with the simulation box.
 */
export class BoxEditor {
  device: GPUDevice;
  gridDimensions: number[];
  boxes: AABB[] = [];

  // WebGPU resources
  linePipeline: GPURenderPipeline;
  solidPipeline: GPURenderPipeline;

  gridVertexBuffer: GPUBuffer;
  cubeVertexBuffer: GPUBuffer;
  cubeIndexBuffer: GPUBuffer;

  uniformBuffer: GPUBuffer;
  bindGroup: GPUBindGroup;

  constructor(
    device: GPUDevice,
    presentationFormat: GPUTextureFormat,
    gridDimensions: number[]
  ) {
    this.device = device;
    this.gridDimensions = gridDimensions;

    // Default spawn box used by `main.ts` to initialize fluid particles.
    this.boxes.push(
      new AABB(
        [0, 0, 0],
        [
          gridDimensions[0] * 0.5,
          gridDimensions[1] * 0.8,
          gridDimensions[2] * 0.8,
        ]
      )
    );

    const shaderModule = device.createShaderModule({ code: boxEditorShader });

    // Explicit bind-group layout keeps uniform packing predictable.
    const bindGroupLayout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' },
        },
      ],
    });

    const pipelineLayout = device.createPipelineLayout({
      bindGroupLayouts: [bindGroupLayout],
    });

    const pipelineDescriptor: GPURenderPipelineDescriptor = {
      layout: pipelineLayout,
      vertex: {
        module: shaderModule,
        entryPoint: 'vs_main',
        buffers: [
          {
            arrayStride: 12,
            attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }],
          },
        ],
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fs_main',
        targets: [{ format: presentationFormat }],
      },
      primitive: { topology: 'line-list' },
      depthStencil: {
        depthWriteEnabled: true,
        depthCompare: 'less',
        format: 'depth24plus',
      },
    };

    this.linePipeline = device.createRenderPipeline(pipelineDescriptor);

    // Optional solid pipeline (kept for future extension/debug rendering).
    const solidDescriptor = { ...pipelineDescriptor };
    solidDescriptor.primitive = {
      topology: 'triangle-list',
      cullMode: 'back' as GPUCullMode,
    };
    this.solidPipeline = device.createRenderPipeline(
      solidDescriptor as GPURenderPipelineDescriptor
    );

    // Unit-cube wireframe edges. Scaled/translated in the vertex shader.
    const gridVertices = new Float32Array([
      0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0,
      1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 1, 1, 1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 0, 0, 0,
      0, 0, 1, 0, 1, 0, 0, 1, 1, 0, 1, 0, 1, 1, 1, 1, 0, 0, 1, 0, 1, 1,
    ]);
    this.gridVertexBuffer = this.createBuffer(
      gridVertices,
      GPUBufferUsage.VERTEX
    );

    // Unit cube mesh for optional filled box rendering.
    const cubeVertices = new Float32Array([
      0,
      0,
      1,
      1,
      0,
      1,
      1,
      1,
      1,
      0,
      1,
      1, // Front
      0,
      0,
      0,
      0,
      1,
      0,
      1,
      1,
      0,
      1,
      0,
      0, // Back
      0,
      1,
      0,
      0,
      1,
      1,
      1,
      1,
      1,
      1,
      1,
      0, // Top
      0,
      0,
      0,
      1,
      0,
      0,
      1,
      0,
      1,
      0,
      0,
      1, // Bottom
      1,
      0,
      0,
      1,
      1,
      0,
      1,
      1,
      1,
      1,
      0,
      1, // Right
      0,
      0,
      0,
      0,
      0,
      1,
      0,
      1,
      1,
      0,
      1,
      0, // Left
    ]);
    this.cubeVertexBuffer = this.createBuffer(
      cubeVertices,
      GPUBufferUsage.VERTEX
    );

    const cubeIndices = new Uint16Array([
      0,
      1,
      2,
      0,
      2,
      3, // front
      4,
      5,
      6,
      4,
      6,
      7, // back
      8,
      9,
      10,
      8,
      10,
      11, // top
      12,
      13,
      14,
      12,
      14,
      15, // bottom
      16,
      17,
      18,
      16,
      18,
      19, // right
      20,
      21,
      22,
      20,
      22,
      23, // left
    ]);
    this.cubeIndexBuffer = this.createBuffer(cubeIndices, GPUBufferUsage.INDEX);

    this.uniformBuffer = device.createBuffer({
      size: 256,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.bindGroup = device.createBindGroup({
      layout: bindGroupLayout,
      entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
    });
  }

  private createBuffer(
    data: Float32Array | Uint16Array,
    usage: GPUBufferUsageFlags
  ) {
    // One-time upload helper for static geometry buffers.
    const buffer = this.device.createBuffer({
      size: data.byteLength,
      usage: usage | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    if (data instanceof Float32Array) {
      new Float32Array(buffer.getMappedRange()).set(data);
    } else {
      new Uint16Array(buffer.getMappedRange()).set(data);
    }
    buffer.unmap();
    return buffer;
  }

  draw(
    passEncoder: GPURenderPassEncoder,
    projectionMatrix: Float32Array,
    camera: Camera,
    simOffset: number[] = [0, 0, 0],
    gridDimensions: number[] = [1, 1, 1]
  ) {
    // Uniform layout in shader:
    // [projection(64) | view(64) | translation(16) | scale(16) | color(16)]
    this.device.queue.writeBuffer(
      this.uniformBuffer,
      0,
      projectionMatrix as any
    );
    this.device.queue.writeBuffer(
      this.uniformBuffer,
      64,
      camera.getViewMatrix() as any
    );

    // Draw simulation boundary wireframe.
    passEncoder.setPipeline(this.linePipeline);
    passEncoder.setBindGroup(0, this.bindGroup);

    this.updateUniforms(simOffset, gridDimensions, [1.0, 1.0, 1.0, 1.0]);
    passEncoder.setVertexBuffer(0, this.gridVertexBuffer);
    passEncoder.draw(24);
  }

  private updateUniforms(
    translation: number[],
    scale: number[],
    color: number[]
  ) {
    // Per-draw transform/color update for the box shader.
    this.device.queue.writeBuffer(
      this.uniformBuffer,
      128,
      new Float32Array(translation)
    );
    this.device.queue.writeBuffer(
      this.uniformBuffer,
      144,
      new Float32Array(scale)
    );
    this.device.queue.writeBuffer(
      this.uniformBuffer,
      160,
      new Float32Array(color)
    );
  }
}
