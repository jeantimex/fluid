import { mat4LookAt, mat4Ortho, mat4Multiply } from './math_utils.ts';
import type { Vec3 } from './types.ts';
import { preprocessShader } from './shader_preprocessor.ts';

// Shader imports
import shadowParticlesShader from './shaders/shadow_particles.wgsl?raw';
import shadowMeshShader from './shaders/shadow_mesh.wgsl?raw';
import shadowCommonShader from './shaders/shadow_common.wgsl?raw';

export interface ShadowConfig {
  dirToSun: Vec3;
  shadowSoftness: number;
  particleShadowRadius: number;
  boundsSize: Vec3;
  floorSize: Vec3;
}

/**
 * Manages shadow map generation.
 */
export class ShadowSystem {
  private device: GPUDevice;
  readonly shadowTexture: GPUTexture;
  readonly shadowSampler: GPUSampler;
  readonly uniformBuffer: GPUBuffer;

  // Pipelines
  private particlePipeline: GPURenderPipeline;
  private meshPipeline: GPURenderPipeline;
  private obstaclePipeline: GPURenderPipeline;

  readonly lightViewProj = new Float32Array(16);

  constructor(device: GPUDevice) {
    this.device = device;

    // 1. Shadow Map Texture (2048x2048)
    this.shadowTexture = device.createTexture({
      size: [2048, 2048],
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      format: 'depth24plus',
    });

    // 2. Comparison Sampler
    this.shadowSampler = device.createSampler({
      compare: 'less',
      magFilter: 'linear',
      minFilter: 'linear',
    });

    // 3. Shadow Uniforms (80 bytes = 20 floats)
    this.uniformBuffer = device.createBuffer({
      size: 80,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // 4. Create Pipelines
    const particleCode = preprocessShader(shadowParticlesShader, {
      'shadow_common.wgsl': shadowCommonShader,
    });
    const meshCode = preprocessShader(shadowMeshShader, {
      'shadow_common.wgsl': shadowCommonShader,
    });

    const particleModule = device.createShaderModule({ code: particleCode });
    const meshModule = device.createShaderModule({ code: meshCode });

    this.particlePipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: particleModule, entryPoint: 'vs_particles' },
      primitive: { topology: 'triangle-list' },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: true,
        depthCompare: 'less',
      },
    });

    this.meshPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: meshModule, entryPoint: 'vs_mesh' },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: true,
        depthCompare: 'less',
      },
    });

    this.obstaclePipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: particleModule, // Uses same module but different entry
        entryPoint: 'vs_obstacle',
        buffers: [
          {
            arrayStride: 40,
            attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }],
          },
        ],
      },
      primitive: { topology: 'triangle-list', cullMode: 'back' },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: true,
        depthCompare: 'less',
      },
    });
  }

  /**
   * Updates light view-projection and uploads uniforms.
   */
  update(config: ShadowConfig) {
    const {
      dirToSun,
      boundsSize,
      floorSize,
      shadowSoftness,
      particleShadowRadius,
    } = config;

    // Calculate Matrix
    const lightDistance = Math.max(
      boundsSize.x + boundsSize.z,
      floorSize.x + floorSize.z
    );
    const orthoSize = lightDistance * 0.6;
    const lightPos = {
      x: dirToSun.x * lightDistance,
      y: dirToSun.y * lightDistance,
      z: dirToSun.z * lightDistance,
    };
    const lightView = mat4LookAt(
      lightPos,
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 }
    );
    const lightProj = mat4Ortho(
      -orthoSize,
      orthoSize,
      -orthoSize,
      orthoSize,
      0.1,
      lightDistance * 3.0
    );
    const lightVP = mat4Multiply(lightProj, lightView);
    this.lightViewProj.set(lightVP);

    // Write to Buffer
    const data = new Float32Array(20);
    data.set(lightVP);
    data[16] = shadowSoftness;
    data[17] = particleShadowRadius;
    this.device.queue.writeBuffer(this.uniformBuffer, 0, data);
  }

  /**
   * Encapsulates the shadow pass recording.
   */
  render(
    encoder: GPUCommandEncoder,
    particlePositions: GPUBuffer | null,
    particleCount: number,
    meshVertexBuffer: GPUBuffer | null,
    meshDrawBuffer: GPUBuffer | null,
    obstacleVertexBuffer: GPUBuffer | null,
    obstacleVertexCount: number
  ) {
    const pass = encoder.beginRenderPass({
      colorAttachments: [],
      depthStencilAttachment: {
        view: this.shadowTexture.createView(),
        depthClearValue: 1.0,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    });

    // 1. Fluid Shadows
    if (particlePositions && particleCount > 0) {
      pass.setPipeline(this.particlePipeline);
      const bg = this.device.createBindGroup({
        layout: this.particlePipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.uniformBuffer } },
          { binding: 1, resource: { buffer: particlePositions } },
        ],
      });
      pass.setBindGroup(0, bg);
      pass.draw(6, particleCount);
    } else if (meshVertexBuffer && meshDrawBuffer) {
      pass.setPipeline(this.meshPipeline);
      const bg = this.device.createBindGroup({
        layout: this.meshPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.uniformBuffer } },
          { binding: 1, resource: { buffer: meshVertexBuffer } },
        ],
      });
      pass.setBindGroup(0, bg);
      pass.drawIndirect(meshDrawBuffer, 0);
    }

    // 2. Obstacle Shadows
    if (obstacleVertexBuffer && obstacleVertexCount > 0) {
      pass.setPipeline(this.obstaclePipeline);
      const bg = this.device.createBindGroup({
        layout: this.obstaclePipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
      });
      pass.setBindGroup(0, bg);
      pass.setVertexBuffer(0, obstacleVertexBuffer);
      pass.draw(obstacleVertexCount);
    }

    pass.end();
  }
}
