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
import shadowShader from '../webgpu_particles/shaders/shadow.wgsl?raw';
import environmentShader from '../common/shaders/environment.wgsl?raw';
import type { OrbitCamera } from '../webgpu_particles/orbit_camera.ts';
import type { RaymarchConfig } from './types.ts';
import { preprocessShader } from '../common/shader_preprocessor.ts';
import { writeEnvironmentUniforms } from '../common/environment.ts';
import { mat4LookAt, mat4Multiply, mat4Ortho } from '../webgpu_particles/math_utils.ts';

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

  /** Uniform buffer holding environment parameters. */
  private envUniformBuffer: GPUBuffer;

  /** Uniform buffer for shadow map settings. */
  private shadowUniformBuffer: GPUBuffer;

  /** Trilinear sampler for the 3D density texture (clamp-to-edge). */
  private sampler: GPUSampler;

  /** Bind group for the raymarch pass (density texture + sampler + uniforms). */
  private bindGroup!: GPUBindGroup;

  /** Bind group for particle shadow rendering. */
  private shadowParticleBindGroup!: GPUBindGroup;

  /** Bind group for obstacle shadow rendering. */
  private shadowObstacleBindGroup!: GPUBindGroup;

  /** CPU-side typed array mirroring the uniform buffer contents (32 floats). */
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

  // ---------------------------------------------------------------------------
  // Shadow Map Rendering
  // ---------------------------------------------------------------------------

  /** Pipeline for particle shadow map rendering. */
  private shadowParticlePipeline: GPURenderPipeline;

  /** Pipeline for obstacle shadow map rendering. */
  private shadowObstaclePipeline: GPURenderPipeline;

  /** Depth texture for shadow map. */
  private shadowTexture!: GPUTexture;

  /** Shadow map resolution (square). */
  private shadowMapSize = 2048;

  /** Comparison sampler for shadow map sampling. */
  private shadowSampler: GPUSampler;

  /** Obstacle face vertex buffer for shadow rendering. */
  private lineVertexBuffer: GPUBuffer;

  /** CPU-side obstacle face vertex data. */
  private lineVertexData: Float32Array;

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
      '../../common/shaders/environment.wgsl': environmentShader,
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

    this.uniformData = new Float32Array(36); // 36 floats = 144 bytes

    this.uniformBuffer = device.createBuffer({
      size: this.uniformData.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.envUniformBuffer = device.createBuffer({
      size: 240, // 60 floats
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Shadow uniforms: lightViewProjection (64) + softness + radius + padding = 80 bytes (round to 96)
    this.shadowUniformBuffer = device.createBuffer({
      size: 96,
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
    // Shadow Map Pipelines
    // -------------------------------------------------------------------------

    const shadowModule = device.createShaderModule({ code: shadowShader });

    this.shadowParticlePipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: shadowModule, entryPoint: 'vs_particles' },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: true,
        depthCompare: 'less',
      },
    });

    this.shadowObstaclePipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: shadowModule,
        entryPoint: 'vs_obstacle',
        buffers: [
          {
            arrayStride: 40,
            attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }],
          },
        ],
      },
      primitive: { topology: 'triangle-list', cullMode: 'back' },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: true,
        depthCompare: 'less',
      },
    });

    // Allocate for face vertices (36 × 10 floats)
    this.lineVertexData = new Float32Array(360);
    this.lineVertexBuffer = device.createBuffer({
      size: this.lineVertexData.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });

    this.shadowTexture = this.device.createTexture({
      size: [this.shadowMapSize, this.shadowMapSize],
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });

    this.shadowSampler = this.device.createSampler({
      compare: 'less',
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
  createBindGroup(
    densityTextureView: GPUTextureView,
    positionsBuffer: GPUBuffer
  ): void {
    this.bindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: densityTextureView },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: { buffer: this.uniformBuffer } },
        { binding: 3, resource: { buffer: this.envUniformBuffer } },
        { binding: 4, resource: this.shadowTexture.createView() },
        { binding: 5, resource: this.shadowSampler },
        { binding: 6, resource: { buffer: this.shadowUniformBuffer } },
      ],
    });

    this.shadowParticleBindGroup = this.device.createBindGroup({
      layout: this.shadowParticlePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.shadowUniformBuffer } },
        { binding: 1, resource: { buffer: positionsBuffer } },
      ],
    });

    this.shadowObstacleBindGroup = this.device.createBindGroup({
      layout: this.shadowObstaclePipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.shadowUniformBuffer } }],
    });
  }

  // ===========================================================================
  // Obstacle Geometry Builder
  // ===========================================================================

  private buildObstacleGeometry(config: RaymarchConfig): { faceCount: number } {
    const hx = config.obstacleSize.x * 0.5;
    const hy = config.obstacleSize.y * 0.5;
    const hz = config.obstacleSize.z * 0.5;

    if (hx <= 0 || hy <= 0 || hz <= 0) {
      return { faceCount: 0 };
    }

    const cx = config.obstacleCentre.x;
    const cy = config.obstacleCentre.y;
    const cz = config.obstacleCentre.z;

    const color = config.obstacleColor ?? { r: 1, g: 0, b: 0 };
    const alpha = config.obstacleAlpha ?? 0.8;

    const degToRad = Math.PI / 180;
    const rx = config.obstacleRotation.x * degToRad;
    const ry = config.obstacleRotation.y * degToRad;
    const rz = config.obstacleRotation.z * degToRad;
    const cosX = Math.cos(rx), sinX = Math.sin(rx);
    const cosY = Math.cos(ry), sinY = Math.sin(ry);
    const cosZ = Math.cos(rz), sinZ = Math.sin(rz);

    const rotate = (
      lx: number,
      ly: number,
      lz: number
    ): [number, number, number] => {
      const y1 = ly * cosX - lz * sinX;
      const z1 = ly * sinX + lz * cosX;
      const x2 = lx * cosY + z1 * sinY;
      const z2 = -lx * sinY + z1 * cosY;
      const x3 = x2 * cosZ - y1 * sinZ;
      const y3 = x2 * sinZ + y1 * cosZ;
      return [x3 + cx, y3 + cy, z2 + cz];
    };

    const c = [
      rotate(-hx, -hy, -hz),
      rotate(+hx, -hy, -hz),
      rotate(+hx, +hy, -hz),
      rotate(-hx, +hy, -hz),
      rotate(-hx, -hy, +hz),
      rotate(+hx, -hy, +hz),
      rotate(+hx, +hy, +hz),
      rotate(-hx, +hy, +hz),
    ];

    const rotateDir = (
      lx: number,
      ly: number,
      lz: number
    ): [number, number, number] => {
      const y1 = ly * cosX - lz * sinX;
      const z1 = ly * sinX + lz * cosX;
      const x2 = lx * cosY + z1 * sinY;
      const z2 = -lx * sinY + z1 * cosY;
      const x3 = x2 * cosZ - y1 * sinZ;
      const y3 = x2 * sinZ + y1 * cosZ;
      return [x3, y3, z2];
    };

    const faceNormals: [number, number, number][] = [
      rotateDir(0, 0, -1),
      rotateDir(0, 0, +1),
      rotateDir(-1, 0, 0),
      rotateDir(+1, 0, 0),
      rotateDir(0, -1, 0),
      rotateDir(0, +1, 0),
    ];

    let offset = 0;

    const faceVert = (
      p: [number, number, number],
      n: [number, number, number]
    ) => {
      this.lineVertexData[offset++] = p[0];
      this.lineVertexData[offset++] = p[1];
      this.lineVertexData[offset++] = p[2];
      this.lineVertexData[offset++] = n[0];
      this.lineVertexData[offset++] = n[1];
      this.lineVertexData[offset++] = n[2];
      this.lineVertexData[offset++] = color.r;
      this.lineVertexData[offset++] = color.g;
      this.lineVertexData[offset++] = color.b;
      this.lineVertexData[offset++] = alpha;
    };

    const faces = [
      [0, 2, 1, 0, 3, 2],
      [4, 5, 6, 4, 6, 7],
      [0, 4, 7, 0, 7, 3],
      [1, 2, 6, 1, 6, 5],
      [0, 1, 5, 0, 5, 4],
      [3, 7, 6, 3, 6, 2],
    ];

    for (let fi = 0; fi < faces.length; fi++) {
      const n = faceNormals[fi];
      for (const idx of faces[fi]) {
        faceVert(c[idx], n);
      }
    }

    return { faceCount: 36 };
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
    config: RaymarchConfig,
    particleCount: number
  ): void {
    this.ensureOffscreenTexture(this.canvas.width, this.canvas.height);

    const basis = camera.basis;
    const pos = camera.position;

    const aspect = this.canvas.width / this.canvas.height;
    const fovY = Math.PI / 3; // 60° vertical field of view

    // --- RaymarchParams (128 bytes) ---
    // 0-3: viewPos, pad0
    this.uniformData[0] = pos.x;
    this.uniformData[1] = pos.y;
    this.uniformData[2] = pos.z;
    this.uniformData[3] = 0; // pad

    // 4-7: cameraRight, pad1
    this.uniformData[4] = basis.right.x;
    this.uniformData[5] = basis.right.y;
    this.uniformData[6] = basis.right.z;
    this.uniformData[7] = 0; // pad

    // 8-11: cameraUp, pad2
    this.uniformData[8] = basis.up.x;
    this.uniformData[9] = basis.up.y;
    this.uniformData[10] = basis.up.z;
    this.uniformData[11] = 0; // pad

    // 12-15: cameraForward, pad3
    this.uniformData[12] = basis.forward.x;
    this.uniformData[13] = basis.forward.y;
    this.uniformData[14] = basis.forward.z;
    this.uniformData[15] = 0; // pad

    // 16-19: boundsSize, densityOffset
    this.uniformData[16] = config.boundsSize.x;
    this.uniformData[17] = config.boundsSize.y;
    this.uniformData[18] = config.boundsSize.z;
    this.uniformData[19] = config.densityOffset;

    // 20-23: densityMultiplier, stepSize, lightStepSize, aspect
    this.uniformData[20] = config.densityMultiplier / 1000; // Scale down for shader
    this.uniformData[21] = config.stepSize;
    this.uniformData[22] = config.lightStepSize * (1.0 + config.shadowSoftness);
    this.uniformData[23] = aspect;

    // 24-27: fovY, maxSteps, indexOfRefraction, numRefractions
    this.uniformData[24] = fovY;
    this.uniformData[25] = config.maxSteps;
    this.uniformData[26] = config.indexOfRefraction;
    this.uniformData[27] = config.numRefractions;

    // 28-31: extinctionCoefficients, pad
    this.uniformData[28] = config.extinctionCoefficients.x;
    this.uniformData[29] = config.extinctionCoefficients.y;
    this.uniformData[30] = config.extinctionCoefficients.z;
    this.uniformData[31] = 0;

    // 32-35: fluidColor, pad
    this.uniformData[32] = config.fluidColor.r;
    this.uniformData[33] = config.fluidColor.g;
    this.uniformData[34] = config.fluidColor.b;
    this.uniformData[35] = 0;

    // Upload RaymarchParams to GPU
    this.device.queue.writeBuffer(this.uniformBuffer, 0, this.uniformData);

    // --- EnvironmentUniforms (240 bytes) ---
    const envData = new Float32Array(60);
    writeEnvironmentUniforms(envData, 0, config, config);
    this.device.queue.writeBuffer(this.envUniformBuffer, 0, envData);

    // -------------------------------------------------------------------------
    // Shadow Pass Calculations
    // -------------------------------------------------------------------------

    const bounds = config.boundsSize;
    const floor = config.floorSize;
    const sunDir = config.dirToSun;

    const lightDistance = Math.max(bounds.x + bounds.z, floor.x + floor.z);
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

    const shadowParticleRadius = Math.max(0.001, config.smoothingRadius);
    const shadowParticleRadiusNdc = shadowParticleRadius / orthoSize;

    const shadowUniforms = new Float32Array(20);
    shadowUniforms.set(lightViewProj);
    shadowUniforms[16] = config.shadowSoftness ?? 1.0;
    shadowUniforms[17] = shadowParticleRadiusNdc;
    this.device.queue.writeBuffer(this.shadowUniformBuffer, 0, shadowUniforms);

    const { faceCount } = this.buildObstacleGeometry(config);
    if (faceCount > 0) {
      this.device.queue.writeBuffer(
        this.lineVertexBuffer,
        0,
        this.lineVertexData.buffer,
        this.lineVertexData.byteOffset,
        faceCount * 10 * 4
      );
    }

    // -------------------------------------------------------------------------
    // Shadow Pass (Particles + Obstacle)
    // -------------------------------------------------------------------------

    const shadowPass = encoder.beginRenderPass({
      colorAttachments: [],
      depthStencilAttachment: {
        view: this.shadowTexture.createView(),
        depthClearValue: 1.0,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    });

    shadowPass.setPipeline(this.shadowParticlePipeline);
    shadowPass.setBindGroup(0, this.shadowParticleBindGroup);
    shadowPass.draw(6, particleCount, 0, 0);

    if (faceCount > 0) {
      shadowPass.setPipeline(this.shadowObstaclePipeline);
      shadowPass.setBindGroup(0, this.shadowObstacleBindGroup);
      shadowPass.setVertexBuffer(0, this.lineVertexBuffer, 0);
      shadowPass.draw(faceCount);
    }

    shadowPass.end();

    // -------------------------------------------------------------------------
    // Pass 1: Raymarch into half-res offscreen texture
    // -------------------------------------------------------------------------

    const raymarchPass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.offscreenTextureView,
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: { r: 0.03, g: 0.05, b: 0.08, a: 1 }, // Dark blue-gray background (overwritten by env)
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
