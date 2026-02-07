/**
 * Shadow pass: render particle thickness from the light's perspective
 * into a low-resolution shadow map using an orthographic projection.
 *
 * Reuses the thickness shader but with no depth test and a light-space VP.
 */

import shadowShader from '../shaders/shadow_debug.wgsl?raw';
import type { ScreenSpaceFrame, ScreenSpaceTextures, SimBuffers } from '../screen_space_types.ts';
import {
  mat4LookAt,
  mat4Multiply,
  mat4Ortho,
  normalize,
  vec3Scale,
} from '../../../common/math_utils.ts';

export class ShadowPass {
  private device: GPUDevice;
  private pipeline: GPURenderPipeline;
  private uniformBuffer: GPUBuffer;
  private bindGroupLayout: GPUBindGroupLayout;
  private bindGroup: GPUBindGroup | null = null;

  constructor(device: GPUDevice) {
    this.device = device;

    this.uniformBuffer = device.createBuffer({
      size: 80,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.bindGroupLayout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: 'read-only-storage' },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: 'uniform' },
        },
      ],
    });

    const module = device.createShaderModule({ code: shadowShader });

    this.pipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({
        bindGroupLayouts: [this.bindGroupLayout],
      }),
      vertex: {
        module,
        entryPoint: 'vs_main',
      },
      fragment: {
        module,
        entryPoint: 'fs_main',
        targets: [
          {
            format: 'r16float',
            blend: {
              color: { srcFactor: 'one', dstFactor: 'one' },
              alpha: { srcFactor: 'one', dstFactor: 'one' },
            },
          },
        ],
      },
      primitive: {
        topology: 'triangle-list',
        cullMode: 'none',
      },
      // No depth test — accumulate all particles from the light's view
    });
  }

  createBindGroup(buffers: SimBuffers) {
    this.bindGroup = this.device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: buffers.positions } },
        { binding: 1, resource: { buffer: this.uniformBuffer } },
      ],
    });
  }

  /**
   * Builds an orthographic view-projection matrix from the sun direction
   * that frames the simulation bounds.
   */
  buildShadowVP(frame: ScreenSpaceFrame): Float32Array {
    const sunDir = normalize(frame.dirToSun);

    // Position the shadow camera far along the sun direction, looking at scene center
    const sceneCenter = { x: 0, y: -2.5, z: 0 }; // Roughly center of the sim
    const cameraDist = 30;
    const eye = {
      x: sceneCenter.x + sunDir.x * cameraDist,
      y: sceneCenter.y + sunDir.y * cameraDist,
      z: sceneCenter.z + sunDir.z * cameraDist,
    };
    const up = Math.abs(sunDir.y) > 0.99
      ? { x: 1, y: 0, z: 0 }
      : { x: 0, y: 1, z: 0 };

    const view = mat4LookAt(eye, sceneCenter, up);

    // Orthographic size to cover the simulation bounds with some margin
    const hx = frame.boundsSize.x * 0.5 + 2;
    const hy = frame.boundsSize.y * 0.5 + 2;
    const hz = frame.boundsSize.z * 0.5 + 2;
    const orthoSize = Math.max(hx, hy, hz);

    // Near/far need to encompass the scene from the camera's perspective
    // Camera is cameraDist from center, scene extends ~orthoSize in each direction
    const proj = mat4Ortho(
      -orthoSize, orthoSize,
      -orthoSize, orthoSize,
      cameraDist - orthoSize - 10, cameraDist + orthoSize + 10,
    );

    return mat4Multiply(proj, view);
  }

  encode(
    encoder: GPUCommandEncoder,
    resources: ScreenSpaceTextures & { buffers: SimBuffers },
    frame: ScreenSpaceFrame,
  ): Float32Array | null {
    if (!resources.shadowTexture || !this.bindGroup) {
      return null;
    }

    const shadowVP = this.buildShadowVP(frame);

    const shadowW = resources.shadowTexture.width;
    const shadowH = resources.shadowTexture.height;

    // For shadow pass, use a larger particle radius since:
    // 1. Shadow texture is 1/4 resolution
    // 2. We want soft, overlapping shadows
    // Use a significant fraction of the texture size
    const shadowParticleRadius = Math.max(shadowW, shadowH) * 0.05;

    const uniforms = new Float32Array(20);
    uniforms.set(shadowVP);
    uniforms[16] = shadowW;
    uniforms[17] = shadowH;
    uniforms[18] = shadowParticleRadius;
    uniforms[19] = 0.0;
    this.device.queue.writeBuffer(this.uniformBuffer, 0, uniforms);

    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: resources.shadowTexture.createView(),
          clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 0.0 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });

    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.draw(6, resources.buffers.particleCount);
    pass.end();

    return shadowVP;
  }
}
