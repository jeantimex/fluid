/**
 * =============================================================================
 * Compute Pipeline Management for 3D SPH Fluid Simulation (Linear Grid)
 * =============================================================================
 */

import type { SimulationBuffersLinear } from './simulation_buffers_linear.ts';

// Import shader source code as raw strings
import externalForcesShader from './shaders/external_forces.wgsl?raw';
import hashShader from './shaders/hash_linear.wgsl?raw';
import sortShader from './shaders/sort_linear.wgsl?raw';
import scatterShader from './shaders/scatter_linear.wgsl?raw';
import densityShader from './shaders/density_linear.wgsl?raw';
import pressureShader from './shaders/pressure_linear.wgsl?raw';
import viscosityShader from './shaders/viscosity_linear.wgsl?raw';
import integrateShader from './shaders/integrate.wgsl?raw';
import prefixSumShader from './shaders/prefix_sum.wgsl?raw';
import reorderShader from './shaders/reorder.wgsl?raw';
import cullShader from './shaders/cull.wgsl?raw';

export interface UniformBuffers {
  compute: GPUBuffer;
  integrate: GPUBuffer;
  hash: GPUBuffer;
  sort: GPUBuffer;
  scanParamsL0: GPUBuffer;
  scanParamsL1: GPUBuffer;
  scanParamsL2: GPUBuffer;
  density: GPUBuffer;
  pressure: GPUBuffer;
  viscosity: GPUBuffer;
  cull: GPUBuffer;
}

export class ComputePipelinesLinear {
  externalForces: GPUComputePipeline;
  density: GPUComputePipeline;
  pressure: GPUComputePipeline;
  viscosity: GPUComputePipeline;
  integrate: GPUComputePipeline;
  hash: GPUComputePipeline;
  clearOffsets: GPUComputePipeline;
  countOffsets: GPUComputePipeline;
  prefixScan: GPUComputePipeline;
  prefixCombine: GPUComputePipeline;
  scatter: GPUComputePipeline;
  reorder: GPUComputePipeline;
  copyBack: GPUComputePipeline;
  cull: GPUComputePipeline;

  externalForcesBindGroup!: GPUBindGroup;
  integrateBindGroup!: GPUBindGroup;
  hashBindGroup!: GPUBindGroup;
  clearOffsetsBindGroup!: GPUBindGroup;
  countOffsetsBindGroup!: GPUBindGroup;
  scanPass0BindGroup!: GPUBindGroup;
  scanPass1BindGroup!: GPUBindGroup;
  scanPass2BindGroup!: GPUBindGroup;
  combinePass1BindGroup!: GPUBindGroup;
  combinePass0BindGroup!: GPUBindGroup;
  scatterBindGroup!: GPUBindGroup;
  reorderBindGroup!: GPUBindGroup;
  copyBackBindGroup!: GPUBindGroup;
  cullBindGroup!: GPUBindGroup;
  densityBindGroup!: GPUBindGroup;
  pressureBindGroup!: GPUBindGroup;
  viscosityBindGroup!: GPUBindGroup;

  readonly uniformBuffers: UniformBuffers;
  private device: GPUDevice;

