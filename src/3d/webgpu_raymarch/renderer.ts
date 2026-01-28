import raymarchShader from './shaders/raymarch.wgsl?raw';
import type { OrbitCamera } from '../webgpu_particles/orbit_camera.ts';
import type { RaymarchConfig } from './types.ts';

export class RaymarchRenderer {
  private device: GPUDevice;
  private canvas: HTMLCanvasElement;
  private pipeline: GPURenderPipeline;
  private uniformBuffer: GPUBuffer;
  private sampler: GPUSampler;
  private bindGroup!: GPUBindGroup;
  private uniformData = new Float32Array(28);

  constructor(
    device: GPUDevice,
    canvas: HTMLCanvasElement,
    format: GPUTextureFormat
  ) {
    this.device = device;
    this.canvas = canvas;

    const module = device.createShaderModule({ code: raymarchShader });

    this.pipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module,
        entryPoint: 'vs_main',
      },
      fragment: {
        module,
        entryPoint: 'fs_main',
        targets: [{ format }],
      },
      primitive: {
        topology: 'triangle-list',
        cullMode: 'none',
      },
    });

    this.uniformBuffer = device.createBuffer({
      size: this.uniformData.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.sampler = device.createSampler({
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
      addressModeW: 'clamp-to-edge',
      magFilter: 'linear',
      minFilter: 'linear',
    });
  }

  createBindGroup(densityTextureView: GPUTextureView): void {
    this.bindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: densityTextureView },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: { buffer: this.uniformBuffer } },
      ],
    });
  }

  render(
    encoder: GPUCommandEncoder,
    targetView: GPUTextureView,
    camera: OrbitCamera,
    config: RaymarchConfig
  ): void {
    const basis = camera.basis;
    const pos = camera.position;

    const aspect = this.canvas.width / this.canvas.height;
    const fovY = Math.PI / 3;

    this.uniformData[0] = pos.x;
    this.uniformData[1] = pos.y;
    this.uniformData[2] = pos.z;
    this.uniformData[3] = 0;

    this.uniformData[4] = basis.right.x;
    this.uniformData[5] = basis.right.y;
    this.uniformData[6] = basis.right.z;
    this.uniformData[7] = 0;

    this.uniformData[8] = basis.up.x;
    this.uniformData[9] = basis.up.y;
    this.uniformData[10] = basis.up.z;
    this.uniformData[11] = 0;

    this.uniformData[12] = basis.forward.x;
    this.uniformData[13] = basis.forward.y;
    this.uniformData[14] = basis.forward.z;
    this.uniformData[15] = 0;

    this.uniformData[16] = config.boundsSize.x;
    this.uniformData[17] = config.boundsSize.y;
    this.uniformData[18] = config.boundsSize.z;
    this.uniformData[19] = config.densityOffset;

    this.uniformData[20] = config.densityMultiplier / 1000;
    this.uniformData[21] = config.stepSize;
    this.uniformData[22] = aspect;
    this.uniformData[23] = fovY;
    this.uniformData[24] = config.maxSteps;
    this.uniformData[25] = 0;
    this.uniformData[26] = 0;
    this.uniformData[27] = 0;

    this.device.queue.writeBuffer(this.uniformBuffer, 0, this.uniformData);

    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: targetView,
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: { r: 0.03, g: 0.05, b: 0.08, a: 1 },
        },
      ],
    });

    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.draw(3, 1, 0, 0);
    pass.end();
  }
}
