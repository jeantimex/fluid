/**
 * =============================================================================
 * Raymarch Renderer - 2-Pass Volume Rendering Pipeline
 * =============================================================================
 *
 * Renders the 3D fluid density volume as a full-screen raymarched image using
 * a two-pass approach:
 *
 * 1. **Raymarch Pass**: Renders to a half-resolution offscreen texture.
 *    A full-screen triangle invokes the raymarch fragment shader which
 *    steps through the density volume, computing refraction, reflection,
 *    Beer–Lambert transmittance, floor tiling, and sky lighting.
 *
 * 2. **Blit Pass**: Upscales the half-resolution result to the final canvas
 *    with bilinear filtering and applies a linear-to-sRGB conversion.
 *
 * The half-resolution strategy halves the pixel count (4× fewer fragments),
 * which is critical because the raymarch shader is extremely expensive per pixel.
 *
 * ## Uniform Buffer Layout (124 floats = 496 bytes)
 *
 * @module renderer
 */

import raymarchShader from './shaders/raymarch.wgsl?raw';
import blitShader from './shaders/blit.wgsl?raw';
import wireframeShader from '../common/shaders/wireframe.wgsl?raw';
import shadowCommonShader from '../common/shaders/shadow_common.wgsl?raw';
import { preprocessShader } from '../common/shader_preprocessor.ts';
import type { OrbitCamera } from '../common/orbit_camera.ts';
import type { RaymarchConfig } from './types.ts';

/**
 * Two-pass volume renderer: raymarch at half resolution, then blit to canvas.
 *
 * Owns the raymarch render pipeline, the blit upscale pipeline, the uniform
 * buffer, the density texture sampler, and the offscreen render target.
 */
export class RaymarchRenderer {
  /** GPU device reference for resource creation and queue writes. */
  private device: GPUDevice;

  /** Canvas element used to derive aspect ratio and pixel dimensions. */
  private canvas: HTMLCanvasElement;

  /** Preferred texture format for the swap chain (e.g. 'bgra8unorm'). */
  private format: GPUTextureFormat;

  /** Render pipeline for the full-screen raymarch fragment shader. */
  private pipeline: GPURenderPipeline;

  /** Uniform buffer holding camera, bounds, and rendering parameters. */
  private uniformBuffer: GPUBuffer;

  /** Trilinear sampler for the 3D density texture (clamp-to-edge). */
  private sampler: GPUSampler;

  /** Bind group for the raymarch pass (density texture + sampler + uniforms). */
  private bindGroup!: GPUBindGroup;

  /** CPU-side typed array mirroring the uniform buffer contents (124 floats). */
  private uniformData = new Float32Array(124);

  // ---------------------------------------------------------------------------
  // Blit / Half-Resolution Rendering
  // ---------------------------------------------------------------------------

  /** Render pipeline for the full-screen blit + linear-to-sRGB conversion. */
  private blitPipeline: GPURenderPipeline;

  /** Bind group for the blit pass (offscreen texture + bilinear sampler). */
  private blitBindGroup!: GPUBindGroup;

  /** Bilinear sampler used to upscale the half-res offscreen texture. */
  private blitSampler: GPUSampler;

  /** Half-resolution offscreen render target texture. */
  private offscreenTexture!: GPUTexture;

  /** View into the offscreen texture, used as both render target and sample source. */
  private offscreenTextureView!: GPUTextureView;

  /** Half-resolution depth texture for raymarch depth output. */
  private offscreenDepthTexture!: GPUTexture;

  /** Current width of the offscreen texture (canvas.width / 2). */
  private offscreenWidth = 0;

  /** Current height of the offscreen texture (canvas.height / 2). */
  private offscreenHeight = 0;

  // ---------------------------------------------------------------------------
  // Wireframe Rendering
  // ---------------------------------------------------------------------------

  /** Pipeline for rendering bounds wireframe. */
  private wireframePipeline: GPURenderPipeline;

  /** Bind group for wireframe rendering. */
  private wireframeBindGroup: GPUBindGroup;

  /** Uniform buffer for wireframe (viewProjection matrix). */
  private wireframeUniformBuffer: GPUBuffer;

