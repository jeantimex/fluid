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
import hashShader from './shaders/hash.wgsl?raw';
import countShader from './shaders/count.wgsl?raw';
import prefixSumShader from './shaders/prefix_sum.wgsl?raw';
import reorderShader from './shaders/reorder.wgsl?raw';
import pushApartShader from './shaders/push_apart.wgsl?raw';
import clearGridShader from './shaders/clear_grid.wgsl?raw';
import markCellsShader from './shaders/mark_cells.wgsl?raw';
import markFluidShader from './shaders/mark_fluid.wgsl?raw';
import p2gShader from './shaders/p2g.wgsl?raw';
import normalizeGridShader from './shaders/normalize_grid.wgsl?raw';
import densityShader from './shaders/density.wgsl?raw';
import normalizeDensityShader from './shaders/normalize_density.wgsl?raw';

export class GPUComputePipelines {
  private device: GPUDevice;

  // Pipelines
  integratePipeline: GPUComputePipeline;
  updateColorsPipeline: GPUComputePipeline;
  collisionsPipeline: GPUComputePipeline;
  g2pPipeline: GPUComputePipeline;
  hashPipeline: GPUComputePipeline;
  countPipeline: GPUComputePipeline;
  prefixSumPipeline: GPUComputePipeline;
  reorderPipeline: GPUComputePipeline;
  pushApartPipeline: GPUComputePipeline;
  clearGridPipeline: GPUComputePipeline;
  markCellsPipeline: GPUComputePipeline;
  markFluidPipeline: GPUComputePipeline;
  p2gPipeline: GPUComputePipeline;
  normalizeGridPipeline: GPUComputePipeline;
  densityPipeline: GPUComputePipeline;
  normalizeDensityPipeline: GPUComputePipeline;

  // Bind groups
  integrateBindGroup: GPUBindGroup;
  updateColorsBindGroup: GPUBindGroup;
  collisionsBindGroup: GPUBindGroup;
  g2pBindGroup: GPUBindGroup;
  hashBindGroup: GPUBindGroup;
  countBindGroup: GPUBindGroup;
  prefixSumBindGroup: GPUBindGroup;
  reorderBindGroup: GPUBindGroup;
  pushApartBindGroup: GPUBindGroup;
  clearGridBindGroup: GPUBindGroup;
  markCellsBindGroup: GPUBindGroup;
  markFluidBindGroup: GPUBindGroup;
  p2gBindGroup: GPUBindGroup;
  normalizeGridBindGroup: GPUBindGroup;
  densityBindGroup: GPUBindGroup;
  normalizeDensityBindGroup: GPUBindGroup;

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

    // === Spatial Hash Pipelines ===

