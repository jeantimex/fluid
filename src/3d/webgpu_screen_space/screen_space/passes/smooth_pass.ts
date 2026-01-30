/**
 * Smooth pass skeleton: blur/smooth thickness or depth in screen space.
 */

import smoothShader from '../shaders/smooth.wgsl?raw';
import type {
  ScreenSpaceFrame,
  SmoothPassResources,
} from '../screen_space_types.ts';

export class SmoothPass {
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

    const module = device.createShaderModule({ code: smoothShader });
    this.pipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({
        bindGroupLayouts: [this.bindGroupLayout],
      }),
      vertex: { module, entryPoint: 'vs_main' },
      fragment: {
        module,
        entryPoint: 'fs_main',
        targets: [{ format: 'r16float' }],
      },
      primitive: { topology: 'triangle-list' },
    });
  }

  resize(_width: number, _height: number) {
    // Placeholder.
  }

  createBindGroup(resources: SmoothPassResources) {
    if (!resources.thicknessTexture) {
      this.bindGroup = null;
      return;
    }

    this.bindGroup = this.device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: resources.thicknessTexture.createView() },
        { binding: 1, resource: this.sampler },
      ],
    });
  }

  encode(
    encoder: GPUCommandEncoder,
    resources: SmoothPassResources,
    _frame: ScreenSpaceFrame
  ) {
    if (!resources.smoothTextureB) {
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
          view: resources.smoothTextureB.createView(),
          clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 0.0 },
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
