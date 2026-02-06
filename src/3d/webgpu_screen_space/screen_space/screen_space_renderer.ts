/**
 * Screen-space fluid renderer.
 *
 * Multi-pass rendering pipeline: depth, thickness, normal, smoothing,
 * foam, and composite.
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
  mat4Multiply,
  mat4Perspective,
} from '../../webgpu_particles/math_utils.ts';
import { DepthPass } from './passes/depth_pass.ts';
import { FoamPass } from './passes/foam_pass.ts';
import { ThicknessPass } from './passes/thickness_pass.ts';
import { NormalPass } from './passes/normal_pass.ts';
import { SmoothPass } from './passes/smooth_pass.ts';
import { CompositePass } from './passes/composite_pass.ts';
import { ShadowPass } from './passes/shadow_pass.ts';

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
  private foamTexture: GPUTexture | null = null;
  private shadowTexture: GPUTexture | null = null;
  private shadowSmoothTexture: GPUTexture | null = null;

  private buffers: SimBuffers | null = null;

  private depthPass: DepthPass;
  private thicknessPass: ThicknessPass;
  private normalPass: NormalPass;
  private smoothPass: SmoothPass;
  private foamPass: FoamPass;
  private compositePass: CompositePass;
  private shadowPass: ShadowPass;

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
    this.foamPass = new FoamPass(device);
    this.compositePass = new CompositePass(device, format);
    this.shadowPass = new ShadowPass(device);
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
      foamTexture: this.foamTexture,
      shadowTexture: this.shadowTexture,
      shadowSmoothTexture: this.shadowSmoothTexture,
    };

    this.depthPass.createBindGroup(resources);
    this.thicknessPass.createBindGroup(resources);
    this.normalPass.createBindGroup(resources);
    this.shadowPass.createBindGroup(buffers);

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

    this.foamTexture = this.device.createTexture({
      size: { width: this.width, height: this.height },
      format: 'r16float',
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });

    // Shadow textures at 1/4 resolution (like Unity)
    const shadowW = Math.max(1, Math.floor(this.width / 4));
    const shadowH = Math.max(1, Math.floor(this.height / 4));
    this.shadowTexture = this.device.createTexture({
      size: { width: shadowW, height: shadowH },
      format: 'r16float',
      usage: colorUsage,
    });
    this.shadowSmoothTexture = this.device.createTexture({
      size: { width: shadowW, height: shadowH },
      format: 'r16float',
      usage: colorUsage,
    });

    this.depthPass.resize(this.width, this.height);
    this.thicknessPass.resize(this.width, this.height);
    this.normalPass.resize(this.width, this.height);
    this.smoothPass.resize(this.width, this.height);
    this.compositePass.resize(this.width, this.height);
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

    const frame: ScreenSpaceFrame = {
      ...this.config, // Spread first to provide base EnvironmentConfig
      viewProjection: viewProj,
      inverseViewProjection: invViewProj,
      canvasWidth: this.canvas.width,
      canvasHeight: this.canvas.height,
      particleRadius: this.config.particleRadius * dpr, // Override with DPR-scaled value
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
      showBoundsWireframe: this.config.showBoundsWireframe,
      boundsWireframeColor: this.config.boundsWireframeColor,
      boundsSize: this.config.boundsSize,
      shadowViewProjection: null,
    };

    const resources: ScreenSpaceTextures & { buffers: SimBuffers } = {
      buffers: this.buffers,
      depthTexture: this.depthTexture,
      thicknessTexture: this.thicknessTexture,
      normalTexture: this.normalTexture,
      smoothTextureA: this.smoothTextureA,
      smoothTextureB: this.smoothTextureB,
      foamTexture: this.foamTexture,
      shadowTexture: this.shadowTexture,
      shadowSmoothTexture: this.shadowSmoothTexture,
    };

    this.depthPass.encode(encoder, resources, frame);
    this.thicknessPass.encode(encoder, resources, frame);
    if (resources.foamTexture) {
      this.foamPass.encode(encoder, resources, frame, resources.foamTexture);
    }

    // Shadow pass: render thickness from light's perspective, then smooth
    const shadowVP = this.shadowPass.encode(encoder, resources, frame);
    frame.shadowViewProjection = shadowVP;
    if (resources.shadowTexture && resources.shadowSmoothTexture) {
      this.smoothPass.encode(
        encoder,
        resources,
        frame,
        resources.shadowTexture,
        resources.shadowSmoothTexture,
        resources.shadowTexture // bilateral depth ref = shadow itself
      );
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
  }
}
