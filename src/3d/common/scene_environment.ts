import type { EnvironmentConfig } from './environment.ts';
import type { SimConfig } from './types.ts';
import { writeEnvironmentUniforms } from './environment.ts';
import { preprocessShader } from './shader_preprocessor.ts';

// Shader imports
import backgroundShader from '../webgpu_particles/shaders/background.wgsl?raw';
import environmentShader from './shaders/environment.wgsl?raw';

/**
 * Manages the visual environment (Sky, Floor, Obstacle) including
 * the uniform buffer and background render pipeline.
 */
export class SceneEnvironment {
  private device: GPUDevice;
  readonly uniformBuffer: GPUBuffer;
  readonly bindGroupLayout: GPUBindGroupLayout;
  private backgroundPipeline: GPURenderPipeline;

  constructor(device: GPUDevice, format: GPUTextureFormat) {
    this.device = device;

    // 1. Create Uniform Buffer (240 bytes = 60 floats)
    this.uniformBuffer = device.createBuffer({
      size: 240,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // 2. Define Bind Group Layout (shared by background and other renderers)
    this.bindGroupLayout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.VERTEX,
          buffer: { type: 'uniform' },
        },
      ],
    });

    // 3. Create Background Pipeline (Full-screen triangle)
    const bgCode = preprocessShader(backgroundShader, {
      '../../common/shaders/environment.wgsl': environmentShader,
      // shadow_common is NOT used by the base background pass usually, 
      // but let's provide it if the shader expects it.
    });
    
    const bgModule = device.createShaderModule({ code: bgCode });
    this.backgroundPipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({
        bindGroupLayouts: [this.bindGroupLayout],
      }),
      vertex: {
        module: bgModule,
        entryPoint: 'vs_main',
      },
      fragment: {
        module: bgModule,
        entryPoint: 'fs_main',
        targets: [{ format }],
      },
      primitive: { topology: 'triangle-list' },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: false,
        depthCompare: 'always',
      },
    });
  }

  /**
   * Updates the environment uniform buffer.
   */
  update(env: EnvironmentConfig, sim: SimConfig) {
    const data = new Float32Array(60);
    writeEnvironmentUniforms(data, 0, env, sim);
    this.device.queue.writeBuffer(this.uniformBuffer, 0, data);
  }

  /**
   * Returns a bind group for the environment uniforms.
   */
  createBindGroup(): GPUBindGroup {
    return this.device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
      ],
    });
  }

  /**
   * Renders the background (Sky + Floor).
   */
  draw(pass: GPURenderPassEncoder, bindGroup: GPUBindGroup) {
    pass.setPipeline(this.backgroundPipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3); // Full-screen triangle
  }
}
