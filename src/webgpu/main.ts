import './style.css';
import GUI from 'lil-gui';
import Stats from 'stats-gl';
import { createConfig } from '../canvas2d/config.ts';
import { createPhysics } from '../canvas2d/physics.ts';
import { buildGradientLut } from '../canvas2d/kernels.ts';
import { createSpawnData } from '../canvas2d/spawn.ts';
import type { SimState } from '../canvas2d/types.ts';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) {
  throw new Error('Missing #app container');
}

app.innerHTML = '<canvas id="sim-canvas" aria-label="Fluid simulation"></canvas>';

const canvas = document.querySelector<HTMLCanvasElement>('#sim-canvas');
if (!canvas) {
  throw new Error('Missing canvas element');
}

const canvasToWorld = (
  x: number,
  y: number,
  scale: number
): { x: number; y: number } => {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const px = (x - rect.left) * dpr;
  const py = (y - rect.top) * dpr;
  const originX = canvas.width * 0.5;
  const originY = canvas.height * 0.5;
  return {
    x: (px - originX) / scale,
    y: (originY - py) / scale,
  };
};

const gui = new GUI({ title: 'Simulation Settings' });
const stats = new Stats({ trackGPU: false, horizontal: true });
stats.dom.style.display = 'none';
document.body.appendChild(stats.dom);

const uiState = { showStats: false };
const config = createConfig();

const particlesFolder = gui.addFolder('Particles');
particlesFolder
  .add(config, 'spawnDensity', 10, 300, 1)
  .name('Spawn Density');
particlesFolder.add(config, 'gravity', -30, 30, 0.1).name('Gravity');
particlesFolder
  .add(config, 'collisionDamping', 0, 1, 0.01)
  .name('Collision Damping');
particlesFolder
  .add(config, 'smoothingRadius', 0.05, 3, 0.01)
  .name('Smoothing Radius');
particlesFolder.add(config, 'targetDensity', 0, 3000, 1).name('Target Density');
particlesFolder
  .add(config, 'pressureMultiplier', 0, 2000, 1)
  .name('Pressure Multiplier');
particlesFolder
  .add(config, 'nearPressureMultiplier', 0, 40, 0.1)
  .name('Near Pressure Multiplier');
particlesFolder
  .add(config, 'viscosityStrength', 0, 0.2, 0.001)
  .name('Viscosity Strength');
particlesFolder.add(config, 'particleRadius', 1, 6, 1).name('Particle Radius');

const obstacleFolder = gui.addFolder('Obstacle');
obstacleFolder.close();
obstacleFolder.add(config.obstacleSize, 'x', 0, 20, 0.01).name('Size X');
obstacleFolder.add(config.obstacleSize, 'y', 0, 20, 0.01).name('Size Y');
obstacleFolder
  .add(config.obstacleCentre, 'x', -10, 10, 0.01)
  .name('Center X');
obstacleFolder
  .add(config.obstacleCentre, 'y', -10, 10, 0.01)
  .name('Center Y');

const interactionFolder = gui.addFolder('Interaction');
interactionFolder.close();
interactionFolder
  .add(config, 'interactionRadius', 0, 10, 0.01)
  .name('Radius');
interactionFolder
  .add(config, 'interactionStrength', 0, 200, 1)
  .name('Strength');

const performanceFolder = gui.addFolder('Performance');
performanceFolder.close();
performanceFolder.add(config, 'timeScale', 0, 2, 0.01).name('Time Scale');
performanceFolder
  .add(config, 'maxTimestepFPS', 0, 120, 1)
  .name('Max Timestep FPS');
performanceFolder
  .add(config, 'iterationsPerFrame', 1, 8, 1)
  .name('Iterations Per Frame');
performanceFolder
  .add(uiState, 'showStats')
  .name('Show FPS')
  .onChange((value: boolean) => {
    stats.dom.style.display = value ? 'block' : 'none';
  });

