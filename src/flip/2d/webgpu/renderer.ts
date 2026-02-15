import particleShader from './shaders/particle.wgsl?raw';
import { SimParams } from './types';

export class FlipRenderer {
  private device: GPUDevice;
  private pipeline: GPURenderPipeline;
  private uniformBuffer: GPUBuffer;
  private bindGroup: GPUBindGroup;

  constructor(
    device: GPUDevice,
    format: GPUTextureFormat,
    params: SimParams
  ) {
    this.device = device;

    // Create Uniform Buffer
    this.uniformBuffer = device.createBuffer({
      size: 16, // vec2 (8) + f32 (4) + padding (4)
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Create Pipeline
    this.pipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: device.createShaderModule({ code: particleShader }),
        entryPoint: 'vs_main',
        buffers: [
          {
            // Position buffer
            arrayStride: 8, // vec2<f32>
            stepMode: 'instance',
            attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }],
          },
          {
            // Color buffer
            arrayStride: 12, // vec3<f32>
            stepMode: 'instance',
            attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x3' }],
          },
        ],
      },
      fragment: {
        module: device.createShaderModule({ code: particleShader }),
        entryPoint: 'fs_main',
        targets: [{ format }],
      },
      primitive: {
        topology: 'triangle-strip',
      },
    });

    // Create Bind Group
    this.bindGroup = device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        {
          binding: 0,
          resource: { buffer: this.uniformBuffer },
        },
      ],
    });

    this.updateUniforms(params);
  }

  updateUniforms(params: SimParams) {
    const data = new Float32Array([
      params.width,
      params.height,
      params.particleRadius * 1.5, // Visual size
      0.0 // Padding
    ]);
    this.device.queue.writeBuffer(this.uniformBuffer, 0, data);
  }

  render(
    context: GPUCanvasContext,
    posBuffer: GPUBuffer,
    colorBuffer: GPUBuffer,
    numParticles: number
  ) {
    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: context.getCurrentTexture().createView(),
          clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });

    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.setVertexBuffer(0, posBuffer);
    pass.setVertexBuffer(1, colorBuffer);
    pass.draw(4, numParticles);

    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }
}
