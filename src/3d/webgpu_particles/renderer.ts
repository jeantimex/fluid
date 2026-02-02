/**
 * =============================================================================
 * WebGPU Rendering for 3D Fluid Simulation
 * =============================================================================
 *
 * This module handles all GPU rendering operations for visualizing the
 * 3D fluid simulation. It manages render pipelines, depth buffering,
 * and the actual draw calls.
 *
 * ## Rendering Architecture
 *
 * ### 1. Particle Pipeline (Instanced Billboard Rendering)
 *
 * Particles are rendered as camera-facing quads (billboards) using a technique
 * called "vertex pulling" combined with indirect instanced rendering:
 *
 * ```
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │  PARTICLE RENDERING PIPELINE                                            │
 * ├─────────────────────────────────────────────────────────────────────────┤
 * │                                                                          │
 * │  1. Cull Shader (Compute)                                                │
 * │     └─► Tests each particle against view frustum                         │
 * │     └─► Builds compact list of visible particle indices                  │
 * │     └─► Atomically updates instanceCount in indirect draw buffer         │
 * │                                                                          │
 * │  2. Vertex Shader (per vertex, 6 vertices × visible particles)           │
 * │     └─► Looks up actual particle index from visibleIndices buffer        │
 * │     └─► Fetches position and velocity from storage buffers               │
 * │     └─► Generates billboard quad corners procedurally (no vertex buffer) │
 * │     └─► Applies perspective-correct billboard expansion                  │
 * │     └─► Maps velocity to color using gradient lookup table               │
 * │                                                                          │
 * │  3. Fragment Shader (per pixel)                                          │
 * │     └─► Discards pixels outside circle radius (circle impostor)          │
 * │     └─► Outputs velocity-based color                                     │
 * │                                                                          │
 * └─────────────────────────────────────────────────────────────────────────┘
 * ```
 *
 * ### 2. Line Pipeline (Wireframe Bounding Box)
 *
 * The bounding box is rendered as simple 3D lines using traditional vertex buffers.
 * This provides visual reference for the simulation boundaries.
 *
 * ## Performance Features
 *
 * - **Indirect Drawing**: The cull shader writes the instance count directly
 *   to the GPU, avoiding CPU-GPU synchronization for particle count.
 *
 * - **Vertex Pulling**: No vertex buffers needed for particles. The shader
 *   generates quad vertices procedurally, reducing memory bandwidth.
 *
 * - **Circle Impostors**: Instead of rendering spheres with many triangles,
 *   we render a single quad and discard fragments outside a circle in the
 *   pixel shader. This looks like a circle with much less geometry.
 *
 * @module renderer
 */

import particleShader from './shaders/particle3d.wgsl?raw';
import lineShader from './shaders/line3d.wgsl?raw';
import backgroundShader from './shaders/background.wgsl?raw';
import environmentShader from '../common/shaders/environment.wgsl?raw';
import type { SimulationBuffersLinear } from './simulation_buffers_linear.ts';
import type { ParticlesConfig } from './types.ts';
import { mat4Perspective, mat4Multiply } from './math_utils.ts';
import { buildGradientLut } from '../common/kernels.ts';
import { writeEnvironmentUniforms } from '../common/environment.ts';
import { preprocessShader } from '../common/shader_preprocessor.ts';

/**
 * Handles all rendering for the 3D fluid simulation.
 *
 * This class manages:
 * - Render pipeline creation and configuration
 * - Depth buffer management
 * - Uniform buffer updates
 * - Draw command submission
 */
export class Renderer {
  // ===========================================================================
  // WebGPU Resources
  // ===========================================================================

  /** Reference to GPU device */
  private device: GPUDevice;

  // ===========================================================================
  // Render Pipelines
  // ===========================================================================

  /** Pipeline for rendering particles as billboards. */
  private particlePipeline: GPURenderPipeline;

  /** Pipeline for rendering wireframe lines. */
  private linePipeline: GPURenderPipeline;

  /** Pipeline for rendering filled obstacle faces. */
  private facePipeline: GPURenderPipeline;

