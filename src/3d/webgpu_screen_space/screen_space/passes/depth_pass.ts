/**
 * Depth pass skeleton: render particles into a depth/linear depth target.
 */

import depthShader from '../shaders/depth.wgsl?raw';
import type {
  DepthPassResources,
  ScreenSpaceFrame,
} from '../screen_space_types.ts';

export class DepthPass {
  private device: GPUDevice;
  private pipeline: GPURenderPipeline;
  private uniformBuffer: GPUBuffer;
  private bindGroupLayout: GPUBindGroupLayout;
  private bindGroup: GPUBindGroup | null = null;

  constructor(device: GPUDevice) {
    this.device = device;

    this.uniformBuffer = device.createBuffer({
      size: 96,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.bindGroupLayout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: 'read-only-storage' },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' },
        },
      ],
    });

    const module = device.createShaderModule({ code: depthShader });

    this.pipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({
        bindGroupLayouts: [this.bindGroupLayout],
      }),
      vertex: {
        module,
        entryPoint: 'vs_main',
      },
      fragment: {
        module,
        entryPoint: 'fs_main',
        targets: [{ format: 'r16float' }],
      },
      primitive: {
        topology: 'triangle-list',
        cullMode: 'none',
      },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: true,
        depthCompare: 'less',
      },
    });
  }

  resize(_width: number, _height: number) {
    // Placeholder.
  }

  createBindGroup(resources: DepthPassResources) {
    this.bindGroup = this.device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: resources.buffers.positions } },
        { binding: 1, resource: { buffer: this.uniformBuffer } },
      ],
    });
  }

  encode(
    encoder: GPUCommandEncoder,
    resources: DepthPassResources,
    frame: ScreenSpaceFrame
  ) {
    if (!resources.depthTexture || !this.bindGroup) {
      return;
    }

    const uniforms = new Float32Array(24);
    uniforms.set(frame.viewProjection);
    uniforms[16] = frame.canvasWidth;
    uniforms[17] = frame.canvasHeight;
    uniforms[18] = frame.particleRadius;
    uniforms[19] = 0.0;
    uniforms[20] = frame.near;
    uniforms[21] = frame.far;
    this.device.queue.writeBuffer(this.uniformBuffer, 0, uniforms);

    if (!resources.smoothTextureA) {
      return;
    }

    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: resources.smoothTextureA.createView(),
          clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
      depthStencilAttachment: {
        view: resources.depthTexture.createView(),
        depthClearValue: 1.0,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    });

    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.draw(6, resources.buffers.particleCount);
    pass.end();
  }
}
