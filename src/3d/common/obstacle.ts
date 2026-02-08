/**
 * Utility for rendering the box obstacle.
 */
export class Obstacle {
  readonly vertexBuffer: GPUBuffer;
  readonly vertexCount: number = 36;
  private pipeline: GPURenderPipeline;

  constructor(
    device: GPUDevice,
    format: GPUTextureFormat,
    envBindGroupLayout: GPUBindGroupLayout,
    faceShaderCode: string
  ) {
    // 1. Create Vertex Buffer
    const vertexData = this.generateBoxVertices();
    this.vertexBuffer = device.createBuffer({
      size: vertexData.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Float32Array(this.vertexBuffer.getMappedRange()).set(vertexData);
    this.vertexBuffer.unmap();

    // 2. Create Render Pipeline
    this.pipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({
        bindGroupLayouts: [envBindGroupLayout],
      }),
      vertex: {
        module: device.createShaderModule({ code: faceShaderCode }),
        entryPoint: 'vs_main',
        buffers: [
          {
            arrayStride: 40, // pos(12) + normal(12) + color(16)
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x3' }, // pos
              { shaderLocation: 1, offset: 12, format: 'float32x3' }, // normal
              { shaderLocation: 2, offset: 24, format: 'float32x4' }, // color
            ],
          },
        ],
      },
      fragment: {
        module: device.createShaderModule({ code: faceShaderCode }),
        entryPoint: 'fs_main',
        targets: [
          {
            format,
            blend: {
              color: {
                srcFactor: 'src-alpha',
                dstFactor: 'one-minus-src-alpha',
                operation: 'add',
              },
              alpha: {
                srcFactor: 'one',
                dstFactor: 'one-minus-src-alpha',
                operation: 'add',
              },
            },
          },
        ],
      },
      primitive: { topology: 'triangle-list', cullMode: 'back' },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: false,
        depthCompare: 'less',
      },
    });
  }

  draw(pass: GPURenderPassEncoder, envBindGroup: GPUBindGroup) {
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, envBindGroup);
    pass.setVertexBuffer(0, this.vertexBuffer);
    pass.draw(this.vertexCount);
  }

  private generateBoxVertices(): Float32Array {
    // 6 faces * 2 triangles * 3 vertices * 10 floats (pos:3, normal:3, color:4)
    const data = new Float32Array(360);
    let i = 0;

    const addFace = (
      p1: number[],
      p2: number[],
      p3: number[],
      p4: number[],
      n: number[]
    ) => {
      const color = [1, 1, 1, 1];
      const verts = [p1, p2, p3, p3, p4, p1];
      for (const p of verts) {
        data[i++] = p[0];
        data[i++] = p[1];
        data[i++] = p[2];
        data[i++] = n[0];
        data[i++] = n[1];
        data[i++] = n[2];
        data[i++] = color[0];
        data[i++] = color[1];
        data[i++] = color[2];
        data[i++] = color[3];
      }
    };

    // Unit box [-0.5, 0.5]
    const p = [
      [-0.5, -0.5, 0.5],
      [0.5, -0.5, 0.5],
      [0.5, 0.5, 0.5],
      [-0.5, 0.5, 0.5],
      [-0.5, -0.5, -0.5],
      [0.5, -0.5, -0.5],
      [0.5, 0.5, -0.5],
      [-0.5, 0.5, -0.5],
    ];

    addFace(p[0], p[1], p[2], p[3], [0, 0, 1]); // Front
    addFace(p[5], p[4], p[7], p[6], [0, 0, -1]); // Back
    addFace(p[4], p[0], p[3], p[7], [-1, 0, 0]); // Left
    addFace(p[1], p[5], p[6], p[2], [1, 0, 0]); // Right
    addFace(p[3], p[2], p[6], p[7], [0, 1, 0]); // Top
    addFace(p[1], p[0], p[4], p[5], [0, -1, 0]); // Bottom

    return data;
  }
}