  /** Pipeline for rendering the environment background. */
  private backgroundPipeline: GPURenderPipeline;

  // ===========================================================================
  // GPU Buffers
  // ===========================================================================

  /** Uniform buffer for render settings. */
  private uniformBuffer: GPUBuffer;

  /** Storage buffer for velocity-to-color gradient lookup table. */
  private gradientBuffer: GPUBuffer;

  /** Uniform buffer for environment settings. */
  private envUniformBuffer: GPUBuffer;

  /** Uniform buffer for camera settings (for background shader). */
  private camUniformBuffer: GPUBuffer;

  // ===========================================================================
  // Bind Groups
  // ===========================================================================

  private particleBindGroup!: GPUBindGroup;
  private lineBindGroup: GPUBindGroup;
  private faceBindGroup: GPUBindGroup;
  private backgroundBindGroup!: GPUBindGroup;

  // ===========================================================================
  // Line Rendering Resources
  // ===========================================================================

  private lineVertexBuffer: GPUBuffer;
  private lineVertexData: Float32Array;

  // ===========================================================================
  // Depth Buffer
  // ===========================================================================

  private canvas: HTMLCanvasElement;
  private depthTexture!: GPUTexture;
  private depthWidth = 0;
  private depthHeight = 0;

  // ===========================================================================
  // Density Shadow
  // ===========================================================================

  private densitySampler: GPUSampler;
  private densityUniformBuffer: GPUBuffer;

  // ===========================================================================
  // Constructor
  // ===========================================================================

  constructor(
    device: GPUDevice,
    canvas: HTMLCanvasElement,
    format: GPUTextureFormat,
    config: ParticlesConfig
  ) {
    this.device = device;
    this.canvas = canvas;

    // -------------------------------------------------------------------------
    // Create Uniform Buffers
    // -------------------------------------------------------------------------

    // Render uniforms: 96 bytes
    this.uniformBuffer = device.createBuffer({
      size: 96,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Environment uniforms: 240 bytes (60 floats)
    this.envUniformBuffer = device.createBuffer({
      size: 240,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Camera uniforms for background: 48 bytes (vec3 pos, vec3 fwd, vec3 right, vec3 up, fov, aspect)
    // Actually struct FragmentUniforms has 4 vec4s = 64 bytes
    this.camUniformBuffer = device.createBuffer({
      size: 80, // Updated to 80 bytes
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Density shadow uniforms for background: 64 bytes (aligned)
    this.densityUniformBuffer = device.createBuffer({
      size: 64,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // -------------------------------------------------------------------------
    // Create Gradient Buffer
    // -------------------------------------------------------------------------

    const gradientLut = buildGradientLut(
      config.colorKeys,
      config.gradientResolution
    );

    const gradientData = new Float32Array(config.gradientResolution * 4);
    for (let i = 0; i < gradientLut.length; i++) {
      gradientData[i * 4] = gradientLut[i].r;
      gradientData[i * 4 + 1] = gradientLut[i].g;
      gradientData[i * 4 + 2] = gradientLut[i].b;
      gradientData[i * 4 + 3] = 1;
    }

    this.gradientBuffer = device.createBuffer({
      size: gradientData.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Float32Array(this.gradientBuffer.getMappedRange()).set(gradientData);
    this.gradientBuffer.unmap();

    // -------------------------------------------------------------------------
    // Create Particle Render Pipeline
    // -------------------------------------------------------------------------

    const particleModule = device.createShaderModule({ code: particleShader });

    this.particlePipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: particleModule,
        entryPoint: 'vs_main',
      },
      fragment: {
        module: particleModule,
        entryPoint: 'fs_main',
        targets: [{ format }],
      },
      primitive: {
        topology: 'triangle-list',
      },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: true,
        depthCompare: 'less',
      },
    });

    // -------------------------------------------------------------------------
    // Create Line Render Pipeline
    // -------------------------------------------------------------------------

    const lineModule = device.createShaderModule({ code: lineShader });

    this.linePipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: lineModule,
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
        module: lineModule,
        entryPoint: 'fs_main',
        targets: [
          {
            format,
            blend: {
              color: {
                srcFactor: 'src-alpha',
                dstFactor: 'one-minus-src-alpha',
                operation: 'add',
              },
              alpha: {
                srcFactor: 'one',
                dstFactor: 'one-minus-src-alpha',
                operation: 'add',
              },
            },
          },
        ],
      },
      primitive: { topology: 'line-list' },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: true,
        depthCompare: 'less',
      },
    });

    // -------------------------------------------------------------------------
    // Create Face Render Pipeline
    // -------------------------------------------------------------------------

    this.facePipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: lineModule,
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
        module: lineModule,
        entryPoint: 'fs_main',
        targets: [
          {
            format,
            blend: {
              color: {
                srcFactor: 'src-alpha',
                dstFactor: 'one-minus-src-alpha',
                operation: 'add',
              },
              alpha: {
                srcFactor: 'one',
                dstFactor: 'one-minus-src-alpha',
                operation: 'add',
              },
            },
          },
        ],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: false,
        depthCompare: 'less',
      },
    });

