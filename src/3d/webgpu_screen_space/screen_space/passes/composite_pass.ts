/**
 * Composite pass skeleton: final shading/compositing.
 */

import debugShader from '../shaders/debug_composite.wgsl?raw';
import debugColorShader from '../shaders/debug_composite_color.wgsl?raw';
import compositeShader from '../shaders/composite_final.wgsl?raw';
import type {
  CompositePassResources,
  ScreenSpaceFrame,
} from '../screen_space_types.ts';

export class CompositePass {
  private device: GPUDevice;
  private pipeline: GPURenderPipeline;
  private colorPipeline: GPURenderPipeline;
  private compositePipeline: GPURenderPipeline;
  private bindGroupLayout: GPUBindGroupLayout;
  private bindGroup: GPUBindGroup | null = null;
  private compositeBindGroupLayout: GPUBindGroupLayout;
  private compositeBindGroup: GPUBindGroup | null = null;
  private sampler: GPUSampler;
  private shadowSampler: GPUSampler;
  private uniformBuffer: GPUBuffer;
  private lastMode: number | null = null;

  constructor(device: GPUDevice, format: GPUTextureFormat) {
    this.device = device;

    this.sampler = device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
    });
    this.shadowSampler = device.createSampler({
      compare: 'less',
    });
    this.uniformBuffer = device.createBuffer({
      size: 176, // mat4(64) + mat4(64) + foamColor(12) + foamOpacity(4) + extinctionCoeff(12) + extinctionMul(4) + refractionStrength(4) + pad(12)
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
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

    this.compositeBindGroupLayout = device.createBindGroupLayout({
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
        {
          binding: 3,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'depth' },
        },
        {
          binding: 4,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'float' },
        },
        { binding: 5, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
        {
          binding: 6,
          visibility: GPUShaderStage.FRAGMENT,
          sampler: { type: 'comparison' },
        },
        {
          binding: 7,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' },
        },
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

    const colorModule = device.createShaderModule({ code: debugColorShader });
    this.colorPipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({
        bindGroupLayouts: [this.bindGroupLayout],
      }),
      vertex: { module: colorModule, entryPoint: 'vs_main' },
      fragment: {
        module: colorModule,
        entryPoint: 'fs_main',
        targets: [{ format }],
      },
      primitive: { topology: 'triangle-list' },
    });

    const compositeModule = device.createShaderModule({
      code: compositeShader,
    });
    this.compositePipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({
        bindGroupLayouts: [this.compositeBindGroupLayout],
      }),
      vertex: { module: compositeModule, entryPoint: 'vs_main' },
      fragment: {
        module: compositeModule,
        entryPoint: 'fs_main',
        targets: [{ format }],
      },
      primitive: { topology: 'triangle-list' },
    });
  }

  resize(_width: number, _height: number) {
    this.compositeBindGroup = null;
    this.bindGroup = null;
    this.lastMode = null;
  }

  createBindGroup(resources: CompositePassResources, mode: number) {
    let source: GPUTexture | null = null;
    if (mode === 1) {
      source = resources.thicknessTexture;
    } else if (mode === 2) {
      source = resources.normalTexture;
    } else if (mode === 3) {
      source = resources.smoothTextureB;
    } else {
      source = resources.smoothTextureA;
    }
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

  createCompositeBindGroup(resources: CompositePassResources) {
    if (
      !resources.smoothTextureB ||
      !resources.normalTexture ||
      !resources.smoothTextureA ||
      !resources.shadowTexture ||
      !resources.foamTexture
    ) {
      this.compositeBindGroup = null;
      return;
    }

    this.compositeBindGroup = this.device.createBindGroup({
      layout: this.compositeBindGroupLayout,
      entries: [
        { binding: 0, resource: resources.smoothTextureB.createView() },
        { binding: 1, resource: resources.normalTexture.createView() },
        { binding: 2, resource: resources.smoothTextureA.createView() },
        { binding: 3, resource: resources.shadowTexture.createView() },
        { binding: 4, resource: resources.foamTexture.createView() },
        { binding: 5, resource: this.sampler },
        { binding: 6, resource: this.shadowSampler },
        { binding: 7, resource: { buffer: this.uniformBuffer } },
      ],
    });
  }

  encode(
    encoder: GPUCommandEncoder,
    resources: CompositePassResources,
    frame: ScreenSpaceFrame,
    targetView: GPUTextureView,
    mode: number
  ) {
    if (mode === 4) {
      if (!this.compositeBindGroup) {
        this.createCompositeBindGroup(resources);
      }
      if (!this.compositeBindGroup) {
        return;
      }
      const uniforms = new Float32Array(44);
      uniforms.set(frame.inverseViewProjection, 0);
      uniforms.set(frame.lightViewProjection, 16);
      uniforms[32] = frame.foamColor.r;
      uniforms[33] = frame.foamColor.g;
      uniforms[34] = frame.foamColor.b;
      uniforms[35] = frame.foamOpacity;
      uniforms[36] = frame.extinctionCoeff.x;
      uniforms[37] = frame.extinctionCoeff.y;
      uniforms[38] = frame.extinctionCoeff.z;
      uniforms[39] = frame.extinctionMultiplier;
      uniforms[40] = frame.dirToSun.x;
      uniforms[41] = frame.dirToSun.y;
      uniforms[42] = frame.dirToSun.z;
      uniforms[43] = frame.refractionStrength;
      this.device.queue.writeBuffer(this.uniformBuffer, 0, uniforms);
    } else {
      if (this.lastMode !== mode) {
        this.createBindGroup(resources, mode);
      }
      if (!this.bindGroup) {
        return;
      }
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

    if (mode === 4) {
      pass.setPipeline(this.compositePipeline);
      pass.setBindGroup(0, this.compositeBindGroup!);
    } else {
      pass.setPipeline(mode === 2 ? this.colorPipeline : this.pipeline);
      pass.setBindGroup(0, this.bindGroup!);
    }
    pass.draw(6, 1);
    pass.end();
  }
}
