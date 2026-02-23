import fxaaShaderCode from '../../shaders/fxaa.wgsl?raw';

export interface FXAARecordParams {
  encoder: GPUCommandEncoder;
  width: number;
  height: number;
  targetView: GPUTextureView;
}

export class FXAAPass {
  private readonly device: GPUDevice;
  private readonly pipeline: GPURenderPipeline;
  private readonly uniformBuffer: GPUBuffer;
  private readonly linearSampler: GPUSampler;
  private bindGroup: GPUBindGroup | null = null;
  private readonly uniformData = new Float32Array(2);

  constructor(
    device: GPUDevice,
    presentationFormat: GPUTextureFormat,
    linearSampler: GPUSampler
  ) {
    this.device = device;
    this.linearSampler = linearSampler;

    const shaderModule = device.createShaderModule({ code: fxaaShaderCode });
    this.pipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: shaderModule, entryPoint: 'vs_main' },
      fragment: {
        module: shaderModule,
        entryPoint: 'fs_main',
        targets: [{ format: presentationFormat }],
      },
      primitive: { topology: 'triangle-strip' },
    });

    this.uniformBuffer = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  updateSizeDependentBindings(inputView: GPUTextureView) {
    this.bindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: inputView },
        { binding: 2, resource: this.linearSampler },
      ],
    });
  }

  record(params: FXAARecordParams) {
    if (!this.bindGroup) {
      throw new Error('FXAAPass bind group is not initialized.');
    }

    this.uniformData[0] = params.width;
    this.uniformData[1] = params.height;
    this.device.queue.writeBuffer(this.uniformBuffer, 0, this.uniformData);

    const pass = params.encoder.beginRenderPass({
      colorAttachments: [
        {
          view: params.targetView,
          clearValue: { r: 0.9, g: 0.9, b: 0.9, a: 1.0 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });

    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.draw(4);
    pass.end();
  }
}
