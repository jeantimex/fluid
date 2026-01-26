/**
 * Handles WebGPU rendering for particles and boundaries.
 */

import type { SimConfig } from '../common/types.ts';
import type { SimulationBuffers } from './simulation_buffers.ts';
import { buildGradientLut } from '../common/kernels.ts';

import particleShader from './shaders/particle.wgsl?raw';
import lineShader from './shaders/line.wgsl?raw';

export class Renderer {
  private device: GPUDevice;

  // Pipelines
  private particlePipeline: GPURenderPipeline;
  private linePipeline: GPURenderPipeline;

  // Buffers
  private uniformBuffer: GPUBuffer;
  private gradientBuffer: GPUBuffer;
  private lineVertexBuffer: GPUBuffer;
  private lineVertexData: Float32Array;

  // Bind groups
  private particleBindGroup!: GPUBindGroup;
  private lineBindGroup: GPUBindGroup;

  // Constants
  private readonly lineVertexStride = 6 * 4;
  private readonly lineVertexCapacity = 16;
  private readonly clearColor = { r: 5 / 255, g: 7 / 255, b: 11 / 255, a: 1 };

  // Uniform data
  private uniformData = new Float32Array(8);

  constructor(device: GPUDevice, format: GPUTextureFormat, config: SimConfig) {
    this.device = device;

    // Create uniform buffer
    this.uniformBuffer = device.createBuffer({
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Create gradient buffer
    const gradientLut = buildGradientLut(
      config.colorKeys,
      config.gradientResolution
    );
    const gradientData = new Float32Array(config.gradientResolution * 4);
    for (let i = 0; i < gradientLut.length; i++) {
      gradientData[i * 4] = gradientLut[i].r;
      gradientData[i * 4 + 1] = gradientLut[i].g;
      gradientData[i * 4 + 2] = gradientLut[i].b;
      gradientData[i * 4 + 3] = 1;
    }
    this.gradientBuffer = device.createBuffer({
      size: gradientData.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Float32Array(this.gradientBuffer.getMappedRange()).set(gradientData);
    this.gradientBuffer.unmap();

    // Create line vertex buffer
    this.lineVertexData = new Float32Array(this.lineVertexCapacity * 6);
    this.lineVertexBuffer = device.createBuffer({
      size: this.lineVertexData.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });

    // Create particle pipeline
    const particleModule = device.createShaderModule({ code: particleShader });
    this.particlePipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: particleModule,
        entryPoint: 'vs_main',
      },
      fragment: {
        module: particleModule,
        entryPoint: 'fs_main',
        targets: [{ format }],
      },
      primitive: {
        topology: 'triangle-list',
      },
    });

    // Create line pipeline
    const lineModule = device.createShaderModule({ code: lineShader });
    this.linePipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: lineModule,
        entryPoint: 'vs_main',
        buffers: [
          {
            arrayStride: this.lineVertexStride,
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x2' },
              { shaderLocation: 1, offset: 2 * 4, format: 'float32x4' },
            ],
          },
        ],
      },
      fragment: {
        module: lineModule,
        entryPoint: 'fs_main',
        targets: [{ format }],
      },
      primitive: {
        topology: 'line-list',
      },
    });

    // Create line bind group
    this.lineBindGroup = device.createBindGroup({
      layout: this.linePipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
    });
  }

  createBindGroup(buffers: SimulationBuffers): void {
    this.particleBindGroup = this.device.createBindGroup({
      layout: this.particlePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.positions } },
        { binding: 1, resource: { buffer: buffers.velocities } },
        { binding: 2, resource: { buffer: this.gradientBuffer } },
        { binding: 3, resource: { buffer: this.uniformBuffer } },
      ],
    });
  }

  updateUniforms(
    config: SimConfig,
    canvasWidth: number,
    canvasHeight: number
  ): void {
    this.uniformData[0] = config.boundsSize.x;
    this.uniformData[1] = config.boundsSize.y;
    this.uniformData[2] = canvasWidth;
    this.uniformData[3] = canvasHeight;
    this.uniformData[4] = config.particleRadius;
    this.uniformData[5] = config.velocityDisplayMax;
    this.uniformData[6] = config.gradientResolution;
    this.uniformData[7] = 0;
    this.device.queue.writeBuffer(this.uniformBuffer, 0, this.uniformData);
  }

  render(
    encoder: GPUCommandEncoder,
    context: GPUCanvasContext,
    config: SimConfig,
    particleCount: number
  ): void {
    // Build line vertices
    let lineVertexCount = 0;
    const pushLine = (
      x0: number,
      y0: number,
      x1: number,
      y1: number,
      r: number,
      g: number,
      b: number,
      a: number
    ): void => {
      const base = lineVertexCount * 6;
      this.lineVertexData[base] = x0;
      this.lineVertexData[base + 1] = y0;
      this.lineVertexData[base + 2] = r;
      this.lineVertexData[base + 3] = g;
      this.lineVertexData[base + 4] = b;
      this.lineVertexData[base + 5] = a;
      this.lineVertexData[base + 6] = x1;
      this.lineVertexData[base + 7] = y1;
      this.lineVertexData[base + 8] = r;
      this.lineVertexData[base + 9] = g;
      this.lineVertexData[base + 10] = b;
      this.lineVertexData[base + 11] = a;
      lineVertexCount += 2;
    };

    // Draw bounds
    const halfX = config.boundsSize.x * 0.5;
    const halfY = config.boundsSize.y * 0.5;
    const boundsCol = { r: 0x1b / 255, g: 0x24 / 255, b: 0x32 / 255, a: 1 };
    pushLine(
      -halfX,
      -halfY,
      halfX,
      -halfY,
      boundsCol.r,
      boundsCol.g,
      boundsCol.b,
      boundsCol.a
    );
    pushLine(
      halfX,
      -halfY,
      halfX,
      halfY,
      boundsCol.r,
      boundsCol.g,
      boundsCol.b,
      boundsCol.a
    );
    pushLine(
      halfX,
      halfY,
      -halfX,
      halfY,
      boundsCol.r,
      boundsCol.g,
      boundsCol.b,
      boundsCol.a
    );
    pushLine(
      -halfX,
      halfY,
      -halfX,
      -halfY,
      boundsCol.r,
      boundsCol.g,
      boundsCol.b,
      boundsCol.a
    );

    // Draw obstacle
    if (config.obstacleSize.x > 0 && config.obstacleSize.y > 0) {
      const obsHalfX = config.obstacleSize.x * 0.5;
      const obsHalfY = config.obstacleSize.y * 0.5;
      const cx = config.obstacleCentre.x;
      const cy = config.obstacleCentre.y;
      const obstacleCol = { r: 0x36 / 255, g: 0x51 / 255, b: 0x6d / 255, a: 1 };
      pushLine(
        cx - obsHalfX,
        cy - obsHalfY,
        cx + obsHalfX,
        cy - obsHalfY,
        obstacleCol.r,
        obstacleCol.g,
        obstacleCol.b,
        obstacleCol.a
      );
      pushLine(
        cx + obsHalfX,
        cy - obsHalfY,
        cx + obsHalfX,
        cy + obsHalfY,
        obstacleCol.r,
        obstacleCol.g,
        obstacleCol.b,
        obstacleCol.a
      );
      pushLine(
        cx + obsHalfX,
        cy + obsHalfY,
        cx - obsHalfX,
        cy + obsHalfY,
        obstacleCol.r,
        obstacleCol.g,
        obstacleCol.b,
        obstacleCol.a
      );
      pushLine(
        cx - obsHalfX,
        cy + obsHalfY,
        cx - obsHalfX,
        cy - obsHalfY,
        obstacleCol.r,
        obstacleCol.g,
        obstacleCol.b,
        obstacleCol.a
      );
    }

    // Upload line vertices
    this.device.queue.writeBuffer(
      this.lineVertexBuffer,
      0,
      this.lineVertexData.subarray(
        0,
        lineVertexCount * 6
      ) as Float32Array<ArrayBuffer>
    );

    // Begin render pass
    const view = context.getCurrentTexture().createView();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view,
          clearValue: this.clearColor,
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });

    // Draw particles
    pass.setPipeline(this.particlePipeline);
    pass.setBindGroup(0, this.particleBindGroup);
    pass.draw(6, particleCount);

    // Draw lines
    if (lineVertexCount > 0) {
      pass.setPipeline(this.linePipeline);
      pass.setBindGroup(0, this.lineBindGroup);
      pass.setVertexBuffer(0, this.lineVertexBuffer);
      pass.draw(lineVertexCount);
    }

    pass.end();
  }
}
