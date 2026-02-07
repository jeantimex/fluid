import type { FluidBuffers } from './fluid_buffers.ts';

import foamSpawnShader from './shaders/foam_spawn.wgsl?raw';
import foamUpdateShader from './shaders/foam_update.wgsl?raw';
import foamClearCounterShader from './shaders/foam_clear_counter.wgsl?raw';

export interface FoamUniforms {
  spawn: GPUBuffer;
  update: GPUBuffer;
}

export class FoamPipeline {
  private device: GPUDevice;

  private foamClearCounter: GPUComputePipeline;
  private foamSpawn: GPUComputePipeline;
  private foamUpdate: GPUComputePipeline;

  private foamClearCounterBindGroup!: GPUBindGroup;
  private foamSpawnBindGroup!: GPUBindGroup;
  private foamUpdateBindGroup!: GPUBindGroup;

  constructor(device: GPUDevice) {
    this.device = device;

    this.foamClearCounter = this.createPipeline(foamClearCounterShader, 'main');
    this.foamSpawn = this.createPipeline(foamSpawnShader, 'main');
    this.foamUpdate = this.createPipeline(foamUpdateShader, 'main');
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

  createBindGroups(buffers: FluidBuffers, uniforms: FoamUniforms): void {
    if (!buffers.foamPositions || !buffers.foamVelocities || !buffers.foamCounter) {
      throw new Error('FoamPipeline requires FluidBuffers created with includeFoam.');
    }

    this.foamClearCounterBindGroup = this.device.createBindGroup({
      layout: this.foamClearCounter.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: buffers.foamCounter } }],
    });

    this.foamSpawnBindGroup = this.device.createBindGroup({
      layout: this.foamSpawn.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.predicted } },
        { binding: 1, resource: { buffer: buffers.velocities } },
        { binding: 3, resource: { buffer: buffers.foamPositions } },
        { binding: 4, resource: { buffer: buffers.foamVelocities } },
        { binding: 5, resource: { buffer: buffers.foamCounter } },
        { binding: 6, resource: { buffer: uniforms.spawn } },
        { binding: 7, resource: { buffer: buffers.sortOffsets } },
      ],
    });

    this.foamUpdateBindGroup = this.device.createBindGroup({
      layout: this.foamUpdate.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.foamPositions } },
        { binding: 1, resource: { buffer: buffers.foamVelocities } },
        { binding: 2, resource: { buffer: uniforms.update } },
        { binding: 3, resource: { buffer: buffers.predicted } },
        { binding: 4, resource: { buffer: buffers.velocities } },
        { binding: 5, resource: { buffer: buffers.sortOffsets } },
      ],
    });
  }

  dispatch(
    encoder: GPUCommandEncoder,
    particleCount: number,
    maxFoamParticles: number,
    clearCounter: boolean = false
  ): void {
    if (clearCounter) {
      const clearPass = encoder.beginComputePass();
      clearPass.setPipeline(this.foamClearCounter);
      clearPass.setBindGroup(0, this.foamClearCounterBindGroup);
      clearPass.dispatchWorkgroups(1);
      clearPass.end();
    }

    const spawnPass = encoder.beginComputePass();
    spawnPass.setPipeline(this.foamSpawn);
    spawnPass.setBindGroup(0, this.foamSpawnBindGroup);
    spawnPass.dispatchWorkgroups(Math.ceil(particleCount / 256));
    spawnPass.end();

    const updatePass = encoder.beginComputePass();
    updatePass.setPipeline(this.foamUpdate);
    updatePass.setBindGroup(0, this.foamUpdateBindGroup);
    updatePass.dispatchWorkgroups(Math.ceil(maxFoamParticles / 256));
    updatePass.end();
  }
}
