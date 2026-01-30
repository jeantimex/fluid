/**
 * Screen-space fluid renderer skeleton.
 *
 * This file provides a placeholder structure for a multi-pass screen-space
 * rendering pipeline (depth, thickness, normal, smoothing, composite).
 */

import type { SimConfig } from '../../common/types.ts';
import type {
  CompositePassInputs,
  ScreenSpaceFrame,
  ScreenSpaceTextures,
  SimBuffers,
} from './screen_space_types.ts';
import { mat4Invert, mat4LookAt, mat4Multiply, mat4Ortho, mat4Perspective } from '../math_utils.ts';
import { DepthPass } from './passes/depth_pass.ts';
import { FoamPass } from './passes/foam_pass.ts';
import { ThicknessPass } from './passes/thickness_pass.ts';
import { NormalPass } from './passes/normal_pass.ts';
import { SmoothPass } from './passes/smooth_pass.ts';
import { ShadowPass } from './passes/shadow_pass.ts';
import { CompositePass } from './passes/composite_pass.ts';

export class ScreenSpaceRenderer {
  private device: GPUDevice;
  private canvas: HTMLCanvasElement;
  private format: GPUTextureFormat;
  private config: SimConfig;

  private width = 0;
  private height = 0;

  private depthTexture: GPUTexture | null = null;
  private thicknessTexture: GPUTexture | null = null;
  private normalTexture: GPUTexture | null = null;
  private smoothTextureA: GPUTexture | null = null;
  private smoothTextureB: GPUTexture | null = null;
  private shadowTexture: GPUTexture | null = null;
  private foamTexture: GPUTexture | null = null;

  private buffers: SimBuffers | null = null;

  private depthPass: DepthPass;
  private thicknessPass: ThicknessPass;
  private normalPass: NormalPass;
  private smoothPass: SmoothPass;
  private shadowPass: ShadowPass;
  private foamPass: FoamPass;
  private compositePass: CompositePass;

  constructor(
    device: GPUDevice,
    canvas: HTMLCanvasElement,
    format: GPUTextureFormat,
    config: SimConfig
  ) {
    this.device = device;
    this.canvas = canvas;
    this.format = format;
    this.config = config;

    this.depthPass = new DepthPass(device);
    this.thicknessPass = new ThicknessPass(device);
    this.normalPass = new NormalPass(device);
    this.smoothPass = new SmoothPass(device);
    this.shadowPass = new ShadowPass(device);
    this.foamPass = new FoamPass(device);
    this.compositePass = new CompositePass(device, format);
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

    // Placeholder for per-pass bind group creation.
    this.depthPass.createBindGroup(resources);
    this.thicknessPass.createBindGroup(resources);
    this.normalPass.createBindGroup(resources);
    // smooth pass bind groups are created on-demand per source texture
    this.shadowPass.createBindGroup(resources);
    this.compositePass.createBindGroup(resources);
  }

  resize(width: number, height: number) {
    if (width === this.width && height === this.height) {
      return;
    }

    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));

    // Placeholder texture allocation. Formats and usages will be refined.
    this.depthTexture = this.device.createTexture({
      size: { width: this.width, height: this.height },
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
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
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });

    this.foamTexture = this.device.createTexture({
      size: { width: this.width, height: this.height },
      format: 'r16float',
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });

    this.depthPass.resize(this.width, this.height);
    this.thicknessPass.resize(this.width, this.height);
    this.normalPass.resize(this.width, this.height);
    this.smoothPass.resize(this.width, this.height);
    this.shadowPass.resize(this.width, this.height);
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

    // Placeholder for multi-pass render orchestration.
    // Expected order:
    // 1) Depth pass
    // 2) Thickness pass
    // 3) Normal reconstruction
    // 4) Smooth thickness/normal
    // 5) Shadow pass (optional)
    // 6) Composite

    const aspect = this.canvas.width / this.canvas.height;
    const near = 0.1;
    const far = 100.0;
    const projection = mat4Perspective(Math.PI / 3, aspect, near, far);
    const viewProj = mat4Multiply(projection, viewMatrix);
    const invViewProj = mat4Invert(viewProj);
    const dpr = window.devicePixelRatio || 1;

    const bounds = this.config.boundsSize;
    const halfX = bounds.x * 0.6;
    const halfY = bounds.y * 0.6;
    const halfZ = bounds.z * 0.6;
    const lightDir = { x: 0.3, y: 1.0, z: 0.4 };
    const lightPos = {
      x: -lightDir.x * (bounds.x + bounds.z),
      y: -lightDir.y * (bounds.x + bounds.z),
      z: -lightDir.z * (bounds.x + bounds.z),
    };
    const lightView = mat4LookAt(lightPos, { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
    const lightProj = mat4Ortho(-halfX, halfX, -halfY, halfY, 0.1, bounds.x + bounds.z);
    const lightViewProj = mat4Multiply(lightProj, lightView);

    const frame: ScreenSpaceFrame = {
      viewProjection: viewProj,
      inverseViewProjection: invViewProj,
      lightViewProjection: lightViewProj,
      canvasWidth: this.canvas.width,
      canvasHeight: this.canvas.height,
      particleRadius: this.config.particleRadius * dpr,
      near,
      far,
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

    const compositeInputs: CompositePassInputs = {
      targetView: swapchainView,
    };

    this.compositePass.encode(
      encoder,
      resources,
      frame,
      compositeInputs.targetView,
      this.config.screenSpaceDebugMode
    );
  }
}
