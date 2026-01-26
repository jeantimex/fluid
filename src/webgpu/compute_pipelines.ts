/**
 * Manages all compute pipelines and their bind groups for the simulation.
 */

import type { SimulationBuffers } from './simulation_buffers.ts';

// Import shaders as raw strings
import externalForcesShader from './shaders/external_forces.wgsl?raw';
import hashShader from './shaders/hash.wgsl?raw';
import sortShader from './shaders/sort.wgsl?raw';
import scatterShader from './shaders/scatter.wgsl?raw';
import spatialOffsetsShader from './shaders/spatial_offsets.wgsl?raw';
import densityShader from './shaders/density.wgsl?raw';
import pressureShader from './shaders/pressure.wgsl?raw';
import viscosityShader from './shaders/viscosity.wgsl?raw';
import integrateShader from './shaders/integrate.wgsl?raw';

export interface UniformBuffers {
  compute: GPUBuffer;
  integrate: GPUBuffer;
  hash: GPUBuffer;
  sort: GPUBuffer;
  density: GPUBuffer;
  pressure: GPUBuffer;
  viscosity: GPUBuffer;
}

export class ComputePipelines {
  // Pipelines
  externalForces: GPUComputePipeline;
  hash: GPUComputePipeline;
  clearOffsets: GPUComputePipeline;
  countOffsets: GPUComputePipeline;
  scatter: GPUComputePipeline;
  spatialOffsets: GPUComputePipeline;
  density: GPUComputePipeline;
  pressure: GPUComputePipeline;
  viscosity: GPUComputePipeline;
  integrate: GPUComputePipeline;

  // Bind groups
  externalForcesBindGroup!: GPUBindGroup;
  integrateBindGroup!: GPUBindGroup;
  hashBindGroup!: GPUBindGroup;
  clearOffsetsBindGroup!: GPUBindGroup;
  countOffsetsBindGroup!: GPUBindGroup;
  scatterBindGroup!: GPUBindGroup;
  spatialOffsetsBindGroup!: GPUBindGroup;
  densityBindGroup!: GPUBindGroup;
  pressureBindGroup!: GPUBindGroup;
  viscosityBindGroup!: GPUBindGroup;

  readonly uniformBuffers: UniformBuffers;

  private device: GPUDevice;

  constructor(device: GPUDevice) {
    this.device = device;

    // Create uniform buffers
    this.uniformBuffers = {
      compute: device.createBuffer({
        size: 32,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      }),
      integrate: device.createBuffer({
        size: 64,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      }),
      hash: device.createBuffer({
        size: 32,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      }),
      sort: device.createBuffer({
        size: 32,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      }),
      density: device.createBuffer({
        size: 48,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      }),
      pressure: device.createBuffer({
        size: 48,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      }),
      viscosity: device.createBuffer({
        size: 48,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      }),
    };

    // Create pipelines
    this.externalForces = this.createPipeline(externalForcesShader, 'main');
    this.hash = this.createPipeline(hashShader, 'main');
    this.clearOffsets = this.createPipeline(sortShader, 'clearOffsets');
    this.countOffsets = this.createPipeline(sortShader, 'countOffsets');
    this.scatter = this.createPipeline(scatterShader, 'prefixAndScatter');
    this.spatialOffsets = this.createPipeline(spatialOffsetsShader, 'buildOffsets');
    this.density = this.createPipeline(densityShader, 'main');
    this.pressure = this.createPipeline(pressureShader, 'main');
    this.viscosity = this.createPipeline(viscosityShader, 'main');
    this.integrate = this.createPipeline(integrateShader, 'main');
  }

  private createPipeline(code: string, entryPoint: string): GPUComputePipeline {
    const module = this.device.createShaderModule({ code });
    return this.device.createComputePipeline({
      layout: 'auto',
      compute: { module, entryPoint },
    });
  }

  createBindGroups(buffers: SimulationBuffers): void {
    this.externalForcesBindGroup = this.device.createBindGroup({
      layout: this.externalForces.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.positions } },
        { binding: 1, resource: { buffer: buffers.velocities } },
        { binding: 2, resource: { buffer: buffers.predicted } },
        { binding: 3, resource: { buffer: this.uniformBuffers.compute } },
      ],
    });

    this.integrateBindGroup = this.device.createBindGroup({
      layout: this.integrate.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.positions } },
        { binding: 1, resource: { buffer: buffers.velocities } },
        { binding: 2, resource: { buffer: this.uniformBuffers.integrate } },
      ],
    });

    this.hashBindGroup = this.device.createBindGroup({
      layout: this.hash.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.predicted } },
        { binding: 1, resource: { buffer: buffers.keys } },
        { binding: 2, resource: { buffer: buffers.indices } },
        { binding: 3, resource: { buffer: this.uniformBuffers.hash } },
      ],
    });

    this.clearOffsetsBindGroup = this.device.createBindGroup({
      layout: this.clearOffsets.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.sortOffsets } },
        { binding: 1, resource: { buffer: this.uniformBuffers.sort } },
      ],
    });

    this.countOffsetsBindGroup = this.device.createBindGroup({
      layout: this.countOffsets.getBindGroupLayout(1),
      entries: [
        { binding: 0, resource: { buffer: buffers.keys } },
        { binding: 1, resource: { buffer: buffers.sortOffsets } },
        { binding: 2, resource: { buffer: this.uniformBuffers.sort } },
      ],
    });

    this.scatterBindGroup = this.device.createBindGroup({
      layout: this.scatter.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.keys } },
        { binding: 1, resource: { buffer: buffers.sortOffsets } },
        { binding: 2, resource: { buffer: buffers.sortedKeys } },
        { binding: 3, resource: { buffer: buffers.indices } },
        { binding: 4, resource: { buffer: this.uniformBuffers.sort } },
      ],
    });

    this.spatialOffsetsBindGroup = this.device.createBindGroup({
      layout: this.spatialOffsets.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.sortedKeys } },
        { binding: 1, resource: { buffer: buffers.spatialOffsets } },
        { binding: 2, resource: { buffer: this.uniformBuffers.sort } },
      ],
    });

    this.densityBindGroup = this.device.createBindGroup({
      layout: this.density.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.predicted } },
        { binding: 1, resource: { buffer: buffers.sortedKeys } },
        { binding: 2, resource: { buffer: buffers.indices } },
        { binding: 3, resource: { buffer: buffers.spatialOffsets } },
        { binding: 4, resource: { buffer: buffers.densities } },
        { binding: 5, resource: { buffer: this.uniformBuffers.density } },
      ],
    });

    this.pressureBindGroup = this.device.createBindGroup({
      layout: this.pressure.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.predicted } },
        { binding: 1, resource: { buffer: buffers.velocities } },
        { binding: 2, resource: { buffer: buffers.densities } },
        { binding: 3, resource: { buffer: buffers.sortedKeys } },
        { binding: 4, resource: { buffer: buffers.indices } },
        { binding: 5, resource: { buffer: buffers.spatialOffsets } },
        { binding: 6, resource: { buffer: this.uniformBuffers.pressure } },
      ],
    });

    this.viscosityBindGroup = this.device.createBindGroup({
      layout: this.viscosity.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.predicted } },
        { binding: 1, resource: { buffer: buffers.velocities } },
        { binding: 2, resource: { buffer: buffers.sortedKeys } },
        { binding: 3, resource: { buffer: buffers.indices } },
        { binding: 4, resource: { buffer: buffers.spatialOffsets } },
        { binding: 5, resource: { buffer: this.uniformBuffers.viscosity } },
      ],
    });
  }
}
