/**
 * WebGPU Scene Renderer
 *
 * Renders the basic Unity scene with background and checkered floor.
 */

import sceneShaderCode from './shaders/scene.wgsl?raw';
import { mat4Multiply, mat4Perspective, mat4Invert } from './math_utils';

export interface SceneConfig {
  // Tile colors (from Unity scene)
  tileCol1: { r: number; g: number; b: number };
  tileCol2: { r: number; g: number; b: number };
  tileCol3: { r: number; g: number; b: number };
  tileCol4: { r: number; g: number; b: number };

  // Global adjustments (set by GUI)
  globalBrightness?: number;
  globalSaturation?: number;

  // Floor parameters
  floorY: number;
  tileScale: number;
  tileDarkFactor: number; // Multiplicative factor for dark tiles (e.g., 0.8)
  floorSize: number;

  // Tile color variation (HSV)
  tileColVariation: { x: number; y: number; z: number };

  // Lighting
  dirToSun: { x: number; y: number; z: number };

  // Sky colors
  skyColorHorizon: { r: number; g: number; b: number };
  skyColorZenith: { r: number; g: number; b: number };
  skyColorGround: { r: number; g: number; b: number };
  sunPower: number;
  sunBrightness: number;
  floorAmbient: number;
}

export class SceneRenderer {
  private device: GPUDevice;
  private context: GPUCanvasContext;
  private format: GPUTextureFormat;
  private canvas: HTMLCanvasElement;

  private pipeline!: GPURenderPipeline;
  private uniformBuffer!: GPUBuffer;
  private bindGroup!: GPUBindGroup;

  private config: SceneConfig;

  constructor(
    device: GPUDevice,
    context: GPUCanvasContext,
    canvas: HTMLCanvasElement,
    format: GPUTextureFormat,
    config: SceneConfig
  ) {
    this.device = device;
    this.context = context;
    this.canvas = canvas;
    this.format = format;
    this.config = config;

    this.createPipeline();
    this.createBuffers();
  }

  private createPipeline() {
    const shaderModule = this.device.createShaderModule({
      code: sceneShaderCode,
    });

    const bindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' },
        },
      ],
    });

    const pipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [bindGroupLayout],
    });

    this.pipeline = this.device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: {
        module: shaderModule,
        entryPoint: 'vs_fullscreen',
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fs_main',
        targets: [{ format: this.format }],
      },
      primitive: {
        topology: 'triangle-list',
      },
    });
  }

  private createBuffers() {
    // Uniform buffer - aligned to 256 bytes
    this.uniformBuffer = this.device.createBuffer({
      size: 256,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.bindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        {
          binding: 0,
          resource: { buffer: this.uniformBuffer },
        },
      ],
    });
  }

  render(
    viewMatrix: Float32Array,
    cameraPos: { x: number; y: number; z: number }
  ) {
    const aspect = this.canvas.width / this.canvas.height;
    const projMatrix = mat4Perspective(Math.PI / 3, aspect, 0.15, 500);
    const viewProjMatrix = mat4Multiply(projMatrix, viewMatrix);
    const invViewProjMatrix = mat4Invert(viewProjMatrix);

    // Update uniform buffer
    const uniformData = new Float32Array(64); // 256 bytes / 4
    let offset = 0;

    // invViewProj (mat4x4) - 16 floats
    uniformData.set(invViewProjMatrix, offset);
    offset += 16;

    // cameraPos + pad - 4 floats
    uniformData[offset++] = cameraPos.x;
    uniformData[offset++] = cameraPos.y;
    uniformData[offset++] = cameraPos.z;
    uniformData[offset++] = 0;

    // tileCol1 + pad - 4 floats
    uniformData[offset++] = this.config.tileCol1.r;
    uniformData[offset++] = this.config.tileCol1.g;
    uniformData[offset++] = this.config.tileCol1.b;
    uniformData[offset++] = 0;

    // tileCol2 + pad - 4 floats
    uniformData[offset++] = this.config.tileCol2.r;
    uniformData[offset++] = this.config.tileCol2.g;
    uniformData[offset++] = this.config.tileCol2.b;
    uniformData[offset++] = 0;

    // tileCol3 + pad - 4 floats
    uniformData[offset++] = this.config.tileCol3.r;
    uniformData[offset++] = this.config.tileCol3.g;
    uniformData[offset++] = this.config.tileCol3.b;
    uniformData[offset++] = 0;

    // tileCol4 + pad - 4 floats
    uniformData[offset++] = this.config.tileCol4.r;
    uniformData[offset++] = this.config.tileCol4.g;
    uniformData[offset++] = this.config.tileCol4.b;
    uniformData[offset++] = 0;

    // floorY, tileScale, tileDarkFactor, floorSize - 4 floats
    uniformData[offset++] = this.config.floorY;
    uniformData[offset++] = this.config.tileScale;
    uniformData[offset++] = this.config.tileDarkFactor;
    uniformData[offset++] = this.config.floorSize;

    // dirToSun + pad - 4 floats
    uniformData[offset++] = this.config.dirToSun.x;
    uniformData[offset++] = this.config.dirToSun.y;
    uniformData[offset++] = this.config.dirToSun.z;
    uniformData[offset++] = 0;

    // skyColorHorizon + sunPower - 4 floats
    uniformData[offset++] = this.config.skyColorHorizon.r;
    uniformData[offset++] = this.config.skyColorHorizon.g;
    uniformData[offset++] = this.config.skyColorHorizon.b;
    uniformData[offset++] = this.config.sunPower;

    // skyColorZenith + sunBrightness - 4 floats
    uniformData[offset++] = this.config.skyColorZenith.r;
    uniformData[offset++] = this.config.skyColorZenith.g;
    uniformData[offset++] = this.config.skyColorZenith.b;
    uniformData[offset++] = this.config.sunBrightness;

    // skyColorGround + floorAmbient - 4 floats
    uniformData[offset++] = this.config.skyColorGround.r;
    uniformData[offset++] = this.config.skyColorGround.g;
    uniformData[offset++] = this.config.skyColorGround.b;
    uniformData[offset++] = this.config.floorAmbient;

    // tileColVariation + pad - 4 floats
    uniformData[offset++] = this.config.tileColVariation.x;
    uniformData[offset++] = this.config.tileColVariation.y;
    uniformData[offset++] = this.config.tileColVariation.z;
    uniformData[offset++] = 0;

    // globalBrightness, globalSaturation + pad - 4 floats
    uniformData[offset++] = this.config.globalBrightness ?? 1.0;
    uniformData[offset++] = this.config.globalSaturation ?? 1.0;
    uniformData[offset++] = 0;
    uniformData[offset++] = 0;

    this.device.queue.writeBuffer(this.uniformBuffer, 0, uniformData);

    // Render
    const commandEncoder = this.device.createCommandEncoder();
    const textureView = this.context.getCurrentTexture().createView();

    const renderPass = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: textureView,
          clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });

    renderPass.setPipeline(this.pipeline);
    renderPass.setBindGroup(0, this.bindGroup);
    renderPass.draw(3); // Fullscreen triangle
    renderPass.end();

    this.device.queue.submit([commandEncoder.finish()]);
  }
}