  constructor(device: GPUDevice) {
    this.device = device;

    this.uniformBuffers = {
      compute: device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }),
      integrate: device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }),
      hash: device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }), // Updated size 32
      sort: device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }),
      scanParamsL0: device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }),
      scanParamsL1: device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }),
      scanParamsL2: device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }),
      cull: device.createBuffer({ size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }),
      density: device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }), // Updated size 48
      pressure: device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }), // Updated size 64
      viscosity: device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }),
    };

    this.externalForces = this.createPipeline(externalForcesShader, 'main');
    this.density = this.createPipeline(densityShader, 'main');
    this.pressure = this.createPipeline(pressureShader, 'main');
    this.viscosity = this.createPipeline(viscosityShader, 'main');
    this.integrate = this.createPipeline(integrateShader, 'main');
    this.hash = this.createPipeline(hashShader, 'main');
    this.clearOffsets = this.createPipeline(sortShader, 'clearOffsets');
    this.countOffsets = this.createPipeline(sortShader, 'countOffsets');
    this.prefixScan = this.createPipeline(prefixSumShader, 'blockScan');
    this.prefixCombine = this.createPipeline(prefixSumShader, 'blockCombine');
    this.scatter = this.createPipeline(scatterShader, 'scatter');
    this.reorder = this.createPipeline(reorderShader, 'reorder');
    this.copyBack = this.createPipeline(reorderShader, 'copyBack');
    this.cull = this.createPipeline(cullShader, 'main');
  }

  private createPipeline(code: string, entryPoint: string): GPUComputePipeline {
    const module = this.device.createShaderModule({ code });
    return this.device.createComputePipeline({
      layout: 'auto',
      compute: { module, entryPoint },
    });
  }

  createBindGroups(buffers: SimulationBuffersLinear): void {
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
        { binding: 3, resource: { buffer: buffers.particleCellOffsets } },
      ],
    });

    this.scanPass0BindGroup = this.device.createBindGroup({
      layout: this.prefixScan.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.sortOffsets } },
        { binding: 1, resource: { buffer: buffers.groupSumsL1 } },
        { binding: 2, resource: { buffer: this.uniformBuffers.scanParamsL0 } },
      ],
    });

    this.scanPass1BindGroup = this.device.createBindGroup({
      layout: this.prefixScan.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.groupSumsL1 } },
        { binding: 1, resource: { buffer: buffers.groupSumsL2 } },
        { binding: 2, resource: { buffer: this.uniformBuffers.scanParamsL1 } },
      ],
    });

    this.scanPass2BindGroup = this.device.createBindGroup({
      layout: this.prefixScan.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.groupSumsL2 } },
        { binding: 1, resource: { buffer: buffers.scanScratch } },
        { binding: 2, resource: { buffer: this.uniformBuffers.scanParamsL2 } },
      ],
    });

    this.combinePass1BindGroup = this.device.createBindGroup({
      layout: this.prefixCombine.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.groupSumsL1 } },
        { binding: 2, resource: { buffer: this.uniformBuffers.scanParamsL1 } },
        { binding: 3, resource: { buffer: buffers.groupSumsL2 } },
      ],
    });

    this.combinePass0BindGroup = this.device.createBindGroup({
      layout: this.prefixCombine.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.sortOffsets } },
        { binding: 2, resource: { buffer: this.uniformBuffers.scanParamsL0 } },
        { binding: 3, resource: { buffer: buffers.groupSumsL1 } },
      ],
    });

    this.scatterBindGroup = this.device.createBindGroup({
      layout: this.scatter.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.keys } },
        { binding: 1, resource: { buffer: buffers.sortOffsets } },
        { binding: 2, resource: { buffer: buffers.indices } },
        { binding: 3, resource: { buffer: this.uniformBuffers.sort } },
        { binding: 4, resource: { buffer: buffers.particleCellOffsets } },
      ],
    });

    this.reorderBindGroup = this.device.createBindGroup({
      layout: this.reorder.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.indices } },
        { binding: 1, resource: { buffer: buffers.positions } },
        { binding: 2, resource: { buffer: buffers.velocities } },
        { binding: 3, resource: { buffer: buffers.predicted } },
        { binding: 4, resource: { buffer: buffers.positionsSorted } },
        { binding: 5, resource: { buffer: buffers.velocitiesSorted } },
        { binding: 6, resource: { buffer: buffers.predictedSorted } },
        { binding: 7, resource: { buffer: this.uniformBuffers.sort } },
      ],
    });

    this.copyBackBindGroup = this.device.createBindGroup({
      layout: this.copyBack.getBindGroupLayout(0),
      entries: [
        { binding: 1, resource: { buffer: buffers.positions } },
        { binding: 2, resource: { buffer: buffers.velocities } },
        { binding: 3, resource: { buffer: buffers.predicted } },
        { binding: 4, resource: { buffer: buffers.positionsSorted } },
        { binding: 5, resource: { buffer: buffers.velocitiesSorted } },
        { binding: 6, resource: { buffer: buffers.predictedSorted } },
        { binding: 7, resource: { buffer: this.uniformBuffers.sort } },
      ],
    });

    this.cullBindGroup = this.device.createBindGroup({
      layout: this.cull.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.positions } },
        { binding: 1, resource: { buffer: buffers.visibleIndices } },
        { binding: 2, resource: { buffer: buffers.indirectDraw } },
        { binding: 3, resource: { buffer: this.uniformBuffers.cull } },
      ],
    });

    this.densityBindGroup = this.device.createBindGroup({
      layout: this.density.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.predicted } },
        { binding: 1, resource: { buffer: buffers.sortOffsets } },
        { binding: 2, resource: { buffer: buffers.densities } },
        { binding: 3, resource: { buffer: this.uniformBuffers.density } },
      ],
    });

    this.pressureBindGroup = this.device.createBindGroup({
      layout: this.pressure.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.predicted } },
        { binding: 1, resource: { buffer: buffers.velocities } },
        { binding: 2, resource: { buffer: buffers.densities } },
        { binding: 3, resource: { buffer: buffers.sortOffsets } },
        { binding: 4, resource: { buffer: this.uniformBuffers.pressure } },
      ],
    });

    this.viscosityBindGroup = this.device.createBindGroup({
      layout: this.viscosity.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.predicted } },
        { binding: 1, resource: { buffer: buffers.velocities } },
        { binding: 2, resource: { buffer: buffers.sortOffsets } },
        { binding: 4, resource: { buffer: this.uniformBuffers.viscosity } },
      ],
    });
  }
}