    // Hash pipeline
    const hashModule = device.createShaderModule({
      label: 'hash shader',
      code: hashShader,
    });
    this.hashPipeline = device.createComputePipeline({
      label: 'hash pipeline',
      layout: 'auto',
      compute: { module: hashModule, entryPoint: 'main' },
    });
    this.hashBindGroup = device.createBindGroup({
      label: 'hash bind group',
      layout: this.hashPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.particlePos } },
        { binding: 1, resource: { buffer: buffers.particleHash } },
        { binding: 2, resource: { buffer: buffers.particleIndex } },
        { binding: 3, resource: { buffer: buffers.simParams } },
      ],
    });

    // Count pipeline
    const countModule = device.createShaderModule({
      label: 'count shader',
      code: countShader,
    });
    this.countPipeline = device.createComputePipeline({
      label: 'count pipeline',
      layout: 'auto',
      compute: { module: countModule, entryPoint: 'main' },
    });
    this.countBindGroup = device.createBindGroup({
      label: 'count bind group',
      layout: this.countPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.particleHash } },
        { binding: 1, resource: { buffer: buffers.cellCount } },
        { binding: 2, resource: { buffer: buffers.simParams } },
      ],
    });

    // Prefix sum pipeline
    const prefixSumModule = device.createShaderModule({
      label: 'prefix sum shader',
      code: prefixSumShader,
    });
    this.prefixSumPipeline = device.createComputePipeline({
      label: 'prefix sum pipeline',
      layout: 'auto',
      compute: { module: prefixSumModule, entryPoint: 'main' },
    });
    this.prefixSumBindGroup = device.createBindGroup({
      label: 'prefix sum bind group',
      layout: this.prefixSumPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.cellCount } },
        { binding: 1, resource: { buffer: buffers.cellOffset } },
        { binding: 2, resource: { buffer: buffers.simParams } },
      ],
    });

    // Reorder pipeline
    const reorderModule = device.createShaderModule({
      label: 'reorder shader',
      code: reorderShader,
    });
    this.reorderPipeline = device.createComputePipeline({
      label: 'reorder pipeline',
      layout: 'auto',
      compute: { module: reorderModule, entryPoint: 'main' },
    });
    this.reorderBindGroup = device.createBindGroup({
      label: 'reorder bind group',
      layout: this.reorderPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.particleHash } },
        { binding: 1, resource: { buffer: buffers.particleIndex } },
        { binding: 2, resource: { buffer: buffers.cellOffset } },
        { binding: 3, resource: { buffer: buffers.sortedIndex } },
        { binding: 4, resource: { buffer: buffers.simParams } },
      ],
    });

    // Push apart pipeline
    const pushApartModule = device.createShaderModule({
      label: 'push apart shader',
      code: pushApartShader,
    });
    this.pushApartPipeline = device.createComputePipeline({
      label: 'push apart pipeline',
      layout: 'auto',
      compute: { module: pushApartModule, entryPoint: 'main' },
    });
    this.pushApartBindGroup = device.createBindGroup({
      label: 'push apart bind group',
      layout: this.pushApartPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.particlePos } },
        { binding: 1, resource: { buffer: buffers.cellOffset } },
        { binding: 2, resource: { buffer: buffers.sortedIndex } },
        { binding: 3, resource: { buffer: buffers.simParams } },
      ],
    });

    // === P2G Pipelines ===

    // Clear grid pipeline
    const clearGridModule = device.createShaderModule({
      label: 'clear grid shader',
      code: clearGridShader,
    });
    this.clearGridPipeline = device.createComputePipeline({
      label: 'clear grid pipeline',
      layout: 'auto',
      compute: { module: clearGridModule, entryPoint: 'main' },
    });
    this.clearGridBindGroup = device.createBindGroup({
      label: 'clear grid bind group',
      layout: this.clearGridPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.gridU } },
        { binding: 1, resource: { buffer: buffers.gridV } },
        { binding: 2, resource: { buffer: buffers.gridDU } },
        { binding: 3, resource: { buffer: buffers.gridDV } },
        { binding: 4, resource: { buffer: buffers.gridPrevU } },
        { binding: 5, resource: { buffer: buffers.gridPrevV } },
        { binding: 6, resource: { buffer: buffers.simParams } },
      ],
    });

    // Mark cells pipeline (marks SOLID/AIR based on solid flag)
    const markCellsModule = device.createShaderModule({
      label: 'mark cells shader',
      code: markCellsShader,
    });
    this.markCellsPipeline = device.createComputePipeline({
      label: 'mark cells pipeline',
      layout: 'auto',
      compute: { module: markCellsModule, entryPoint: 'main' },
    });
    this.markCellsBindGroup = device.createBindGroup({
      label: 'mark cells bind group',
      layout: this.markCellsPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.gridS } },
        { binding: 1, resource: { buffer: buffers.gridCellType } },
        { binding: 2, resource: { buffer: buffers.simParams } },
      ],
    });

    // Mark fluid pipeline (marks FLUID based on particle positions)
    const markFluidModule = device.createShaderModule({
      label: 'mark fluid shader',
      code: markFluidShader,
    });
    this.markFluidPipeline = device.createComputePipeline({
      label: 'mark fluid pipeline',
      layout: 'auto',
      compute: { module: markFluidModule, entryPoint: 'main' },
    });
    this.markFluidBindGroup = device.createBindGroup({
      label: 'mark fluid bind group',
      layout: this.markFluidPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.particlePos } },
        { binding: 1, resource: { buffer: buffers.gridCellType } },
        { binding: 2, resource: { buffer: buffers.simParams } },
      ],
    });

    // P2G pipeline (atomic accumulation)
    const p2gModule = device.createShaderModule({
      label: 'p2g shader',
      code: p2gShader,
    });
    this.p2gPipeline = device.createComputePipeline({
      label: 'p2g pipeline',
      layout: 'auto',
      compute: { module: p2gModule, entryPoint: 'main' },
    });
    this.p2gBindGroup = device.createBindGroup({
      label: 'p2g bind group',
      layout: this.p2gPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.particlePos } },
        { binding: 1, resource: { buffer: buffers.particleVel } },
        { binding: 2, resource: { buffer: buffers.gridUAccum } },
        { binding: 3, resource: { buffer: buffers.gridVAccum } },
        { binding: 4, resource: { buffer: buffers.gridDUAccum } },
        { binding: 5, resource: { buffer: buffers.gridDVAccum } },
        { binding: 6, resource: { buffer: buffers.simParams } },
      ],
    });

    // Normalize grid pipeline (converts atomic accum to f32 and restores solid)
    const normalizeGridModule = device.createShaderModule({
      label: 'normalize grid shader',
      code: normalizeGridShader,
    });
    this.normalizeGridPipeline = device.createComputePipeline({
      label: 'normalize grid pipeline',
      layout: 'auto',
      compute: { module: normalizeGridModule, entryPoint: 'main' },
    });
    this.normalizeGridBindGroup = device.createBindGroup({
      label: 'normalize grid bind group',
      layout: this.normalizeGridPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.gridUAccum } },
        { binding: 1, resource: { buffer: buffers.gridVAccum } },
        { binding: 2, resource: { buffer: buffers.gridDUAccum } },
        { binding: 3, resource: { buffer: buffers.gridDVAccum } },
        { binding: 4, resource: { buffer: buffers.gridU } },
        { binding: 5, resource: { buffer: buffers.gridV } },
        { binding: 6, resource: { buffer: buffers.gridPrevU } },
        { binding: 7, resource: { buffer: buffers.gridPrevV } },
        { binding: 8, resource: { buffer: buffers.gridCellType } },
        { binding: 9, resource: { buffer: buffers.simParams } },
      ],
    });

    // === Density Pipelines ===

    // Density accumulation pipeline
    const densityModule = device.createShaderModule({
      label: 'density shader',
      code: densityShader,
    });
    this.densityPipeline = device.createComputePipeline({
      label: 'density pipeline',
      layout: 'auto',
      compute: { module: densityModule, entryPoint: 'main' },
    });
    this.densityBindGroup = device.createBindGroup({
      label: 'density bind group',
      layout: this.densityPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.particlePos } },
        { binding: 1, resource: { buffer: buffers.densityAccum } },
        { binding: 2, resource: { buffer: buffers.simParams } },
      ],
    });

    // Normalize density pipeline
    const normalizeDensityModule = device.createShaderModule({
      label: 'normalize density shader',
      code: normalizeDensityShader,
    });
    this.normalizeDensityPipeline = device.createComputePipeline({
      label: 'normalize density pipeline',
      layout: 'auto',
      compute: { module: normalizeDensityModule, entryPoint: 'main' },
    });
    this.normalizeDensityBindGroup = device.createBindGroup({
      label: 'normalize density bind group',
      layout: this.normalizeDensityPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.densityAccum } },
        { binding: 1, resource: { buffer: buffers.gridDensity } },
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
