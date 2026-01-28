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
import type { SimulationBuffers } from './simulation_buffers.ts';
import type { SimConfig } from '../common/types.ts';
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
   * CPU-side line vertex data.
   * Reused each frame to avoid allocation.
   *
   * Capacity: 48 vertices × 7 floats = 336 floats
   * (Enough for a 3D box: 12 edges × 2 vertices × 2 for safety)
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
    config: SimConfig
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
    // Create Line Vertex Buffer
    // -------------------------------------------------------------------------

    // Allocate for 48 vertices (enough for box edges plus some extra)
    this.lineVertexData = new Float32Array(48 * 7); // 7 floats per vertex

    this.lineVertexBuffer = device.createBuffer({
      size: this.lineVertexData.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });

    // -------------------------------------------------------------------------
    // Create Line Bind Group
    // -------------------------------------------------------------------------

    this.lineBindGroup = device.createBindGroup({
      layout: this.linePipeline.getBindGroupLayout(0),
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
    // Destroy old depth texture if it exists
    if (this.depthTexture) this.depthTexture.destroy();

    // Create new depth texture matching canvas size
    this.depthTexture = this.device.createTexture({
      size: [this.canvas.width, this.canvas.height],
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
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
  createBindGroup(buffers: SimulationBuffers) {
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
  // Main Render Function
  // ===========================================================================

  /**
   * Renders the complete scene (particles + bounding box).
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
    config: SimConfig,
    buffers: SimulationBuffers,
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
    // Build Line Vertex Data (Bounding Box)
    // -------------------------------------------------------------------------

    let vertexCount = 0;

    /**
     * Helper to add a line segment to the vertex buffer.
     *
     * @param p1 - Start point
     * @param p2 - End point
     * @param r,g,b,a - Line color
     */
    const addLine = (
      p1: { x: number; y: number; z: number },
      p2: { x: number; y: number; z: number },
      r: number,
      g: number,
      b: number,
      a: number
    ) => {
      const i = vertexCount * 7;

      // First vertex
      this.lineVertexData[i] = p1.x;
      this.lineVertexData[i + 1] = p1.y;
      this.lineVertexData[i + 2] = p1.z;
      this.lineVertexData[i + 3] = r;
      this.lineVertexData[i + 4] = g;
      this.lineVertexData[i + 5] = b;
      this.lineVertexData[i + 6] = a;

      // Second vertex
      this.lineVertexData[i + 7] = p2.x;
      this.lineVertexData[i + 8] = p2.y;
      this.lineVertexData[i + 9] = p2.z;
      this.lineVertexData[i + 10] = r;
      this.lineVertexData[i + 11] = g;
      this.lineVertexData[i + 12] = b;
      this.lineVertexData[i + 13] = a;

      vertexCount += 2;
    };

    /**
     * Helper to draw a wireframe box centered at (cx, cy, cz) with size (sx, sy, sz).
     */
    const drawBox = (
      cx: number,
      cy: number,
      cz: number,
      sx: number,
      sy: number,
      sz: number,
      r: number,
      g: number,
      b: number,
      a: number
    ) => {
      const hx = sx / 2,
        hy = sy / 2,
        hz = sz / 2;

      // Bottom face (4 edges)
      addLine(
        { x: cx - hx, y: cy - hy, z: cz - hz },
        { x: cx + hx, y: cy - hy, z: cz - hz },
        r,
        g,
        b,
        a
      );
      addLine(
        { x: cx + hx, y: cy - hy, z: cz - hz },
        { x: cx + hx, y: cy - hy, z: cz + hz },
        r,
        g,
        b,
        a
      );
      addLine(
        { x: cx + hx, y: cy - hy, z: cz + hz },
        { x: cx - hx, y: cy - hy, z: cz + hz },
        r,
        g,
        b,
        a
      );
      addLine(
        { x: cx - hx, y: cy - hy, z: cz + hz },
        { x: cx - hx, y: cy - hy, z: cz - hz },
        r,
        g,
        b,
        a
      );

      // Top face (4 edges)
      addLine(
        { x: cx - hx, y: cy + hy, z: cz - hz },
        { x: cx + hx, y: cy + hy, z: cz - hz },
        r,
        g,
        b,
        a
      );
      addLine(
        { x: cx + hx, y: cy + hy, z: cz - hz },
        { x: cx + hx, y: cy + hy, z: cz + hz },
        r,
        g,
        b,
        a
      );
      addLine(
        { x: cx + hx, y: cy + hy, z: cz + hz },
        { x: cx - hx, y: cy + hy, z: cz + hz },
        r,
        g,
        b,
        a
      );
      addLine(
        { x: cx - hx, y: cy + hy, z: cz + hz },
        { x: cx - hx, y: cy + hy, z: cz - hz },
        r,
        g,
        b,
        a
      );

      // Vertical edges (4 edges)
      addLine(
        { x: cx - hx, y: cy - hy, z: cz - hz },
        { x: cx - hx, y: cy + hy, z: cz - hz },
        r,
        g,
        b,
        a
      );
      addLine(
        { x: cx + hx, y: cy - hy, z: cz - hz },
        { x: cx + hx, y: cy + hy, z: cz - hz },
        r,
        g,
        b,
        a
      );
      addLine(
        { x: cx + hx, y: cy - hy, z: cz + hz },
        { x: cx + hx, y: cy + hy, z: cz + hz },
        r,
        g,
        b,
        a
      );
      addLine(
        { x: cx - hx, y: cy - hy, z: cz + hz },
        { x: cx - hx, y: cy + hy, z: cz + hz },
        r,
        g,
        b,
        a
      );
    };

    // Draw simulation bounding box
    const boundsCol = { r: 0.9, g: 0.9, b: 0.9 }; // Light gray
    drawBox(
      0,
      0,
      0, // Center at origin
      config.boundsSize.x,
      config.boundsSize.y,
      config.boundsSize.z,
      boundsCol.r,
      boundsCol.g,
      boundsCol.b,
      0.5 // Semi-transparent
    );

    // Upload line vertex data
    this.device.queue.writeBuffer(
      this.lineVertexBuffer,
      0,
      this.lineVertexData as unknown as BufferSource,
      0,
      vertexCount * 7
    );

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
    // Draw Lines (Bounding Box)
    // -------------------------------------------------------------------------

    pass.setPipeline(this.linePipeline);
    pass.setBindGroup(0, this.lineBindGroup);
    pass.setVertexBuffer(0, this.lineVertexBuffer);
    pass.draw(vertexCount);

    // -------------------------------------------------------------------------
    // Draw Particles (Indirect Instanced)
    // -------------------------------------------------------------------------

    pass.setPipeline(this.particlePipeline);
    pass.setBindGroup(0, this.particleBindGroup);

    // Use indirect draw - the instance count was populated by the cull shader
    // This avoids CPU-GPU synchronization for determining visible particle count
    pass.drawIndirect(buffers.indirectDraw, 0);

    pass.end();
  }
}
