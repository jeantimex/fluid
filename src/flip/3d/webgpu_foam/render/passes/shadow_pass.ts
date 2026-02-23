import shadowShaderCode from '../../shaders/shadow.wgsl?raw';

export interface ShadowRecordParams {
  encoder: GPUCommandEncoder;
  lightProjectionViewMatrix: Float32Array;
  particleRadius: number;
  simOffset: [number, number, number];
  particleCount: number;
  depthView: GPUTextureView;
  sphereVertexBuffer: GPUBuffer;
  sphereIndexBuffer: GPUBuffer;
  sphereIndexCount: number;
}

export class ShadowPass {
  private readonly device: GPUDevice;
  private readonly pipeline: GPURenderPipeline;
  private readonly uniformBuffer: GPUBuffer;
  private readonly bindGroup: GPUBindGroup;
  private readonly uniformData = new Float32Array(8);

  constructor(device: GPUDevice, particlePositionBuffer: GPUBuffer) {
    this.device = device;

    const shaderModule = device.createShaderModule({ code: shadowShaderCode });
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
        targets: [],
      },
      primitive: { topology: 'triangle-list', cullMode: 'back' },
      depthStencil: {
        depthWriteEnabled: true,
        depthCompare: 'less',
        format: 'depth32float',
      },
    });

    this.uniformBuffer = device.createBuffer({
      size: 112,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.bindGroup = device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: { buffer: particlePositionBuffer } },
      ],
    });
  }

  record(params: ShadowRecordParams) {
    this.uniformData[0] = params.particleRadius;
    this.uniformData[1] = 1.0;
    this.uniformData[2] = params.simOffset[0];
    this.uniformData[3] = params.simOffset[1];
    this.uniformData[4] = params.simOffset[2];

    this.device.queue.writeBuffer(
      this.uniformBuffer,
      0,
      params.lightProjectionViewMatrix as any
    );
    this.device.queue.writeBuffer(this.uniformBuffer, 64, this.uniformData);

    const pass = params.encoder.beginRenderPass({
      colorAttachments: [],
      depthStencilAttachment: {
        view: params.depthView,
        depthClearValue: 1.0,
        depthLoadOp: 'clear',
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
