/**
 * Centralized render resource manager.
 *
 * Owns:
 * - Size-dependent textures (depth, g-buffer, occlusion, compositing)
 * - Size-invariant shadow depth map
 * - Shared samplers
 *
 * Provides:
 * - current texture views for pass recording
 * - resize(width, height) for safe recreation
 */
export class RenderResources {
  private readonly device: GPUDevice;
  private readonly presentationFormat: GPUTextureFormat;

  private depthTexture: GPUTexture;
  private gBufferTexture: GPUTexture;
  private occlusionTexture: GPUTexture;
  private compositingTexture: GPUTexture;
  private shadowDepthTexture: GPUTexture;

  public depthView: GPUTextureView;
  public gBufferView: GPUTextureView;
  public occlusionView: GPUTextureView;
  public compositingView: GPUTextureView;
  public shadowDepthView: GPUTextureView;

  public readonly linearSampler: GPUSampler;
  public readonly shadowSampler: GPUSampler;

  constructor(
    device: GPUDevice,
    presentationFormat: GPUTextureFormat,
    width: number,
    height: number,
    shadowMapSize: number
  ) {
    this.device = device;
    this.presentationFormat = presentationFormat;

    this.depthTexture = this.createDepthTexture(width, height);
    this.gBufferTexture = this.createGBufferTexture(width, height);
    this.occlusionTexture = this.createOcclusionTexture(width, height);
    this.compositingTexture = this.createCompositingTexture(width, height);
    this.shadowDepthTexture = this.createShadowDepthTexture(shadowMapSize);

    this.depthView = this.depthTexture.createView();
    this.gBufferView = this.gBufferTexture.createView();
    this.occlusionView = this.occlusionTexture.createView();
    this.compositingView = this.compositingTexture.createView();
    this.shadowDepthView = this.shadowDepthTexture.createView();

    this.linearSampler = device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
    });

    this.shadowSampler = device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      compare: 'less',
    });
  }

  resize(width: number, height: number) {
    this.depthTexture.destroy();
    this.gBufferTexture.destroy();
    this.occlusionTexture.destroy();
    this.compositingTexture.destroy();

    this.depthTexture = this.createDepthTexture(width, height);
    this.gBufferTexture = this.createGBufferTexture(width, height);
    this.occlusionTexture = this.createOcclusionTexture(width, height);
    this.compositingTexture = this.createCompositingTexture(width, height);

    this.depthView = this.depthTexture.createView();
    this.gBufferView = this.gBufferTexture.createView();
    this.occlusionView = this.occlusionTexture.createView();
    this.compositingView = this.compositingTexture.createView();
  }

  private createDepthTexture(width: number, height: number) {
    return this.device.createTexture({
      size: [width, height],
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
  }

  private createGBufferTexture(width: number, height: number) {
    return this.device.createTexture({
      size: [width, height],
      format: 'rgba16float',
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
  }

  private createOcclusionTexture(width: number, height: number) {
    return this.device.createTexture({
      size: [width, height],
      format: 'r16float',
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
  }

  private createCompositingTexture(width: number, height: number) {
    return this.device.createTexture({
      size: [width, height],
      format: this.presentationFormat,
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
  }

  private createShadowDepthTexture(size: number) {
    return this.device.createTexture({
      size: [size, size],
      format: 'depth32float',
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
  }
}
