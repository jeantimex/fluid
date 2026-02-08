/**
 * Composite pass skeleton: final shading/compositing.
 */

import compositeShader from '../shaders/composite_final.wgsl?raw';
import wireframeShader from '../../../common/shaders/wireframe.wgsl?raw';
import environmentShader from '../../../common/shaders/environment.wgsl?raw';
import shadowCommonShader from '../../../common/shaders/shadow_common.wgsl?raw';
import type {
  CompositePassResources,
  ScreenSpaceFrame,
} from '../screen_space_types.ts';
import { writeEnvironmentUniforms } from '../../../common/environment.ts';
import { preprocessShader } from '../../../common/shader_preprocessor.ts';

export class CompositePass {
  private device: GPUDevice;
  private compositePipeline: GPURenderPipeline;
  private wireframePipeline: GPURenderPipeline;
  private compositeBindGroupLayout: GPUBindGroupLayout;
  private compositeBindGroup: GPUBindGroup | null = null;
  private wireframeBindGroup: GPUBindGroup;
  private sampler: GPUSampler;
  private uniformBuffer: GPUBuffer;
  private envUniformBuffer: GPUBuffer;
  private wireframeUniformBuffer: GPUBuffer;
  private wireframeVertexBuffer: GPUBuffer;
  private wireframeVertexData: Float32Array;

