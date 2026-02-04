/**
 * Screen-space fluid renderer.
 *
 * Multi-pass rendering pipeline: depth, thickness, normal, smoothing,
 * shadow, foam, and composite.
 */

import type { ScreenSpaceConfig } from '../types.ts';
import type {
  ScreenSpaceFrame,
  ScreenSpaceTextures,
  SimBuffers,
} from './screen_space_types.ts';
import { SimulationBuffersLinear } from '../simulation_buffers_linear.ts';
import {
  mat4Invert,
  mat4LookAt,
  mat4Multiply,
  mat4Ortho,
  mat4Perspective,
} from '../../webgpu_particles/math_utils.ts';
import { DepthPass } from './passes/depth_pass.ts';
import { FoamPass } from './passes/foam_pass.ts';
import { ThicknessPass } from './passes/thickness_pass.ts';
import { NormalPass } from './passes/normal_pass.ts';
import { SmoothPass } from './passes/smooth_pass.ts';
import { ShadowPass } from './passes/shadow_pass.ts';
import { CompositePass } from './passes/composite_pass.ts';
import modelShader from './shaders/model_basic.wgsl?raw';
import type { GpuModel } from '../../common/model_loader.ts';

export class ScreenSpaceRenderer {
  private device: GPUDevice;
  private canvas: HTMLCanvasElement;
  private config: ScreenSpaceConfig;

  private width = 0;
  private height = 0;

  private depthTexture: GPUTexture | null = null;
  private thicknessTexture: GPUTexture | null = null;
  private normalTexture: GPUTexture | null = null;
  private smoothTextureA: GPUTexture | null = null;
  private smoothTextureB: GPUTexture | null = null;
  private shadowTexture: GPUTexture | null = null;
  private foamTexture: GPUTexture | null = null;
  private modelDepthTexture: GPUTexture | null = null;

  private buffers: SimBuffers | null = null;

  private depthPass: DepthPass;
  private thicknessPass: ThicknessPass;
  private normalPass: NormalPass;
  private smoothPass: SmoothPass;
  private shadowPass: ShadowPass;
  private foamPass: FoamPass;
  private compositePass: CompositePass;
  private modelPipeline: GPURenderPipeline;
  private modelUniformBuffer: GPUBuffer;
  private modelBindGroup?: GPUBindGroup;
  private model: GpuModel | null = null;
  private modelUniformData = new Float32Array(36);
  private modelScale = 0.04;

