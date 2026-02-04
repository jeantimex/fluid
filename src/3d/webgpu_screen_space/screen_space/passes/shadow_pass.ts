/**
 * Shadow pass skeleton: render shadow map and optional smoothing.
 */

import shadowShader from '../shaders/shadow.wgsl?raw';
import shadowModelShader from '../shaders/shadow_model.wgsl?raw';
import type {
  ScreenSpaceFrame,
  ShadowPassResources,
} from '../screen_space_types.ts';
import type { GpuModel } from '../../../common/model_loader.ts';

export class ShadowPass {
  private device: GPUDevice;
  private pipeline: GPURenderPipeline;
  private modelPipeline: GPURenderPipeline;
  private uniformBuffer: GPUBuffer;
  private bindGroupLayout: GPUBindGroupLayout;
  private bindGroup: GPUBindGroup | null = null;
  private modelBindGroup: GPUBindGroup | null = null;

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
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: 'uniform' },
        },
      ],
    });

    const module = device.createShaderModule({ code: shadowShader });
    this.pipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({
        bindGroupLayouts: [this.bindGroupLayout],
      }),
      vertex: { module, entryPoint: 'vs_main' },
      fragment: { module, entryPoint: 'fs_main', targets: [] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: true,
        depthCompare: 'less',
      },
    });

    const modelModule = device.createShaderModule({ code: shadowModelShader });
    this.modelPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: modelModule,
        entryPoint: 'vs_main',
        buffers: [
          {
            arrayStride: 32,
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x3' },
            ],
          },
        ],
      },
      fragment: undefined,
      primitive: { topology: 'triangle-list', cullMode: 'back' },
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

  createBindGroup(resources: ShadowPassResources) {
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
    resources: ShadowPassResources,
    frame: ScreenSpaceFrame,
    model?: GpuModel | null,
    modelUniformBuffer?: GPUBuffer
  ) {
    if (!resources.shadowTexture || !this.bindGroup) {
      return;
    }

    const uniforms = new Float32Array(24);
    uniforms.set(frame.lightViewProjection);
    uniforms[16] = frame.shadowRadius;
    uniforms[17] = 0.0;
    uniforms[18] = frame.lightScale.x;
    uniforms[19] = frame.lightScale.y;
    uniforms[20] = 0.0;
    this.device.queue.writeBuffer(this.uniformBuffer, 0, uniforms);

    const pass = encoder.beginRenderPass({
      colorAttachments: [],
      depthStencilAttachment: {
        view: resources.shadowTexture.createView(),
        depthClearValue: 1.0,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    });

    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.draw(6, resources.buffers.particleCount);

    if (model && modelUniformBuffer) {
      if (!this.modelBindGroup) {
        this.modelBindGroup = this.device.createBindGroup({
          layout: this.modelPipeline.getBindGroupLayout(0),
          entries: [{ binding: 0, resource: { buffer: modelUniformBuffer } }],
        });
      }
      pass.setPipeline(this.modelPipeline);
      pass.setBindGroup(0, this.modelBindGroup);
      pass.setVertexBuffer(0, model.vertexBuffer);
      pass.setIndexBuffer(model.indexBuffer, model.indexFormat);
      pass.drawIndexed(model.indexCount);
    }

    pass.end();
  }
}
