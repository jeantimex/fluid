import foamPostShader from '../shaders/foam_post.wgsl?raw';
import type { ScreenSpaceFrame } from '../screen_space_types.ts';

export class FoamPostPass {
  private device: GPUDevice;
  private pipeline: GPURenderPipeline;
  private bindGroupLayout: GPUBindGroupLayout;
  private bindGroup: GPUBindGroup | null = null;
  private sampler: GPUSampler;
  private uniformBuffer: GPUBuffer;

  private lastRaw: GPUTexture | null = null;
  private lastThickness: GPUTexture | null = null;
  private lastHistory: GPUTexture | null = null;

  constructor(device: GPUDevice) {
    this.device = device;

    this.sampler = device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });

    this.uniformBuffer = device.createBuffer({
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.bindGroupLayout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'float' },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'float' },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'float' },
        },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
        {
          binding: 4,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' },
        },
      ],
    });

    const module = device.createShaderModule({ code: foamPostShader });
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

  private createBindGroup(
    rawFoam: GPUTexture,
    thickness: GPUTexture,
    history: GPUTexture
  ) {
    this.bindGroup = this.device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: rawFoam.createView() },
        { binding: 1, resource: thickness.createView() },
        { binding: 2, resource: history.createView() },
        { binding: 3, resource: this.sampler },
        { binding: 4, resource: { buffer: this.uniformBuffer } },
      ],
    });
    this.lastRaw = rawFoam;
    this.lastThickness = thickness;
    this.lastHistory = history;
  }

  encode(
    encoder: GPUCommandEncoder,
    frame: ScreenSpaceFrame,
    rawFoam: GPUTexture,
    thickness: GPUTexture,
    history: GPUTexture,
    target: GPUTexture
  ) {
    if (
      !this.bindGroup ||
      this.lastRaw !== rawFoam ||
      this.lastThickness !== thickness ||
      this.lastHistory !== history
    ) {
      this.createBindGroup(rawFoam, thickness, history);
    }

    if (!this.bindGroup) {
      return;
    }

    const isPatchMode = frame.foamRenderMode !== 'points';
    const uniforms = new Float32Array(8);
    uniforms[0] = 1 / Math.max(1, frame.canvasWidth);
    uniforms[1] = 1 / Math.max(1, frame.canvasHeight);
    uniforms[2] = frame.foamThreshold;
    uniforms[3] = frame.foamSoftness;
    uniforms[4] = isPatchMode ? Math.max(1, frame.foamBlurPasses) : 1;
    uniforms[5] = isPatchMode ? frame.foamEdgeBoost : 0.25;
    uniforms[6] = isPatchMode ? frame.foamTemporalBlend : 0;
    uniforms[7] = isPatchMode ? frame.foamAnisotropy : 0;
    this.device.queue.writeBuffer(this.uniformBuffer, 0, uniforms);

    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: target.createView(),
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
