/**
 * FLIP Fluid Simulation - WebGPU Implementation
 *
 * Phase 1: GPU integration, rest on CPU
 * - Particle integration (gravity + position update) runs on GPU
 * - All other steps run on CPU
 * - This verifies the GPU compute infrastructure works correctly
 */

import { initWebGPU } from './webgpu_utils';
import { FlipFluid } from './flip_fluid';
import { GPUFluidSimulation } from './gpu_simulation';
import { SimulationParams } from './gpu_buffers';
import diskShader from './shaders/disk.wgsl?raw';
import particleShader from './shaders/particle.wgsl?raw';

async function main(): Promise<void> {
  // Get canvas and set size
  const canvas = document.getElementById('myCanvas') as HTMLCanvasElement;
  canvas.width = window.innerWidth - 40;
  canvas.height = window.innerHeight - 100;

  // Simulation dimensions
  const simHeight = 3.0;
  const cScale = canvas.height / simHeight;
  const simWidth = canvas.width / cScale;

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

  // Create CPU fluid simulation (used for most steps)
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

  // ============ GPU SIMULATION SETUP ============
  const simParams: SimulationParams = {
    fNumX: fluid.fNumX,
    fNumY: fluid.fNumY,
    fNumCells: fluid.fNumCells,
    h: fluid.h,
    fInvSpacing: fluid.fInvSpacing,
    numParticles: fluid.numParticles,
    maxParticles: fluid.maxParticles,
    particleRadius: fluid.particleRadius,
    pNumX: fluid.pNumX,
    pNumY: fluid.pNumY,
    pNumCells: fluid.pNumCells,
    pInvSpacing: fluid.pInvSpacing,
    gravity: -9.81,
    dt: 1.0 / 60.0,
    flipRatio: 0.9,
    overRelaxation: 1.9,
    particleRestDensity: 0.0,
    domainWidth: simWidth,
    domainHeight: simHeight,
  };

  const gpuSim = new GPUFluidSimulation(device, simParams);
  console.log('GPU simulation initialized!');

  // Simulation parameters
  const gravity = -9.81;
  const dt = 1.0 / 60.0;
  let flipRatio = 0.9;
  const numPressureIters = 50;
  const numParticleIters = 2;
  const overRelaxation = 1.9;
  let compensateDrift = true;
  let separateParticles = true;

  // Obstacle state
  let obstacleX = 3.0;
  let obstacleY = 2.0;
  let obstacleVelX = 0.0;
  let obstacleVelY = 0.0;
  const obstacleRadius = 0.15;

  // Set obstacle in grid
  function setObstacle(x: number, y: number, vx: number, vy: number): void {
    for (let i = 1; i < fluid.fNumX - 2; i++) {
      for (let j = 1; j < fluid.fNumY - 2; j++) {
        fluid.s[i * n + j] = 1.0;

        const cellDx = (i + 0.5) * fluid.h - x;
        const cellDy = (j + 0.5) * fluid.h - y;

        if (cellDx * cellDx + cellDy * cellDy < obstacleRadius * obstacleRadius) {
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

  // ============ MOUSE INTERACTION ============
  let mouseDown = false;
  let paused = true;

  function clientToSim(clientX: number, clientY: number): { x: number; y: number } {
    const bounds = canvas.getBoundingClientRect();
    const mx = clientX - bounds.left;
    const my = clientY - bounds.top;
    return {
      x: mx / cScale,
      y: (canvas.height - my) / cScale,
    };
  }

  canvas.addEventListener('mousedown', (event) => {
    mouseDown = true;
    paused = false;
    const pos = clientToSim(event.clientX, event.clientY);
    obstacleX = pos.x;
    obstacleY = pos.y;
    obstacleVelX = 0;
    obstacleVelY = 0;
  });

  canvas.addEventListener('mouseup', () => {
    mouseDown = false;
    obstacleVelX = 0;
    obstacleVelY = 0;
  });

  canvas.addEventListener('mousemove', (event) => {
    if (!mouseDown) return;
    const pos = clientToSim(event.clientX, event.clientY);
    obstacleVelX = (pos.x - obstacleX) / dt;
    obstacleVelY = (pos.y - obstacleY) / dt;
    obstacleX = pos.x;
    obstacleY = pos.y;
  });

  // Touch support
  canvas.addEventListener('touchstart', (event) => {
    mouseDown = true;
    paused = false;
    const pos = clientToSim(event.touches[0].clientX, event.touches[0].clientY);
    obstacleX = pos.x;
    obstacleY = pos.y;
    obstacleVelX = 0;
    obstacleVelY = 0;
  });

  canvas.addEventListener('touchend', () => {
    mouseDown = false;
    obstacleVelX = 0;
    obstacleVelY = 0;
  });

  canvas.addEventListener('touchmove', (event) => {
    event.preventDefault();
    if (!mouseDown) return;
    const pos = clientToSim(event.touches[0].clientX, event.touches[0].clientY);
    obstacleVelX = (pos.x - obstacleX) / dt;
    obstacleVelY = (pos.y - obstacleY) / dt;
    obstacleX = pos.x;
    obstacleY = pos.y;
  }, { passive: false });

  // Keyboard
  document.addEventListener('keydown', (event) => {
    if (event.key === 'p') {
      paused = !paused;
      console.log(paused ? 'Paused' : 'Running');
    } else if (event.key === 'm') {
      paused = false;
      runSimStep();
      paused = true;
    }
  });

  // UI checkboxes
  const showParticlesEl = document.getElementById('showParticles') as HTMLInputElement;
  const compensateDriftEl = document.getElementById('compensateDrift') as HTMLInputElement;
  const separateParticlesEl = document.getElementById('separateParticles') as HTMLInputElement;
  const flipRatioEl = document.getElementById('flipRatio') as HTMLInputElement;

  let showParticles = true;

  if (showParticlesEl) {
    showParticlesEl.addEventListener('change', () => {
      showParticles = showParticlesEl.checked;
    });
  }
  if (compensateDriftEl) {
    compensateDriftEl.addEventListener('change', () => {
      compensateDrift = compensateDriftEl.checked;
    });
  }
  if (separateParticlesEl) {
    separateParticlesEl.addEventListener('change', () => {
      separateParticles = separateParticlesEl.checked;
    });
  }
  if (flipRatioEl) {
    flipRatioEl.addEventListener('input', () => {
      flipRatio = 0.1 * parseInt(flipRatioEl.value);
    });
  }

  console.log("GPU Integration active. Drag to move obstacle. Press 'p' to pause.");

  // ============ GPU RENDER BUFFERS ============
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

  // ============ SIMULATION ============
  async function runSimStep(): Promise<void> {
    setObstacle(obstacleX, obstacleY, obstacleVelX, obstacleVelY);

    // Update GPU params
    gpuSim.updateParams({ gravity, dt, numParticles: fluid.numParticles });
    gpuSim.updateObstacle(obstacleX, obstacleY, obstacleVelX, obstacleVelY, obstacleRadius);

    // Upload current state to GPU
    gpuSim.getBuffers().uploadParticlePos(fluid.particlePos, fluid.numParticles);
    gpuSim.getBuffers().uploadParticleVel(fluid.particleVel, fluid.numParticles);

    // ===== GPU: Integrate + Collisions =====
    gpuSim.runIntegrate();
    gpuSim.runCollisions();

    // Read back GPU results
    const gpuPos = await gpuSim.readParticlePositions(fluid.numParticles);
    const gpuVel = await gpuSim.readParticleVelocities(fluid.numParticles);

    // Copy GPU results to CPU arrays
    fluid.particlePos.set(gpuPos);
    fluid.particleVel.set(gpuVel);

    // ===== CPU: Remaining simulation steps =====
    // Push particles apart (uses spatial hash - still on CPU)
    if (separateParticles) {
      fluid.pushParticlesApart(numParticleIters);
    }

    // P2G transfer (CPU)
    fluid.transferVelocities(true, flipRatio);

    // Update density (CPU)
    fluid.updateParticleDensity();

    // Pressure solver (CPU)
    const sdt = 1.0 / 60.0; // sub-timestep for pressure solve
    fluid.solveIncompressibility(numPressureIters, sdt, overRelaxation, compensateDrift);

    // ===== GPU: G2P Transfer =====
    // Upload grid data needed for G2P (after pressure solver)
    gpuSim.uploadGridDataForG2P(
      fluid.u,
      fluid.v,
      fluid.prevU,
      fluid.prevV,
      fluid.cellType
    );
    // Upload particle positions (needed for interpolation)
    gpuSim.getBuffers().uploadParticlePos(fluid.particlePos, fluid.numParticles);
    // Upload particle velocities BEFORE G2P (these will be modified by G2P)
    gpuSim.getBuffers().uploadParticleVel(fluid.particleVel, fluid.numParticles);
    // Update flipRatio in params
    gpuSim.updateParams({ flipRatio });

    // Run GPU G2P
    gpuSim.runG2P();

    // G2P transfer (CPU) - keep for comparison
    fluid.transferVelocities(false, flipRatio);

    // Read back GPU velocities and use them (overwrite CPU results)
    const gpuVelAfterG2P = await gpuSim.readParticleVelocities(fluid.numParticles);
    fluid.particleVel.set(gpuVelAfterG2P);

    // ===== GPU: Color Update =====
    // Sync particleRestDensity from CPU (computed in updateParticleDensity)
    gpuSim.updateParams({ particleRestDensity: fluid.particleRestDensity });

    // Upload density computed by CPU
    gpuSim.uploadGridDensity(fluid.particleDensity);
    // Upload current colors and positions for the color shader
    gpuSim.getBuffers().uploadParticlePos(fluid.particlePos, fluid.numParticles);
    gpuSim.getBuffers().uploadParticleColor(fluid.particleColor, fluid.numParticles);

    // Run GPU color update
    gpuSim.runUpdateColors();

    // Read back GPU colors
    const gpuColors = await gpuSim.readParticleColors(fluid.numParticles);

    // Convert RGBA back to RGB and update CPU array
    for (let i = 0; i < fluid.numParticles; i++) {
      fluid.particleColor[i * 3 + 0] = gpuColors[i * 4 + 0];
      fluid.particleColor[i * 3 + 1] = gpuColors[i * 4 + 1];
      fluid.particleColor[i * 3 + 2] = gpuColors[i * 4 + 2];
    }

    // Update cell colors (CPU - for grid visualization)
    fluid.updateCellColors();
  }

  // ============ MAIN LOOP ============
  let isSimulating = false;

  async function update(): Promise<void> {
    if (!paused && !isSimulating) {
      isSimulating = true;
      await runSimStep();
      isSimulating = false;
    }

    // Upload particle data for rendering
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

    if (showParticles) {
      renderPass.setPipeline(particlePipeline);
      renderPass.setBindGroup(0, particleBindGroup);
      renderPass.draw(4, fluid.numParticles);
    }

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
