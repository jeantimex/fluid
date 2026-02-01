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
import type { SimulationBuffersLinear } from './simulation_buffers_linear.ts';
import type { ParticlesConfig } from './types.ts';
import { mat4Perspective, mat4Multiply } from './math_utils.ts';
import { buildGradientLut } from '../common/kernels.ts';

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

  /**
   * Pipeline for rendering particles as billboards.
   *
   * Configuration:
   * - Vertex: Procedural quad generation (6 vertices per instance)
   * - Fragment: Circle impostor with velocity-based coloring
   * - Topology: triangle-list
   * - Depth: enabled, less-than comparison
   */
  private particlePipeline: GPURenderPipeline;

  /**
   * Pipeline for rendering wireframe lines.
   *
   * Configuration:
   * - Vertex: Position + color from vertex buffer
   * - Fragment: Pass-through color
   * - Topology: line-list
   * - Depth: enabled for proper occlusion
   */
  private linePipeline: GPURenderPipeline;

  /**
   * Pipeline for rendering filled obstacle faces.
   *
   * Configuration:
   * - Vertex: Position + color from vertex buffer (same shader as lines)
   * - Fragment: Pass-through color with alpha blending
   * - Topology: triangle-list
   * - Depth: read-only (no write) so particles behind show through
   * - Cull: none (both sides visible for transparency)
   */
  private facePipeline: GPURenderPipeline;

  // ===========================================================================
  // GPU Buffers
  // ===========================================================================

  /**
   * Uniform buffer for render settings.
   *
   * Layout (96 bytes):
   * - viewProjection: mat4x4<f32> (64 bytes)
   * - canvasSize: vec2<f32> (8 bytes)
   * - particleRadius: f32 (4 bytes)
   * - velocityDisplayMax: f32 (4 bytes)
   * - padding (16 bytes)
   */
  private uniformBuffer: GPUBuffer;

  /**
   * Storage buffer for velocity-to-color gradient lookup table.
   *
   * Contains pre-computed colors at regular intervals.
   * The shader samples this table based on particle speed.
   *
   * Size: gradientResolution * 16 bytes (vec4<f32> per entry)
   */
  private gradientBuffer: GPUBuffer;

  // ===========================================================================
  // Bind Groups
  // ===========================================================================

  /**
   * Bind group for particle rendering.
   * Recreated when simulation buffers change (e.g., reset).
   *
   * Bindings:
   * - 0: positions (storage, read)
   * - 1: velocities (storage, read)
   * - 2: uniforms (uniform)
   * - 3: gradient (storage, read)
   * - 4: visibleIndices (storage, read)
   */
  private particleBindGroup!: GPUBindGroup;

  /**
   * Bind group for line rendering.
   * Static, only contains uniform buffer.
   */
  private lineBindGroup: GPUBindGroup;

  /**
   * Bind group for face rendering.
   * Static, only contains uniform buffer.
   */
  private faceBindGroup: GPUBindGroup;

  // ===========================================================================
  // Line Rendering Resources
  // ===========================================================================

  /**
   * Vertex buffer for line rendering.
   *
   * Layout per vertex (28 bytes):
   * - position: vec3<f32> (12 bytes)
   * - color: vec4<f32> (16 bytes)
   */
  private lineVertexBuffer: GPUBuffer;

  /**
   * CPU-side vertex data for obstacle faces and wireframe edges.
   * Reused each frame to avoid allocation.
   *
   * Capacity: 72 vertices × 7 floats = 504 floats
   * (36 face vertices + 24 edge vertices + headroom)
   */
  private lineVertexData: Float32Array;

  // ===========================================================================
  // Depth Buffer
  // ===========================================================================

  /** Reference to canvas for size queries */
  private canvas: HTMLCanvasElement;

  /**
   * Depth texture for z-buffering.
   * Recreated on canvas resize.
   */
  private depthTexture!: GPUTexture;
  private depthWidth = 0;
  private depthHeight = 0;

  // ===========================================================================
  // Constructor
  // ===========================================================================

  /**
   * Creates the renderer with all necessary pipelines and resources.
   *
   * @param device - WebGPU device
   * @param canvas - Canvas element for size reference
   * @param format - Preferred texture format for swap chain
   * @param config - Simulation configuration for gradient colors
   */
  constructor(
    device: GPUDevice,
    canvas: HTMLCanvasElement,
    format: GPUTextureFormat,
    config: ParticlesConfig
  ) {
    this.device = device;
    this.canvas = canvas;

    // -------------------------------------------------------------------------
    // Create Uniform Buffer
    // -------------------------------------------------------------------------

    // Size: 96 bytes for viewProjection (64) + canvasSize (8) + radius (4) + velocityMax (4) + padding (16)
    this.uniformBuffer = device.createBuffer({
      size: 96,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // -------------------------------------------------------------------------
    // Create Gradient Buffer
    // -------------------------------------------------------------------------
    // Build a lookup table from the color gradient configuration.
    // This allows fast color lookup in the shader without complex calculations.

    const gradientLut = buildGradientLut(
      config.colorKeys,
      config.gradientResolution
    );

    // Convert to vec4<f32> format (RGBA with alpha = 1)
    const gradientData = new Float32Array(config.gradientResolution * 4);
    for (let i = 0; i < gradientLut.length; i++) {
      gradientData[i * 4] = gradientLut[i].r;
      gradientData[i * 4 + 1] = gradientLut[i].g;
      gradientData[i * 4 + 2] = gradientLut[i].b;
      gradientData[i * 4 + 3] = 1; // Alpha
    }

    // Create buffer with mapped-at-creation for efficient upload
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
        // No vertex buffers - we use vertex pulling from storage buffers
      },
      fragment: {
        module: particleModule,
        entryPoint: 'fs_main',
        targets: [{ format }],
      },
      primitive: {
        topology: 'triangle-list', // 2 triangles (6 vertices) per particle
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
            // Vertex buffer layout: pos (vec3) + color (vec4)
            arrayStride: 28, // 3 × 4 + 4 × 4 = 28 bytes
            attributes: [
              {
                shaderLocation: 0, // @location(0) pos
                offset: 0,
                format: 'float32x3',
              },
              {
                shaderLocation: 1, // @location(1) color
                offset: 12, // After 3 floats for position
                format: 'float32x4',
              },
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
            // Alpha blending for semi-transparent lines
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
      primitive: {
        topology: 'line-list', // Each pair of vertices is a line segment
      },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: true,
        depthCompare: 'less',
      },
    });

    // -------------------------------------------------------------------------
    // Create Face Render Pipeline (filled obstacle faces)
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
      primitive: {
        topology: 'triangle-list',
        cullMode: 'none',
      },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: false,
        depthCompare: 'less',
      },
    });

    // -------------------------------------------------------------------------
    // Create Vertex Buffer (faces + edges)
    // -------------------------------------------------------------------------

    // Allocate for 72 vertices (36 face + 24 edge + headroom)
    this.lineVertexData = new Float32Array(72 * 7); // 7 floats per vertex

    this.lineVertexBuffer = device.createBuffer({
      size: this.lineVertexData.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });

    // -------------------------------------------------------------------------
    // Create Bind Groups (line + face)
    // -------------------------------------------------------------------------

    this.lineBindGroup = device.createBindGroup({
      layout: this.linePipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
    });

    this.faceBindGroup = device.createBindGroup({
      layout: this.facePipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
    });

    // -------------------------------------------------------------------------
    // Create Initial Depth Texture
    // -------------------------------------------------------------------------

    this.resize();
  }

  // ===========================================================================
  // Resize Handling
  // ===========================================================================

  /**
   * Recreates the depth texture when canvas size changes.
   *
   * Called at the start of each frame to handle window resize.
   * The depth texture must match the canvas size exactly.
   */
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

    // Destroy old depth texture if it exists
    if (this.depthTexture) this.depthTexture.destroy();

    // Create new depth texture matching canvas size
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

  /**
   * Creates the particle bind group with simulation buffers.
   *
   * Must be called whenever simulation buffers are recreated (e.g., on reset).
   *
   * @param buffers - The simulation buffers containing particle data
   */
  createBindGroup(buffers: SimulationBuffersLinear) {
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
  }

  // ===========================================================================
  // Obstacle Geometry Builder
  // ===========================================================================

  /**
   * Builds obstacle box geometry (filled faces + wireframe edges).
   *
   * Writes face triangle vertices first (36 vertices), then edge line
   * vertices (24 vertices) into lineVertexData. The rotation order matches
   * the integrate shader: rotateX → rotateY → rotateZ.
   *
   * @param config - Simulation configuration with obstacle parameters
   * @returns Face and edge vertex counts (both 0 if obstacle is disabled)
   */
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

    // Rotation (degrees → radians), matching integrate.wgsl rotateLocalToWorld
    const degToRad = Math.PI / 180;
    const rx = config.obstacleRotation.x * degToRad;
    const ry = config.obstacleRotation.y * degToRad;
    const rz = config.obstacleRotation.z * degToRad;
    const cosX = Math.cos(rx),
      sinX = Math.sin(rx);
    const cosY = Math.cos(ry),
      sinY = Math.sin(ry);
    const cosZ = Math.cos(rz),
      sinZ = Math.sin(rz);

    // rotateLocalToWorld: rotateX → rotateY → rotateZ, then translate
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

    // 8 corners of the box in local space → world space
    const c = [
      rotate(-hx, -hy, -hz), // 0
      rotate(+hx, -hy, -hz), // 1
      rotate(+hx, +hy, -hz), // 2
      rotate(-hx, +hy, -hz), // 3
      rotate(-hx, -hy, +hz), // 4
      rotate(+hx, -hy, +hz), // 5
      rotate(+hx, +hy, +hz), // 6
      rotate(-hx, +hy, +hz), // 7
    ];

    // Helper: write one vertex (position + color) at current offset
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

    // --- Filled faces: 6 faces × 2 triangles × 3 vertices = 36 vertices ---
    // Each face as two triangles (winding consistent for double-sided rendering)
    const faces = [
      [0, 2, 1, 0, 3, 2], // -Z back
      [4, 5, 6, 4, 6, 7], // +Z front
      [0, 4, 7, 0, 7, 3], // -X left
      [1, 2, 6, 1, 6, 5], // +X right
      [0, 1, 5, 0, 5, 4], // -Y bottom
      [3, 7, 6, 3, 6, 2], // +Y top
    ];

    for (const face of faces) {
      for (const idx of face) {
        vert(c[idx]);
      }
    }

    const faceCount = 36;

    // --- Wireframe edges: 12 edges × 2 vertices = 24 vertices ---
    const edges = [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0], // back face (-z)
      [4, 5],
      [5, 6],
      [6, 7],
      [7, 4], // front face (+z)
      [0, 4],
      [1, 5],
      [2, 6],
      [3, 7], // connecting edges
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

    this.device.queue.writeBuffer(this.uniformBuffer, 0, uniforms);

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
          clearValue: { r: 0.05, g: 0.05, b: 0.08, a: 1 }, // Dark background
          loadOp: 'clear',
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
