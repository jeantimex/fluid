import integrateShader from './shaders/integrate.wgsl?raw';
import { SimParams, DEFAULT_PARAMS } from './types';
import { FlipRenderer } from './renderer';

export class FlipFluid {
  public params: SimParams;
  public renderer: FlipRenderer;
  
  // Buffers
  public posBuffer: GPUBuffer;
  public velBuffer: GPUBuffer;
  public colorBuffer: GPUBuffer;
  private computeParamsBuffer: GPUBuffer;
  
  // Compute
  private integratePipeline: GPUComputePipeline;
  private integrateBindGroup: GPUBindGroup;
  
  public numParticles: number = 0;

  constructor(
    private device: GPUDevice,
    private context: GPUCanvasContext,
    format: GPUTextureFormat
  ) {
    this.params = { ...DEFAULT_PARAMS };
    this.renderer = new FlipRenderer(device, format, this.params);

    // 1. Create Buffers
    const maxP = this.params.maxParticles;
    this.posBuffer = device.createBuffer({
      size: maxP * 8, // vec2<f32>
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.velBuffer = device.createBuffer({
      size: maxP * 8, // vec2<f32>
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.colorBuffer = device.createBuffer({
      size: maxP * 12, // vec3<f32>
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.computeParamsBuffer = device.createBuffer({
      size: 16, // width, height, gravity, dt
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // 2. Create Compute Pipeline
    this.integratePipeline = device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: device.createShaderModule({ code: integrateShader }),
        entryPoint: 'main',
      },
    });

    // 3. Create Bind Group
    this.integrateBindGroup = device.createBindGroup({
      layout: this.integratePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.computeParamsBuffer } },
        { binding: 1, resource: { buffer: this.posBuffer } },
        { binding: 2, resource: { buffer: this.velBuffer } },
      ],
    });

    this.initParticles();
  }

  private initParticles() {
    const { width, height, spacing, particleRadius } = this.params;
    
    const relWaterHeight = 0.8;
    const relWaterWidth = 0.6;
    const r = particleRadius;
    const dx = 2.0 * r;
    const dy = Math.sqrt(3.0) / 2.0 * dx;
    
    const marginX = spacing * 2.0;
    const marginY = spacing * 2.0;
    
    const numX = Math.floor((relWaterWidth * width - 2.0 * marginX) / dx);
    const numY = Math.floor((relWaterHeight * height - 2.0 * marginY) / dy);
    
    this.numParticles = Math.min(numX * numY, this.params.maxParticles);

    const posData = new Float32Array(this.numParticles * 2);
    const velData = new Float32Array(this.numParticles * 2);
    const colorData = new Float32Array(this.numParticles * 3);
    
    let p2 = 0;
    let p3 = 0;
    
    for (let i = 0; i < numX; i++) {
        for (let j = 0; j < numY; j++) {
            if (p2 >= this.numParticles * 2) break;

            const x = marginX + dx * i + (j % 2 === 0 ? 0.0 : r);
            const y = marginY + dy * j;
            
            posData[p2++] = x;
            posData[p2++] = y;

            velData[p2-2] = 0;
            velData[p2-1] = 0;

            colorData[p3++] = 0.0;
            colorData[p3++] = 0.0;
            colorData[p3++] = 1.0;
        }
    }

    this.device.queue.writeBuffer(this.posBuffer, 0, posData);
    this.device.queue.writeBuffer(this.velBuffer, 0, velData);
    this.device.queue.writeBuffer(this.colorBuffer, 0, colorData);
  }

  step(dt: number) {
    // Update compute params
    const paramsData = new Float32Array([
      this.params.width,
      this.params.height,
      this.params.gravity,
      dt
    ]);
    this.device.queue.writeBuffer(this.computeParamsBuffer, 0, paramsData);

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.integratePipeline);
    pass.setBindGroup(0, this.integrateBindGroup);
    
    const workgroupCount = Math.ceil(this.numParticles / 64);
    pass.dispatchWorkgroups(workgroupCount);
    
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  render() {
    this.renderer.render(this.context, this.posBuffer, this.colorBuffer, this.numParticles);
  }
}