async function initWebGPU(): Promise<void> {
  if (!navigator.gpu) {
    app.innerHTML = '<p>WebGPU is not supported in this browser.</p>';
    return;
  }

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    app.innerHTML = '<p>Unable to acquire a WebGPU adapter.</p>';
    return;
  }

  const device = await adapter.requestDevice();
  const context = canvas.getContext('webgpu');
  if (!context) {
    app.innerHTML = '<p>Unable to create a WebGPU context.</p>';
    return;
  }

  const format = navigator.gpu.getPreferredCanvasFormat();

  const spawn = createSpawnData(config);
  const particleCount = spawn.count;

  const state: SimState = {
    positions: spawn.positions,
    predicted: new Float32Array(spawn.positions),
    velocities: spawn.velocities,
    densities: new Float32Array(particleCount * 2),
    keys: new Uint32Array(particleCount),
    sortedKeys: new Uint32Array(particleCount),
    indices: new Uint32Array(particleCount),
    sortOffsets: new Uint32Array(particleCount),
    spatialOffsets: new Uint32Array(particleCount),
    positionsSorted: new Float32Array(particleCount * 2),
    predictedSorted: new Float32Array(particleCount * 2),
    velocitiesSorted: new Float32Array(particleCount * 2),
    count: particleCount,
    input: {
      worldX: 0,
      worldY: 0,
      pull: false,
      push: false,
    },
  };

  const getScale = (): number => canvas.width / config.boundsSize.x;
  const physics = createPhysics(state, config, getScale);

  const updatePointer = (event: MouseEvent): void => {
    const scale = getScale();
    const world = canvasToWorld(event.clientX, event.clientY, scale);
    state.input.worldX = world.x;
    state.input.worldY = world.y;
  };

  canvas.addEventListener('mousemove', updatePointer);
  canvas.addEventListener('mousedown', (event) => {
    updatePointer(event);
    if (event.button === 0) state.input.pull = true;
    if (event.button === 2) state.input.push = true;
  });
  canvas.addEventListener('mouseup', (event) => {
    if (event.button === 0) state.input.pull = false;
    if (event.button === 2) state.input.push = false;
  });
  canvas.addEventListener('mouseleave', () => {
    state.input.pull = false;
    state.input.push = false;
  });
  canvas.addEventListener('contextmenu', (event) => {
    event.preventDefault();
  });

  const uniformBuffer = device.createBuffer({
    size: 32,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const lineVertexStride = 6 * 4;
  const lineVertexCapacity = 16;
  const lineVertexData = new Float32Array(lineVertexCapacity * 6);
  const lineVertexBuffer = device.createBuffer({
    size: lineVertexData.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });

  const gradientLut = buildGradientLut(
    config.colorKeys,
    config.gradientResolution
  );
  const gradientData = new Float32Array(config.gradientResolution * 4);
  for (let i = 0; i < gradientLut.length; i += 1) {
    const col = gradientLut[i];
    gradientData[i * 4] = col.r;
    gradientData[i * 4 + 1] = col.g;
    gradientData[i * 4 + 2] = col.b;
    gradientData[i * 4 + 3] = 1;
  }

  const gradientBuffer = device.createBuffer({
    size: gradientData.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    mappedAtCreation: true,
  });
  new Float32Array(gradientBuffer.getMappedRange()).set(gradientData);
  gradientBuffer.unmap();

  const createBufferFromArray = (
    data: Float32Array | Uint32Array,
    usage: GPUBufferUsageFlags
  ): GPUBuffer => {
    const buffer = device.createBuffer({
      size: data.byteLength,
      usage,
      mappedAtCreation: true,
    });
    const mapping =
      data instanceof Float32Array
        ? new Float32Array(buffer.getMappedRange())
        : new Uint32Array(buffer.getMappedRange());
    mapping.set(data);
    buffer.unmap();
    return buffer;
  };

  const createEmptyBuffer = (
    byteLength: number,
    usage: GPUBufferUsageFlags
  ): GPUBuffer =>
    device.createBuffer({
      size: byteLength,
      usage,
    });

  const positionsBuffer = createBufferFromArray(
    spawn.positions,
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  );
  const predictedBuffer = createBufferFromArray(
    new Float32Array(spawn.positions),
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  );
  const velocitiesBuffer = createBufferFromArray(
    spawn.velocities,
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  );
  const densitiesBuffer = createEmptyBuffer(
    particleCount * 2 * 4,
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  );

  const keysBuffer = createEmptyBuffer(
    particleCount * 4,
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  );
  const sortedKeysBuffer = createEmptyBuffer(
    particleCount * 4,
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  );
  const indicesBuffer = createEmptyBuffer(
    particleCount * 4,
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  );
  const sortOffsetsBuffer = createEmptyBuffer(
    particleCount * 4,
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  );
  const spatialOffsetsBuffer = createEmptyBuffer(
    particleCount * 4,
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  );

  const positionsSortedBuffer = createEmptyBuffer(
    particleCount * 2 * 4,
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  );
  const predictedSortedBuffer = createEmptyBuffer(
    particleCount * 2 * 4,
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  );
  const velocitiesSortedBuffer = createEmptyBuffer(
    particleCount * 2 * 4,
    GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  );

  const gpuBuffers = {
    predictedBuffer,
    velocitiesBuffer,
    densitiesBuffer,
    keysBuffer,
    sortedKeysBuffer,
    indicesBuffer,
    sortOffsetsBuffer,
    spatialOffsetsBuffer,
    positionsSortedBuffer,
    predictedSortedBuffer,
    velocitiesSortedBuffer,
  };
  void gpuBuffers;

  const shaderModule = device.createShaderModule({
    code: `
struct SimUniforms {
  boundsSize: vec2<f32>,
  canvasSize: vec2<f32>,
  particleRadius: f32,
  velocityDisplayMax: f32,
  gradientResolution: f32,
  pad0: f32,
};

@group(0) @binding(0) var<storage, read> positions: array<vec2<f32>>;
@group(0) @binding(1) var<storage, read> velocities: array<vec2<f32>>;
@group(0) @binding(2) var<storage, read> gradient: array<vec4<f32>>;
@group(0) @binding(3) var<uniform> uniforms: SimUniforms;

struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) localPos: vec2<f32>,
  @location(1) speed: f32,
};

@vertex
fn vs_main(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32
) -> VertexOut {
  var quad = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(1.0, -1.0),
    vec2<f32>(1.0, 1.0),
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(1.0, 1.0),
    vec2<f32>(-1.0, 1.0)
  );

  let pos = positions[instanceIndex];
  let halfBounds = uniforms.boundsSize * 0.5;
  let ndc = vec2<f32>(pos.x / halfBounds.x, pos.y / halfBounds.y);
  let radiusNdc = vec2<f32>(
    uniforms.particleRadius / uniforms.canvasSize.x * 2.0,
    uniforms.particleRadius / uniforms.canvasSize.y * 2.0
  );
  let offset = quad[vertexIndex] * radiusNdc;

  var out: VertexOut;
  out.position = vec4<f32>(ndc + offset, 0.0, 1.0);
  out.localPos = quad[vertexIndex];
  let vel = velocities[instanceIndex];
  out.speed = length(vel);
  return out;
}

@fragment
fn fs_main(
  @location(0) localPos: vec2<f32>,
  @location(1) speed: f32
) -> @location(0) vec4<f32> {
  if (dot(localPos, localPos) > 1.0) {
    discard;
  }
  let t = clamp(speed / uniforms.velocityDisplayMax, 0.0, 1.0);
  let idx = u32(t * (uniforms.gradientResolution - 1.0));
  return gradient[idx];
}
`,
  });

  const lineShaderModule = device.createShaderModule({
    code: `
struct SimUniforms {
  boundsSize: vec2<f32>,
  canvasSize: vec2<f32>,
  particleRadius: f32,
  velocityDisplayMax: f32,
  gradientResolution: f32,
  pad0: f32,
};

@group(0) @binding(0) var<uniform> uniforms: SimUniforms;

struct VertexIn {
  @location(0) pos: vec2<f32>,
  @location(1) color: vec4<f32>,
};

struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
};

@vertex
fn vs_main(input: VertexIn) -> VertexOut {
  let halfBounds = uniforms.boundsSize * 0.5;
  let ndc = vec2<f32>(input.pos.x / halfBounds.x, input.pos.y / halfBounds.y);
  var out: VertexOut;
  out.position = vec4<f32>(ndc, 0.0, 1.0);
  out.color = input.color;
  return out;
}

@fragment
fn fs_main(@location(0) color: vec4<f32>) -> @location(0) vec4<f32> {
  return color;
}
`,
  });

  const pipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: {
      module: shaderModule,
      entryPoint: 'vs_main',
    },
    fragment: {
      module: shaderModule,
      entryPoint: 'fs_main',
      targets: [{ format }],
    },
    primitive: {
      topology: 'triangle-list',
    },
  });

  const linePipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: {
      module: lineShaderModule,
      entryPoint: 'vs_main',
      buffers: [
        {
          arrayStride: lineVertexStride,
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x2' },
            { shaderLocation: 1, offset: 2 * 4, format: 'float32x4' },
          ],
        },
      ],
    },
    fragment: {
      module: lineShaderModule,
      entryPoint: 'fs_main',
      targets: [{ format }],
    },
    primitive: {
      topology: 'line-list',
    },
  });

  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: positionsBuffer } },
      { binding: 1, resource: { buffer: velocitiesBuffer } },
      { binding: 2, resource: { buffer: gradientBuffer } },
      { binding: 3, resource: { buffer: uniformBuffer } },
    ],
  });

  const lineBindGroup = device.createBindGroup({
    layout: linePipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
  });

  let baseUnitsPerPixel: number | null = null;
  const uniformData = new Float32Array(8);

  const resize = (): void => {
    const rect = canvas.getBoundingClientRect();
    if (baseUnitsPerPixel === null) {
      baseUnitsPerPixel = config.boundsSize.x / Math.max(1, rect.width);
    }
    const dpr = window.devicePixelRatio || 1;
    const nextWidth = Math.max(1, Math.round(rect.width * dpr));
    const nextHeight = Math.max(1, Math.round(rect.height * dpr));

    if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
      canvas.width = nextWidth;
      canvas.height = nextHeight;
      config.boundsSize = {
        x: (canvas.width / dpr) * baseUnitsPerPixel,
        y: (canvas.height / dpr) * baseUnitsPerPixel,
      };
      context.configure({
        device,
        format,
        alphaMode: 'opaque',
      });
    }
  };

  resize();
  window.addEventListener('resize', resize);

  const clearColor = { r: 5 / 255, g: 7 / 255, b: 11 / 255, a: 1 };

  let lastTime = performance.now();
  const frame = (now: number): void => {
    stats.begin();
    const dt = Math.min(0.033, (now - lastTime) / 1000);
    lastTime = now;
    physics.step(dt);
    device.queue.writeBuffer(positionsBuffer, 0, state.positions);
    device.queue.writeBuffer(velocitiesBuffer, 0, state.velocities);
    uniformData[0] = config.boundsSize.x;
    uniformData[1] = config.boundsSize.y;
    uniformData[2] = canvas.width;
    uniformData[3] = canvas.height;
    uniformData[4] = config.particleRadius;
    uniformData[5] = config.velocityDisplayMax;
    uniformData[6] = config.gradientResolution;
    uniformData[7] = 0;
    device.queue.writeBuffer(uniformBuffer, 0, uniformData);
    let lineVertexCount = 0;
    const pushLine = (
      x0: number,
      y0: number,
      x1: number,
      y1: number,
      r: number,
      g: number,
      b: number,
      a: number
    ): void => {
      const base = lineVertexCount * 6;
      lineVertexData[base] = x0;
      lineVertexData[base + 1] = y0;
      lineVertexData[base + 2] = r;
      lineVertexData[base + 3] = g;
      lineVertexData[base + 4] = b;
      lineVertexData[base + 5] = a;
      lineVertexData[base + 6] = x1;
      lineVertexData[base + 7] = y1;
      lineVertexData[base + 8] = r;
      lineVertexData[base + 9] = g;
      lineVertexData[base + 10] = b;
      lineVertexData[base + 11] = a;
      lineVertexCount += 2;
    };

    const halfX = config.boundsSize.x * 0.5;
    const halfY = config.boundsSize.y * 0.5;
    const boundsCol = { r: 0x1b / 255, g: 0x24 / 255, b: 0x32 / 255, a: 1 };
    pushLine(-halfX, -halfY, halfX, -halfY, boundsCol.r, boundsCol.g, boundsCol.b, boundsCol.a);
    pushLine(halfX, -halfY, halfX, halfY, boundsCol.r, boundsCol.g, boundsCol.b, boundsCol.a);
    pushLine(halfX, halfY, -halfX, halfY, boundsCol.r, boundsCol.g, boundsCol.b, boundsCol.a);
    pushLine(-halfX, halfY, -halfX, -halfY, boundsCol.r, boundsCol.g, boundsCol.b, boundsCol.a);

    if (config.obstacleSize.x > 0 && config.obstacleSize.y > 0) {
      const obsHalfX = config.obstacleSize.x * 0.5;
      const obsHalfY = config.obstacleSize.y * 0.5;
      const cx = config.obstacleCentre.x;
      const cy = config.obstacleCentre.y;
      const obstacleCol = { r: 0x36 / 255, g: 0x51 / 255, b: 0x6d / 255, a: 1 };
      pushLine(
        cx - obsHalfX,
        cy - obsHalfY,
        cx + obsHalfX,
        cy - obsHalfY,
        obstacleCol.r,
        obstacleCol.g,
        obstacleCol.b,
        obstacleCol.a
      );
      pushLine(
        cx + obsHalfX,
        cy - obsHalfY,
        cx + obsHalfX,
        cy + obsHalfY,
        obstacleCol.r,
        obstacleCol.g,
        obstacleCol.b,
        obstacleCol.a
      );
      pushLine(
        cx + obsHalfX,
        cy + obsHalfY,
        cx - obsHalfX,
        cy + obsHalfY,
        obstacleCol.r,
        obstacleCol.g,
        obstacleCol.b,
        obstacleCol.a
      );
      pushLine(
        cx - obsHalfX,
        cy + obsHalfY,
        cx - obsHalfX,
        cy - obsHalfY,
        obstacleCol.r,
        obstacleCol.g,
        obstacleCol.b,
        obstacleCol.a
      );
    }

    device.queue.writeBuffer(
      lineVertexBuffer,
      0,
      lineVertexData.subarray(0, lineVertexCount * 6)
    );

    const encoder = device.createCommandEncoder();
    const view = context.getCurrentTexture().createView();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view,
          clearValue: clearColor,
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(6, particleCount);
    if (lineVertexCount > 0) {
      pass.setPipeline(linePipeline);
      pass.setBindGroup(0, lineBindGroup);
      pass.setVertexBuffer(0, lineVertexBuffer);
      pass.draw(lineVertexCount);
    }
    pass.end();
    device.queue.submit([encoder.finish()]);
    stats.end();
    stats.update();
    requestAnimationFrame(frame);
  };

  requestAnimationFrame(frame);
}

void initWebGPU();
