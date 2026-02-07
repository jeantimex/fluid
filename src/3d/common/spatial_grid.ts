import type { FluidBuffers } from './fluid_buffers.ts';

// Shader imports
import hashShader from './shaders/hash_linear.wgsl?raw';
import sortShader from './shaders/sort_linear.wgsl?raw';
import prefixSumShader from './shaders/prefix_sum.wgsl?raw';
import scatterShader from './shaders/scatter_linear.wgsl?raw';
import reorderShader from './shaders/reorder.wgsl?raw';

export interface SpatialGridUniforms {
  hash: GPUBuffer;
  sort: GPUBuffer;
  scanL0: GPUBuffer;
  scanL1: GPUBuffer;
  scanL2: GPUBuffer;
}

/**
 * Encapsulates the 7-pass (or more, including hierarchical scan) Linear Grid 
 * spatial hashing and sorting pipeline.
 */
export class SpatialGrid {
  /**
   * Beginner note:
   * This builds a sorted particle order so neighbor queries become fast.
   * Think of it as a GPU-side spatial index.
   */
  private device: GPUDevice;
  
  // Pipelines
  private hashPipeline: GPUComputePipeline;
  private clearOffsetsPipeline: GPUComputePipeline;
  private countOffsetsPipeline: GPUComputePipeline;
  private prefixScanPipeline: GPUComputePipeline;
  private prefixCombinePipeline: GPUComputePipeline;
  private scatterPipeline: GPUComputePipeline;
  private reorderPipeline: GPUComputePipeline;
  private copyBackPipeline: GPUComputePipeline;

  // Bind Groups
  private hashBG!: GPUBindGroup;
  private clearBG!: GPUBindGroup;
  private countBG!: GPUBindGroup;
  private scanL0BG!: GPUBindGroup;
  private scanL1BG!: GPUBindGroup;
  private scanL2BG!: GPUBindGroup;
  private combineL1BG!: GPUBindGroup;
  private combineL0BG!: GPUBindGroup;
  private scatterBG!: GPUBindGroup;
  private reorderBG!: GPUBindGroup;
  private copyBackBG!: GPUBindGroup;

  constructor(device: GPUDevice) {
    this.device = device;

    // Create Pipelines
    this.hashPipeline = this.createPipeline(hashShader, 'main');
    this.clearOffsetsPipeline = this.createPipeline(sortShader, 'clearOffsets');
    this.countOffsetsPipeline = this.createPipeline(sortShader, 'countOffsets');
    this.prefixScanPipeline = this.createPipeline(prefixSumShader, 'blockScan');
    this.prefixCombinePipeline = this.createPipeline(prefixSumShader, 'blockCombine');
    this.scatterPipeline = this.createPipeline(scatterShader, 'scatter');
    this.reorderPipeline = this.createPipeline(reorderShader, 'reorder');
    this.copyBackPipeline = this.createPipeline(reorderShader, 'copyBack');
  }