  constructor(
    device: GPUDevice,
    canvas: HTMLCanvasElement,
    format: GPUTextureFormat,
    config: ScreenSpaceConfig
  ) {
    this.device = device;
    this.canvas = canvas;
    this.config = config;

    this.depthPass = new DepthPass(device);
    this.thicknessPass = new ThicknessPass(device);
    this.normalPass = new NormalPass(device);
    this.smoothPass = new SmoothPass(device);
    this.shadowPass = new ShadowPass(device);
    this.foamPass = new FoamPass(device);
    this.compositePass = new CompositePass(device, format);

    const modelModule = device.createShaderModule({ code: modelShader });
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
              { shaderLocation: 1, offset: 12, format: 'float32x3' },
              { shaderLocation: 2, offset: 24, format: 'float32x2' },
            ],
          },
        ],
      },
      fragment: {
        module: modelModule,
        entryPoint: 'fs_main',
        targets: [{ format }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'back' },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: true,
        depthCompare: 'less',
      },
    });

    // Model uniforms: viewProj (64) + model (64) + lightDir/pad (16) = 144 bytes
    this.modelUniformBuffer = device.createBuffer({
      size: 144,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  createBindGroups(buffers: SimBuffers) {
    this.buffers = buffers;

    const resources: ScreenSpaceTextures & { buffers: SimBuffers } = {
      buffers,
      depthTexture: this.depthTexture,
      thicknessTexture: this.thicknessTexture,
      normalTexture: this.normalTexture,
      smoothTextureA: this.smoothTextureA,
      smoothTextureB: this.smoothTextureB,
      shadowTexture: this.shadowTexture,
      foamTexture: this.foamTexture,
    };

    this.depthPass.createBindGroup(resources);
    this.thicknessPass.createBindGroup(resources);
    this.normalPass.createBindGroup(resources);
    this.shadowPass.createBindGroup(resources);

    if (buffers instanceof SimulationBuffersLinear) {
      this.foamPass.createBindGroup(
        buffers.foamPositions,
        buffers.foamVelocities,
        SimulationBuffersLinear.MAX_FOAM_PARTICLES
      );
    }
  }

  resize(width: number, height: number) {
    if (width === this.width && height === this.height) {
      return;
    }

    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));

    this.depthTexture = this.device.createTexture({
      size: { width: this.width, height: this.height },
      format: 'depth24plus',
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });

    const colorUsage =
      GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING;

    this.thicknessTexture = this.device.createTexture({
      size: { width: this.width, height: this.height },
      format: 'r16float',
      usage: colorUsage,
    });

    this.normalTexture = this.device.createTexture({
      size: { width: this.width, height: this.height },
      format: 'rgba16float',
      usage: colorUsage,
    });

    this.smoothTextureA = this.device.createTexture({
      size: { width: this.width, height: this.height },
      format: 'r16float',
      usage: colorUsage,
    });

    this.smoothTextureB = this.device.createTexture({
      size: { width: this.width, height: this.height },
      format: 'r16float',
      usage: colorUsage,
    });

    this.shadowTexture = this.device.createTexture({
      size: { width: this.width, height: this.height },
      format: 'depth24plus',
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });

    this.foamTexture = this.device.createTexture({
      size: { width: this.width, height: this.height },
      format: 'r16float',
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });

    this.modelDepthTexture = this.device.createTexture({
      size: { width: this.width, height: this.height },
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });

    this.depthPass.resize(this.width, this.height);
    this.thicknessPass.resize(this.width, this.height);
    this.normalPass.resize(this.width, this.height);
    this.smoothPass.resize(this.width, this.height);
    this.shadowPass.resize(this.width, this.height);
    this.compositePass.resize(this.width, this.height);
  }

  setModel(model: GpuModel | null): void {
    this.model = model;
    if (!model) {
      this.modelBindGroup = undefined;
      return;
    }

    this.modelBindGroup = this.device.createBindGroup({
      layout: this.modelPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.modelUniformBuffer } },
        { binding: 1, resource: model.textureView },
        { binding: 2, resource: model.sampler },
      ],
    });
  }

  render(
    encoder: GPUCommandEncoder,
    swapchainView: GPUTextureView,
    viewMatrix: Float32Array
  ) {
    if (!this.buffers) {
      return;
    }

    const aspect = this.canvas.width / this.canvas.height;
    const near = 0.1;
    const far = 100.0;
    const projection = mat4Perspective(Math.PI / 3, aspect, near, far);
    const viewProj = mat4Multiply(projection, viewMatrix);
    const invViewProj = mat4Invert(viewProj);
    const dpr = window.devicePixelRatio || 1;

    const bounds = this.config.boundsSize;
    const floor = this.config.floorSize;
    const sunDir = this.config.dirToSun;
    const lightDistance = Math.max(bounds.x + bounds.z, floor.x + floor.z);
    
    // Use a safe square frustum that covers the rotation of the floor/bounds
    const orthoSize = lightDistance * 0.6;

    const lightPos = {
      x: sunDir.x * lightDistance,
      y: sunDir.y * lightDistance,
      z: sunDir.z * lightDistance,
    };
    const lightView = mat4LookAt(
      lightPos,
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 }
    );
    const lightProj = mat4Ortho(
      -orthoSize,
      orthoSize,
      -orthoSize,
      orthoSize,
      0.1,
      -lightDistance * 3.0
    );
    const lightViewProj = mat4Multiply(lightProj, lightView);
    const lightScale = { x: 1 / orthoSize, y: 1 / orthoSize };

    const frame: ScreenSpaceFrame = {
      ...this.config, // Spread first to provide base EnvironmentConfig
      viewProjection: viewProj,
      inverseViewProjection: invViewProj,
      lightViewProjection: lightViewProj,
      lightScale,
      canvasWidth: this.canvas.width,
      canvasHeight: this.canvas.height,
      particleRadius: this.config.particleRadius * dpr, // Override with DPR-scaled value
      shadowRadius: this.config.smoothingRadius * this.config.shadowRadiusScale,
      foamParticleRadius: this.config.foamParticleRadius * dpr,
      near,
      far,
      // Calculate derived obstacleHalfSize
      obstacleHalfSize: {
        x: this.config.obstacleSize.x * 0.5,
        y: this.config.obstacleSize.y * 0.5,
        z: this.config.obstacleSize.z * 0.5,
      },
      obstacleColor: this.config.obstacleColor ?? { r: 1, g: 0, b: 0 },
      obstacleAlpha: this.config.obstacleAlpha ?? 0.8,
    };

    const resources: ScreenSpaceTextures & { buffers: SimBuffers } = {
      buffers: this.buffers,
      depthTexture: this.depthTexture,
      thicknessTexture: this.thicknessTexture,
      normalTexture: this.normalTexture,
      smoothTextureA: this.smoothTextureA,
      smoothTextureB: this.smoothTextureB,
      shadowTexture: this.shadowTexture,
      foamTexture: this.foamTexture,
    };

    this.depthPass.encode(encoder, resources, frame);
    this.thicknessPass.encode(encoder, resources, frame);
    this.shadowPass.encode(encoder, resources, frame);
    if (resources.foamTexture) {
      this.foamPass.encode(encoder, resources, frame, resources.foamTexture);
    }

    if (
      resources.thicknessTexture &&
      resources.smoothTextureA &&
      resources.smoothTextureB
    ) {
      // Run multiple blur passes to reduce particle granularity.
      this.smoothPass.encode(
        encoder,
        resources,
        frame,
        resources.thicknessTexture,
        resources.smoothTextureB,
        resources.smoothTextureA
      );
      this.smoothPass.encode(
        encoder,
        resources,
        frame,
        resources.smoothTextureB,
        resources.thicknessTexture,
        resources.smoothTextureA
      );
      this.smoothPass.encode(
        encoder,
        resources,
        frame,
        resources.thicknessTexture,
        resources.smoothTextureB,
        resources.smoothTextureA
      );
      this.smoothPass.encode(
        encoder,
        resources,
        frame,
        resources.smoothTextureB,
        resources.thicknessTexture,
        resources.smoothTextureA
      );
      this.smoothPass.encode(
        encoder,
        resources,
        frame,
        resources.thicknessTexture,
        resources.smoothTextureB,
        resources.smoothTextureA
      );
    }
    this.normalPass.encode(encoder, resources, frame);

    this.compositePass.encode(
      encoder,
      resources,
      frame,
      swapchainView,
      this.config.screenSpaceDebugMode
    );

    if (
      this.model &&
      this.modelBindGroup &&
      this.modelDepthTexture
    ) {
      const modelScale = this.modelScale;
      const modelTx = 0;
      const modelTy =
        -this.config.boundsSize.y * 0.5 -
        (this.model.boundsMinY ?? 0) * modelScale;
      const modelTz = 0;
      const modelMatrix = [
        -modelScale, 0, 0, 0,
        0, modelScale, 0, 0,
        0, 0, -modelScale, 0,
        modelTx, modelTy, modelTz, 1,
      ];

      this.modelUniformData.set(viewProj, 0);
      this.modelUniformData.set(modelMatrix, 16);
      this.modelUniformData[32] = this.config.dirToSun.x;
      this.modelUniformData[33] = this.config.dirToSun.y;
      this.modelUniformData[34] = this.config.dirToSun.z;
      this.modelUniformData[35] = 0;

      this.device.queue.writeBuffer(
        this.modelUniformBuffer,
        0,
        this.modelUniformData
      );

      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: swapchainView,
            loadOp: 'load',
            storeOp: 'store',
          },
        ],
        depthStencilAttachment: {
          view: this.modelDepthTexture.createView(),
          depthLoadOp: 'clear',
          depthStoreOp: 'store',
          depthClearValue: 1.0,
        },
      });

      pass.setPipeline(this.modelPipeline);
      pass.setBindGroup(0, this.modelBindGroup);
      pass.setVertexBuffer(0, this.model.vertexBuffer);
      pass.setIndexBuffer(this.model.indexBuffer, this.model.indexFormat);
      pass.drawIndexed(this.model.indexCount);
      pass.end();
    }
  }
}
