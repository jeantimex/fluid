import type { ParticlesConfig } from './types.ts';
import splatClearShader from '../common/shaders/splat_clear.wgsl?raw';
import splatParticlesShader from '../common/shaders/splat_particles.wgsl?raw';
import splatResolveShader from '../common/shaders/splat_resolve.wgsl?raw';

export class DensitySplatPipeline {
  private device: GPUDevice;

  private clearPipeline: GPUComputePipeline;
  private particlesPipeline: GPUComputePipeline;
  private resolvePipeline: GPUComputePipeline;

  private clearBindGroup!: GPUBindGroup;
  private particlesBindGroup!: GPUBindGroup;
  private resolveBindGroup!: GPUBindGroup;

  private clearParamsBuffer: GPUBuffer;
  private particlesParamsBuffer: GPUBuffer;
  private resolveParamsBuffer: GPUBuffer;

  private particlesParamsData: ArrayBuffer;
  private particlesParamsF32: Float32Array;
  private particlesParamsU32: Uint32Array;

  private resolveParamsData: ArrayBuffer;
  private resolveParamsF32: Float32Array;
  private resolveParamsU32: Uint32Array;

  private atomicDensityBuffer!: GPUBuffer;

  private densityTexture!: GPUTexture;
  private _densityTextureView!: GPUTextureView;
  private densityTextureSize = { x: 1, y: 1, z: 1 };

  private densityWorkgroupSize = { x: 8, y: 8, z: 4 };

