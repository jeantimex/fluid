/**
 * =============================================================================
 * Splat Pipeline - 3-Pass Density Volume Splatting
 * =============================================================================
 *
 * Converts particle positions into a 3D density texture using atomic splatting:
 *
 * 1. **Clear**: Zero the atomic density buffer
 * 2. **Splat**: Each particle writes its SPH kernel contribution to nearby voxels
 * 3. **Resolve**: Convert atomic integer values back to float density texture
 *
 * The resulting density texture is consumed by the marching cubes renderer.
 *
 * @module splat_pipeline
 */

import type { MarchingCubesConfig } from './types.ts';
import splatClearShader from './shaders/splat_clear.wgsl?raw';
import splatParticlesShader from './shaders/splat_particles.wgsl?raw';
import splatResolveShader from './shaders/splat_resolve.wgsl?raw';

/**
 * Manages the 3-pass density splatting system.
 *
 * This pipeline converts particle positions into a 3D density volume texture
 * using GPU compute shaders with atomic operations for thread-safe accumulation.
 */
export class SplatPipeline {
  private device: GPUDevice;

  // Pipelines
  private clearPipeline: GPUComputePipeline;
  private particlesPipeline: GPUComputePipeline;
  private resolvePipeline: GPUComputePipeline;

  // Bind groups
  private clearBindGroup!: GPUBindGroup;
  private particlesBindGroup!: GPUBindGroup;
  private resolveBindGroup!: GPUBindGroup;

  // Parameter buffers
  private clearParamsBuffer: GPUBuffer;
  private particlesParamsBuffer: GPUBuffer;
  private resolveParamsBuffer: GPUBuffer;

  // Typed array views for particle splat params
  private particlesParamsData: ArrayBuffer;
  private particlesParamsF32: Float32Array;
  private particlesParamsU32: Uint32Array;

  // Typed array views for resolve params
  private resolveParamsData: ArrayBuffer;
  private resolveParamsF32: Float32Array;
  private resolveParamsU32: Uint32Array;

  // Atomic density buffer for particle splatting
  private atomicDensityBuffer!: GPUBuffer;

  // Density volume texture and view
  private densityTexture!: GPUTexture;
  private _densityTextureView!: GPUTextureView;
  private densityTextureSize = { x: 1, y: 1, z: 1 };

  private densityWorkgroupSize = { x: 8, y: 8, z: 4 };