  private createPipeline(code: string, entryPoint: string): GPUComputePipeline {
    return this.device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: this.device.createShaderModule({ code }),
        entryPoint,
      },
    });
  }

  /**
   * (Re)creates bind groups when buffers change.
   */
  createBindGroups(buffers: FluidBuffers, uniforms: SpatialGridUniforms) {
    if (!buffers.particleCellOffsets) {
      throw new Error('SpatialGrid requires FluidBuffers allocated with gridTotalCells (Linear Grid mode).');
    }

    this.hashBG = this.device.createBindGroup({
      layout: this.hashPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.predicted } },
        { binding: 1, resource: { buffer: buffers.keys } },
        { binding: 2, resource: { buffer: buffers.indices } },
        { binding: 3, resource: { buffer: uniforms.hash } },
      ],
    });

    this.clearBG = this.device.createBindGroup({
      layout: this.clearOffsetsPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.sortOffsets } },
        { binding: 1, resource: { buffer: uniforms.sort } },
      ],
    });

    this.countBG = this.device.createBindGroup({
      layout: this.countOffsetsPipeline.getBindGroupLayout(1),
      entries: [
        { binding: 0, resource: { buffer: buffers.keys } },
        { binding: 1, resource: { buffer: buffers.sortOffsets } },
        { binding: 2, resource: { buffer: uniforms.sort } },
        { binding: 3, resource: { buffer: buffers.particleCellOffsets } },
      ],
    });

    this.scanL0BG = this.device.createBindGroup({
      layout: this.prefixScanPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.sortOffsets } },
        { binding: 1, resource: { buffer: buffers.groupSumsL1 } },
        { binding: 2, resource: { buffer: uniforms.scanL0 } },
      ],
    });

    this.scanL1BG = this.device.createBindGroup({
      layout: this.prefixScanPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.groupSumsL1 } },
        { binding: 1, resource: { buffer: buffers.groupSumsL2 } },
        { binding: 2, resource: { buffer: uniforms.scanL1 } },
      ],
    });

    this.scanL2BG = this.device.createBindGroup({
      layout: this.prefixScanPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.groupSumsL2 } },
        { binding: 1, resource: { buffer: buffers.scanScratch } },
        { binding: 2, resource: { buffer: uniforms.scanL2 } },
      ],
    });

    this.combineL1BG = this.device.createBindGroup({
      layout: this.prefixCombinePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.groupSumsL1 } },
        { binding: 2, resource: { buffer: uniforms.scanL1 } },
        { binding: 3, resource: { buffer: buffers.groupSumsL2 } },
      ],
    });

    this.combineL0BG = this.device.createBindGroup({
      layout: this.prefixCombinePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.sortOffsets } },
        { binding: 2, resource: { buffer: uniforms.scanL0 } },
        { binding: 3, resource: { buffer: buffers.groupSumsL1 } },
      ],
    });

    this.scatterBG = this.device.createBindGroup({
      layout: this.scatterPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.keys } },
        { binding: 1, resource: { buffer: buffers.sortOffsets } },
        { binding: 2, resource: { buffer: buffers.indices } },
        { binding: 3, resource: { buffer: uniforms.sort } },
        { binding: 4, resource: { buffer: buffers.particleCellOffsets } },
      ],
    });

    this.reorderBG = this.device.createBindGroup({
      layout: this.reorderPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.indices } },
        { binding: 1, resource: { buffer: buffers.positions } },
        { binding: 2, resource: { buffer: buffers.velocities } },
        { binding: 3, resource: { buffer: buffers.predicted } },
        { binding: 4, resource: { buffer: buffers.positionsSorted } },
        { binding: 5, resource: { buffer: buffers.velocitiesSorted } },
        { binding: 6, resource: { buffer: buffers.predictedSorted } },
        { binding: 7, resource: { buffer: uniforms.sort } },
      ],
    });

    this.copyBackBG = this.device.createBindGroup({
      layout: this.copyBackPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 1, resource: { buffer: buffers.positions } },
        { binding: 2, resource: { buffer: buffers.velocities } },
        { binding: 3, resource: { buffer: buffers.predicted } },
        { binding: 4, resource: { buffer: buffers.positionsSorted } },
        { binding: 5, resource: { buffer: buffers.velocitiesSorted } },
        { binding: 6, resource: { buffer: buffers.predictedSorted } },
        { binding: 7, resource: { buffer: uniforms.sort } },
      ],
    });
  }

  /**
   * Records the full spatial hashing and sorting pass into a compute pass encoder.
   */
  dispatch(
    pass: GPUComputePassEncoder,
    particleCount: number,
    gridTotalCells: number
  ) {
    const numParticleBlocks = Math.ceil(particleCount / 256);
    const numGridBlocksL0 = Math.ceil((gridTotalCells + 1) / 512);
    const numGridBlocksL1 = Math.ceil(numGridBlocksL0 / 512);
    const numGridBlocksL2 = Math.ceil(numGridBlocksL1 / 512);

    // 1. Hash Predicted Positions
    pass.setPipeline(this.hashPipeline);
    pass.setBindGroup(0, this.hashBG);
    pass.dispatchWorkgroups(numParticleBlocks);

    // 2. Clear Histogram
    pass.setPipeline(this.clearOffsetsPipeline);
    pass.setBindGroup(0, this.clearBG);
    pass.dispatchWorkgroups(Math.ceil((gridTotalCells + 1) / 256));

    // 3. Count Particles per Cell
    pass.setPipeline(this.countOffsetsPipeline);
    pass.setBindGroup(1, this.countBG);
    pass.dispatchWorkgroups(numParticleBlocks);

    // 4. Hierarchical Prefix Sum (Scan sortOffsets)
    pass.setPipeline(this.prefixScanPipeline);
    
    // L0 -> L1
    pass.setBindGroup(0, this.scanL0BG);
    pass.dispatchWorkgroups(numGridBlocksL0);
    
    if (numGridBlocksL0 > 1) {
      // L1 -> L2
      pass.setBindGroup(0, this.scanL1BG);
      pass.dispatchWorkgroups(numGridBlocksL1);
    }
    
    if (numGridBlocksL1 > 1) {
      // L2 -> scratch
      pass.setBindGroup(0, this.scanL2BG);
      pass.dispatchWorkgroups(numGridBlocksL2);
    }

    // 5. Combine sums back
    pass.setPipeline(this.prefixCombinePipeline);
    
    if (numGridBlocksL1 > 1) {
      // L2 -> L1
      pass.setBindGroup(0, this.combineL1BG);
      pass.dispatchWorkgroups(numGridBlocksL1);
    }
    
    if (numGridBlocksL0 > 1) {
      // L1 -> L0
      pass.setBindGroup(0, this.combineL0BG);
      pass.dispatchWorkgroups(numGridBlocksL0);
    }

    // 6. Scatter particles to sorted positions
    pass.setPipeline(this.scatterPipeline);
    pass.setBindGroup(0, this.scatterBG);
    pass.dispatchWorkgroups(numParticleBlocks);

    // 7. Physical Reorder
    pass.setPipeline(this.reorderPipeline);
    pass.setBindGroup(0, this.reorderBG);
    pass.dispatchWorkgroups(numParticleBlocks);

    // 8. Copy Back (optional if we switch to ping-pong, but currently required)
    pass.setPipeline(this.copyBackPipeline);
    pass.setBindGroup(0, this.copyBackBG);
    pass.dispatchWorkgroups(numParticleBlocks);
  }
}
