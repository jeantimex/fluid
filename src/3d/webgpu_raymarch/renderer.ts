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
 * ## Uniform Buffer Layout (84 floats = 336 bytes)
 *
 * | Offset | Name                   | Type      |
 * |--------|------------------------|-----------|
 * | 0–2    | viewPos                | vec3<f32> |
 * | 4–6    | cameraRight            | vec3<f32> |
 * | 8–10   | cameraUp               | vec3<f32> |
 * | 12–14  | cameraForward          | vec3<f32> |
 * | 16–18  | boundsSize             | vec3<f32> |
 * | 19     | densityOffset          | f32       |
 * | 20     | densityMultiplier      | f32       |
 * | 21     | stepSize               | f32       |
 * | 22     | lightStepSize          | f32       |
 * | 23     | aspect                 | f32       |
 * | 24     | fovY                   | f32       |
 * | 25     | maxSteps               | f32       |
 * | 26     | tileScale              | f32       |
 * | 27     | tileDarkOffset         | f32       |
 * | 28–30  | tileCol1               | vec3<f32> |
 * | 32–34  | tileCol2               | vec3<f32> |
 * | 36–38  | tileCol3               | vec3<f32> |
 * | 40–42  | tileCol4               | vec3<f32> |
 * | 44–46  | tileColVariation       | vec3<f32> |
 * | 47     | debugFloorMode         | f32       |
 * | 48–50  | dirToSun               | vec3<f32> |
 * | 52–54  | extinctionCoefficients | vec3<f32> |
 * | 56     | indexOfRefraction       | f32       |
 * | 57     | numRefractions         | f32       |
 * | 58     | tileDarkFactor         | f32       |
 * | 59     | floorAmbient           | f32       |
 * | 60–62  | floorSize              | vec3<f32> |
 * | 63     | sceneExposure          | f32       |
 * | 64–66  | floorCenter            | vec3<f32> |
 * | 68–70  | obstacleCenter         | vec3<f32> |
 * | 72–74  | obstacleHalfSize       | vec3<f32> |
 * | 76–78  | obstacleRotation       | vec3<f32> |
 * | 79     | pad                    | f32       |
 * | 80–82  | obstacleColor          | vec3<f32> |
 * | 83     | obstacleAlpha          | f32       |
 *
 * @module renderer
 */

