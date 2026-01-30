import foamShader from '../shaders/foam.wgsl?raw';
import type { ScreenSpaceFrame, ScreenSpaceTextures, SimBuffers } from '../screen_space_types.ts';

export class FoamPass {
  private device: GPUDevice;
  private pipeline: GPURenderPipeline;
  private bindGroupLayout: GPUBindGroupLayout;
  private bindGroup: GPUBindGroup | null = null;
  private uniformBuffer: GPUBuffer;

  constructor(device: GPUDevice) {
    this.device = device;

    this.uniformBuffer = device.createBuffer({
      size: 96,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.bindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
        { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
        { binding: 3, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
      ],
    });

    const module = device.createShaderModule({ code: foamShader });
    this.pipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [this.bindGroupLayout] }),
      vertex: { module, entryPoint: 'vs_main' },
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
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: false,
        depthCompare: 'less-equal',
      },
    });
  }

  createBindGroup(buffers: SimBuffers) {
    if (!('densities' in buffers)) {
      this.bindGroup = null;
      return;
    }
    this.bindGroup = this.device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: buffers.positions } },
        { binding: 1, resource: { buffer: buffers.velocities } },
        { binding: 2, resource: { buffer: buffers.densities } },
        { binding: 3, resource: { buffer: this.uniformBuffer } },
      ],
    });
  }

  encode(
    encoder: GPUCommandEncoder,
    resources: ScreenSpaceTextures & { buffers: SimBuffers },
    frame: ScreenSpaceFrame,
    foamTexture: GPUTexture
  ) {
    if (!this.bindGroup) {
      this.createBindGroup(resources.buffers);
    }
    if (!this.bindGroup) {
      return;
    }

    const uniforms = new Float32Array(24);
    uniforms.set(frame.viewProjection);
    uniforms[16] = frame.canvasWidth;
    uniforms[17] = frame.canvasHeight;
    uniforms[18] = frame.particleRadius;
    uniforms[19] = 2.5;  // foamMinSpeed
    uniforms[20] = 12.0; // foamMaxSpeed
    uniforms[21] = 450.0; // foamMinDensity
    uniforms[22] = 700.0; // foamMaxDensity
    this.device.queue.writeBuffer(this.uniformBuffer, 0, uniforms);

    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: foamTexture.createView(),
          clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 0.0 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
      depthStencilAttachment: resources.depthTexture
        ? {
            view: resources.depthTexture.createView(),
            depthLoadOp: 'load',
            depthStoreOp: 'store',
          }
        : undefined,
    });

    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.draw(6, resources.buffers.particleCount);
    pass.end();
  }
}
