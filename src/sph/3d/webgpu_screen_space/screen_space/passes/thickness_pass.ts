/**
 * Thickness pass skeleton: accumulate particle thickness in screen space.
 */

import thicknessShader from '../shaders/thickness.wgsl?raw';
import type {
  ScreenSpaceFrame,
  ThicknessPassResources,
} from '../screen_space_types.ts';

export class ThicknessPass {
  private device: GPUDevice;
  private pipeline: GPURenderPipeline;
  private uniformBuffer: GPUBuffer;
  private bindGroupLayout: GPUBindGroupLayout;
  private bindGroup: GPUBindGroup | null = null;

  constructor(device: GPUDevice) {
    this.device = device;

    this.uniformBuffer = device.createBuffer({
      size: 80,
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
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: 'uniform' },
        },
      ],
    });

    const module = device.createShaderModule({ code: thicknessShader });

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
        targets: [
          {
            format: 'r16float',
            blend: {
              color: { srcFactor: 'one', dstFactor: 'one' },
              alpha: { srcFactor: 'one', dstFactor: 'one' },
            },
          },
        ],
      },
      primitive: {
        topology: 'triangle-list',
        cullMode: 'none',
      },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: false,
        depthCompare: 'less-equal',
      },
    });
  }

  resize(_width: number, _height: number) {
    // Placeholder.
  }

  createBindGroup(resources: ThicknessPassResources) {
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
    resources: ThicknessPassResources,
    frame: ScreenSpaceFrame
  ) {
    if (
      !resources.thicknessTexture ||
      !resources.depthTexture ||
      !this.bindGroup
    ) {
      return;
    }

    const uniforms = new Float32Array(20);
    uniforms.set(frame.viewProjection);
    uniforms[16] = frame.canvasWidth;
    uniforms[17] = frame.canvasHeight;
    uniforms[18] = frame.particleRadius;
    uniforms[19] = 0.0;
    this.device.queue.writeBuffer(this.uniformBuffer, 0, uniforms);

    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: resources.thicknessTexture.createView(),
          clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 0.0 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
      depthStencilAttachment: {
        view: resources.depthTexture.createView(),
        depthLoadOp: 'load',
        depthStoreOp: 'store',
      },
    });

    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.draw(6, resources.buffers.particleCount);
    pass.end();
  }
}
