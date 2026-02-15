/**
 * FLIP Fluid GPU Buffer Management
 *
 * This module manages GPU buffers for rendering the FLIP simulation.
 * The simulation runs on CPU, but we need GPU buffers for WebGPU rendering.
 */

import { FlipFluid } from './flip_fluid';

export class FlipBuffers {
  private device: GPUDevice;

  // Particle rendering buffers
  particlePositions: GPUBuffer;
  particleColors: GPUBuffer;

  // Grid rendering buffers
  gridCenters: GPUBuffer;
  gridColors: GPUBuffer;

  // Disk rendering buffers
  diskVertices: GPUBuffer;
  diskIndices: GPUBuffer;

  // Uniform buffers
  particleUniforms: GPUBuffer;
  gridUniforms: GPUBuffer;
  diskUniforms: GPUBuffer;

  // Sizes for drawing
  numParticles: number;
  numGridCells: number;
  numDiskIndices: number;

  constructor(device: GPUDevice, fluid: FlipFluid) {
    this.device = device;
    this.numParticles = fluid.maxParticles;
    this.numGridCells = fluid.fNumCells;

    // Create particle buffers
    this.particlePositions = device.createBuffer({
      size: fluid.maxParticles * 2 * 4, // vec2<f32> per particle
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      label: 'Particle Positions',
    });

    this.particleColors = device.createBuffer({
      size: fluid.maxParticles * 3 * 4, // vec3<f32> per particle (but stored as 3 floats)
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      label: 'Particle Colors',
    });

    // Create grid buffers
    // Grid centers are static - computed once
    const gridCentersData = new Float32Array(fluid.fNumCells * 2);
    let p = 0;
    for (let i = 0; i < fluid.fNumX; i++) {
      for (let j = 0; j < fluid.fNumY; j++) {
        gridCentersData[p++] = (i + 0.5) * fluid.h;
        gridCentersData[p++] = (j + 0.5) * fluid.h;
      }
    }

    this.gridCenters = device.createBuffer({
      size: gridCentersData.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      label: 'Grid Centers',
    });
    device.queue.writeBuffer(this.gridCenters, 0, gridCentersData);

    this.gridColors = device.createBuffer({
      size: fluid.fNumCells * 3 * 4, // vec3<f32> per cell (stored as 3 floats)
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      label: 'Grid Colors',
    });

    // Create disk mesh (for obstacle rendering)
    const numSegs = 50;
    const diskVerts = new Float32Array((numSegs + 1) * 2);
    const dphi = (2.0 * Math.PI) / numSegs;

    // Center vertex
    diskVerts[0] = 0.0;
    diskVerts[1] = 0.0;

    // Circle vertices
    for (let i = 0; i < numSegs; i++) {
      diskVerts[(i + 1) * 2] = Math.cos(i * dphi);
      diskVerts[(i + 1) * 2 + 1] = Math.sin(i * dphi);
    }

    this.diskVertices = device.createBuffer({
      size: diskVerts.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      label: 'Disk Vertices',
    });
    device.queue.writeBuffer(this.diskVertices, 0, diskVerts);

    // Triangle fan indices
    const diskIds = new Uint16Array(numSegs * 3);
    let idx = 0;
    for (let i = 0; i < numSegs; i++) {
      diskIds[idx++] = 0; // center
      diskIds[idx++] = i + 1;
      diskIds[idx++] = ((i + 1) % numSegs) + 1;
    }
    this.numDiskIndices = diskIds.length;

    this.diskIndices = device.createBuffer({
      size: diskIds.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
      label: 'Disk Indices',
    });
    device.queue.writeBuffer(this.diskIndices, 0, diskIds);

    // Create uniform buffers
    // Particle uniforms: domainSize (vec2), pointSize (f32), pad (f32)
    this.particleUniforms = device.createBuffer({
      size: 16, // 4 floats
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      label: 'Particle Uniforms',
    });

    // Grid uniforms: domainSize (vec2), cellSize (f32), pad (f32)
    this.gridUniforms = device.createBuffer({
      size: 16, // 4 floats
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      label: 'Grid Uniforms',
    });

    // Disk uniforms: domainSize (vec2), translation (vec2), scale (f32), pad, pad, pad, color (vec3), pad
    this.diskUniforms = device.createBuffer({
      size: 48, // 12 floats (vec2 + vec2 + f32 + 3*pad + vec3 + pad = 12)
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      label: 'Disk Uniforms',
    });
  }

  /**
   * Update particle buffers from CPU simulation data.
   */
  updateParticleBuffers(fluid: FlipFluid): void {
    // Only upload the active particles
    const activeCount = fluid.numParticles;
    this.numParticles = activeCount;

    if (activeCount > 0) {
      this.device.queue.writeBuffer(
        this.particlePositions,
        0,
        fluid.particlePos.buffer,
        0,
        activeCount * 2 * 4
      );

      this.device.queue.writeBuffer(
        this.particleColors,
        0,
        fluid.particleColor.buffer,
        0,
        activeCount * 3 * 4
      );
    }
  }

  /**
   * Update grid color buffer from CPU simulation data.
   */
  updateGridBuffers(fluid: FlipFluid): void {
    this.device.queue.writeBuffer(this.gridColors, 0, fluid.cellColor);
  }

  /**
   * Update particle rendering uniforms.
   */
  updateParticleUniforms(
    domainWidth: number,
    domainHeight: number,
    pointSize: number
  ): void {
    const data = new Float32Array([domainWidth, domainHeight, pointSize, 0]);
    this.device.queue.writeBuffer(this.particleUniforms, 0, data);
  }

  /**
   * Update grid rendering uniforms.
   */
  updateGridUniforms(
    domainWidth: number,
    domainHeight: number,
    cellSize: number
  ): void {
    const data = new Float32Array([domainWidth, domainHeight, cellSize, 0]);
    this.device.queue.writeBuffer(this.gridUniforms, 0, data);
  }

  /**
   * Update disk/obstacle rendering uniforms.
   */
  updateDiskUniforms(
    domainWidth: number,
    domainHeight: number,
    x: number,
    y: number,
    radius: number,
    r: number,
    g: number,
    b: number
  ): void {
    const data = new Float32Array([
      domainWidth,
      domainHeight, // vec2 domainSize
      x,
      y, // vec2 translation
      radius,
      0,
      0,
      0, // f32 scale + 3 padding
      r,
      g,
      b,
      0, // vec3 color + padding
    ]);
    this.device.queue.writeBuffer(this.diskUniforms, 0, data);
  }

  /**
   * Clean up GPU resources.
   */
  destroy(): void {
    this.particlePositions.destroy();
    this.particleColors.destroy();
    this.gridCenters.destroy();
    this.gridColors.destroy();
    this.diskVertices.destroy();
    this.diskIndices.destroy();
    this.particleUniforms.destroy();
    this.gridUniforms.destroy();
    this.diskUniforms.destroy();
  }
}
