/**
 * GPU Compute Pipeline Management for FLIP Fluid Simulation
 *
 * This module creates and manages all compute shader pipelines.
 */

import { GPUSimulationBuffers } from './gpu_buffers';
import integrateShader from './shaders/integrate.wgsl?raw';
import updateColorsShader from './shaders/update_colors.wgsl?raw';
import collisionsShader from './shaders/collisions.wgsl?raw';
import g2pShader from './shaders/g2p.wgsl?raw';

export class GPUComputePipelines {
  private device: GPUDevice;

  // Pipelines
  integratePipeline: GPUComputePipeline;
  updateColorsPipeline: GPUComputePipeline;
  collisionsPipeline: GPUComputePipeline;
  g2pPipeline: GPUComputePipeline;

  // Bind groups
  integrateBindGroup: GPUBindGroup;
  updateColorsBindGroup: GPUBindGroup;
  collisionsBindGroup: GPUBindGroup;
  g2pBindGroup: GPUBindGroup;

  // Workgroup size
  readonly workgroupSize = 256;

  constructor(device: GPUDevice, buffers: GPUSimulationBuffers) {
    this.device = device;

    // Create integrate pipeline
    const integrateModule = device.createShaderModule({
      label: 'integrate shader',
      code: integrateShader,
    });

    this.integratePipeline = device.createComputePipeline({
      label: 'integrate pipeline',
      layout: 'auto',
      compute: {
        module: integrateModule,
        entryPoint: 'main',
      },
    });

    // Create bind groups
    this.integrateBindGroup = device.createBindGroup({
      label: 'integrate bind group',
      layout: this.integratePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.particlePos } },
        { binding: 1, resource: { buffer: buffers.particleVel } },
        { binding: 2, resource: { buffer: buffers.simParams } },
      ],
    });

    // Create update colors pipeline
    const updateColorsModule = device.createShaderModule({
      label: 'update colors shader',
      code: updateColorsShader,
    });

    this.updateColorsPipeline = device.createComputePipeline({
      label: 'update colors pipeline',
      layout: 'auto',
      compute: {
        module: updateColorsModule,
        entryPoint: 'main',
      },
    });

    this.updateColorsBindGroup = device.createBindGroup({
      label: 'update colors bind group',
      layout: this.updateColorsPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.particlePos } },
        { binding: 1, resource: { buffer: buffers.particleColor } },
        { binding: 2, resource: { buffer: buffers.gridDensity } },
        { binding: 3, resource: { buffer: buffers.simParams } },
      ],
    });

    // Create collisions pipeline
    const collisionsModule = device.createShaderModule({
      label: 'collisions shader',
      code: collisionsShader,
    });

    this.collisionsPipeline = device.createComputePipeline({
      label: 'collisions pipeline',
      layout: 'auto',
      compute: {
        module: collisionsModule,
        entryPoint: 'main',
      },
    });

    this.collisionsBindGroup = device.createBindGroup({
      label: 'collisions bind group',
      layout: this.collisionsPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.particlePos } },
        { binding: 1, resource: { buffer: buffers.particleVel } },
        { binding: 2, resource: { buffer: buffers.simParams } },
        { binding: 3, resource: { buffer: buffers.obstacleParams } },
      ],
    });

    // Create G2P pipeline
    const g2pModule = device.createShaderModule({
      label: 'g2p shader',
      code: g2pShader,
    });

    this.g2pPipeline = device.createComputePipeline({
      label: 'g2p pipeline',
      layout: 'auto',
      compute: {
        module: g2pModule,
        entryPoint: 'main',
      },
    });

    this.g2pBindGroup = device.createBindGroup({
      label: 'g2p bind group',
      layout: this.g2pPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.particlePos } },
        { binding: 1, resource: { buffer: buffers.particleVel } },
        { binding: 2, resource: { buffer: buffers.gridU } },
        { binding: 3, resource: { buffer: buffers.gridV } },
        { binding: 4, resource: { buffer: buffers.gridPrevU } },
        { binding: 5, resource: { buffer: buffers.gridPrevV } },
        { binding: 6, resource: { buffer: buffers.gridCellType } },
        { binding: 7, resource: { buffer: buffers.simParams } },
      ],
    });
  }

  /**
   * Recreate bind groups if buffers change.
   */
  updateBindGroups(buffers: GPUSimulationBuffers): void {
    this.integrateBindGroup = this.device.createBindGroup({
      label: 'integrate bind group',
      layout: this.integratePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.particlePos } },
        { binding: 1, resource: { buffer: buffers.particleVel } },
        { binding: 2, resource: { buffer: buffers.simParams } },
      ],
    });

    this.updateColorsBindGroup = this.device.createBindGroup({
      label: 'update colors bind group',
      layout: this.updateColorsPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.particlePos } },
        { binding: 1, resource: { buffer: buffers.particleColor } },
        { binding: 2, resource: { buffer: buffers.gridDensity } },
        { binding: 3, resource: { buffer: buffers.simParams } },
      ],
    });

    this.collisionsBindGroup = this.device.createBindGroup({
      label: 'collisions bind group',
      layout: this.collisionsPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.particlePos } },
        { binding: 1, resource: { buffer: buffers.particleVel } },
        { binding: 2, resource: { buffer: buffers.simParams } },
        { binding: 3, resource: { buffer: buffers.obstacleParams } },
      ],
    });

    this.g2pBindGroup = this.device.createBindGroup({
      label: 'g2p bind group',
      layout: this.g2pPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.particlePos } },
        { binding: 1, resource: { buffer: buffers.particleVel } },
        { binding: 2, resource: { buffer: buffers.gridU } },
        { binding: 3, resource: { buffer: buffers.gridV } },
        { binding: 4, resource: { buffer: buffers.gridPrevU } },
        { binding: 5, resource: { buffer: buffers.gridPrevV } },
        { binding: 6, resource: { buffer: buffers.gridCellType } },
        { binding: 7, resource: { buffer: buffers.simParams } },
      ],
    });
  }
}
