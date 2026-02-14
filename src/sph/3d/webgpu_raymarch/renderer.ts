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
 * ## Uniform Buffer Layout (88 floats = 352 bytes)
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
 * | 0–2   | viewPos                | vec3<f32> |
 * | 4–6   | cameraRight            | vec3<f32> |
 * | 8–10  | cameraUp               | vec3<f32> |
 * | 12–14 | cameraForward          | vec3<f32> |
 * | 16–18 | minBounds              | vec3<f32> |
 * | 19     | voxelsPerUnit          | f32       |
 * | 20–22 | maxBounds              | vec3<f32> |
 * | 23     | floorY                 | f32       |
 * | 24     | densityOffset          | f32       |
 * | 25     | densityMultiplier      | f32       |
 * | 26     | stepSize               | f32       |
 * | 27     | lightStepSize          | f32       |
 * | 28     | aspect                 | f32       |
 * | 29     | fovY                   | f32       |
 * | 30     | maxSteps               | f32       |
 * | 31     | tileScale              | f32       |
 * | 32     | tileDarkOffset         | f32       |
 * | 33     | globalBrightness       | f32       |
 * | 34     | globalSaturation       | f32       |
 * | 36–38  | tileCol1               | vec3<f32> |
 * | 40–42  | tileCol2               | vec3<f32> |
 * | 44–46  | tileCol3               | vec3<f32> |
 * | 48–50  | tileCol4               | vec3<f32> |
 * | 52–54  | tileColVariation       | vec3<f32> |
 * | 55     | pad11                  | f32       |
 * | 56–58  | dirToSun               | vec3<f32> |
 * | 60–62  | extinctionCoefficients | vec3<f32> |
 * | 63     | sunPower               | f32       |
 * | 64-67  | pad12                  | vec4<f32> |
 * | 68–70  | skyColorHorizon        | vec3<f32> |
 * | 71     | indexOfRefraction      | f32       |
 * | 72–74  | skyColorZenith         | vec3<f32> |
 * | 75     | numRefractions         | f32       |
 * | 76–78  | skyColorGround         | vec3<f32> |
 * | 79     | tileDarkFactor         | f32       |
 * | 80     | floorAmbient           | f32       |
 * | 81     | sceneExposure          | f32       |
 * | 84–86  | floorSize              | vec3<f32> |
 * | 88–90  | floorCenter            | vec3<f32> |
 * | 92–94  | obstacleCenter         | vec3<f32> |
 * | 96–98  | obstacleHalfSize       | vec3<f32> |
 * | 100–102| obstacleRotation       | vec3<f32> |
 * | 103    | obstacleAlpha          | f32       |
 * | 104–106| obstacleColor          | vec3<f32> |
 * | 107    | pad                    | f32       |
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
  /**
   * Beginner note:
   * This renderer runs a full-screen fragment shader that raymarches the
   * 3D density texture and then blits the result to the swap chain.
   */
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

    const raymarchCode = preprocessShader(raymarchShader, {
      '../../common/shaders/shadow_common.wgsl': shadowCommonShader,
    });
    const module = device.createShaderModule({ code: raymarchCode });

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
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: true,
        depthCompare: 'always', // Always write depth (raymarch calculates it manually)
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

    this.uniformData = new Float32Array(124); // 124 * 4 = 496 bytes

    this.uniformBuffer = this.device.createBuffer({
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

    // -------------------------------------------------------------------------
    // Wireframe Pipeline
    // -------------------------------------------------------------------------

    const wireframeModule = device.createShaderModule({
      code: wireframeShader,
    });

    this.wireframePipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: wireframeModule,
        entryPoint: 'vs_main',
        buffers: [
          {
            arrayStride: 28, // 3 floats pos + 4 floats color = 7 floats = 28 bytes
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

    // Wireframe uniform buffer (viewProjection matrix + shadow params = 96 bytes)
    // Used by both wireframe shader (first 64 bytes) and camera depth pass (80 bytes)
    this.wireframeUniformBuffer = device.createBuffer({
      size: 96,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Wireframe vertex buffer: 12 edges × 2 vertices × 7 floats = 168 floats
    this.wireframeVertexData = new Float32Array(168);
    this.wireframeVertexBuffer = device.createBuffer({
      size: this.wireframeVertexData.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });

    this.wireframeBindGroup = device.createBindGroup({
      layout: this.wireframePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.wireframeUniformBuffer } },
      ],
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
   * Ensures the offscreen texture matches the scaled canvas
   * size. Recreates the texture and blit bind group only when dimensions change.
   *
   * @param canvasWidth  - Current canvas pixel width
   * @param canvasHeight - Current canvas pixel height
   * @param renderScale  - Scaling factor (0-1)
   */
  private ensureOffscreenTexture(
    canvasWidth: number,
    canvasHeight: number,
    renderScale: number
  ): void {
    const targetW = Math.max(1, Math.floor(canvasWidth * renderScale));
    const targetH = Math.max(1, Math.floor(canvasHeight * renderScale));

    // Skip recreation if dimensions haven't changed
    if (targetW === this.offscreenWidth && targetH === this.offscreenHeight) {
      return;
    }

    if (this.offscreenTexture) {
      this.offscreenTexture.destroy();
    }
    if (this.offscreenDepthTexture) {
      this.offscreenDepthTexture.destroy();
    }

    this.offscreenWidth = targetW;
    this.offscreenHeight = targetH;

    this.offscreenTexture = this.device.createTexture({
      size: { width: targetW, height: targetH },
      format: this.format,
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });

    this.offscreenTextureView = this.offscreenTexture.createView();

    // Create depth texture for raymarch depth output
    this.offscreenDepthTexture = this.device.createTexture({
      size: { width: targetW, height: targetH },
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });

    // Rebind the blit pass to sample from the new offscreen texture
    this.blitBindGroup = this.device.createBindGroup({
      layout: this.blitPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.offscreenTextureView },
        { binding: 1, resource: this.blitSampler },
      ],
    });
  }

  // ===========================================================================
  // Bounds Wireframe Geometry Builder
  // ===========================================================================

  /**
   * Builds wireframe geometry for the simulation bounds.
   * Creates 12 edges (lines) representing the bounding box.
   */
  private buildBoundsWireframe(config: RaymarchConfig): number {
    const hx = config.boundsSize.x * 0.5;
    const hy = config.boundsSize.y * 0.5;
    const hz = config.boundsSize.z * 0.5;

    // Bounds center is at origin, bottom at -hy (adjusted for floor)
    const cy = hy - 5.0; // Offset to match the density bounds minY = -5.0

    const color = config.boundsWireframeColor ?? { r: 1, g: 1, b: 1 };

    // 8 corners of the bounding box
    const corners = [
      [-hx, cy - hy, -hz], // 0: back-bottom-left
      [+hx, cy - hy, -hz], // 1: back-bottom-right
      [+hx, cy + hy, -hz], // 2: back-top-right
      [-hx, cy + hy, -hz], // 3: back-top-left
      [-hx, cy - hy, +hz], // 4: front-bottom-left
      [+hx, cy - hy, +hz], // 5: front-bottom-right
      [+hx, cy + hy, +hz], // 6: front-top-right
      [-hx, cy + hy, +hz], // 7: front-top-left
    ];

    // 12 edges of the box (pairs of corner indices)
    const edges = [
      // Bottom face edges
      [0, 1],
      [1, 5],
      [5, 4],
      [4, 0],
      // Top face edges
      [3, 2],
      [2, 6],
      [6, 7],
      [7, 3],
      // Vertical edges
      [0, 3],
      [1, 2],
      [5, 6],
      [4, 7],
    ];

    let offset = 0;
    const addVertex = (cornerIdx: number) => {
      const c = corners[cornerIdx];
      this.wireframeVertexData[offset++] = c[0];
      this.wireframeVertexData[offset++] = c[1];
      this.wireframeVertexData[offset++] = c[2];
      this.wireframeVertexData[offset++] = color.r;
      this.wireframeVertexData[offset++] = color.g;
      this.wireframeVertexData[offset++] = color.b;
      this.wireframeVertexData[offset++] = 1.0; // alpha
    };

    for (const [a, b] of edges) {
      addVertex(a);
      addVertex(b);
    }

    return edges.length * 2; // 24 vertices
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
    this.ensureOffscreenTexture(
      this.canvas.width,
      this.canvas.height,
      config.renderScale
    );

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
    const size = config.boundsSize;
    const hx = size.x * 0.5;
    const hz = size.z * 0.5;
    const minY = -5.0; // Fixed bottom

    // minBounds
    this.uniformData[16] = -hx;
    this.uniformData[17] = minY;
    this.uniformData[18] = -hz;
    this.uniformData[19] = config.densityTextureRes / 20; // voxelsPerUnit

    // maxBounds
    this.uniformData[20] = hx;
    this.uniformData[21] = minY + size.y;
    this.uniformData[22] = hz;
    this.uniformData[23] = config.floorCenter.y + config.floorSize.y * 0.5; // floorY = top surface of floor

    this.uniformData[24] = config.densityOffset;
    this.uniformData[25] = config.densityMultiplier / 1000; // Scale down for shader
    this.uniformData[26] = config.stepSize;
    this.uniformData[27] = config.lightStepSize;
    this.uniformData[28] = aspect;

    this.uniformData[29] = fovY;
    this.uniformData[30] = config.maxSteps;
    this.uniformData[31] = config.tileScale;
    this.uniformData[32] = config.tileDarkOffset;
    this.uniformData[33] = config.globalBrightness;
    this.uniformData[34] = config.globalSaturation;
    this.uniformData[35] = 0; // pad_align2

    // --- Tile colors (4 quadrant colors, linear space) ---
    this.uniformData[36] = config.tileCol1.r;
    this.uniformData[37] = config.tileCol1.g;
    this.uniformData[38] = config.tileCol1.b;
    this.uniformData[39] = 0; // pad6

    this.uniformData[40] = config.tileCol2.r;
    this.uniformData[41] = config.tileCol2.g;
    this.uniformData[42] = config.tileCol2.b;
    this.uniformData[43] = 0; // pad7

    this.uniformData[44] = config.tileCol3.r;
    this.uniformData[45] = config.tileCol3.g;
    this.uniformData[46] = config.tileCol3.b;
    this.uniformData[47] = 0; // pad8

    this.uniformData[48] = config.tileCol4.r;
    this.uniformData[49] = config.tileCol4.g;
    this.uniformData[50] = config.tileCol4.b;
    this.uniformData[51] = 0; // pad9

    // --- Color variation & debug ---
    this.uniformData[52] = config.tileColVariation.x;
    this.uniformData[53] = config.tileColVariation.y;
    this.uniformData[54] = config.tileColVariation.z;
    this.uniformData[55] = 0; // pad11

    // --- Sun direction ---
    const sunDir = config.dirToSun;
    this.uniformData[56] = sunDir.x; // dirToSun.x
    this.uniformData[57] = sunDir.y; // dirToSun.y
    this.uniformData[58] = sunDir.z; // dirToSun.z
    this.uniformData[59] = 0; // pad10

    // --- Extinction coefficients ---
    this.uniformData[60] = config.extinctionCoefficients.x;
    this.uniformData[61] = config.extinctionCoefficients.y;
    this.uniformData[62] = config.extinctionCoefficients.z;
    this.uniformData[63] = config.sunPower; // sunPower at 63

    // --- Padding (formerly fluidColor) ---
    this.uniformData[64] = 0;
    this.uniformData[65] = 0;
    this.uniformData[66] = 0;
    this.uniformData[67] = 0;

    // --- Sky Colors ---
    this.uniformData[68] = config.skyColorHorizon.r;
    this.uniformData[69] = config.skyColorHorizon.g;
    this.uniformData[70] = config.skyColorHorizon.b;
    this.uniformData[71] = config.indexOfRefraction; // indexOfRefraction at 71

    this.uniformData[72] = config.skyColorZenith.r;
    this.uniformData[73] = config.skyColorZenith.g;
    this.uniformData[74] = config.skyColorZenith.b;
    this.uniformData[75] = config.numRefractions; // numRefractions at 75

    this.uniformData[76] = config.skyColorGround.r;
    this.uniformData[77] = config.skyColorGround.g;
    this.uniformData[78] = config.skyColorGround.b;
    this.uniformData[79] = config.tileDarkFactor; // tileDarkFactor at 79

    // --- Optical & lighting parameters ---
    this.uniformData[80] = config.floorAmbient;
    this.uniformData[81] = config.sceneExposure;
    this.uniformData[82] = 0; // pad_align_floor
    this.uniformData[83] = 0; // pad_align_floor

    // --- Floor geometry ---
    this.uniformData[84] = config.floorSize.x;
    this.uniformData[85] = config.floorSize.y;
    this.uniformData[86] = config.floorSize.z;
    this.uniformData[87] = 0; // pad14

    // Floor center - top of floor should be at y=-5.0 (fluid bottom)
    this.uniformData[88] = config.floorCenter.x;
    this.uniformData[89] = config.floorCenter.y; // -5.5, so top is at -5.0
    this.uniformData[90] = config.floorCenter.z;
    this.uniformData[91] = 0; // pad15

    const showObstacle = config.showObstacle !== false;
    const obstacleShape = config.obstacleShape ?? 'box';
    const obstacleIsSphere = obstacleShape === 'sphere';
    const obstacleRadius = config.obstacleRadius ?? 0;
    // --- Obstacle box/sphere (box uses bottom Y, sphere uses center) ---
    this.uniformData[92] = config.obstacleCentre.x;
    this.uniformData[93] = obstacleIsSphere
      ? config.obstacleCentre.y
      : config.obstacleCentre.y + config.obstacleSize.y * 0.5;
    this.uniformData[94] = config.obstacleCentre.z;
    this.uniformData[95] = 0; // pad16

    this.uniformData[96] = showObstacle
      ? obstacleIsSphere
        ? obstacleRadius
        : config.obstacleSize.x * 0.5
      : 0;
    this.uniformData[97] = showObstacle
      ? obstacleIsSphere
        ? obstacleRadius
        : config.obstacleSize.y * 0.5
      : 0;
    this.uniformData[98] = showObstacle
      ? obstacleIsSphere
        ? obstacleRadius
        : config.obstacleSize.z * 0.5
      : 0;
    this.uniformData[99] = 0; // pad17

    this.uniformData[100] = config.obstacleRotation.x;
    this.uniformData[101] = config.obstacleRotation.y;
    this.uniformData[102] = config.obstacleRotation.z;
    this.uniformData[103] = showObstacle ? config.obstacleAlpha : 0;

    this.uniformData[104] = config.obstacleColor.r;
    this.uniformData[105] = config.obstacleColor.g;
    this.uniformData[106] = config.obstacleColor.b;
    this.uniformData[107] = config.shadowSoftness; // shadowSoftness

    this.uniformData[108] = config.showFluidShadows ? 1.0 : 0.0;
    this.uniformData[109] = obstacleIsSphere ? 1.0 : 0.0;

    // Upload uniforms to GPU
    this.device.queue.writeBuffer(this.uniformBuffer, 0, this.uniformData);

    // -------------------------------------------------------------------------
    // Pass 1: Raymarch into half-res offscreen texture (with depth)
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
      depthStencilAttachment: {
        view: this.offscreenDepthTexture.createView(),
        depthClearValue: 1.0,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
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
    // Pass 1.5: Wireframe at half-res (if enabled) - uses raymarch depth
    // -------------------------------------------------------------------------

    if (config.showBoundsWireframe) {
      const wireframeVertexCount = this.buildBoundsWireframe(config);
      this.device.queue.writeBuffer(
        this.wireframeVertexBuffer,
        0,
        this.wireframeVertexData.buffer,
        this.wireframeVertexData.byteOffset,
        wireframeVertexCount * 7 * 4
      );

      // Build view-projection matrix for wireframe
      // Use WebGPU's [0, 1] depth range (not OpenGL's [-1, 1])
      const viewMatrix = camera.viewMatrix;
      const projection = new Float32Array(16);
      const tanHalfFov = Math.tan(fovY * 0.5);
      const near = 0.1;
      const far = 200.0;
      projection[0] = 1 / (aspect * tanHalfFov);
      projection[5] = 1 / tanHalfFov;
      projection[10] = -far / (far - near); // WebGPU [0,1] depth
      projection[11] = -1;
      projection[14] = -(far * near) / (far - near); // WebGPU [0,1] depth

      const viewProj = new Float32Array(16);
      for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 4; j++) {
          let sum = 0;
          for (let k = 0; k < 4; k++) {
            sum += projection[i + k * 4] * viewMatrix[k + j * 4];
          }
          viewProj[i + j * 4] = sum;
        }
      }

      // Write viewProj to wireframe uniform buffer
      this.device.queue.writeBuffer(this.wireframeUniformBuffer, 0, viewProj);

      // Render wireframe at half-res using raymarch depth texture
      const wireframePass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: this.offscreenTextureView,
            loadOp: 'load', // Keep the raymarch result
            storeOp: 'store',
          },
        ],
        depthStencilAttachment: {
          view: this.offscreenDepthTexture.createView(),
          depthLoadOp: 'load', // Keep raymarch depth
          depthStoreOp: 'store',
        },
      });

      wireframePass.setViewport(
        0,
        0,
        this.offscreenWidth,
        this.offscreenHeight,
        0,
        1
      );
      wireframePass.setPipeline(this.wireframePipeline);
      wireframePass.setBindGroup(0, this.wireframeBindGroup);
      wireframePass.setVertexBuffer(0, this.wireframeVertexBuffer, 0);
      wireframePass.draw(wireframeVertexCount);
      wireframePass.end();
    }

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
