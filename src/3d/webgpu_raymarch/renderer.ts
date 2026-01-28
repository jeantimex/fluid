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

    this.uniformData = new Float32Array(68); // Increased size for new params

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
    this.uniformData[25] = config.tileScale;
    this.uniformData[26] = config.tileDarkOffset;
    this.uniformData[27] = 0; // padding

    // Tile Colors
    this.uniformData[28] = config.tileCol1.r;
    this.uniformData[29] = config.tileCol1.g;
    this.uniformData[30] = config.tileCol1.b;
    this.uniformData[31] = 0;

    this.uniformData[32] = config.tileCol2.r;
    this.uniformData[33] = config.tileCol2.g;
    this.uniformData[34] = config.tileCol2.b;
    this.uniformData[35] = 0;

    this.uniformData[36] = config.tileCol3.r;
    this.uniformData[37] = config.tileCol3.g;
    this.uniformData[38] = config.tileCol3.b;
    this.uniformData[39] = 0;

    this.uniformData[40] = config.tileCol4.r;
    this.uniformData[41] = config.tileCol4.g;
    this.uniformData[42] = config.tileCol4.b;
    this.uniformData[43] = 0;

    // Variation & Sun
    this.uniformData[44] = config.tileColVariation.x;
    this.uniformData[45] = config.tileColVariation.y;
    this.uniformData[46] = config.tileColVariation.z;
    this.uniformData[47] = 0;

    this.uniformData[48] = 0.83; // dirToSun.x
    this.uniformData[49] = 0.42; // dirToSun.y
    this.uniformData[50] = 0.36; // dirToSun.z
    this.uniformData[51] = 0;

    this.uniformData[52] = config.extinctionCoefficients.x;
    this.uniformData[53] = config.extinctionCoefficients.y;
    this.uniformData[54] = config.extinctionCoefficients.z;
    this.uniformData[55] = 0;

    this.uniformData[56] = config.indexOfRefraction;
    this.uniformData[57] = config.numRefractions;
    this.uniformData[58] = 0; // padding
    this.uniformData[59] = 0; // padding

    this.uniformData[60] = config.floorSize.x;
    this.uniformData[61] = config.floorSize.y;
    this.uniformData[62] = config.floorSize.z;
    this.uniformData[63] = 0;

    this.uniformData[64] = 0; // floorCenter.x
    this.uniformData[65] = -config.boundsSize.y * 0.5 - config.floorSize.y * 0.5; // floorCenter.y
    this.uniformData[66] = 0; // floorCenter.z
    this.uniformData[67] = 0;

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
