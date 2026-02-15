/**
 * GPU Compute Pipeline Management for FLIP Fluid Simulation
 *
 * This module creates and manages all compute shader pipelines.
 */

import { GPUSimulationBuffers } from './gpu_buffers';
import integrateShader from './shaders/integrate.wgsl?raw';

export class GPUComputePipelines {
  private device: GPUDevice;

  // Pipelines
  integratePipeline: GPUComputePipeline;

  // Bind groups
  integrateBindGroup: GPUBindGroup;

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
  }
}