  constructor(device: GPUDevice) {
    this.device = device;

    const clearModule = device.createShaderModule({ code: splatClearShader });
    this.clearPipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module: clearModule, entryPoint: 'main' },
    });
    this.clearParamsBuffer = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const splatModule = device.createShaderModule({
      code: splatParticlesShader,
    });
    this.particlesPipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module: splatModule, entryPoint: 'main' },
    });
    this.particlesParamsData = new ArrayBuffer(64);
    this.particlesParamsF32 = new Float32Array(this.particlesParamsData);
    this.particlesParamsU32 = new Uint32Array(this.particlesParamsData);
    this.particlesParamsBuffer = device.createBuffer({
      size: 64,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const resolveModule = device.createShaderModule({
      code: splatResolveShader,
    });
    this.resolvePipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module: resolveModule, entryPoint: 'main' },
    });
    this.resolveParamsData = new ArrayBuffer(32);
    this.resolveParamsF32 = new Float32Array(this.resolveParamsData);
    this.resolveParamsU32 = new Uint32Array(this.resolveParamsData);
    this.resolveParamsBuffer = device.createBuffer({
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  get textureView(): GPUTextureView {
    return this._densityTextureView;
  }

  recreate(config: ParticlesConfig, predictedBuffer: GPUBuffer): void {
    if (this.densityTexture) {
      this.densityTexture.destroy();
    }

    this.createDensityTexture(config);
    this.createAtomicDensityBuffer();
    this.createBindGroups(predictedBuffer);
  }

  dispatch(
    encoder: GPUCommandEncoder,
    particleCount: number,
    config: ParticlesConfig
  ): void {
    this.updateParams(particleCount, config);

    const totalVoxels =
      this.densityTextureSize.x *
      this.densityTextureSize.y *
      this.densityTextureSize.z;

    const clearPass = encoder.beginComputePass();
    clearPass.setPipeline(this.clearPipeline);
    clearPass.setBindGroup(0, this.clearBindGroup);
    clearPass.dispatchWorkgroups(Math.ceil(totalVoxels / 256));
    clearPass.end();

    const splatPass = encoder.beginComputePass();
    splatPass.setPipeline(this.particlesPipeline);
    splatPass.setBindGroup(0, this.particlesBindGroup);
    splatPass.dispatchWorkgroups(Math.ceil(particleCount / 256));
    splatPass.end();

    const resolvePass = encoder.beginComputePass();
    resolvePass.setPipeline(this.resolvePipeline);
    resolvePass.setBindGroup(0, this.resolveBindGroup);
    resolvePass.dispatchWorkgroups(
      Math.ceil(this.densityTextureSize.x / this.densityWorkgroupSize.x),
      Math.ceil(this.densityTextureSize.y / this.densityWorkgroupSize.y),
      Math.ceil(this.densityTextureSize.z / this.densityWorkgroupSize.z)
    );
    resolvePass.end();
  }

  destroy(): void {
    if (this.densityTexture) {
      this.densityTexture.destroy();
    }
    if (this.atomicDensityBuffer) {
      this.atomicDensityBuffer.destroy();
    }
  }

  private createDensityTexture(config: ParticlesConfig): void {
    const bounds = config.boundsSize;
    const maxAxis = Math.max(bounds.x, bounds.y, bounds.z);

    const targetRes = Math.max(1, Math.round(config.densityTextureRes));
    const width = Math.max(1, Math.round((bounds.x / maxAxis) * targetRes));
    const height = Math.max(1, Math.round((bounds.y / maxAxis) * targetRes));
    const depth = Math.max(1, Math.round((bounds.z / maxAxis) * targetRes));

    this.densityTextureSize = { x: width, y: height, z: depth };

    this.densityTexture = this.device.createTexture({
      size: { width, height, depthOrArrayLayers: depth },
      dimension: '3d',
      format: 'rgba16float',
      usage:
        GPUTextureUsage.STORAGE_BINDING |
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_SRC,
    });

    this._densityTextureView = this.densityTexture.createView({
      dimension: '3d',
    });
  }

  private createAtomicDensityBuffer(): void {
    if (this.atomicDensityBuffer) {
      this.atomicDensityBuffer.destroy();
    }
    const totalVoxels =
      this.densityTextureSize.x *
      this.densityTextureSize.y *
      this.densityTextureSize.z;
    this.atomicDensityBuffer = this.device.createBuffer({
      size: totalVoxels * 4,
      usage: GPUBufferUsage.STORAGE,
    });
  }

  private createBindGroups(predictedBuffer: GPUBuffer): void {
    this.clearBindGroup = this.device.createBindGroup({
      layout: this.clearPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.atomicDensityBuffer } },
        { binding: 1, resource: { buffer: this.clearParamsBuffer } },
      ],
    });

    this.particlesBindGroup = this.device.createBindGroup({
      layout: this.particlesPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: predictedBuffer } },
        { binding: 1, resource: { buffer: this.atomicDensityBuffer } },
        { binding: 2, resource: { buffer: this.particlesParamsBuffer } },
      ],
    });

    this.resolveBindGroup = this.device.createBindGroup({
      layout: this.resolvePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.atomicDensityBuffer } },
        { binding: 1, resource: this._densityTextureView },
        { binding: 2, resource: { buffer: this.resolveParamsBuffer } },
      ],
    });
  }

  private updateParams(particleCount: number, config: ParticlesConfig): void {
    const radius = config.smoothingRadius;

    const spikyPow2Scale = 15 / (2 * Math.PI * Math.pow(radius, 5));
    const fixedPointScale = 1000.0;

    const totalVoxels =
      this.densityTextureSize.x *
      this.densityTextureSize.y *
      this.densityTextureSize.z;

    const size = config.boundsSize;
    const hx = size.x * 0.5;
    const hz = size.z * 0.5;
    const minY = -5.0; // Fixed bottom

    // Clear params: totalVoxels (u32) + 3x padding
    const clearData = new Uint32Array(4);
    clearData[0] = totalVoxels;
    this.device.queue.writeBuffer(this.clearParamsBuffer, 0, clearData);

    // Splat particles params
    this.particlesParamsF32[0] = radius;
    this.particlesParamsF32[1] = spikyPow2Scale;
    this.particlesParamsU32[2] = particleCount;
    this.particlesParamsF32[3] = fixedPointScale;
    
    // minBounds
    this.particlesParamsF32[4] = -hx;
    this.particlesParamsF32[5] = minY;
    this.particlesParamsF32[6] = -hz;
    this.particlesParamsF32[7] = 0;

    // maxBounds
    this.particlesParamsF32[8] = hx;
    this.particlesParamsF32[9] = minY + size.y;
    this.particlesParamsF32[10] = hz;
    this.particlesParamsF32[11] = 0;

    // volumeSize
    this.particlesParamsU32[12] = this.densityTextureSize.x;
    this.particlesParamsU32[13] = this.densityTextureSize.y;
    this.particlesParamsU32[14] = this.densityTextureSize.z;
    this.particlesParamsU32[15] = 0;

    this.device.queue.writeBuffer(
      this.particlesParamsBuffer,
      0,
      this.particlesParamsData
    );

    this.resolveParamsF32[0] = fixedPointScale;
    this.resolveParamsF32[1] = 0;
    this.resolveParamsF32[2] = 0;
    this.resolveParamsF32[3] = 0;
    this.resolveParamsU32[4] = this.densityTextureSize.x;
    this.resolveParamsU32[5] = this.densityTextureSize.y;
    this.resolveParamsU32[6] = this.densityTextureSize.z;
    this.resolveParamsU32[7] = 0;
    this.device.queue.writeBuffer(
      this.resolveParamsBuffer,
      0,
      this.resolveParamsData
    );
  }
}
