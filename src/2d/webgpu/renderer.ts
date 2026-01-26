/**
 * WebGPU Rendering for Fluid Simulation
 *
 * This module handles all GPU rendering operations for visualizing the
 * fluid simulation. It renders:
 * 1. Particles - As velocity-colored circles using instanced rendering
 * 2. Boundaries - As line segments for the simulation bounds
 * 3. Obstacles - As line segments for any rectangular obstacles
 *
 * Rendering Architecture:
 * - Particle Pipeline: Uses instanced rendering to draw thousands of particles
 *   efficiently. Each particle is rendered as a quad (2 triangles, 6 vertices)
 *   with the vertex shader positioning and sizing each instance.
 *
 * - Line Pipeline: Renders boundary and obstacle outlines using line primitives.
 *   Line vertices are generated on CPU and uploaded each frame.
 *
 * Color Mapping:
 * - Particles are colored based on their velocity magnitude
 * - A gradient lookup table (LUT) maps velocity to color
 * - The gradient is configurable via colorKeys in the config
 */

import type { SimConfig } from '../common/types.ts';
import type { SimulationBuffers } from './simulation_buffers.ts';
import { buildGradientLut } from '../common/kernels.ts';

// Import WGSL render shaders as raw strings
import particleShader from './shaders/particle.wgsl?raw';
import lineShader from './shaders/line.wgsl?raw';

/**
 * Handles all WebGPU rendering for the fluid simulation.
 *
 * This class manages:
 * - Render pipelines for particles and lines
 * - GPU buffers for uniforms, gradients, and line vertices
 * - Bind groups that connect buffers to shaders
 * - The render loop that draws particles and boundaries
 */
export class Renderer {
  /** Reference to the GPU device */
  private device: GPUDevice;

  // ============================================================================
  // Render Pipelines
  // ============================================================================

  /**
   * Pipeline for rendering particles as instanced quads.
   * Uses the particle.wgsl shader which:
   * - Positions a quad for each particle instance
   * - Colors based on velocity using the gradient LUT
   * - Draws circular particles with smooth edges
   */
  private particlePipeline: GPURenderPipeline;

  /**
   * Pipeline for rendering boundary and obstacle lines.
   * Uses the line.wgsl shader which:
   * - Takes position and color per vertex
   * - Draws lines in world space transformed to clip space
   */
  private linePipeline: GPURenderPipeline;

  // ============================================================================
  // GPU Buffers
  // ============================================================================

  /**
   * Uniform buffer containing render parameters.
   * Layout (8 floats, 32 bytes):
   * - [0-1]: boundsSize (x, y) - World space simulation bounds
   * - [2-3]: canvasSize (width, height) - Canvas pixel dimensions
   * - [4]: particleRadius - Radius of particles in world units
   * - [5]: velocityDisplayMax - Max velocity for color mapping normalization
   * - [6]: gradientResolution - Number of entries in the gradient LUT
   * - [7]: padding
   */
  private uniformBuffer: GPUBuffer;

  /**
   * Storage buffer containing the velocity-to-color gradient lookup table.
   * Each entry is RGBA (4 floats). The gradient is built from config.colorKeys
   * and allows smooth color transitions based on particle velocity.
   */
  private gradientBuffer: GPUBuffer;

  /**
   * Vertex buffer for line rendering (bounds and obstacles).
   * Each vertex has: position (vec2) + color (vec4) = 6 floats = 24 bytes
   * Updated every frame with the current boundary/obstacle geometry.
   */
  private lineVertexBuffer: GPUBuffer;

  /** CPU-side array for building line vertex data before upload */
  private lineVertexData: Float32Array;

  // ============================================================================
  // Bind Groups
  // ============================================================================

  /**
   * Bind group for the particle pipeline.
   * Must be recreated when simulation buffers change (on reset).
   */
  private particleBindGroup!: GPUBindGroup;

  /**
   * Bind group for the line pipeline.
   * Contains only the uniform buffer, so it doesn't need recreation.
   */
  private lineBindGroup: GPUBindGroup;

