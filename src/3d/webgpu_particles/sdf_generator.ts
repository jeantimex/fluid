import sdfShader from './shaders/sdf_generator.wgsl?raw';
import type { GpuModel } from './model_loader.ts';

export class SDFGenerator {
  private device: GPUDevice;
  private pipeline: GPUComputePipeline;
  
  public texture: GPUTexture;
  public textureView: GPUTextureView;
  public sampler: GPUSampler;
  public bounds: { min: [number, number, number], max: [number, number, number] };

  // Resolution of the SDF grid (e.g., 64x64x64)
  private readonly resolution = 64;

  constructor(device: GPUDevice) {
    this.device = device;

    const module = device.createShaderModule({ code: sdfShader });
    this.pipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module, entryPoint: 'main' }
    });

    this.texture = this.device.createTexture({
      size: { width: this.resolution, height: this.resolution, depthOrArrayLayers: this.resolution },
      dimension: '3d',
      format: 'r32float',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING
    });
    this.textureView = this.texture.createView();
    
    this.sampler = device.createSampler({
      magFilter: 'nearest',
      minFilter: 'nearest',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
      addressModeW: 'clamp-to-edge',
    });

    // Default bounds (safe fallback)
    this.bounds = { min: [-10,-10,-10], max: [10,10,10] };

    // Initialize texture to "empty" (large distance)
    this.clearTexture();
  }

  private clearTexture() {
    // Dummy buffers
    const dummyStorage = this.device.createBuffer({ size: 4, usage: GPUBufferUsage.STORAGE });
    
    const paramsBuffer = this.device.createBuffer({
      size: 48,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });

    const paramsData = new ArrayBuffer(48);
    new Uint32Array(paramsData)[0] = this.resolution;
    new Uint32Array(paramsData)[1] = this.resolution;
    new Uint32Array(paramsData)[2] = this.resolution;
    new Uint32Array(paramsData)[3] = 0; // 0 triangles
    // Bounds don't matter for 0 triangles, but set reasonable values
    new Float32Array(paramsData, 16)[0] = -10; // minX
    new Float32Array(paramsData, 32)[0] = 10;  // maxX
    
    this.device.queue.writeBuffer(paramsBuffer, 0, paramsData);

    const bindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: dummyStorage } }, // indices
        { binding: 1, resource: { buffer: dummyStorage } }, // positions
        { binding: 2, resource: this.textureView },
        { binding: 3, resource: { buffer: paramsBuffer } }
      ]
    });

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(
      Math.ceil(this.resolution / 4), 
      Math.ceil(this.resolution / 4), 
      Math.ceil(this.resolution / 4)
    );
    pass.end();
    this.device.queue.submit([encoder.finish()]);

    // dummyStorage.destroy(); // Keep it alive until submission processed? 
    // WebGPU allows destroy immediately, it defers until GPU is done.
    dummyStorage.destroy();
    paramsBuffer.destroy();
  }

  async generate(model: GpuModel): Promise<void> {
    const { positions, indices } = model.meshData;
    
    // 1. Calculate Bounds
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i];
      const y = positions[i+1];
      const z = positions[i+2];
      
      minX = Math.min(minX, x); minY = Math.min(minY, y); minZ = Math.min(minZ, z);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); maxZ = Math.max(maxZ, z);
    }

    // Add padding to bounds
    const padding = 0.5;
    minX -= padding; minY -= padding; minZ -= padding;
    maxX += padding; maxY += padding; maxZ += padding;

    this.bounds = { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };

    // 2. Upload Geometry to Storage Buffers
    // Indices (convert to u32 if needed)
    let indicesU32: Uint32Array;
    if (indices instanceof Uint16Array) {
      indicesU32 = new Uint32Array(indices);
    } else {
      indicesU32 = indices as Uint32Array;
    }

    const indicesBuffer = this.device.createBuffer({
      size: indicesU32.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true
    });
    new Uint32Array(indicesBuffer.getMappedRange()).set(indicesU32);
    indicesBuffer.unmap();

    // Positions (Float32Array)
    const posBuffer = this.device.createBuffer({
      size: positions.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true
    });
    new Float32Array(posBuffer.getMappedRange()).set(positions);
    posBuffer.unmap();

    // 3. Uniform Params
    const paramsBuffer = this.device.createBuffer({
      size: 48, // 3 u32 + 1 u32 + 3 f32 + 1 f32 + 3 f32 + 1 f32
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });

    const paramsData = new ArrayBuffer(48);
    const paramsU32 = new Uint32Array(paramsData);
    const paramsF32 = new Float32Array(paramsData);

    paramsU32[0] = this.resolution;
    paramsU32[1] = this.resolution;
    paramsU32[2] = this.resolution;
    paramsU32[3] = indicesU32.length / 3; // Triangle count

    paramsF32[4] = minX; paramsF32[5] = minY; paramsF32[6] = minZ; paramsF32[7] = 0;
    paramsF32[8] = maxX; paramsF32[9] = maxY; paramsF32[10] = maxZ; paramsF32[11] = 0;

    this.device.queue.writeBuffer(paramsBuffer, 0, paramsData);

    // 4. Bind Group
    const bindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: indicesBuffer } },
        { binding: 1, resource: { buffer: posBuffer } },
        { binding: 2, resource: this.textureView },
        { binding: 3, resource: { buffer: paramsBuffer } }
      ]
    });

    // 5. Dispatch
    const commandEncoder = this.device.createCommandEncoder();
    const pass = commandEncoder.beginComputePass();
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(
      Math.ceil(this.resolution / 4), 
      Math.ceil(this.resolution / 4), 
      Math.ceil(this.resolution / 4)
    );
    pass.end();

    this.device.queue.submit([commandEncoder.finish()]);

    // Cleanup temp buffers immediately (GPU operations are queued)
    // Actually, we must wait for queue to finish or let GC handle it.
    // In WebGPU, destroying buffers that are in use is safe (they live until use completes).
    indicesBuffer.destroy();
    posBuffer.destroy();
    paramsBuffer.destroy();
  }
}
