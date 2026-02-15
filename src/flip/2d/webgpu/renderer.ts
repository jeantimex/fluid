import { Scene } from '../canvas2d/types';

const particleShaderWGSL = `
  struct Uniforms {
    domainSize: vec2f,
    pointSize: f32,
    drawDisk: f32,
  }

  @group(0) @binding(0) var<uniform> uniforms: Uniforms;

  struct VertexInput {
    @builtin(vertex_index) vertexIndex: u32,
    @builtin(instance_index) instanceIndex: u32,
    @location(0) position: vec2f,
    @location(1) color: vec3f,
  }

  struct VertexOutput {
    @builtin(position) pos: vec4f,
    @location(0) fragColor: vec3f,
    @location(1) uv: vec2f,
  }

  @vertex
  fn vs_main(input: VertexInput) -> VertexOutput {
    let pos = array<vec2f, 4>(
      vec2f(-1.0, -1.0), vec2f(1.0, -1.0),
      vec2f(-1.0,  1.0), vec2f(1.0,  1.0)
    );
    
    let uv = pos[input.vertexIndex];
    let worldPos = input.position + uv * (uniforms.pointSize * 0.5);
    
    // Transform to clip space [-1, 1]
    let clipX = (worldPos.x * (2.0 / uniforms.domainSize.x)) - 1.0;
    let clipY = (worldPos.y * (2.0 / uniforms.domainSize.y)) - 1.0;
    
    var output: VertexOutput;
    output.pos = vec4f(clipX, clipY, 0.0, 1.0);
    output.fragColor = input.color;
    output.uv = uv;
    return output;
  }

  @fragment
  fn fs_main(input: VertexOutput) -> @location(0) vec4f {
    if (uniforms.drawDisk > 0.5) {
      let r2 = dot(input.uv, input.uv);
      if (r2 > 1.0) {
        discard;
      }
    }
    return vec4f(input.fragColor, 1.0);
  }
`;

const meshShaderWGSL = `
  struct MeshUniforms {
    domainSize: vec2f,
    color: vec3f,
    translation: vec2f,
    scale: f32,
  }

  @group(0) @binding(0) var<uniform> uniforms: MeshUniforms;

  struct VertexInput {
    @builtin(vertex_index) vertexIndex: u32,
  }

  struct VertexOutput {
    @builtin(position) pos: vec4f,
  }

  @vertex
  fn vs_main(input: VertexInput) -> VertexOutput {
    let numSegs: u32 = 50u;
    var pos: vec2f;
    
    if (input.vertexIndex % 3u == 0u) {
      pos = vec2f(0.0, 0.0);
    } else {
      let i = f32(input.vertexIndex / 3u) + f32(input.vertexIndex % 3u - 1u);
      let angle = i * (2.0 * 3.14159265 / f32(numSegs));
      pos = vec2f(cos(angle), sin(angle));
    }

    let worldPos = uniforms.translation + pos * uniforms.scale;
    let clipX = (worldPos.x * (2.0 / uniforms.domainSize.x)) - 1.0;
    let clipY = (worldPos.y * (2.0 / uniforms.domainSize.y)) - 1.0;

    var output: VertexOutput;
    output.pos = vec4f(clipX, clipY, 0.0, 1.0);
    return output;
  }

  @fragment
  fn fs_main() -> @location(0) vec4f {
    return vec4f(uniforms.color, 1.0);
  }
`;

export class WebGPURenderer {
  device: GPUDevice;
  format: GPUTextureFormat;
  
  particlePipeline: GPURenderPipeline;
  meshPipeline: GPURenderPipeline;
  
  uniformBuffer: GPUBuffer;
  meshUniformBuffer: GPUBuffer;
  bindGroup: GPUBindGroup;
  meshBindGroup: GPUBindGroup;
  
  particlePosBuffer: GPUBuffer | null = null;
  particleColorBuffer: GPUBuffer | null = null;
  gridPosBuffer: GPUBuffer | null = null;
  gridColorBuffer: GPUBuffer | null = null;

