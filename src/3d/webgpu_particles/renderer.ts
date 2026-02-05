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
import obstacleFaceShader from './shaders/obstacle_face.wgsl?raw';
import shadowShader from './shaders/shadow.wgsl?raw';
import backgroundShader from './shaders/background.wgsl?raw';
import wireframeShader from './shaders/wireframe.wgsl?raw';
import environmentShader from '../common/shaders/environment.wgsl?raw';
import type { SimulationBuffersLinear } from './simulation_buffers_linear.ts';
import type { ParticlesConfig } from './types.ts';
import {
  mat4Perspective,
  mat4Multiply,
  mat4LookAt,
  mat4Ortho,
} from './math_utils.ts';
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

  /** Pipeline for rendering filled obstacle faces. */
  private facePipeline: GPURenderPipeline;

  /** Pipeline for rendering the environment background. */
  private backgroundPipeline: GPURenderPipeline;

  /** Pipeline for particle shadow map rendering. */
  private shadowParticlePipeline: GPURenderPipeline;

  /** Pipeline for obstacle shadow map rendering. */
  private shadowObstaclePipeline: GPURenderPipeline;

  /** Pipeline for rendering bounds wireframe. */
  private wireframePipeline: GPURenderPipeline;

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

  /** Uniform buffer for shadow map settings. */
  private shadowUniformBuffer: GPUBuffer;

  // ===========================================================================
  // Bind Groups
  // ===========================================================================

  private particleBindGroup!: GPUBindGroup;
  private faceBindGroup: GPUBindGroup;
  private backgroundBindGroup!: GPUBindGroup;
  private shadowParticleBindGroup!: GPUBindGroup;
  private shadowObstacleBindGroup!: GPUBindGroup;
  private wireframeBindGroup: GPUBindGroup;

  // ===========================================================================
  // Line Rendering Resources
  // ===========================================================================

  private lineVertexBuffer: GPUBuffer;
  private lineVertexData: Float32Array;

  // ===========================================================================
  // Wireframe Rendering Resources
  // ===========================================================================

  private wireframeVertexBuffer: GPUBuffer;
  private wireframeVertexData: Float32Array;
  private wireframeUniformBuffer: GPUBuffer;

  // ===========================================================================
  // Depth Buffer
  // ===========================================================================

  private canvas: HTMLCanvasElement;
  private depthTexture!: GPUTexture;
  private depthWidth = 0;
  private depthHeight = 0;

  // ===========================================================================
  // Shadow Map
  // ===========================================================================

  private shadowTexture!: GPUTexture;
  private shadowMapSize = 2048;
  private shadowSampler: GPUSampler;

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

    // Render uniforms: 112 bytes
    this.uniformBuffer = device.createBuffer({
      size: 112,
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

    // Shadow uniforms: lightViewProjection (64) + softness + particleRadius + padding = 80 bytes (round to 96)
    this.shadowUniformBuffer = device.createBuffer({
      size: 96,
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
    // Create Face Render Pipeline
    // -------------------------------------------------------------------------

    const faceModule = device.createShaderModule({ code: obstacleFaceShader });
    this.facePipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: faceModule,
        entryPoint: 'vs_main',
        buffers: [
          {
            arrayStride: 40,
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x3' }, // pos
              { shaderLocation: 1, offset: 12, format: 'float32x3' }, // normal
              { shaderLocation: 2, offset: 24, format: 'float32x4' }, // color
            ],
          },
        ],
      },
      fragment: {
        module: faceModule,
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
      primitive: { topology: 'triangle-list', cullMode: 'back' },
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
    // Create Shadow Render Pipelines
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

    // -------------------------------------------------------------------------
    // Create Wireframe Render Pipeline
    // -------------------------------------------------------------------------

    const wireframeModule = device.createShaderModule({ code: wireframeShader });

    this.wireframePipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: wireframeModule,
        entryPoint: 'vs_main',
        buffers: [
          {
            arrayStride: 28, // 3 floats pos + 4 floats color = 7 floats = 28 bytes
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x3' }, // position
              { shaderLocation: 1, offset: 12, format: 'float32x4' }, // color
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

    // Wireframe uniform buffer (just viewProjection matrix = 64 bytes)
    this.wireframeUniformBuffer = device.createBuffer({
      size: 64,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Wireframe vertex buffer: 12 edges × 2 vertices × 7 floats = 168 floats
    this.wireframeVertexData = new Float32Array(168);
    this.wireframeVertexBuffer = device.createBuffer({
      size: this.wireframeVertexData.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });

    // -------------------------------------------------------------------------
    // Create Vertex Buffer (faces)
    // -------------------------------------------------------------------------

    // Allocate for face vertices (36 × 10 floats)
    this.lineVertexData = new Float32Array(360);
    this.lineVertexBuffer = device.createBuffer({
      size: this.lineVertexData.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });

    // -------------------------------------------------------------------------
    // Create Shadow Resources
    // -------------------------------------------------------------------------

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

    // -------------------------------------------------------------------------
    // Create Static Bind Groups
    // -------------------------------------------------------------------------

    this.faceBindGroup = device.createBindGroup({
      layout: this.facePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: this.shadowTexture.createView() },
        { binding: 2, resource: this.shadowSampler },
        { binding: 3, resource: { buffer: this.shadowUniformBuffer } },
      ],
    });

    this.shadowObstacleBindGroup = device.createBindGroup({
      layout: this.shadowObstaclePipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.shadowUniformBuffer } }],
    });

    this.wireframeBindGroup = device.createBindGroup({
      layout: this.wireframePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.wireframeUniformBuffer } },
      ],
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
        { binding: 5, resource: this.shadowTexture.createView() },
        { binding: 6, resource: this.shadowSampler },
        { binding: 7, resource: { buffer: this.shadowUniformBuffer } },
      ],
    });

    this.shadowParticleBindGroup = this.device.createBindGroup({
      layout: this.shadowParticlePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.shadowUniformBuffer } },
        { binding: 1, resource: { buffer: buffers.positions } },
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
  } {
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

    const faceCount = 36;

    return { faceCount };
  }

  // ===========================================================================
  // Bounds Wireframe Geometry Builder
  // ===========================================================================

  /**
   * Builds wireframe geometry for the simulation bounds.
   * Creates 12 edges (lines) representing the bounding box.
   */
  private buildBoundsWireframe(config: ParticlesConfig): number {
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
      [0, 1], [1, 5], [5, 4], [4, 0],
      // Top face edges
      [3, 2], [2, 6], [6, 7], [7, 3],
      // Vertical edges
      [0, 3], [1, 2], [5, 6], [4, 7],
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
    const uniforms = new Float32Array(28);
    uniforms.set(viewProj); // [0-15]: viewProjection matrix
    uniforms[16] = this.canvas.width; // canvasSize.x
    uniforms[17] = this.canvas.height; // canvasSize.y
    uniforms[18] = config.particleRadius * dpr; // particleRadius in device pixels
    uniforms[19] = config.velocityDisplayMax; // For velocity → color mapping
    uniforms[20] = config.sceneExposure;
    uniforms[21] = config.floorAmbient;
    uniforms[22] = config.sunBrightness;
    uniforms[23] = 0.0;
    uniforms[24] = config.dirToSun.x;
    uniforms[25] = config.dirToSun.y;
    uniforms[26] = config.dirToSun.z;
    uniforms[27] = 0.0;

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
    const size = config.boundsSize;
    const hx = size.x * 0.5;
    const hz = size.z * 0.5;
    const minY = -5.0; // Fixed bottom

    // minBounds
    densityUniforms[0] = -hx;
    densityUniforms[1] = minY;
    densityUniforms[2] = -hz;
    densityUniforms[3] = 0.0; // pad

    // maxBounds
    densityUniforms[4] = hx;
    densityUniforms[5] = minY + size.y;
    densityUniforms[6] = hz;
    densityUniforms[7] = 0.0; // pad

    densityUniforms[8] = config.densityOffset;
    densityUniforms[9] = config.densityMultiplier;
    densityUniforms[10] = config.lightStepSize;
    densityUniforms[11] = config.shadowSoftness;
    densityUniforms[12] = config.extinctionCoefficients.x;
    densityUniforms[13] = config.extinctionCoefficients.y;
    densityUniforms[14] = config.extinctionCoefficients.z;
    densityUniforms[15] = 0.0;
    this.device.queue.writeBuffer(this.densityUniformBuffer, 0, densityUniforms);

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

    // -------------------------------------------------------------------------
    // Build & Upload Obstacle Geometry (faces)
    // -------------------------------------------------------------------------

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
    // Build & Upload Bounds Wireframe Geometry
    // -------------------------------------------------------------------------

    let wireframeVertexCount = 0;
    if (config.showBoundsWireframe) {
      wireframeVertexCount = this.buildBoundsWireframe(config);
      this.device.queue.writeBuffer(
        this.wireframeVertexBuffer,
        0,
        this.wireframeVertexData.buffer,
        this.wireframeVertexData.byteOffset,
        wireframeVertexCount * 7 * 4
      );
      // Update wireframe uniform buffer with viewProjection
      this.device.queue.writeBuffer(
        this.wireframeUniformBuffer,
        0,
        viewProj.buffer,
        viewProj.byteOffset,
        viewProj.byteLength
      );
    }

    // -------------------------------------------------------------------------
    // Shadow Pass
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
    shadowPass.draw(6, buffers.particleCount, 0, 0);

    if (faceCount > 0) {
      shadowPass.setPipeline(this.shadowObstaclePipeline);
      shadowPass.setBindGroup(0, this.shadowObstacleBindGroup);
      shadowPass.setVertexBuffer(0, this.lineVertexBuffer, 0);
      shadowPass.draw(faceCount);
    }

    shadowPass.end();

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

    // -------------------------------------------------------------------------
    // Draw Bounds Wireframe
    // -------------------------------------------------------------------------

    if (config.showBoundsWireframe && wireframeVertexCount > 0) {
      pass.setPipeline(this.wireframePipeline);
      pass.setBindGroup(0, this.wireframeBindGroup);
      pass.setVertexBuffer(0, this.wireframeVertexBuffer, 0);
      pass.draw(wireframeVertexCount);
    }

    pass.end();
  }
}