  constructor(device: GPUDevice, format: GPUTextureFormat) {
    this.device = device;

    this.sampler = device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
    });
    // Render uniforms:
    // inverseVP (64) + waterColor (16) + deepColor (16) + foamColor (16) +
    // extinction (16) + refraction + shadow toggle + 2 pad (16) + ShadowUniforms (80) = 224 bytes
    this.uniformBuffer = device.createBuffer({
      size: 224,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Environment uniforms: 240 bytes
    this.envUniformBuffer = device.createBuffer({
      size: 240,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.compositeBindGroupLayout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'float' },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'float' },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'float' },
        },
        {
          binding: 3,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'float' },
        },
        { binding: 4, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
        {
          binding: 5,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' },
        },
        {
          binding: 6,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' },
        },
        {
          binding: 7,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'float' },
        },
      ],
    });

    const compositeCode = preprocessShader(compositeShader, {
      '../../../common/shaders/environment.wgsl': environmentShader,
      '../../../common/shaders/shadow_common.wgsl': shadowCommonShader,
    });
    const compositeModule = device.createShaderModule({
      code: compositeCode,
    });
    this.compositePipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({
        bindGroupLayouts: [this.compositeBindGroupLayout],
      }),
      vertex: { module: compositeModule, entryPoint: 'vs_main' },
      fragment: {
        module: compositeModule,
        entryPoint: 'fs_main',
        targets: [{ format }],
      },
      primitive: { topology: 'triangle-list' },
    });

    // Wireframe pipeline with depth testing
    const wireframeModule = device.createShaderModule({ code: wireframeShader });
    this.wireframePipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: wireframeModule,
        entryPoint: 'vs_main',
        buffers: [
          {
            arrayStride: 28, // 3 floats pos + 4 floats color = 7 floats = 28 bytes
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x3' },
              { shaderLocation: 1, offset: 12, format: 'float32x4' },
            ],
          },
        ],
      },
      fragment: {
        module: wireframeModule,
        entryPoint: 'fs_main',
        targets: [{ format }],
      },
      primitive: { topology: 'line-list' },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: true,
        depthCompare: 'less',
      },
    });

    // Wireframe uniform buffer (viewProjection matrix = 64 bytes)
    this.wireframeUniformBuffer = device.createBuffer({
      size: 64,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Wireframe vertex buffer: 12 edges × 2 vertices × 7 floats = 168 floats
    this.wireframeVertexData = new Float32Array(168);
    this.wireframeVertexBuffer = device.createBuffer({
      size: this.wireframeVertexData.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });

    this.wireframeBindGroup = device.createBindGroup({
      layout: this.wireframePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.wireframeUniformBuffer } },
      ],
    });
  }

  resize(_width: number, _height: number) {
    this.compositeBindGroup = null;
  }

  /**
   * Builds wireframe geometry for the simulation bounds.
   * Creates 12 edges (lines) representing the bounding box.
   */
  private buildBoundsWireframe(frame: ScreenSpaceFrame): number {
    const hx = frame.boundsSize.x * 0.5;
    const hy = frame.boundsSize.y * 0.5;
    const hz = frame.boundsSize.z * 0.5;

    // Bounds center is at origin, bottom at -hy (adjusted for floor)
    const cy = hy - 5.0; // Offset to match the density bounds minY = -5.0

    const color = frame.boundsWireframeColor ?? { r: 1, g: 1, b: 1 };

    // 8 corners of the bounding box
    const corners = [
      [-hx, cy - hy, -hz], // 0: back-bottom-left
      [+hx, cy - hy, -hz], // 1: back-bottom-right
      [+hx, cy + hy, -hz], // 2: back-top-right
      [-hx, cy + hy, -hz], // 3: back-top-left
      [-hx, cy - hy, +hz], // 4: front-bottom-left
      [+hx, cy - hy, +hz], // 5: front-bottom-right
      [+hx, cy + hy, +hz], // 6: front-top-right
      [-hx, cy + hy, +hz], // 7: front-top-left
    ];

    // 12 edges of the box (pairs of corner indices)
    const edges = [
      // Bottom face edges
      [0, 1], [1, 5], [5, 4], [4, 0],
      // Top face edges
      [3, 2], [2, 6], [6, 7], [7, 3],
      // Vertical edges
      [0, 3], [1, 2], [5, 6], [4, 7],
    ];

    let offset = 0;
    const addVertex = (cornerIdx: number) => {
      const c = corners[cornerIdx];
      this.wireframeVertexData[offset++] = c[0];
      this.wireframeVertexData[offset++] = c[1];
      this.wireframeVertexData[offset++] = c[2];
      this.wireframeVertexData[offset++] = color.r;
      this.wireframeVertexData[offset++] = color.g;
      this.wireframeVertexData[offset++] = color.b;
      this.wireframeVertexData[offset++] = 1.0; // alpha
    };

    for (const [a, b] of edges) {
      addVertex(a);
      addVertex(b);
    }

    return edges.length * 2; // 24 vertices
  }

  createCompositeBindGroup(resources: CompositePassResources) {
    if (
      !resources.smoothTextureB ||
      !resources.normalTexture ||
      !resources.smoothTextureA ||
      !resources.foamTexture ||
      !resources.shadowSmoothTexture
    ) {
      this.compositeBindGroup = null;
      return;
    }

    this.compositeBindGroup = this.device.createBindGroup({
      layout: this.compositeBindGroupLayout,
      entries: [
        { binding: 0, resource: resources.smoothTextureB.createView() },
        { binding: 1, resource: resources.normalTexture.createView() },
        { binding: 2, resource: resources.smoothTextureA.createView() },
        { binding: 3, resource: resources.foamTexture.createView() },
        { binding: 4, resource: this.sampler },
        { binding: 5, resource: { buffer: this.uniformBuffer } },
        { binding: 6, resource: { buffer: this.envUniformBuffer } },
        { binding: 7, resource: resources.shadowTexture!.createView() },
      ],
    });
  }

  encode(
    encoder: GPUCommandEncoder,
    resources: CompositePassResources,
    frame: ScreenSpaceFrame,
    targetView: GPUTextureView
  ) {
    if (!this.compositeBindGroup) {
      this.createCompositeBindGroup(resources);
    }
    if (!this.compositeBindGroup) {
      return;
    }
    // Render uniforms (inverse view-projection + colors + params + ShadowUniforms)
    const uniforms = new Float32Array(56);
    uniforms.set(frame.inverseViewProjection, 0); // 0-15
    uniforms[16] = frame.waterColor.r;
    uniforms[17] = frame.waterColor.g;
    uniforms[18] = frame.waterColor.b;
    uniforms[19] = 0; // pad
    uniforms[20] = frame.deepWaterColor.r;
    uniforms[21] = frame.deepWaterColor.g;
    uniforms[22] = frame.deepWaterColor.b;
    uniforms[23] = 0; // pad
    uniforms[24] = frame.foamColor.r;
    uniforms[25] = frame.foamColor.g;
    uniforms[26] = frame.foamColor.b;
    uniforms[27] = frame.foamOpacity;
    uniforms[28] = frame.extinctionCoeff.x;
    uniforms[29] = frame.extinctionCoeff.y;
    uniforms[30] = frame.extinctionCoeff.z;
    uniforms[31] = frame.extinctionMultiplier;
    uniforms[32] = frame.refractionStrength;
    uniforms[33] = frame.showFluidShadows ? 1.0 : 0.0;
    uniforms[34] = 0; // pad3
    uniforms[35] = 0; // pad4
    // shadowParams at offset 36 (byte offset 144, 16-byte aligned for mat4x4)
    if (frame.shadowViewProjection) {
      uniforms.set(frame.shadowViewProjection, 36); // 36-51: lightViewProjection
      uniforms[52] = frame.shadowSoftness;
      uniforms[53] = 0; // particleShadowRadius (not used in screen space depth)
      uniforms[54] = 0; // pad0
      uniforms[55] = 0; // pad1
    }
    this.device.queue.writeBuffer(this.uniformBuffer, 0, uniforms);

    // Environment uniforms
    const envData = new Float32Array(60);
    // Corrected: use obstacleCentre
    writeEnvironmentUniforms(envData, 0, frame, {
      ...frame,
      obstacleCentre: frame.obstacleCentre,
      obstacleSize: {
          x: frame.obstacleHalfSize.x * 2,
          y: frame.obstacleHalfSize.y * 2,
          z: frame.obstacleHalfSize.z * 2
      }
    } as any);
    this.device.queue.writeBuffer(this.envUniformBuffer, 0, envData);

    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: targetView,
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });

    pass.setPipeline(this.compositePipeline);
    pass.setBindGroup(0, this.compositeBindGroup!);
    pass.draw(6, 1);
    pass.end();

    // Draw bounds wireframe in a separate pass with depth testing
    if (frame.showBoundsWireframe && resources.depthTexture) {
      const wireframeVertexCount = this.buildBoundsWireframe(frame);
      this.device.queue.writeBuffer(
        this.wireframeVertexBuffer,
        0,
        this.wireframeVertexData.buffer,
        this.wireframeVertexData.byteOffset,
        wireframeVertexCount * 7 * 4
      );
      this.device.queue.writeBuffer(
        this.wireframeUniformBuffer,
        0,
        frame.viewProjection.buffer,
        frame.viewProjection.byteOffset,
        frame.viewProjection.byteLength
      );

      const wireframePass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: targetView,
            loadOp: 'load', // Keep the composite result
            storeOp: 'store',
          },
        ],
        depthStencilAttachment: {
          view: resources.depthTexture.createView(),
          depthLoadOp: 'load', // Keep existing depth
          depthStoreOp: 'store',
        },
      });

      wireframePass.setPipeline(this.wireframePipeline);
      wireframePass.setBindGroup(0, this.wireframeBindGroup);
      wireframePass.setVertexBuffer(0, this.wireframeVertexBuffer, 0);
      wireframePass.draw(wireframeVertexCount);
      wireframePass.end();
    }
  }
}