    // -------------------------------------------------------------------------
    // Create Background Render Pipeline
    // -------------------------------------------------------------------------

    const bgCode = preprocessShader(backgroundShader, {
      '../../common/shaders/environment.wgsl': environmentShader,
    });
    const bgModule = device.createShaderModule({ code: bgCode });

    this.backgroundPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: bgModule,
        entryPoint: 'vs_main',
      },
      fragment: {
        module: bgModule,
        entryPoint: 'fs_main',
        targets: [{ format }],
      },
      primitive: { topology: 'triangle-list' },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: false,
        depthCompare: 'always',
      },
    });

    // -------------------------------------------------------------------------
    // Create Vertex Buffer (faces + edges)
    // -------------------------------------------------------------------------

    this.lineVertexData = new Float32Array(72 * 7);
    this.lineVertexBuffer = device.createBuffer({
      size: this.lineVertexData.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });

    // -------------------------------------------------------------------------
    // Create Static Bind Groups
    // -------------------------------------------------------------------------

    this.lineBindGroup = device.createBindGroup({
      layout: this.linePipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
    });

    this.faceBindGroup = device.createBindGroup({
      layout: this.facePipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
    });

    this.densitySampler = this.device.createSampler({
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
      addressModeW: 'clamp-to-edge',
      magFilter: 'linear',
      minFilter: 'linear',
    });

    this.resize();
  }

  // ===========================================================================
  // Resize Handling
  // ===========================================================================

  resize() {
    const width = this.canvas.width;
    const height = this.canvas.height;
    if (
      this.depthTexture &&
      width === this.depthWidth &&
      height === this.depthHeight
    ) {
      return;
    }

    if (this.depthTexture) this.depthTexture.destroy();

    this.depthTexture = this.device.createTexture({
      size: [width, height],
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.depthWidth = width;
    this.depthHeight = height;
  }

  // ===========================================================================
  // Bind Group Management
  // ===========================================================================

  createBindGroup(
    buffers: SimulationBuffersLinear,
    densityTextureView: GPUTextureView
  ) {
    this.particleBindGroup = this.device.createBindGroup({
      layout: this.particlePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.positions } },
        { binding: 1, resource: { buffer: buffers.velocities } },
        { binding: 2, resource: { buffer: this.uniformBuffer } },
        { binding: 3, resource: { buffer: this.gradientBuffer } },
        { binding: 4, resource: { buffer: buffers.visibleIndices } },
      ],
    });

    this.backgroundBindGroup = this.device.createBindGroup({
      layout: this.backgroundPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.envUniformBuffer } },
        { binding: 1, resource: { buffer: this.camUniformBuffer } },
        { binding: 2, resource: densityTextureView },
        { binding: 3, resource: this.densitySampler },
        { binding: 4, resource: { buffer: this.densityUniformBuffer } },
      ],
    });
  }

  // ===========================================================================
  // Obstacle Geometry Builder
  // ===========================================================================

  private buildObstacleGeometry(config: ParticlesConfig): {
    faceCount: number;
    edgeCount: number;
  } {
    const hx = config.obstacleSize.x * 0.5;
    const hy = config.obstacleSize.y * 0.5;
    const hz = config.obstacleSize.z * 0.5;

    if (hx <= 0 || hy <= 0 || hz <= 0) {
      return { faceCount: 0, edgeCount: 0 };
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

    let offset = 0;
    const vert = (p: [number, number, number]) => {
      this.lineVertexData[offset++] = p[0];
      this.lineVertexData[offset++] = p[1];
      this.lineVertexData[offset++] = p[2];
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

    for (const face of faces) {
      for (const idx of face) {
        vert(c[idx]);
      }
    }

    const faceCount = 36;

    const edges = [
      [0, 1], [1, 2], [2, 3], [3, 0],
      [4, 5], [5, 6], [6, 7], [7, 4],
      [0, 4], [1, 5], [2, 6], [3, 7],
    ];

    for (const [a, b] of edges) {
      vert(c[a]);
      vert(c[b]);
    }

    const edgeCount = 24;

    return { faceCount, edgeCount };
  }

  // ===========================================================================
  // Main Render Function
  // ===========================================================================

  /**
   * Renders the complete scene (particles + obstacle wireframe).
   *
   * @param encoder - Command encoder for recording render commands
   * @param view - Texture view for the current frame's render target
   * @param config - Simulation configuration
   * @param buffers - Simulation buffers (for indirect draw buffer)
   * @param viewMatrix - Camera view matrix
   */
  render(
    encoder: GPUCommandEncoder,
    view: GPUTextureView,
    config: ParticlesConfig,
    buffers: SimulationBuffersLinear,
    viewMatrix: Float32Array
  ) {
    // -------------------------------------------------------------------------
    // Update Uniforms
    // -------------------------------------------------------------------------

    // Calculate view-projection matrix
    const aspect = this.canvas.width / this.canvas.height;
    const projection = mat4Perspective(Math.PI / 3, aspect, 0.1, 100.0);
    const viewProj = mat4Multiply(projection, viewMatrix);

    // Scale particle radius by device pixel ratio
    // Config radius is in CSS pixels, we need device pixels for rendering
    const dpr = window.devicePixelRatio || 1;

    // Pack uniform data
    const uniforms = new Float32Array(24);
    uniforms.set(viewProj); // [0-15]: viewProjection matrix
    uniforms[16] = this.canvas.width; // canvasSize.x
    uniforms[17] = this.canvas.height; // canvasSize.y
    uniforms[18] = config.particleRadius * dpr; // particleRadius in device pixels
    uniforms[19] = config.velocityDisplayMax; // For velocity → color mapping
    uniforms[20] = config.sceneExposure;

    this.device.queue.writeBuffer(this.uniformBuffer, 0, uniforms);

    // Update Environment Uniforms
    const envData = new Float32Array(60);
    writeEnvironmentUniforms(envData, 0, config, config);
    this.device.queue.writeBuffer(this.envUniformBuffer, 0, envData);

    // Update Camera Uniforms for Background
    const camRight = { x: viewMatrix[0], y: viewMatrix[4], z: viewMatrix[8] };
    const camUp    = { x: viewMatrix[1], y: viewMatrix[5], z: viewMatrix[9] };
    const camBack  = { x: viewMatrix[2], y: viewMatrix[6], z: viewMatrix[10] };
    const camFwd   = { x: -camBack.x, y: -camBack.y, z: -camBack.z };
    
    // Extract camera position from view matrix translation
    const tx = viewMatrix[12];
    const ty = viewMatrix[13];
    const tz = viewMatrix[14];
    
    const eyeX = -(camRight.x * tx + camUp.x * ty + camBack.x * tz);
    const eyeY = -(camRight.y * tx + camUp.y * ty + camBack.y * tz);
    const eyeZ = -(camRight.z * tx + camUp.z * ty + camBack.z * tz);

    const camFullData = new Float32Array(20);
    // cameraPos (0-2)
    camFullData[0] = eyeX; camFullData[1] = eyeY; camFullData[2] = eyeZ; camFullData[3] = 0;
    // cameraForward (4-6)
    camFullData[4] = camFwd.x; camFullData[5] = camFwd.y; camFullData[6] = camFwd.z; camFullData[7] = 0;
    // cameraRight (8-10)
    camFullData[8] = camRight.x; camFullData[9] = camRight.y; camFullData[10] = camRight.z; camFullData[11] = 0;
    // cameraUp (12-14)
    camFullData[12] = camUp.x; camFullData[13] = camUp.y; camFullData[14] = camUp.z; camFullData[15] = 0;
    // fovY, aspect
    camFullData[16] = Math.PI / 3;
    camFullData[17] = aspect;
    this.device.queue.writeBuffer(this.camUniformBuffer, 0, camFullData);

    // -------------------------------------------------------------------------
    // Density Shadow Params (volume-based)
    // -------------------------------------------------------------------------

    const densityUniforms = new Float32Array(16);
    densityUniforms[0] = config.boundsSize.x;
    densityUniforms[1] = config.boundsSize.y;
    densityUniforms[2] = config.boundsSize.z;
    densityUniforms[3] = config.densityOffset;
    densityUniforms[4] = config.densityMultiplier;
    densityUniforms[5] = config.lightStepSize;
    densityUniforms[6] = config.shadowSoftness;
    densityUniforms[7] = 0.0;
    densityUniforms[8] = config.extinctionCoefficients.x;
    densityUniforms[9] = config.extinctionCoefficients.y;
    densityUniforms[10] = config.extinctionCoefficients.z;
    densityUniforms[11] = 0.0;
    this.device.queue.writeBuffer(this.densityUniformBuffer, 0, densityUniforms);

    // -------------------------------------------------------------------------
    // Build & Upload Obstacle Geometry (faces + edges)
    // -------------------------------------------------------------------------

    const { faceCount, edgeCount } = this.buildObstacleGeometry(config);
    const totalVerts = faceCount + edgeCount;
    if (totalVerts > 0) {
      this.device.queue.writeBuffer(
        this.lineVertexBuffer,
        0,
        this.lineVertexData.buffer,
        this.lineVertexData.byteOffset,
        totalVerts * 7 * 4 // bytes
      );
    }

    // -------------------------------------------------------------------------
    // Begin Render Pass
    // -------------------------------------------------------------------------

    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view,
          clearValue: { r: 0.05, g: 0.05, b: 0.08, a: 1 }, // Irrelevant as we draw background
          loadOp: 'clear', // Clear for safety, though background will overdraw
          storeOp: 'store',
        },
      ],
      depthStencilAttachment: {
        view: this.depthTexture.createView(),
        depthClearValue: 1.0, // Far plane
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    });

    // 1. Draw Background
    pass.setPipeline(this.backgroundPipeline);
    pass.setBindGroup(0, this.backgroundBindGroup);
    pass.draw(3, 1, 0, 0);

    // -------------------------------------------------------------------------
    // Draw Particles (Indirect Instanced)
    // -------------------------------------------------------------------------

    pass.setPipeline(this.particlePipeline);
    pass.setBindGroup(0, this.particleBindGroup);

    // Use indirect draw - the instance count was populated by the cull shader
    // This avoids CPU-GPU synchronization for determining visible particle count
    pass.drawIndirect(buffers.indirectDraw, 0);

    // -------------------------------------------------------------------------
    // Draw Obstacle (filled faces, then wireframe edges on top)
    // -------------------------------------------------------------------------

    if (faceCount > 0) {
      pass.setPipeline(this.facePipeline);
      pass.setBindGroup(0, this.faceBindGroup);
      pass.setVertexBuffer(0, this.lineVertexBuffer, 0);
      pass.draw(faceCount);
    }

    if (edgeCount > 0) {
      pass.setPipeline(this.linePipeline);
      pass.setBindGroup(0, this.lineBindGroup);
      pass.setVertexBuffer(0, this.lineVertexBuffer, faceCount * 28);
      pass.draw(edgeCount);
    }

    pass.end();
  }
}
