import aoShaderCode from '../../shaders/ao.wgsl?raw';

export interface AORecordParams {
  encoder: GPUCommandEncoder;
  projectionMatrix: Float32Array;
  viewMatrix: Float32Array;
  width: number;
  height: number;
  fov: number;
  particleRadius: number;
  simOffset: [number, number, number];
  particleCount: number;
  colorView: GPUTextureView;
  depthView: GPUTextureView;
  sphereVertexBuffer: GPUBuffer;
  sphereIndexBuffer: GPUBuffer;
  sphereIndexCount: number;
}

export class AOPass {
  private readonly device: GPUDevice;
  private readonly pipeline: GPURenderPipeline;
  private readonly uniformBuffer: GPUBuffer;
  private readonly particlePositionBuffer: GPUBuffer;
  private readonly linearSampler: GPUSampler;
  private bindGroup: GPUBindGroup | null = null;
  private readonly uniformData = new Float32Array(12);

  constructor(
    device: GPUDevice,
    particlePositionBuffer: GPUBuffer,
    linearSampler: GPUSampler
  ) {
    this.device = device;
    this.particlePositionBuffer = particlePositionBuffer;
    this.linearSampler = linearSampler;

    const shaderModule = device.createShaderModule({ code: aoShaderCode });
    this.pipeline = device.createRenderPipeline({
      layout: 'auto',
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
        targets: [
          {
            format: 'r16float',
            blend: {
              color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
              alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
            },
          },
        ],
      },
      primitive: { topology: 'triangle-list', cullMode: 'back' },
      depthStencil: {
        depthWriteEnabled: false,
        depthCompare: 'less',
        format: 'depth24plus',
      },
    });

    this.uniformBuffer = device.createBuffer({
      size: 192,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  updateSizeDependentBindings(gBufferView: GPUTextureView) {
    this.bindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: { buffer: this.particlePositionBuffer } },
        { binding: 2, resource: gBufferView },
        { binding: 3, resource: this.linearSampler },
      ],
    });
  }

  record(params: AORecordParams) {
    if (!this.bindGroup) {
      throw new Error('AOPass bind group is not initialized.');
    }

    this.uniformData[0] = params.width;
    this.uniformData[1] = params.height;
    this.uniformData[2] = params.fov;
    this.uniformData[3] = params.particleRadius;
    this.uniformData[4] = 1.0;
    this.uniformData[5] = params.simOffset[0];
    this.uniformData[6] = params.simOffset[1];
    this.uniformData[7] = params.simOffset[2];

    this.device.queue.writeBuffer(
      this.uniformBuffer,
      0,
      params.projectionMatrix as any
    );
    this.device.queue.writeBuffer(
      this.uniformBuffer,
      64,
      params.viewMatrix as any
    );
    this.device.queue.writeBuffer(this.uniformBuffer, 128, this.uniformData);

    const pass = params.encoder.beginRenderPass({
      colorAttachments: [
        {
          view: params.colorView,
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
      depthStencilAttachment: {
        view: params.depthView,
        depthLoadOp: 'load',
        depthStoreOp: 'store',
      },
    });

    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.setVertexBuffer(0, params.sphereVertexBuffer);
    pass.setIndexBuffer(params.sphereIndexBuffer, 'uint16');
    pass.drawIndexed(params.sphereIndexCount, params.particleCount);
    pass.end();
  }
}