  constructor(device: GPUDevice) {
    this.device = device;

    // Splat clear pipeline
    const clearModule = device.createShaderModule({ code: splatClearShader });
    this.clearPipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module: clearModule, entryPoint: 'main' },
    });
    this.clearParamsBuffer = device.createBuffer({
      size: 16, // totalVoxels (u32) + padding to 16-byte alignment
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Splat particles pipeline
    const splatModule = device.createShaderModule({
      code: splatParticlesShader,
    });
    this.particlesPipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module: splatModule, entryPoint: 'main' },
    });
    // SplatParams: radius(f32), spikyPow2Scale(f32), particleCount(u32), fixedPointScale(f32),
    //              boundsSize(vec3<f32>), pad0(f32), volumeSize(vec3<u32>), pad1(u32) = 48 bytes
    this.particlesParamsData = new ArrayBuffer(48);
    this.particlesParamsF32 = new Float32Array(this.particlesParamsData);
    this.particlesParamsU32 = new Uint32Array(this.particlesParamsData);
    this.particlesParamsBuffer = device.createBuffer({
      size: 48,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Splat resolve pipeline
    const resolveModule = device.createShaderModule({
      code: splatResolveShader,
    });
    this.resolvePipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module: resolveModule, entryPoint: 'main' },
    });
    // ResolveParams: fixedPointScale(f32), pad0(f32), pad1(f32), pad2(f32),
    //                volumeSize(vec3<u32>), pad3(u32) = 32 bytes
    this.resolveParamsData = new ArrayBuffer(32);
    this.resolveParamsF32 = new Float32Array(this.resolveParamsData);
    this.resolveParamsU32 = new Uint32Array(this.resolveParamsData);
    this.resolveParamsBuffer = device.createBuffer({
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  /**
   * Returns the density texture view for use by the renderer.
   */
  get textureView(): GPUTextureView {
    return this._densityTextureView;
  }

  /**
   * Returns the current density texture dimensions (in voxels).
   */
  get textureSize(): { x: number; y: number; z: number } {
    return this.densityTextureSize;
  }

  /**
   * Recreates the density texture and bind groups after a simulation reset.
   *
   * @param config - Current simulation configuration
   * @param predictedBuffer - The predicted positions buffer to bind for splatting
   */
  recreate(config: MarchingCubesConfig, predictedBuffer: GPUBuffer): void {
    if (this.densityTexture) {
      this.densityTexture.destroy();
    }

    this.createDensityTexture(config);
    this.createAtomicDensityBuffer();
    this.createBindGroups(predictedBuffer);
  }

  /**
   * Dispatches the 3-pass splat pipeline: clear, splat, resolve.
   *
   * @param encoder - Command encoder to record compute passes to
   * @param particleCount - Number of particles to splat
   * @param config - Current simulation configuration
   */
  dispatch(
    encoder: GPUCommandEncoder,
    particleCount: number,
    config: MarchingCubesConfig
  ): void {
    this.updateParams(particleCount, config);

    const totalVoxels =
      this.densityTextureSize.x *
      this.densityTextureSize.y *
      this.densityTextureSize.z;

    // Pass 1: Clear atomic buffer
    const clearPass = encoder.beginComputePass();
    clearPass.setPipeline(this.clearPipeline);
    clearPass.setBindGroup(0, this.clearBindGroup);
    clearPass.dispatchWorkgroups(Math.ceil(totalVoxels / 256));
    clearPass.end();

    // Pass 2: Splat particles into atomic buffer
    const splatPass = encoder.beginComputePass();
    splatPass.setPipeline(this.particlesPipeline);
    splatPass.setBindGroup(0, this.particlesBindGroup);
    splatPass.dispatchWorkgroups(Math.ceil(particleCount / 256));
    splatPass.end();

    // Pass 3: Resolve atomic buffer to density texture
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

  /**
   * Destroys all GPU resources owned by this pipeline.
   */
  destroy(): void {
    if (this.densityTexture) {
      this.densityTexture.destroy();
    }
    if (this.atomicDensityBuffer) {
      this.atomicDensityBuffer.destroy();
    }
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  /**
   * Creates the 3D density texture sized proportionally to the simulation bounds.
   *
   * The longest axis gets `densityTextureRes` voxels; shorter axes are scaled
   * proportionally so voxels are roughly cubic. The texture format is
   * `rgba16float` to allow both storage writes (from the resolve pass) and
   * texture sampling (from the marching cubes compute shader).
   *
   * @param config - Configuration providing bounds dimensions and target resolution
   */
  private createDensityTexture(config: MarchingCubesConfig): void {
    const bounds = config.boundsSize;
    const maxAxis = Math.max(bounds.x, bounds.y, bounds.z);

    // Scale each axis relative to the longest so voxels are approximately cubic
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
        GPUTextureUsage.STORAGE_BINDING | // Written by the resolve compute shader
        GPUTextureUsage.TEXTURE_BINDING | // Sampled by the marching cubes compute shader
        GPUTextureUsage.COPY_SRC,
    });

    this._densityTextureView = this.densityTexture.createView({
      dimension: '3d',
    });
  }

  /**
   * Creates (or recreates) the atomic density buffer used for thread-safe
   * accumulation during the splat pass.
   *
   * Each voxel gets one `u32` slot. The splat shader uses `atomicAdd` with
   * fixed-point encoding to accumulate particle density contributions from
   * multiple threads without data races. The resolve pass later converts
   * these integer sums back to `f32` and writes the density texture.
   */
  private createAtomicDensityBuffer(): void {
    if (this.atomicDensityBuffer) {
      this.atomicDensityBuffer.destroy();
    }
    const totalVoxels =
      this.densityTextureSize.x *
      this.densityTextureSize.y *
      this.densityTextureSize.z;
    this.atomicDensityBuffer = this.device.createBuffer({
      size: totalVoxels * 4, // 4 bytes (one u32) per voxel
      usage: GPUBufferUsage.STORAGE,
    });
  }

  /**
   * Creates all three bind groups for the clear, splat, and resolve passes.
   *
   * @param predictedBuffer - GPU buffer of predicted particle positions
   *                          (vec4<f32> per particle, xyz = position)
   */
  private createBindGroups(predictedBuffer: GPUBuffer): void {
    // Clear bind group: atomic buffer (read_write) + clear params (uniform)
    this.clearBindGroup = this.device.createBindGroup({
      layout: this.clearPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.atomicDensityBuffer } },
        { binding: 1, resource: { buffer: this.clearParamsBuffer } },
      ],
    });

    // Splat particles bind group: positions (read) + atomic buffer (read_write) + params (uniform)
    this.particlesBindGroup = this.device.createBindGroup({
      layout: this.particlesPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: predictedBuffer } },
        { binding: 1, resource: { buffer: this.atomicDensityBuffer } },
        { binding: 2, resource: { buffer: this.particlesParamsBuffer } },
      ],
    });

    // Resolve bind group: atomic buffer (read) + density texture (write) + params (uniform)
    this.resolveBindGroup = this.device.createBindGroup({
      layout: this.resolvePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.atomicDensityBuffer } },
        { binding: 1, resource: this._densityTextureView },
        { binding: 2, resource: { buffer: this.resolveParamsBuffer } },
      ],
    });
  }

  /**
   * Uploads the per-frame parameters for all three passes to the GPU.
   *
   * Computes the Spiky kernel normalization factor and encodes all values
   * into the typed array views, then writes them to the respective uniform
   * buffers via `device.queue.writeBuffer`.
   *
   * @param particleCount - Number of active particles this frame
   * @param config - Current simulation configuration (bounds, smoothing radius)
   */
  private updateParams(particleCount: number, config: MarchingCubesConfig): void {
    const bounds = config.boundsSize;
    const radius = config.smoothingRadius;

    // Normalization constant for the Spiky² kernel: 15 / (2π r⁵)
    const spikyPow2Scale = 15 / (2 * Math.PI * Math.pow(radius, 5));

    // Scale factor for fixed-point encoding (float → u32 via atomicAdd)
    const fixedPointScale = 1000.0;

    const totalVoxels =
      this.densityTextureSize.x *
      this.densityTextureSize.y *
      this.densityTextureSize.z;

    // Clear params: totalVoxels (u32) + 3x padding
    const clearData = new Uint32Array(4);
    clearData[0] = totalVoxels;
    this.device.queue.writeBuffer(this.clearParamsBuffer, 0, clearData);

    // Splat particles params
    this.particlesParamsF32[0] = radius;
    this.particlesParamsF32[1] = spikyPow2Scale;
    this.particlesParamsU32[2] = particleCount;
    this.particlesParamsF32[3] = fixedPointScale;
    this.particlesParamsF32[4] = bounds.x;
    this.particlesParamsF32[5] = bounds.y;
    this.particlesParamsF32[6] = bounds.z;
    this.particlesParamsF32[7] = 0;
    this.particlesParamsU32[8] = this.densityTextureSize.x;
    this.particlesParamsU32[9] = this.densityTextureSize.y;
    this.particlesParamsU32[10] = this.densityTextureSize.z;
    this.particlesParamsU32[11] = 0;
    this.device.queue.writeBuffer(
      this.particlesParamsBuffer,
      0,
      this.particlesParamsData
    );

    // Resolve params
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
