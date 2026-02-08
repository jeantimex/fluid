import pickingShader from './shaders/picking.wgsl?raw';

export interface PickingResult {
  hitPos: { x: number; y: number; z: number };
  hitDist: number;
  particleIndex: number;
  hit: boolean;
}

export class PickingSystem {
  private device: GPUDevice;
  private pipeline: GPUComputePipeline;
  private clearPipeline: GPUComputePipeline;
  private bindGroupLayout: GPUBindGroupLayout;

  private uniformsBuffer: GPUBuffer;
  private resultBuffer: GPUBuffer;
  private readbackBuffer: GPUBuffer;

  private bindGroup!: GPUBindGroup;

  constructor(device: GPUDevice) {
    this.device = device;

    const module = device.createShaderModule({ code: pickingShader });

    this.bindGroupLayout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'read-only-storage' },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'uniform' },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'storage' },
        },
      ],
    });

    const pipelineLayout = device.createPipelineLayout({
      bindGroupLayouts: [this.bindGroupLayout],
    });

    this.pipeline = device.createComputePipeline({
      layout: pipelineLayout,
      compute: { module, entryPoint: 'main' },
    });

    this.clearPipeline = device.createComputePipeline({
      layout: pipelineLayout,
      compute: { module, entryPoint: 'clear' },
    });

    this.uniformsBuffer = device.createBuffer({
      size: 48, // Ray(32) + radius(4) + count(4) + padding(8)
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.resultBuffer = device.createBuffer({
      size: 32, // hitPos(12) + hitDist(4) + index(4) + hit(4) + padding(8)
      usage:
        GPUBufferUsage.STORAGE |
        GPUBufferUsage.COPY_SRC |
        GPUBufferUsage.COPY_DST,
    });

    this.readbackBuffer = device.createBuffer({
      size: 32,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
  }

  createBindGroup(positionsBuffer: GPUBuffer) {
    this.bindGroup = this.device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: positionsBuffer } },
        { binding: 1, resource: { buffer: this.uniformsBuffer } },
        { binding: 2, resource: { buffer: this.resultBuffer } },
      ],
    });
  }

  dispatch(
    encoder: GPUCommandEncoder,
    rayOrigin: { x: number; y: number; z: number },
    rayDir: { x: number; y: number; z: number },
    particleRadius: number,
    particleCount: number
  ) {
    // 1. Update uniforms
    const uniformsData = new Float32Array(12);
    uniformsData[0] = rayOrigin.x;
    uniformsData[1] = rayOrigin.y;
    uniformsData[2] = rayOrigin.z;
    // pad0
    uniformsData[4] = rayDir.x;
    uniformsData[5] = rayDir.y;
    uniformsData[6] = rayDir.z;
    // pad1
    uniformsData[8] = particleRadius;
    new Uint32Array(uniformsData.buffer)[9] = particleCount;

    this.device.queue.writeBuffer(this.uniformsBuffer, 0, uniformsData);

    // 2. Clear result
    const clearPass = encoder.beginComputePass();
    clearPass.setPipeline(this.clearPipeline);
    clearPass.setBindGroup(0, this.bindGroup);
    clearPass.dispatchWorkgroups(1);
    clearPass.end();

    // 3. Run picking
    const pickingPass = encoder.beginComputePass();
    pickingPass.setPipeline(this.pipeline);
    pickingPass.setBindGroup(0, this.bindGroup);
    pickingPass.dispatchWorkgroups(Math.ceil(particleCount / 256));
    pickingPass.end();

    // 4. Copy to readback buffer
    encoder.copyBufferToBuffer(
      this.resultBuffer,
      0,
      this.readbackBuffer,
      0,
      32
    );
  }

  async getResult(): Promise<PickingResult | null> {
    await this.readbackBuffer.mapAsync(GPUMapMode.READ);
    const data = new Float32Array(this.readbackBuffer.getMappedRange());

    // hit is at offset 20 (index 5 in 4-byte units)
    const hit = new Uint32Array(data.buffer)[5] === 1;
    let result: PickingResult | null = null;

    if (hit) {
      result = {
        hitPos: { x: data[0], y: data[1], z: data[2] },
        hitDist: data[3],
        particleIndex: new Int32Array(data.buffer)[4],
        hit: true,
      };
    }

    this.readbackBuffer.unmap();
    return result;
  }
}