import raymarchShader from './shaders/raymarch.wgsl?raw';
import blitShader from './shaders/blit.wgsl?raw';
import type { OrbitCamera } from '../webgpu_particles/orbit_camera.ts';
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

  /** CPU-side typed array mirroring the uniform buffer contents (84 floats). */
  private uniformData!: Float32Array<ArrayBuffer>;

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

  /** Current width of the offscreen texture (canvas.width / 2). */
  private offscreenWidth = 0;

  /** Current height of the offscreen texture (canvas.height / 2). */
  private offscreenHeight = 0;

  /**
   * Creates the raymarch and blit pipelines, samplers, and uniform buffer.
   *
   * @param device - The WebGPU device to create resources on
   * @param canvas - The HTML canvas (used for aspect ratio calculations)
   * @param format - The swap chain texture format
   */
  constructor(
    device: GPUDevice,
    canvas: HTMLCanvasElement,
    format: GPUTextureFormat
  ) {
    this.device = device;
    this.canvas = canvas;
    this.format = format;

    // -------------------------------------------------------------------------
    // Raymarch Pipeline
    // -------------------------------------------------------------------------

    const module = device.createShaderModule({ code: raymarchShader });

    this.pipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module,
        entryPoint: 'vs_main',
      },
      fragment: {
        module,
        entryPoint: 'fs_main',
        targets: [{ format }],
      },
      primitive: {
        topology: 'triangle-list',
        cullMode: 'none',
      },
    });

    // -------------------------------------------------------------------------
    // Blit Pipeline (upscale half-res → full-res with sRGB conversion)
    // -------------------------------------------------------------------------

    const blitModule = device.createShaderModule({ code: blitShader });
    this.blitPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: blitModule,
        entryPoint: 'vs_main',
      },
      fragment: {
        module: blitModule,
        entryPoint: 'fs_main',
        targets: [{ format }],
      },
      primitive: {
        topology: 'triangle-list',
        cullMode: 'none',
      },
    });

    /** Bilinear sampler for smooth upscaling of the half-res texture. */
    this.blitSampler = device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
    });

    // -------------------------------------------------------------------------
    // Uniform Buffer
    // -------------------------------------------------------------------------

    this.uniformData = new Float32Array(84); // 84 floats = 336 bytes

    this.uniformBuffer = device.createBuffer({
      size: this.uniformData.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // -------------------------------------------------------------------------
    // Density Volume Sampler (trilinear, clamp-to-edge on all axes)
    // -------------------------------------------------------------------------

    this.sampler = device.createSampler({
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
      addressModeW: 'clamp-to-edge',
      magFilter: 'linear',
      minFilter: 'linear',
    });
  }

  /**
   * Creates (or recreates) the bind group for the raymarch pass.
   * Must be called whenever the density texture is replaced (e.g. on reset).
   *
   * @param densityTextureView - 3D texture view from the {@link SplatPipeline}
   */
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

  /**
   * Ensures the offscreen half-resolution texture matches the current canvas
   * size. Recreates the texture and blit bind group only when dimensions change.
   *
   * @param canvasWidth  - Current canvas pixel width
   * @param canvasHeight - Current canvas pixel height
   */
  private ensureOffscreenTexture(
    canvasWidth: number,
    canvasHeight: number
  ): void {
    const halfW = Math.max(1, Math.floor(canvasWidth / 2));
    const halfH = Math.max(1, Math.floor(canvasHeight / 2));

    // Skip recreation if dimensions haven't changed
    if (halfW === this.offscreenWidth && halfH === this.offscreenHeight) {
      return;
    }

    if (this.offscreenTexture) {
      this.offscreenTexture.destroy();
    }

    this.offscreenWidth = halfW;
    this.offscreenHeight = halfH;

    this.offscreenTexture = this.device.createTexture({
      size: { width: halfW, height: halfH },
      format: this.format,
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });

    this.offscreenTextureView = this.offscreenTexture.createView();

    // Rebind the blit pass to sample from the new offscreen texture
    this.blitBindGroup = this.device.createBindGroup({
      layout: this.blitPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.offscreenTextureView },
        { binding: 1, resource: this.blitSampler },
      ],
    });
  }

  /**
   * Executes the two-pass render: raymarch → blit.
   *
   * 1. Writes all uniform data (camera, config) to the GPU buffer.
   * 2. Renders the raymarch shader into the half-res offscreen texture.
   * 3. Blits the offscreen texture to the full-res canvas with sRGB conversion.
   *
   * @param encoder   - Command encoder to record render passes into
   * @param targetView - The swap chain texture view (final output)
   * @param camera    - Orbit camera providing position and basis vectors
   * @param config    - Current raymarch configuration
   */
  render(
    encoder: GPUCommandEncoder,
    targetView: GPUTextureView,
    camera: OrbitCamera,
    config: RaymarchConfig
  ): void {
    this.ensureOffscreenTexture(this.canvas.width, this.canvas.height);

    const basis = camera.basis;
    const pos = camera.position;

    const aspect = this.canvas.width / this.canvas.height;
    const fovY = Math.PI / 3; // 60° vertical field of view

    // --- Camera vectors (vec4-aligned with padding) ---
    this.uniformData[0] = pos.x;
    this.uniformData[1] = pos.y;
    this.uniformData[2] = pos.z;
    this.uniformData[3] = 0; // pad

    this.uniformData[4] = basis.right.x;
    this.uniformData[5] = basis.right.y;
    this.uniformData[6] = basis.right.z;
    this.uniformData[7] = 0; // pad

    this.uniformData[8] = basis.up.x;
    this.uniformData[9] = basis.up.y;
    this.uniformData[10] = basis.up.z;
    this.uniformData[11] = 0; // pad

    this.uniformData[12] = basis.forward.x;
    this.uniformData[13] = basis.forward.y;
    this.uniformData[14] = basis.forward.z;
    this.uniformData[15] = 0; // pad

    // --- Volume & density parameters ---
    this.uniformData[16] = config.boundsSize.x;
    this.uniformData[17] = config.boundsSize.y;
    this.uniformData[18] = config.boundsSize.z;
    this.uniformData[19] = config.densityOffset;

    this.uniformData[20] = config.densityMultiplier / 1000; // Scale down for shader
    this.uniformData[21] = config.stepSize;
    this.uniformData[22] = config.lightStepSize;
    this.uniformData[23] = aspect;

    this.uniformData[24] = fovY;
    this.uniformData[25] = config.maxSteps;
    this.uniformData[26] = config.tileScale;
    this.uniformData[27] = config.tileDarkOffset;

    // --- Tile colors (4 quadrant colors, linear space) ---
    this.uniformData[28] = config.tileCol1.r;
    this.uniformData[29] = config.tileCol1.g;
    this.uniformData[30] = config.tileCol1.b;
    this.uniformData[31] = 0; // pad

    this.uniformData[32] = config.tileCol2.r;
    this.uniformData[33] = config.tileCol2.g;
    this.uniformData[34] = config.tileCol2.b;
    this.uniformData[35] = 0; // pad

    this.uniformData[36] = config.tileCol3.r;
    this.uniformData[37] = config.tileCol3.g;
    this.uniformData[38] = config.tileCol3.b;
    this.uniformData[39] = 0; // pad

    this.uniformData[40] = config.tileCol4.r;
    this.uniformData[41] = config.tileCol4.g;
    this.uniformData[42] = config.tileCol4.b;
    this.uniformData[43] = 0; // pad

    // --- Color variation & debug ---
    this.uniformData[44] = config.tileColVariation.x;
    this.uniformData[45] = config.tileColVariation.y;
    this.uniformData[46] = config.tileColVariation.z;
    this.uniformData[47] = config.debugFloorMode;

    // --- Sun direction (hardcoded normalized vector) ---
    this.uniformData[48] = 0.83; // dirToSun.x
    this.uniformData[49] = 0.42; // dirToSun.y
    this.uniformData[50] = 0.36; // dirToSun.z
    this.uniformData[51] = 0; // pad

    // --- Extinction coefficients for Beer–Lambert transmittance ---
    this.uniformData[52] = config.extinctionCoefficients.x;
    this.uniformData[53] = config.extinctionCoefficients.y;
    this.uniformData[54] = config.extinctionCoefficients.z;
    this.uniformData[55] = 0; // pad

    // --- Optical & lighting parameters ---
    this.uniformData[56] = config.indexOfRefraction;
    this.uniformData[57] = config.numRefractions;
    this.uniformData[58] = config.tileDarkFactor;
    this.uniformData[59] = config.floorAmbient;

    // --- Floor geometry ---
    this.uniformData[60] = config.floorSize.x;
    this.uniformData[61] = config.floorSize.y;
    this.uniformData[62] = config.floorSize.z;
    this.uniformData[63] = config.sceneExposure;

    // Floor center: horizontally centered, positioned just below the fluid bounds
    this.uniformData[64] = 0; // floorCenter.x
    this.uniformData[65] =
      -config.boundsSize.y * 0.5 - config.floorSize.y * 0.5; // floorCenter.y
    this.uniformData[66] = 0; // floorCenter.z
    this.uniformData[67] = 0; // pad

    // --- Obstacle box ---
    this.uniformData[68] = config.obstacleCentre.x;
    this.uniformData[69] = config.obstacleCentre.y;
    this.uniformData[70] = config.obstacleCentre.z;
    this.uniformData[71] = 0; // pad

    this.uniformData[72] = config.obstacleSize.x * 0.5;
    this.uniformData[73] = config.obstacleSize.y * 0.5;
    this.uniformData[74] = config.obstacleSize.z * 0.5;
    this.uniformData[75] = 0; // pad

    this.uniformData[76] = config.obstacleRotation.x;
    this.uniformData[77] = config.obstacleRotation.y;
    this.uniformData[78] = config.obstacleRotation.z;
    this.uniformData[79] = 0; // pad

    this.uniformData[80] = config.obstacleColor.r;
    this.uniformData[81] = config.obstacleColor.g;
    this.uniformData[82] = config.obstacleColor.b;
    this.uniformData[83] = config.obstacleAlpha;

    // Upload uniforms to GPU
    this.device.queue.writeBuffer(this.uniformBuffer, 0, this.uniformData);

    // -------------------------------------------------------------------------
    // Pass 1: Raymarch into half-res offscreen texture
    // -------------------------------------------------------------------------

    const raymarchPass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.offscreenTextureView,
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: { r: 0.03, g: 0.05, b: 0.08, a: 1 }, // Dark blue-gray background
        },
      ],
    });

    raymarchPass.setViewport(
      0,
      0,
      this.offscreenWidth,
      this.offscreenHeight,
      0,
      1
    );
    raymarchPass.setPipeline(this.pipeline);
    raymarchPass.setBindGroup(0, this.bindGroup);
    raymarchPass.draw(3, 1, 0, 0); // Full-screen triangle (3 vertices)
    raymarchPass.end();

    // -------------------------------------------------------------------------
    // Pass 2: Blit/upscale offscreen texture to full-res canvas
    // -------------------------------------------------------------------------

    const blitPass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: targetView,
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: { r: 0.03, g: 0.05, b: 0.08, a: 1 },
        },
      ],
    });

    blitPass.setPipeline(this.blitPipeline);
    blitPass.setBindGroup(0, this.blitBindGroup);
    blitPass.draw(3, 1, 0, 0); // Full-screen triangle (3 vertices)
    blitPass.end();
  }
}
