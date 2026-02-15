/**
 * GPU Compute Pipeline Management for FLIP Fluid Simulation
 *
 * This module creates and manages all compute shader pipelines.
 */

import { GPUSimulationBuffers } from './gpu_buffers';
import integrateShader from './shaders/integrate.wgsl?raw';
import updateColorsShader from './shaders/update_colors.wgsl?raw';
import collisionsShader from './shaders/collisions.wgsl?raw';

export class GPUComputePipelines {
  private device: GPUDevice;

  // Pipelines
  integratePipeline: GPUComputePipeline;
  updateColorsPipeline: GPUComputePipeline;
  collisionsPipeline: GPUComputePipeline;

  // Bind groups
  integrateBindGroup: GPUBindGroup;
  updateColorsBindGroup: GPUBindGroup;
  collisionsBindGroup: GPUBindGroup;

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
  }
}