  /** Vertex buffer for wireframe geometry. */
  private wireframeVertexBuffer: GPUBuffer;

  /** CPU-side wireframe vertex data. */
  private wireframeVertexData: Float32Array;

  /**
   * Creates the raymarch and blit pipelines, samplers, and uniform buffer.
   */
  constructor(
    device: GPUDevice,
    canvas: HTMLCanvasElement,
    format: GPUTextureFormat
  ) {
    this.device = device;
    this.canvas = canvas;
    this.format = format;

    const raymarchCode = preprocessShader(raymarchShader, {
      '../../common/shaders/shadow_common.wgsl': shadowCommonShader,
    });
    const module = device.createShaderModule({ code: raymarchCode });

    this.pipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module, entryPoint: 'vs_main' },
      fragment: {
        module,
        entryPoint: 'fs_main',
        targets: [{ format }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: true,
        depthCompare: 'always',
      },
    });

    const blitModule = device.createShaderModule({ code: blitShader });
    this.blitPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: blitModule, entryPoint: 'vs_main' },
      fragment: {
        module: blitModule,
        entryPoint: 'fs_main',
        targets: [{ format }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
    });

    this.blitSampler = device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
    });

    this.uniformBuffer = this.device.createBuffer({
      size: this.uniformData.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.sampler = device.createSampler({
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
      addressModeW: 'clamp-to-edge',
      magFilter: 'linear',
      minFilter: 'linear',
    });

    const wireframeModule = device.createShaderModule({ code: wireframeShader });
    this.wireframePipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: wireframeModule,
        entryPoint: 'vs_main',
        buffers: [
          {
            arrayStride: 28,
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x3' },
              { shaderLocation: 1, offset: 12, format: 'float32x4' },
            ],
          },
        ],
      },
      fragment: {
        module: wireframeModule,
        entryPoint: 'fs_main',
        targets: [{ format }],
      },
      primitive: { topology: 'line-list' },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: true,
        depthCompare: 'less',
      },
    });

    this.wireframeUniformBuffer = device.createBuffer({
      size: 96,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.wireframeVertexData = new Float32Array(168);
    this.wireframeVertexBuffer = device.createBuffer({
      size: this.wireframeVertexData.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });

    this.wireframeBindGroup = device.createBindGroup({
      layout: this.wireframePipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.wireframeUniformBuffer } }],
    });
  }

  createBindGroup(densityTextureView: GPUTextureView): void {
    this.bindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: densityTextureView },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: { buffer: this.uniformBuffer } },
      ],
    });
  }

  private ensureOffscreenTexture(
    canvasWidth: number,
    canvasHeight: number,
    renderScale: number
  ): void {
    const targetW = Math.max(1, Math.floor(canvasWidth * renderScale));
    const targetH = Math.max(1, Math.floor(canvasHeight * renderScale));

    if (targetW === this.offscreenWidth && targetH === this.offscreenHeight) {
      return;
    }

    if (this.offscreenTexture) this.offscreenTexture.destroy();
    if (this.offscreenDepthTexture) this.offscreenDepthTexture.destroy();

    this.offscreenWidth = targetW;
    this.offscreenHeight = targetH;

    this.offscreenTexture = this.device.createTexture({
      size: { width: targetW, height: targetH },
      format: this.format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });

    this.offscreenTextureView = this.offscreenTexture.createView();

    this.offscreenDepthTexture = this.device.createTexture({
      size: { width: targetW, height: targetH },
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });

    this.blitBindGroup = this.device.createBindGroup({
      layout: this.blitPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.offscreenTextureView },
        { binding: 1, resource: this.blitSampler },
      ],
    });
  }

  private buildBoundsWireframe(
    config: RaymarchConfig,
    boundsSize: { x: number; y: number; z: number }
  ): number {
    const hx = boundsSize.x * 0.5;
    const hy = boundsSize.y * 0.5;
    const hz = boundsSize.z * 0.5;
    const cy = hy - 5.0;
    const color = config.boundsWireframeColor ?? { r: 1, g: 1, b: 1 };

    const corners = [
      [-hx, cy - hy, -hz], [+hx, cy - hy, -hz], [+hx, cy + hy, -hz], [-hx, cy + hy, -hz],
      [-hx, cy - hy, +hz], [+hx, cy - hy, +hz], [+hx, cy + hy, +hz], [-hx, cy + hy, +hz],
    ];

    const edges = [
      [0, 1], [1, 5], [5, 4], [4, 0], [3, 2], [2, 6], [6, 7], [7, 3], [0, 3], [1, 2], [5, 6], [4, 7]
    ];

    let offset = 0;
    const addVertex = (idx: number) => {
      const c = corners[idx];
      this.wireframeVertexData[offset++] = c[0];
      this.wireframeVertexData[offset++] = c[1];
      this.wireframeVertexData[offset++] = c[2];
      this.wireframeVertexData[offset++] = color.r;
      this.wireframeVertexData[offset++] = color.g;
      this.wireframeVertexData[offset++] = color.b;
      this.wireframeVertexData[offset++] = 1.0;
    };

    for (const [a, b] of edges) {
      addVertex(a); addVertex(b);
    }
    return 24;
  }

  render(
    encoder: GPUCommandEncoder,
    targetView: GPUTextureView,
    camera: OrbitCamera,
    config: RaymarchConfig,
    densityTextureSize: { x: number; y: number; z: number },
    smoothBoundsSize?: { x: number; y: number; z: number }
  ): void {
    const boundsSize = smoothBoundsSize ?? config.boundsSize;
    this.ensureOffscreenTexture(this.canvas.width, this.canvas.height, config.renderScale);

    const basis = camera.basis;
    const pos = camera.position;
    const aspect = this.canvas.width / this.canvas.height;
    const fovY = Math.PI / 3;

    // --- Packing (must match RaymarchParams exactly) ---
    // 0-3: viewPos, pad0
    this.uniformData[0] = pos.x; this.uniformData[1] = pos.y; this.uniformData[2] = pos.z; this.uniformData[3] = 0;
    // 4-7: cameraRight, pad1
    this.uniformData[4] = basis.right.x; this.uniformData[5] = basis.right.y; this.uniformData[6] = basis.right.z; this.uniformData[7] = 0;
    // 8-11: cameraUp, pad2
    this.uniformData[8] = basis.up.x; this.uniformData[9] = basis.up.y; this.uniformData[10] = basis.up.z; this.uniformData[11] = 0;
    // 12-15: cameraForward, pad3
    this.uniformData[12] = basis.forward.x; this.uniformData[13] = basis.forward.y; this.uniformData[14] = basis.forward.z; this.uniformData[15] = 0;

    const hx = boundsSize.x * 0.5;
    const hz = boundsSize.z * 0.5;
    const minY = -5.0;
    const vpuX = (densityTextureSize.x - 1) / boundsSize.x;
    const vpuY = (densityTextureSize.y - 1) / boundsSize.y;
    const vpuZ = (densityTextureSize.z - 1) / boundsSize.z;

    // 16-19: minBounds, vpuX
    this.uniformData[16] = -hx; this.uniformData[17] = minY; this.uniformData[18] = -hz; this.uniformData[19] = vpuX;
    // 20-23: maxBounds, vpuY
    this.uniformData[20] = hx; this.uniformData[21] = minY + boundsSize.y; this.uniformData[22] = hz; this.uniformData[23] = vpuY;
    
    // 24: densityOffset, 25: densityMultiplier, 26: stepSize, 27: vpuZ
    this.uniformData[24] = config.densityOffset;
    this.uniformData[25] = config.densityMultiplier / 1000;
    this.uniformData[26] = config.stepSize;
    this.uniformData[27] = vpuZ;

    // 28: aspect, 29: fovY, 30: maxSteps, 31: tileScale
    this.uniformData[28] = aspect;
    this.uniformData[29] = fovY;
    this.uniformData[30] = config.maxSteps;
    this.uniformData[31] = config.tileScale;

    // 32: tileDarkOffset, 33: globalBrightness, 34: globalSaturation, 35: lightStepSize
    this.uniformData[32] = config.tileDarkOffset;
    this.uniformData[33] = config.globalBrightness;
    this.uniformData[34] = config.globalSaturation;
    this.uniformData[35] = config.lightStepSize;

    // --- Tile colors (36-55) ---
    this.uniformData[36] = config.tileCol1.r; this.uniformData[37] = config.tileCol1.g; this.uniformData[38] = config.tileCol1.b; this.uniformData[39] = 0;
    this.uniformData[40] = config.tileCol2.r; this.uniformData[41] = config.tileCol2.g; this.uniformData[42] = config.tileCol2.b; this.uniformData[43] = 0;
    this.uniformData[44] = config.tileCol3.r; this.uniformData[45] = config.tileCol3.g; this.uniformData[46] = config.tileCol3.b; this.uniformData[47] = 0;
    this.uniformData[48] = config.tileCol4.r; this.uniformData[49] = config.tileCol4.g; this.uniformData[50] = config.tileCol4.b; this.uniformData[51] = 0;
    // 52-55: tileColVariation, pad
    this.uniformData[52] = config.tileColVariation.x; this.uniformData[53] = config.tileColVariation.y; this.uniformData[54] = config.tileColVariation.z; this.uniformData[55] = 0;

    // --- Sun and Extinction (56-67) ---
    // 56-59: dirToSun, pad
    this.uniformData[56] = config.dirToSun.x; this.uniformData[57] = config.dirToSun.y; this.uniformData[58] = config.dirToSun.z; this.uniformData[59] = 0;
    // 60-63: extinction, sunPower
    this.uniformData[60] = config.extinctionCoefficients.x; this.uniformData[61] = config.extinctionCoefficients.y; this.uniformData[62] = config.extinctionCoefficients.z; this.uniformData[63] = config.sunPower;

    // --- Optical and Sky (64-79) ---
    // 64-67: floorY, IOR, numRefractions, tileDarkFactor
    this.uniformData[64] = config.floorCenter.y + config.floorSize.y * 0.5;
    this.uniformData[65] = config.indexOfRefraction; this.uniformData[66] = config.numRefractions; this.uniformData[67] = config.tileDarkFactor;
    // 68-71: skyHorizon, floorAmbient
    this.uniformData[68] = config.skyColorHorizon.r; this.uniformData[69] = config.skyColorHorizon.g; this.uniformData[70] = config.skyColorHorizon.b; this.uniformData[71] = config.floorAmbient;
    // 72-75: skyZenith, sceneExposure
    this.uniformData[72] = config.skyColorZenith.r; this.uniformData[73] = config.skyColorZenith.g; this.uniformData[74] = config.skyColorZenith.b; this.uniformData[75] = config.sceneExposure;
    // 76-79: skyGround, pad
    this.uniformData[76] = config.skyColorGround.r; this.uniformData[77] = config.skyColorGround.g; this.uniformData[78] = config.skyColorGround.b; this.uniformData[79] = 0;

    // --- Geometry (80-91) ---
    // 80-83: floorSize, pad
    this.uniformData[80] = config.floorSize.x; this.uniformData[81] = config.floorSize.y; this.uniformData[82] = config.floorSize.z; this.uniformData[83] = 0;
    // 84-87: floorCenter, pad
    this.uniformData[84] = config.floorCenter.x; this.uniformData[85] = config.floorCenter.y; this.uniformData[86] = config.floorCenter.z; this.uniformData[87] = 0;

    const showObstacle = config.showObstacle !== false;
    const obstacleShape = config.obstacleShape ?? 'box';
    const obstacleIsSphere = obstacleShape === 'sphere';
    const obstacleRadius = config.obstacleRadius ?? 0;

    // --- Obstacle (88-111) ---
    // 88-91: obstacleCenter, pad
    this.uniformData[88] = config.obstacleCentre.x;
    this.uniformData[89] = obstacleIsSphere ? config.obstacleCentre.y : config.obstacleCentre.y + config.obstacleSize.y * 0.5;
    this.uniformData[90] = config.obstacleCentre.z;
    this.uniformData[91] = 0;

    // 92-95: obstacleHalfSize, pad
    this.uniformData[92] = showObstacle ? (obstacleIsSphere ? obstacleRadius : config.obstacleSize.x * 0.5) : 0;
    this.uniformData[93] = showObstacle ? (obstacleIsSphere ? obstacleRadius : config.obstacleSize.y * 0.5) : 0;
    this.uniformData[94] = showObstacle ? (obstacleIsSphere ? obstacleRadius : config.obstacleSize.z * 0.5) : 0;
    this.uniformData[95] = 0;

    // 96-99: obstacleRotation, alpha
    this.uniformData[96] = config.obstacleRotation.x; this.uniformData[97] = config.obstacleRotation.y; this.uniformData[98] = config.obstacleRotation.z; this.uniformData[99] = showObstacle ? config.obstacleAlpha : 0;
    // 100-103: obstacleColor, shadowSoftness
    this.uniformData[100] = config.obstacleColor.r; this.uniformData[101] = config.obstacleColor.g; this.uniformData[102] = config.obstacleColor.b; this.uniformData[103] = config.shadowSoftness;
    // 104-107: flags
    this.uniformData[104] = config.showFluidShadows ? 1.0 : 0.0;
    this.uniformData[105] = obstacleIsSphere ? 1.0 : 0.0;
    this.uniformData[106] = 0;
    this.uniformData[107] = 0;

    this.device.queue.writeBuffer(this.uniformBuffer, 0, this.uniformData);

    const raymarchPass = encoder.beginRenderPass({
      colorAttachments: [{
        view: this.offscreenTextureView, loadOp: 'clear', storeOp: 'store',
        clearValue: { r: 0.03, g: 0.05, b: 0.08, a: 1 }
      }],
      depthStencilAttachment: {
        view: this.offscreenDepthTexture.createView(), depthClearValue: 1.0, depthLoadOp: 'clear', depthStoreOp: 'store',
      }
    });
    raymarchPass.setViewport(0, 0, this.offscreenWidth, this.offscreenHeight, 0, 1);
    raymarchPass.setPipeline(this.pipeline);
    raymarchPass.setBindGroup(0, this.bindGroup);
    raymarchPass.draw(3, 1, 0, 0);
    raymarchPass.end();

    if (config.showBoundsWireframe) {
      const vCount = this.buildBoundsWireframe(config, boundsSize);
      this.device.queue.writeBuffer(this.wireframeVertexBuffer, 0, this.wireframeVertexData.buffer, 0, vCount * 7 * 4);
      const vMatrix = camera.viewMatrix;
      const proj = new Float32Array(16);
      const tanHalfFov = Math.tan(fovY * 0.5);
      const n = 0.1, f = 200.0;
      proj[0] = 1 / (aspect * tanHalfFov); proj[5] = 1 / tanHalfFov;
      proj[10] = -f / (f - n); proj[11] = -1; proj[14] = -(f * n) / (f - n);
      const vp = new Float32Array(16);
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
        let sum = 0; for (let k = 0; k < 4; k++) sum += proj[i + k * 4] * vMatrix[k + j * 4];
        vp[i + j * 4] = sum;
      }
      this.device.queue.writeBuffer(this.wireframeUniformBuffer, 0, vp);
      const wPass = encoder.beginRenderPass({
        colorAttachments: [{ view: this.offscreenTextureView, loadOp: 'load', storeOp: 'store' }],
        depthStencilAttachment: { view: this.offscreenDepthTexture.createView(), depthLoadOp: 'load', depthStoreOp: 'store' }
      });
      wPass.setViewport(0, 0, this.offscreenWidth, this.offscreenHeight, 0, 1);
      wPass.setPipeline(this.wireframePipeline);
      wPass.setBindGroup(0, this.wireframeBindGroup);
      wPass.setVertexBuffer(0, this.wireframeVertexBuffer, 0);
      wPass.draw(vCount);
      wPass.end();
    }

    const blitPass = encoder.beginRenderPass({
      colorAttachments: [{ view: targetView, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0.03, g: 0.05, b: 0.08, a: 1 } }]
    });
    blitPass.setPipeline(this.blitPipeline);
    blitPass.setBindGroup(0, this.blitBindGroup);
    blitPass.draw(3, 1, 0, 0);
    blitPass.end();
  }
}