  // ============================================================================
  // Constants
  // ============================================================================

  /** Bytes per line vertex: 2 floats (position) + 4 floats (color) = 24 bytes */
  private readonly lineVertexStride = 6 * 4;

  /** Maximum number of line vertices (8 lines * 2 vertices = 16 for bounds + obstacle) */
  private readonly lineVertexCapacity = 16;

  /** Background clear color - dark blue-gray (#05070B) */
  private readonly clearColor = { r: 5 / 255, g: 7 / 255, b: 11 / 255, a: 1 };

  /** CPU-side array for uniform data before upload */
  private uniformData = new Float32Array(8);

  /**
   * Creates the renderer with all required GPU resources.
   *
   * @param device - The WebGPU device to create resources on
   * @param format - The texture format for the render targets
   * @param config - Simulation configuration (for gradient colors)
   */
  constructor(device: GPUDevice, format: GPUTextureFormat, config: SimConfig) {
    this.device = device;

    // ========================================================================
    // Create Uniform Buffer
    // ========================================================================
    this.uniformBuffer = device.createBuffer({
      size: 32, // 8 floats * 4 bytes
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // ========================================================================
    // Create Gradient Lookup Table Buffer
    // ========================================================================
    // Build a color gradient from the configured color keys
    // This creates a smooth transition between colors based on velocity
    const gradientLut = buildGradientLut(
      config.colorKeys,
      config.gradientResolution
    );

    // Convert to RGBA float format for GPU
    const gradientData = new Float32Array(config.gradientResolution * 4);
    for (let i = 0; i < gradientLut.length; i++) {
      gradientData[i * 4] = gradientLut[i].r; // Red
      gradientData[i * 4 + 1] = gradientLut[i].g; // Green
      gradientData[i * 4 + 2] = gradientLut[i].b; // Blue
      gradientData[i * 4 + 3] = 1; // Alpha (always 1)
    }

    // Create and upload gradient buffer
    this.gradientBuffer = device.createBuffer({
      size: gradientData.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Float32Array(this.gradientBuffer.getMappedRange()).set(gradientData);
    this.gradientBuffer.unmap();

    // ========================================================================
    // Create Line Vertex Buffer
    // ========================================================================
    this.lineVertexData = new Float32Array(this.lineVertexCapacity * 6);
    this.lineVertexBuffer = device.createBuffer({
      size: this.lineVertexData.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });

    // ========================================================================
    // Create Particle Render Pipeline
    // ========================================================================
    // This pipeline renders particles as instanced quads (2 triangles each)
    const particleModule = device.createShaderModule({ code: particleShader });
    this.particlePipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: particleModule,
        entryPoint: 'vs_main',
        // No vertex buffers - positions come from storage buffers
      },
      fragment: {
        module: particleModule,
        entryPoint: 'fs_main',
        targets: [{ format }], // Render to canvas format
      },
      primitive: {
        topology: 'triangle-list', // 6 vertices per quad (2 triangles)
      },
    });

    // ========================================================================
    // Create Line Render Pipeline
    // ========================================================================
    // This pipeline renders lines for boundaries and obstacles
    const lineModule = device.createShaderModule({ code: lineShader });
    this.linePipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: lineModule,
        entryPoint: 'vs_main',
        buffers: [
          {
            arrayStride: this.lineVertexStride, // 24 bytes per vertex
            attributes: [
              // Position: vec2<f32> at offset 0
              { shaderLocation: 0, offset: 0, format: 'float32x2' },
              // Color: vec4<f32> at offset 8
              { shaderLocation: 1, offset: 2 * 4, format: 'float32x4' },
            ],
          },
        ],
      },
      fragment: {
        module: lineModule,
        entryPoint: 'fs_main',
        targets: [{ format }],
      },
      primitive: {
        topology: 'line-list', // Each pair of vertices forms a line
      },
    });

    // ========================================================================
    // Create Line Bind Group
    // ========================================================================
    // The line pipeline only needs the uniform buffer
    this.lineBindGroup = device.createBindGroup({
      layout: this.linePipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
    });
  }

  /**
   * Creates the particle bind group with the current simulation buffers.
   *
   * This must be called whenever the simulation is reset, as the buffers
   * are recreated with new particle data.
   *
   * @param buffers - The current simulation buffers
   */
  createBindGroup(buffers: SimulationBuffers): void {
    this.particleBindGroup = this.device.createBindGroup({
      layout: this.particlePipeline.getBindGroupLayout(0),
      entries: [
        // Particle positions for positioning quads
        { binding: 0, resource: { buffer: buffers.positions } },
        // Particle velocities for color lookup
        { binding: 1, resource: { buffer: buffers.velocities } },
        // Gradient LUT for velocity-to-color mapping
        { binding: 2, resource: { buffer: this.gradientBuffer } },
        // Uniform parameters (bounds, canvas size, etc.)
        { binding: 3, resource: { buffer: this.uniformBuffer } },
      ],
    });
  }

  /**
   * Updates the uniform buffer with current render parameters.
   *
   * Called every frame before rendering to update canvas dimensions
   * and any changed configuration values.
   *
   * @param config - Current simulation configuration
   * @param canvasWidth - Canvas width in pixels
   * @param canvasHeight - Canvas height in pixels
   */
  updateUniforms(
    config: SimConfig,
    canvasWidth: number,
    canvasHeight: number
  ): void {
    // Scale particle radius by device pixel ratio to match CSS pixel sizes
    // This ensures particles appear the same size as in the Canvas2D version
    const dpr = window.devicePixelRatio || 1;

    // Pack uniform data into the Float32Array
    this.uniformData[0] = config.boundsSize.x; // World bounds width
    this.uniformData[1] = config.boundsSize.y; // World bounds height
    this.uniformData[2] = canvasWidth; // Canvas pixel width
    this.uniformData[3] = canvasHeight; // Canvas pixel height
    this.uniformData[4] = config.particleRadius * dpr; // Particle display radius (scaled for DPR)
    this.uniformData[5] = config.velocityDisplayMax; // Max velocity for color normalization
    this.uniformData[6] = config.gradientResolution; // Gradient LUT size
    this.uniformData[7] = 0; // Padding for alignment

    // Upload to GPU
    this.device.queue.writeBuffer(this.uniformBuffer, 0, this.uniformData);
  }

  /**
   * Renders the complete frame: particles, bounds, and obstacles.
   *
   * @param encoder - Command encoder to record render commands
   * @param context - Canvas context to get the current texture
   * @param config - Simulation configuration for bounds/obstacles
   * @param particleCount - Number of particles to render
   */
  render(
    encoder: GPUCommandEncoder,
    context: GPUCanvasContext,
    config: SimConfig,
    particleCount: number
  ): void {
    // ========================================================================
    // Build Line Vertex Data
    // ========================================================================
    // Generate vertices for boundary and obstacle lines on CPU

    let lineVertexCount = 0;

    /**
     * Helper to add a line segment to the vertex buffer.
     * Each line has 2 vertices with position and color.
     */
    const pushLine = (
      x0: number,
      y0: number,
      x1: number,
      y1: number,
      r: number,
      g: number,
      b: number,
      a: number
    ): void => {
      const base = lineVertexCount * 6;
      // First vertex
      this.lineVertexData[base] = x0;
      this.lineVertexData[base + 1] = y0;
      this.lineVertexData[base + 2] = r;
      this.lineVertexData[base + 3] = g;
      this.lineVertexData[base + 4] = b;
      this.lineVertexData[base + 5] = a;
      // Second vertex
      this.lineVertexData[base + 6] = x1;
      this.lineVertexData[base + 7] = y1;
      this.lineVertexData[base + 8] = r;
      this.lineVertexData[base + 9] = g;
      this.lineVertexData[base + 10] = b;
      this.lineVertexData[base + 11] = a;
      lineVertexCount += 2;
    };

    // Draw simulation bounds (4 lines forming a rectangle)
    const halfX = config.boundsSize.x * 0.5;
    const halfY = config.boundsSize.y * 0.5;
    const boundsCol = { r: 0x1b / 255, g: 0x24 / 255, b: 0x32 / 255, a: 1 };

    // Bottom edge
    pushLine(
      -halfX,
      -halfY,
      halfX,
      -halfY,
      boundsCol.r,
      boundsCol.g,
      boundsCol.b,
      boundsCol.a
    );
    // Right edge
    pushLine(
      halfX,
      -halfY,
      halfX,
      halfY,
      boundsCol.r,
      boundsCol.g,
      boundsCol.b,
      boundsCol.a
    );
    // Top edge
    pushLine(
      halfX,
      halfY,
      -halfX,
      halfY,
      boundsCol.r,
      boundsCol.g,
      boundsCol.b,
      boundsCol.a
    );
    // Left edge
    pushLine(
      -halfX,
      halfY,
      -halfX,
      -halfY,
      boundsCol.r,
      boundsCol.g,
      boundsCol.b,
      boundsCol.a
    );

    // Draw obstacle if present (4 lines forming a rectangle)
    if (config.obstacleSize.x > 0 && config.obstacleSize.y > 0) {
      const obsHalfX = config.obstacleSize.x * 0.5;
      const obsHalfY = config.obstacleSize.y * 0.5;
      const cx = config.obstacleCentre.x;
      const cy = config.obstacleCentre.y;
      const obstacleCol = { r: 0x36 / 255, g: 0x51 / 255, b: 0x6d / 255, a: 1 };

      // Bottom edge
      pushLine(
        cx - obsHalfX,
        cy - obsHalfY,
        cx + obsHalfX,
        cy - obsHalfY,
        obstacleCol.r,
        obstacleCol.g,
        obstacleCol.b,
        obstacleCol.a
      );
      // Right edge
      pushLine(
        cx + obsHalfX,
        cy - obsHalfY,
        cx + obsHalfX,
        cy + obsHalfY,
        obstacleCol.r,
        obstacleCol.g,
        obstacleCol.b,
        obstacleCol.a
      );
      // Top edge
      pushLine(
        cx + obsHalfX,
        cy + obsHalfY,
        cx - obsHalfX,
        cy + obsHalfY,
        obstacleCol.r,
        obstacleCol.g,
        obstacleCol.b,
        obstacleCol.a
      );
      // Left edge
      pushLine(
        cx - obsHalfX,
        cy + obsHalfY,
        cx - obsHalfX,
        cy - obsHalfY,
        obstacleCol.r,
        obstacleCol.g,
        obstacleCol.b,
        obstacleCol.a
      );
    }

    // Upload line vertices to GPU
    this.device.queue.writeBuffer(
      this.lineVertexBuffer,
      0,
      this.lineVertexData.subarray(
        0,
        lineVertexCount * 6
      ) as Float32Array<ArrayBuffer>
    );

    // ========================================================================
    // Begin Render Pass
    // ========================================================================
    // Get the current swap chain texture and create a render pass

    const view = context.getCurrentTexture().createView();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view, // Render target (the canvas)
          clearValue: this.clearColor, // Background color
          loadOp: 'clear', // Clear before rendering
          storeOp: 'store', // Keep the results
        },
      ],
    });

    // ========================================================================
    // Draw Particles
    // ========================================================================
    // Render all particles using instanced drawing
    // 6 vertices per particle (2 triangles forming a quad)

    pass.setPipeline(this.particlePipeline);
    pass.setBindGroup(0, this.particleBindGroup);
    pass.draw(6, particleCount); // 6 vertices, particleCount instances

    // ========================================================================
    // Draw Lines
    // ========================================================================
    // Render boundary and obstacle lines

    if (lineVertexCount > 0) {
      pass.setPipeline(this.linePipeline);
      pass.setBindGroup(0, this.lineBindGroup);
      pass.setVertexBuffer(0, this.lineVertexBuffer);
      pass.draw(lineVertexCount); // Draw all line vertices
    }

    // End the render pass
    pass.end();
  }
}
