/**
 * FLIP Fluid Simulation - WebGPU Implementation
 *
 * Step 4: Add simulation (particles fall and splash)
 */

import { initWebGPU } from './webgpu_utils';
import { FlipFluid } from './flip_fluid';
import diskShader from './shaders/disk.wgsl?raw';
import particleShader from './shaders/particle.wgsl?raw';

async function main(): Promise<void> {
  // Get canvas and set size
  const canvas = document.getElementById('myCanvas') as HTMLCanvasElement;
  canvas.width = window.innerWidth - 40;
  canvas.height = window.innerHeight - 100;

  // Simulation dimensions
  const simHeight = 3.0;
  const simWidth = (canvas.width / canvas.height) * simHeight;

  console.log('Simulation domain:', simWidth.toFixed(2), 'x', simHeight);

  // Initialize WebGPU
  const { device, context, format } = await initWebGPU(canvas);
  console.log('WebGPU initialized!');

  // ============ FLUID SIMULATION SETUP ============
  const res = 100;
  const h = simHeight / res;
  const particleRadius = 0.3 * h;
  const density = 1000.0;

  // Dam-break particle placement
  const relWaterHeight = 0.8;
  const relWaterWidth = 0.6;
  const dx = 2.0 * particleRadius;
  const dy = (Math.sqrt(3.0) / 2.0) * dx;

  const numX = Math.floor((relWaterWidth * simWidth - 2.0 * h - 2.0 * particleRadius) / dx);
  const numY = Math.floor((relWaterHeight * simHeight - 2.0 * h - 2.0 * particleRadius) / dy);
  const maxParticles = numX * numY;

  console.log('Creating fluid with', maxParticles, 'particles');

  // Create fluid simulation
  const fluid = new FlipFluid(density, simWidth, simHeight, h, particleRadius, maxParticles);

  // Initialize particles
  fluid.numParticles = maxParticles;
  let p = 0;
  for (let i = 0; i < numX; i++) {
    for (let j = 0; j < numY; j++) {
      fluid.particlePos[p++] = h + particleRadius + dx * i + (j % 2 === 0 ? 0.0 : particleRadius);
      fluid.particlePos[p++] = h + particleRadius + dy * j;
    }
  }

  // Setup boundary cells (solid walls)
  const n = fluid.fNumY;
  for (let i = 0; i < fluid.fNumX; i++) {
    for (let j = 0; j < fluid.fNumY; j++) {
      let s = 1.0; // fluid
      if (i === 0 || i === fluid.fNumX - 1 || j === 0) {
        s = 0.0; // solid
      }
      fluid.s[i * n + j] = s;
    }
  }

  console.log('Fluid grid:', fluid.fNumX, 'x', fluid.fNumY, 'cells');

  // Simulation parameters
  const gravity = -9.81;
  const dt = 1.0 / 60.0;
  const flipRatio = 0.9;
  const numPressureIters = 50;
  const numParticleIters = 2;
  const overRelaxation = 1.9;
  const compensateDrift = true;
  const separateParticles = true;

  // Obstacle parameters
  let obstacleX = 3.0;
  let obstacleY = 2.0;
  const obstacleRadius = 0.15;

  // Set initial obstacle
  function setObstacle(x: number, y: number, vx: number, vy: number): void {
    for (let i = 1; i < fluid.fNumX - 2; i++) {
      for (let j = 1; j < fluid.fNumY - 2; j++) {
        fluid.s[i * n + j] = 1.0;

        const dx = (i + 0.5) * fluid.h - x;
        const dy = (j + 0.5) * fluid.h - y;

        if (dx * dx + dy * dy < obstacleRadius * obstacleRadius) {
          fluid.s[i * n + j] = 0.0;
          fluid.u[i * n + j] = vx;
          fluid.u[(i + 1) * n + j] = vx;
          fluid.v[i * n + j] = vy;
          fluid.v[i * n + j + 1] = vy;
        }
      }
    }
  }

  setObstacle(obstacleX, obstacleY, 0, 0);

  // ============ GPU BUFFERS ============
  const particlePosBuffer = device.createBuffer({
    size: maxParticles * 2 * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });

  const particleColorBuffer = device.createBuffer({
    size: maxParticles * 3 * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });

  const particleUniforms = device.createBuffer({
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(particleUniforms, 0, new Float32Array([
    simWidth, simHeight, 2.0 * particleRadius, 0,
  ]));

  // Particle pipeline
  const particleBindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
    ],
  });

  const particlePipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [particleBindGroupLayout] }),
    vertex: {
      module: device.createShaderModule({ code: particleShader }),
      entryPoint: 'vs_main',
    },
    fragment: {
      module: device.createShaderModule({ code: particleShader }),
      entryPoint: 'fs_main',
      targets: [{ format }],
    },
    primitive: { topology: 'triangle-strip' },
  });

  const particleBindGroup = device.createBindGroup({
    layout: particleBindGroupLayout,
    entries: [
      { binding: 0, resource: { buffer: particleUniforms } },
      { binding: 1, resource: { buffer: particlePosBuffer } },
      { binding: 2, resource: { buffer: particleColorBuffer } },
    ],
  });

  // ============ DISK SETUP ============
  const numSegs = 50;
  const diskVerts = new Float32Array((numSegs + 1) * 2);
  const dphi = (2.0 * Math.PI) / numSegs;

  diskVerts[0] = 0.0;
  diskVerts[1] = 0.0;
  for (let i = 0; i < numSegs; i++) {
    diskVerts[(i + 1) * 2] = Math.cos(i * dphi);
    diskVerts[(i + 1) * 2 + 1] = Math.sin(i * dphi);
  }

  const diskVertexBuffer = device.createBuffer({
    size: diskVerts.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(diskVertexBuffer, 0, diskVerts);

  const diskIds = new Uint16Array(numSegs * 3);
  let idx = 0;
  for (let i = 0; i < numSegs; i++) {
    diskIds[idx++] = 0;
    diskIds[idx++] = i + 1;
    diskIds[idx++] = ((i + 1) % numSegs) + 1;
  }

  const diskIndexBuffer = device.createBuffer({
    size: diskIds.byteLength,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(diskIndexBuffer, 0, diskIds);

  const diskUniforms = device.createBuffer({
    size: 48,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const diskBindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
    ],
  });

  const diskPipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [diskBindGroupLayout] }),
    vertex: {
      module: device.createShaderModule({ code: diskShader }),
      entryPoint: 'vs_main',
    },
    fragment: {
      module: device.createShaderModule({ code: diskShader }),
      entryPoint: 'fs_main',
      targets: [{ format }],
    },
    primitive: { topology: 'triangle-list' },
  });

  const diskBindGroup = device.createBindGroup({
    layout: diskBindGroupLayout,
    entries: [
      { binding: 0, resource: { buffer: diskUniforms } },
      { binding: 1, resource: { buffer: diskVertexBuffer } },
    ],
  });

  // ============ SIMULATION STATE ============
  let paused = false;

  // Keyboard controls
  document.addEventListener('keydown', (event) => {
    if (event.key === 'p') {
      paused = !paused;
      console.log(paused ? 'Paused' : 'Running');
    }
  });

  console.log("Press 'p' to pause/unpause. Simulation starting...");

  // ============ MAIN LOOP ============
  function update(): void {
    // Run simulation step
    if (!paused) {
      setObstacle(obstacleX, obstacleY, 0, 0);

      fluid.simulate(
        dt, gravity, flipRatio,
        numPressureIters, numParticleIters,
        overRelaxation, compensateDrift, separateParticles,
        obstacleX, obstacleY, obstacleRadius,
        0, 0 // obstacle velocity
      );
    }

    // Upload particle data to GPU
    device.queue.writeBuffer(particlePosBuffer, 0, fluid.particlePos.buffer, 0, fluid.numParticles * 2 * 4);
    device.queue.writeBuffer(particleColorBuffer, 0, fluid.particleColor.buffer, 0, fluid.numParticles * 3 * 4);

    // Update disk uniforms
    device.queue.writeBuffer(diskUniforms, 0, new Float32Array([
      simWidth, simHeight,
      obstacleX, obstacleY,
      obstacleRadius + particleRadius, 0, 0, 0,
      1.0, 0.0, 0.0, 0,
    ]));

    // Render
    const commandEncoder = device.createCommandEncoder();
    const textureView = context.getCurrentTexture().createView();

    const renderPass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: textureView,
        clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });

    // Draw particles
    renderPass.setPipeline(particlePipeline);
    renderPass.setBindGroup(0, particleBindGroup);
    renderPass.draw(4, fluid.numParticles);

    // Draw disk
    renderPass.setPipeline(diskPipeline);
    renderPass.setBindGroup(0, diskBindGroup);
    renderPass.setIndexBuffer(diskIndexBuffer, 'uint16');
    renderPass.drawIndexed(numSegs * 3);

    renderPass.end();
    device.queue.submit([commandEncoder.finish()]);

    requestAnimationFrame(update);
  }

  update();
}

main().catch((error) => {
  console.error('Failed to initialize:', error);
  document.body.innerHTML = `
    <div style="color: red; padding: 20px;">
      <h2>Error</h2>
      <p>${error.message}</p>
    </div>
  `;
});
