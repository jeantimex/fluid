/**
 * Normal pass skeleton: reconstruct normals from depth.
 */

import normalShader from '../shaders/normal.wgsl?raw';
import type {
  NormalPassResources,
  ScreenSpaceFrame,
} from '../screen_space_types.ts';

export class NormalPass {
  private device: GPUDevice;
  private pipeline: GPURenderPipeline;
  private bindGroupLayout: GPUBindGroupLayout;
  private bindGroup: GPUBindGroup | null = null;
  private sampler: GPUSampler;

  constructor(device: GPUDevice) {
    this.device = device;

    this.sampler = device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
    });

    this.bindGroupLayout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'float' },
        },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
      ],
    });

    const module = device.createShaderModule({ code: normalShader });
    this.pipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({
        bindGroupLayouts: [this.bindGroupLayout],
      }),
      vertex: { module, entryPoint: 'vs_main' },
      fragment: {
        module,
        entryPoint: 'fs_main',
        targets: [{ format: 'rgba16float' }],
      },
      primitive: { topology: 'triangle-list' },
    });
  }

  resize(_width: number, _height: number) {
    this.bindGroup = null;
  }

  createBindGroup(resources: NormalPassResources) {
    if (!resources.smoothTextureA) {
      this.bindGroup = null;
      return;
    }

    this.bindGroup = this.device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: resources.smoothTextureA.createView() },
        { binding: 1, resource: this.sampler },
      ],
    });
  }

  encode(
    encoder: GPUCommandEncoder,
    resources: NormalPassResources,
    _frame: ScreenSpaceFrame
  ) {
    if (!resources.normalTexture) {
      return;
    }
    if (!this.bindGroup) {
      this.createBindGroup(resources);
    }
    if (!this.bindGroup) {
      return;
    }

    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: resources.normalTexture.createView(),
          clearValue: { r: 0.5, g: 0.5, b: 1.0, a: 1.0 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });

    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.draw(6, 1);
    pass.end();
  }
}
