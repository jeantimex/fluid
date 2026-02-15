/**
 * FLIP Fluid Render Pipelines
 *
 * This module creates and manages WebGPU render pipelines for:
 * - Particle rendering (instanced quads with circular cutout)
 * - Grid cell rendering (instanced quads)
 * - Obstacle/disk rendering (indexed triangle mesh)
 */

import { FlipBuffers } from './flip_buffers';
import particleShader from './shaders/particle.wgsl?raw';
import gridCellShader from './shaders/grid_cell.wgsl?raw';
import diskShader from './shaders/disk.wgsl?raw';

export class RenderPipelines {
  private device: GPUDevice;
  private format: GPUTextureFormat;

  // Pipelines
  particlePipeline: GPURenderPipeline;
  gridPipeline: GPURenderPipeline;
  diskPipeline: GPURenderPipeline;

  // Bind group layouts
  particleBindGroupLayout: GPUBindGroupLayout;
  gridBindGroupLayout: GPUBindGroupLayout;
  diskBindGroupLayout: GPUBindGroupLayout;

  // Bind groups (need to be recreated when buffers change)
  particleBindGroup: GPUBindGroup;
  gridBindGroup: GPUBindGroup;
  diskBindGroup: GPUBindGroup;

  constructor(
    device: GPUDevice,
    format: GPUTextureFormat,
    buffers: FlipBuffers
  ) {
    this.device = device;
    this.format = format;

    // Create particle pipeline
    this.particleBindGroupLayout = device.createBindGroupLayout({
      label: 'Particle Bind Group Layout',
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: 'uniform' },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: 'read-only-storage' },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: 'read-only-storage' },
        },
      ],
    });

    const particleShaderModule = device.createShaderModule({
      label: 'Particle Shader',
      code: particleShader,
    });

    this.particlePipeline = device.createRenderPipeline({
      label: 'Particle Pipeline',
      layout: device.createPipelineLayout({
        bindGroupLayouts: [this.particleBindGroupLayout],
      }),
      vertex: {
        module: particleShaderModule,
        entryPoint: 'vs_main',
      },
      fragment: {
        module: particleShaderModule,
        entryPoint: 'fs_main',
        targets: [{ format }],
      },
      primitive: {
        topology: 'triangle-strip',
        stripIndexFormat: undefined,
      },
    });

    // Create grid pipeline
    this.gridBindGroupLayout = device.createBindGroupLayout({
      label: 'Grid Bind Group Layout',
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: 'uniform' },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: 'read-only-storage' },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: 'read-only-storage' },
        },
      ],
    });

    const gridShaderModule = device.createShaderModule({
      label: 'Grid Cell Shader',
      code: gridCellShader,
    });

    this.gridPipeline = device.createRenderPipeline({
      label: 'Grid Pipeline',
      layout: device.createPipelineLayout({
        bindGroupLayouts: [this.gridBindGroupLayout],
      }),
      vertex: {
        module: gridShaderModule,
        entryPoint: 'vs_main',
      },
      fragment: {
        module: gridShaderModule,
        entryPoint: 'fs_main',
        targets: [{ format }],
      },
      primitive: {
        topology: 'triangle-strip',
        stripIndexFormat: undefined,
      },
    });

    // Create disk pipeline
    this.diskBindGroupLayout = device.createBindGroupLayout({
      label: 'Disk Bind Group Layout',
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: 'read-only-storage' },
        },
      ],
    });

    const diskShaderModule = device.createShaderModule({
      label: 'Disk Shader',
      code: diskShader,
    });

    this.diskPipeline = device.createRenderPipeline({
      label: 'Disk Pipeline',
      layout: device.createPipelineLayout({
        bindGroupLayouts: [this.diskBindGroupLayout],
      }),
      vertex: {
        module: diskShaderModule,
        entryPoint: 'vs_main',
      },
      fragment: {
        module: diskShaderModule,
        entryPoint: 'fs_main',
        targets: [{ format }],
      },
      primitive: {
        topology: 'triangle-list',
      },
    });

    // Create initial bind groups
    this.particleBindGroup = this.createParticleBindGroup(buffers);
    this.gridBindGroup = this.createGridBindGroup(buffers);
    this.diskBindGroup = this.createDiskBindGroup(buffers);
  }

  private createParticleBindGroup(buffers: FlipBuffers): GPUBindGroup {
    return this.device.createBindGroup({
      label: 'Particle Bind Group',
      layout: this.particleBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: buffers.particleUniforms } },
        { binding: 1, resource: { buffer: buffers.particlePositions } },
        { binding: 2, resource: { buffer: buffers.particleColors } },
      ],
    });
  }

  private createGridBindGroup(buffers: FlipBuffers): GPUBindGroup {
    return this.device.createBindGroup({
      label: 'Grid Bind Group',
      layout: this.gridBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: buffers.gridUniforms } },
        { binding: 1, resource: { buffer: buffers.gridCenters } },
        { binding: 2, resource: { buffer: buffers.gridColors } },
      ],
    });
  }

  private createDiskBindGroup(buffers: FlipBuffers): GPUBindGroup {
    return this.device.createBindGroup({
      label: 'Disk Bind Group',
      layout: this.diskBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: buffers.diskUniforms } },
        { binding: 1, resource: { buffer: buffers.diskVertices } },
      ],
    });
  }

  /**
   * Recreate bind groups if buffers are recreated.
   */
  updateBindGroups(buffers: FlipBuffers): void {
    this.particleBindGroup = this.createParticleBindGroup(buffers);
    this.gridBindGroup = this.createGridBindGroup(buffers);
    this.diskBindGroup = this.createDiskBindGroup(buffers);
  }
}
