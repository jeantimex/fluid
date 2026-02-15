import { SimParams, DEFAULT_PARAMS } from './types';
import { FlipRenderer } from './renderer';

export class FlipFluid {
  public params: SimParams;
  public renderer: FlipRenderer;
  public particleBuffer: GPUBuffer;
  public numParticles: number = 0;

  constructor(
    private device: GPUDevice,
    private context: GPUCanvasContext,
    format: GPUTextureFormat
  ) {
    this.params = { ...DEFAULT_PARAMS };
    this.renderer = new FlipRenderer(device, format, this.params);

    const bufferSize = this.params.maxParticles * 20; // 20 bytes per particle
    this.particleBuffer = device.createBuffer({
      size: bufferSize,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE,
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

    const data = new Float32Array(this.params.maxParticles * 5);
    let p = 0;
    
    for (let i = 0; i < numX; i++) {
        for (let j = 0; j < numY; j++) {
            if (p >= this.numParticles * 5) break;

            const x = marginX + dx * i + (j % 2 === 0 ? 0.0 : r);
            const y = marginY + dy * j;
            
            data[p++] = x;
            data[p++] = y;
            data[p++] = 0.0; // R
            data[p++] = 0.0; // G
            data[p++] = 1.0; // B
        }
    }

    this.device.queue.writeBuffer(this.particleBuffer, 0, data);
  }

  step(dt: number) {
    // Logic for Step 2
  }

  render() {
    this.renderer.render(this.context, this.particleBuffer, this.numParticles);
  }
}
