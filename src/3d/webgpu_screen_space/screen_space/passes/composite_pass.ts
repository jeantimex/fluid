/**
 * Composite pass skeleton: final shading/compositing.
 */

import debugShader from '../shaders/debug_composite.wgsl?raw';
import type {
  CompositePassResources,
  ScreenSpaceFrame,
} from '../screen_space_types.ts';

export class CompositePass {
  private device: GPUDevice;
  private format: GPUTextureFormat;
  private pipeline: GPURenderPipeline;
  private bindGroupLayout: GPUBindGroupLayout;
  private bindGroup: GPUBindGroup | null = null;
  private sampler: GPUSampler;
  private lastMode: number | null = null;

  constructor(device: GPUDevice, format: GPUTextureFormat) {
    this.device = device;
    this.format = format;

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

    const module = device.createShaderModule({ code: debugShader });
    this.pipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({
        bindGroupLayouts: [this.bindGroupLayout],
      }),
      vertex: { module, entryPoint: 'vs_main' },
      fragment: {
        module,
        entryPoint: 'fs_main',
        targets: [{ format }],
      },
      primitive: { topology: 'triangle-list' },
    });
  }

  resize(_width: number, _height: number) {
    // Placeholder.
  }

  createBindGroup(resources: CompositePassResources, mode: number) {
    const source = mode === 1 ? resources.thicknessTexture : resources.smoothTextureA;
    if (!source) {
      this.bindGroup = null;
      this.lastMode = null;
      return;
    }

    this.bindGroup = this.device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: source.createView() },
        { binding: 1, resource: this.sampler },
      ],
    });
    this.lastMode = mode;
  }

  encode(
    encoder: GPUCommandEncoder,
    resources: CompositePassResources,
    _frame: ScreenSpaceFrame,
    targetView: GPUTextureView,
    mode: number
  ) {
    if (this.lastMode !== mode) {
      this.createBindGroup(resources, mode);
    }
    if (!this.bindGroup) {
      return;
    }

    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: targetView,
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
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