  constructor(device: GPUDevice, format: GPUTextureFormat) {
    this.device = device;
    this.format = format;

    // --- Particle Pipeline ---
    const particleModule = device.createShaderModule({ code: particleShaderWGSL });
    this.particlePipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: particleModule,
        entryPoint: 'vs_main',
        buffers: [
          { // Position buffer
            arrayStride: 8,
            stepMode: 'instance',
            attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }],
          },
          { // Color buffer
            arrayStride: 12,
            stepMode: 'instance',
            attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x3' }],
          },
        ],
      },
      fragment: {
        module: particleModule,
        entryPoint: 'fs_main',
        targets: [{ format }],
      },
      primitive: { topology: 'triangle-strip' },
    });

    // --- Mesh (Obstacle) Pipeline ---
    const meshModule = device.createShaderModule({ code: meshShaderWGSL });
    this.meshPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: meshModule,
        entryPoint: 'vs_main',
      },
      fragment: {
        module: meshModule,
        entryPoint: 'fs_main',
        targets: [{ format }],
      },
      primitive: { topology: 'triangle-list' },
    });

    // --- Uniforms ---
    this.uniformBuffer = device.createBuffer({
      size: 16, // domainSize(8), pointSize(4), drawDisk(4)
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.meshUniformBuffer = device.createBuffer({
      size: 48, // domainSize(8), pad(8), color(12), pad(4), translation(8), scale(4), pad(4)
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.bindGroup = device.createBindGroup({
      layout: this.particlePipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
    });

    this.meshBindGroup = device.createBindGroup({
      layout: this.meshPipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.meshUniformBuffer } }],
    });
  }

  private createOrUpdateBuffer(data: Float32Array, existingBuffer: GPUBuffer | null, usage: GPUBufferUsageFlags): GPUBuffer {
    if (existingBuffer && existingBuffer.size === data.byteLength) {
      this.device.queue.writeBuffer(existingBuffer, 0, data);
      return existingBuffer;
    }
    if (existingBuffer) existingBuffer.destroy();
    const buffer = this.device.createBuffer({
      size: data.byteLength,
      usage: usage | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Float32Array(buffer.getMappedRange()).set(data);
    buffer.unmap();
    return buffer;
  }

  draw(scene: Scene, simWidth: number, simHeight: number, context: GPUCanvasContext) {
    const fluid = scene.fluid!;
    if (!fluid) return;

    // 1. Update Uniforms
    this.device.queue.writeBuffer(this.uniformBuffer, 0, new Float32Array([simWidth, simHeight]));

    const commandEncoder = this.device.createCommandEncoder();
    const renderPass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: context.getCurrentTexture().createView(),
        clearValue: { r: 0.05, g: 0.06, b: 0.08, a: 1.0 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });

    // 2. Draw Grid
    if (scene.showGrid) {
      if (!this.gridPosBuffer) {
        const centers = new Float32Array(2 * fluid.totalCells);
        let p_idx = 0;
        for (let i = 0; i < fluid.numX; i++) {
          for (let j = 0; j < fluid.numY; j++) {
            centers[p_idx++] = (i + 0.5) * fluid.cellSize;
            centers[p_idx++] = (j + 0.5) * fluid.cellSize;
          }
        }
        this.gridPosBuffer = this.createOrUpdateBuffer(centers, null, GPUBufferUsage.VERTEX);
      }
      this.gridColorBuffer = this.createOrUpdateBuffer(fluid.cellColor, this.gridColorBuffer, GPUBufferUsage.VERTEX);

      const gridSize = fluid.cellSize * 0.9;
      this.device.queue.writeBuffer(this.uniformBuffer, 8, new Float32Array([gridSize, 0.0])); // pointSize, drawDisk

      renderPass.setPipeline(this.particlePipeline);
      renderPass.setBindGroup(0, this.bindGroup);
      renderPass.setVertexBuffer(0, this.gridPosBuffer);
      renderPass.setVertexBuffer(1, this.gridColorBuffer);
      renderPass.draw(4, fluid.totalCells);
    }

    // 3. Draw Particles
    if (scene.showParticles) {
      this.particlePosBuffer = this.createOrUpdateBuffer(fluid.particlePos, this.particlePosBuffer, GPUBufferUsage.VERTEX);
      this.particleColorBuffer = this.createOrUpdateBuffer(fluid.particleColor, this.particleColorBuffer, GPUBufferUsage.VERTEX);

      const pSize = fluid.particleRadius * 2.0;
      this.device.queue.writeBuffer(this.uniformBuffer, 8, new Float32Array([pSize, 1.0])); // pointSize, drawDisk

      renderPass.setPipeline(this.particlePipeline);
      renderPass.setBindGroup(0, this.bindGroup);
      renderPass.setVertexBuffer(0, this.particlePosBuffer);
      renderPass.setVertexBuffer(1, this.particleColorBuffer);
      renderPass.draw(4, fluid.numParticles);
    }

    // 4. Draw Obstacle
    if (scene.showObstacle) {
      // Mesh Uniforms (Respecting 16-byte alignment for vec3f)
      const meshData = new Float32Array(12); // 48 bytes
      meshData[0] = simWidth;
      meshData[1] = simHeight;
      // meshData[2,3] are padding
      meshData[4] = 1.0; // color.r (offset 16)
      meshData[5] = 0.0; // color.g
      meshData[6] = 0.0; // color.b
      // meshData[7] is padding
      meshData[8] = scene.obstacleX; // translation.x (offset 32)
      meshData[9] = scene.obstacleY; // translation.y
      meshData[10] = scene.obstacleRadius; // scale (offset 40)
      // meshData[11] is padding
      
      this.device.queue.writeBuffer(this.meshUniformBuffer, 0, meshData);

      renderPass.setPipeline(this.meshPipeline);
      renderPass.setBindGroup(0, this.meshBindGroup);
      renderPass.draw(50 * 3); // 50 triangles for the disk
    }

    renderPass.end();
    this.device.queue.submit([commandEncoder.finish()]);
  }

  resetGridBuffer() {
    this.gridPosBuffer = null;
  }
}
