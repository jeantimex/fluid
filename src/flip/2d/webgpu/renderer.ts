/**
 * FLIP Fluid WebGPU Renderer
 *
 * This module orchestrates all rendering for the FLIP simulation.
 * Render order:
 * 1. Clear to black
 * 2. Draw grid cells (if enabled)
 * 3. Draw particles (if enabled)
 * 4. Draw obstacle disk
 */

import { WebGPUContext } from './webgpu_utils';
import { FlipFluid } from './flip_fluid';
import { FlipBuffers } from './flip_buffers';
import { RenderPipelines } from './render_pipelines';

export class FlipRenderer {
  private device: GPUDevice;
  private context: GPUCanvasContext;
  private format: GPUTextureFormat;
  private buffers: FlipBuffers;
  private pipelines: RenderPipelines;

  // Domain dimensions (in simulation units)
  private simWidth: number;
  private simHeight: number;

  constructor(webgpu: WebGPUContext, fluid: FlipFluid, simWidth: number, simHeight: number) {
    this.device = webgpu.device;
    this.context = webgpu.context;
    this.format = webgpu.format;
    this.simWidth = simWidth;
    this.simHeight = simHeight;

    // Create buffers
    this.buffers = new FlipBuffers(this.device, fluid);

    // Create pipelines
    this.pipelines = new RenderPipelines(this.device, this.format, this.buffers);

    // Initialize uniforms
    this.buffers.updateParticleUniforms(
      simWidth,
      simHeight,
      2.0 * fluid.particleRadius
    );
    this.buffers.updateGridUniforms(simWidth, simHeight, fluid.h);
  }

  /**
   * Update GPU buffers from CPU simulation state.
   */
  updateBuffers(fluid: FlipFluid): void {
    this.buffers.updateParticleBuffers(fluid);
    this.buffers.updateGridBuffers(fluid);
  }

  /**
   * Render one frame.
   */
  render(
    fluid: FlipFluid,
    showParticles: boolean,
    showGrid: boolean,
    obstacleX: number,
    obstacleY: number,
    obstacleRadius: number
  ): void {
    // Update disk uniforms
    const diskRadius = obstacleRadius + fluid.particleRadius;
    this.buffers.updateDiskUniforms(
      this.simWidth,
      this.simHeight,
      obstacleX,
      obstacleY,
      diskRadius,
      1.0, // red
      0.0,
      0.0
    );

    // Get the current texture to render to
    const textureView = this.context.getCurrentTexture().createView();

    // Create command encoder
    const commandEncoder = this.device.createCommandEncoder();

    // Begin render pass
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

    // Draw grid cells (if enabled)
    if (showGrid) {
      renderPass.setPipeline(this.pipelines.gridPipeline);
      renderPass.setBindGroup(0, this.pipelines.gridBindGroup);
      // 4 vertices per quad, fNumCells instances
      renderPass.draw(4, this.buffers.numGridCells);
    }

    // Draw particles (if enabled)
    if (showParticles && this.buffers.numParticles > 0) {
      renderPass.setPipeline(this.pipelines.particlePipeline);
      renderPass.setBindGroup(0, this.pipelines.particleBindGroup);
      // 4 vertices per quad, numParticles instances
      renderPass.draw(4, this.buffers.numParticles);
    }

    // Draw obstacle disk
    renderPass.setPipeline(this.pipelines.diskPipeline);
    renderPass.setBindGroup(0, this.pipelines.diskBindGroup);
    renderPass.setIndexBuffer(this.buffers.diskIndices, 'uint16');
    renderPass.drawIndexed(this.buffers.numDiskIndices);

    // End render pass
    renderPass.end();

    // Submit commands
    this.device.queue.submit([commandEncoder.finish()]);
  }

  /**
   * Clean up GPU resources.
   */
  destroy(): void {
    this.buffers.destroy();
  }
}
