import compositeShaderCode from '../../shaders/composite.wgsl?raw';
import type { SceneConfig } from '../types';

export interface CompositeRecordParams {
  encoder: GPUCommandEncoder;
  inverseViewMatrix: Float32Array;
  lightProjectionViewMatrix: Float32Array;
  width: number;
  height: number;
  fov: number;
  shadowMapSize: number;
  cameraPosition: number[];
  sceneConfig: SceneConfig;
  targetView: GPUTextureView;
}

export class CompositePass {
  private readonly device: GPUDevice;
  private readonly pipeline: GPURenderPipeline;
  private readonly uniformBuffer: GPUBuffer;
  private readonly linearSampler: GPUSampler;
  private readonly shadowSampler: GPUSampler;
  private bindGroup: GPUBindGroup | null = null;
  private readonly uniformData = new Float32Array(40);

  constructor(
    device: GPUDevice,
    presentationFormat: GPUTextureFormat,
    linearSampler: GPUSampler,
    shadowSampler: GPUSampler
  ) {
    this.device = device;
    this.linearSampler = linearSampler;
    this.shadowSampler = shadowSampler;

    const shaderModule = device.createShaderModule({ code: compositeShaderCode });
    this.pipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: shaderModule, entryPoint: 'vs_main' },
      fragment: {
        module: shaderModule,
        entryPoint: 'fs_main',
        targets: [{ format: presentationFormat }],
      },
      primitive: { topology: 'triangle-strip' },
    });

    this.uniformBuffer = device.createBuffer({
      size: 320,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  updateSizeDependentBindings(
    gBufferView: GPUTextureView,
    occlusionView: GPUTextureView,
    shadowDepthView: GPUTextureView
  ) {
    this.bindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: gBufferView },
        { binding: 2, resource: occlusionView },
        { binding: 3, resource: shadowDepthView },
        { binding: 4, resource: this.linearSampler },
        { binding: 5, resource: this.shadowSampler },
      ],
    });
  }

  record(params: CompositeRecordParams) {
    if (!this.bindGroup) {
      throw new Error('CompositePass bind group is not initialized.');
    }

    this.device.queue.writeBuffer(
      this.uniformBuffer,
      0,
      params.inverseViewMatrix as any
    );
    this.device.queue.writeBuffer(
      this.uniformBuffer,
      64,
      params.lightProjectionViewMatrix as any
    );

    let cIdx = 0;
    this.uniformData[cIdx++] = params.width;
    this.uniformData[cIdx++] = params.height;
    this.uniformData[cIdx++] = params.fov;
    this.uniformData[cIdx++] = params.shadowMapSize;

    this.uniformData[cIdx++] = params.cameraPosition[0];
    this.uniformData[cIdx++] = params.cameraPosition[1];
    this.uniformData[cIdx++] = params.cameraPosition[2];
    this.uniformData[cIdx++] = 0;

    this.uniformData[cIdx++] = params.sceneConfig.dirToSun[0];
    this.uniformData[cIdx++] = params.sceneConfig.dirToSun[1];
    this.uniformData[cIdx++] = params.sceneConfig.dirToSun[2];
    this.uniformData[cIdx++] = params.sceneConfig.floorY;

    this.uniformData[cIdx++] = params.sceneConfig.skyColorHorizon[0];
    this.uniformData[cIdx++] = params.sceneConfig.skyColorHorizon[1];
    this.uniformData[cIdx++] = params.sceneConfig.skyColorHorizon[2];
    this.uniformData[cIdx++] = params.sceneConfig.sunPower;

    this.uniformData[cIdx++] = params.sceneConfig.skyColorZenith[0];
    this.uniformData[cIdx++] = params.sceneConfig.skyColorZenith[1];
    this.uniformData[cIdx++] = params.sceneConfig.skyColorZenith[2];
    this.uniformData[cIdx++] = params.sceneConfig.sunBrightness;

    this.uniformData[cIdx++] = params.sceneConfig.skyColorGround[0];
    this.uniformData[cIdx++] = params.sceneConfig.skyColorGround[1];
    this.uniformData[cIdx++] = params.sceneConfig.skyColorGround[2];
    this.uniformData[cIdx++] = params.sceneConfig.floorSize;

    this.uniformData[cIdx++] = params.sceneConfig.tileCol1[0];
    this.uniformData[cIdx++] = params.sceneConfig.tileCol1[1];
    this.uniformData[cIdx++] = params.sceneConfig.tileCol1[2];
    this.uniformData[cIdx++] = params.sceneConfig.tileScale;

    this.uniformData[cIdx++] = params.sceneConfig.tileCol2[0];
    this.uniformData[cIdx++] = params.sceneConfig.tileCol2[1];
    this.uniformData[cIdx++] = params.sceneConfig.tileCol2[2];
    this.uniformData[cIdx++] = params.sceneConfig.tileDarkFactor;

    this.uniformData[cIdx++] = params.sceneConfig.tileCol3[0];
    this.uniformData[cIdx++] = params.sceneConfig.tileCol3[1];
    this.uniformData[cIdx++] = params.sceneConfig.tileCol3[2];
    this.uniformData[cIdx++] = 0;

    this.uniformData[cIdx++] = params.sceneConfig.tileCol4[0];
    this.uniformData[cIdx++] = params.sceneConfig.tileCol4[1];
    this.uniformData[cIdx++] = params.sceneConfig.tileCol4[2];
    this.uniformData[cIdx++] = 0;

    this.device.queue.writeBuffer(this.uniformBuffer, 128, this.uniformData);

    const pass = params.encoder.beginRenderPass({
      colorAttachments: [
        {
          view: params.targetView,
          clearValue: { r: 0.9, g: 0.9, b: 0.9, a: 1.0 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });

    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.draw(4);
    pass.end();
  }
}
