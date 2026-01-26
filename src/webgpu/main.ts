import './style.css';
import GUI from 'lil-gui';
import Stats from 'stats-gl';
import { createConfig } from '../canvas2d/config.ts';
import { createPhysics } from '../canvas2d/physics.ts';
import { buildGradientLut } from '../canvas2d/kernels.ts';
import { createSpawnData } from '../canvas2d/spawn.ts';
import type { SimState, SpawnData } from '../canvas2d/types.ts';

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
let resetSim: (() => void) | null = null;
let physics: ReturnType<typeof createPhysics> | null = null;
const useGpuExternalForces = true;
const useGpuSpatialHash = true;
const useGpuDensity = true;
const useGpuDensityReadback = true;
const useCpuSpatialDataForGpuDensity = false;
const useGpuPressure = true;
const useGpuViscosity = true;

const particlesFolder = gui.addFolder('Particles');
particlesFolder
  .add(config, 'spawnDensity', 10, 300, 1)
  .name('Spawn Density')
  .onFinishChange(() => resetSim?.());
particlesFolder.add(config, 'gravity', -30, 30, 0.1).name('Gravity');
particlesFolder
  .add(config, 'collisionDamping', 0, 1, 0.01)
  .name('Collision Damping');
const smoothingCtrl = particlesFolder
  .add(config, 'smoothingRadius', 0.05, 3, 0.01)
  .name('Smoothing Radius')
  .onChange(() => physics?.refreshSettings());
const targetDensityCtrl = particlesFolder
  .add(config, 'targetDensity', 0, 3000, 1)
  .name('Target Density');
const pressureCtrl = particlesFolder
  .add(config, 'pressureMultiplier', 0, 2000, 1)
  .name('Pressure Multiplier');
const nearPressureCtrl = particlesFolder
  .add(config, 'nearPressureMultiplier', 0, 40, 0.1)
  .name('Near Pressure Multiplier');
const viscosityCtrl = particlesFolder
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

  let particleCount = 0;
  let state: SimState | null = null;
  let positionsBuffer: GPUBuffer | null = null;
  let predictedBuffer: GPUBuffer | null = null;
  let velocitiesBuffer: GPUBuffer | null = null;
  let densitiesBuffer: GPUBuffer | null = null;
  let keysBuffer: GPUBuffer | null = null;
  let sortedKeysBuffer: GPUBuffer | null = null;
  let indicesBuffer: GPUBuffer | null = null;
  let sortOffsetsBuffer: GPUBuffer | null = null;
  let spatialOffsetsBuffer: GPUBuffer | null = null;
  let positionsSortedBuffer: GPUBuffer | null = null;
  let predictedSortedBuffer: GPUBuffer | null = null;
  let velocitiesSortedBuffer: GPUBuffer | null = null;
  let velocityReadbackBuffer: GPUBuffer | null = null;
  let densityReadbackBuffer: GPUBuffer | null = null;
  let bindGroup: GPUBindGroup | null = null;
  let computeBindGroup: GPUBindGroup | null = null;
  let hashBindGroup: GPUBindGroup | null = null;
  let clearOffsetsBindGroup: GPUBindGroup | null = null;
  let countOffsetsBindGroup: GPUBindGroup | null = null;
  let scatterBindGroup: GPUBindGroup | null = null;
  let spatialOffsetsBindGroup: GPUBindGroup | null = null;
  let densityBindGroup: GPUBindGroup | null = null;
  let pressureBindGroup: GPUBindGroup | null = null;
  let viscosityBindGroup: GPUBindGroup | null = null;

  const getScale = (): number => canvas.width / config.boundsSize.x;

  const updatePointer = (event: MouseEvent): void => {
    if (!state) return;
    const scale = getScale();
    const world = canvasToWorld(event.clientX, event.clientY, scale);
    state.input.worldX = world.x;
    state.input.worldY = world.y;
  };

  canvas.addEventListener('mousemove', updatePointer);
  canvas.addEventListener('mousedown', (event) => {
    if (!state) return;
    updatePointer(event);
    if (event.button === 0) state.input.pull = true;
    if (event.button === 2) state.input.push = true;
  });
  canvas.addEventListener('mouseup', (event) => {
    if (!state) return;
    if (event.button === 0) state.input.pull = false;
    if (event.button === 2) state.input.push = false;
  });
  canvas.addEventListener('mouseleave', () => {
    if (!state) return;
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

  const computeUniformBuffer = device.createBuffer({
    size: 32,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const hashUniformBuffer = device.createBuffer({
    size: 32,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const sortUniformBuffer = device.createBuffer({
    size: 32,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const densityUniformBuffer = device.createBuffer({
    size: 48,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const pressureUniformBuffer = device.createBuffer({
    size: 48,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const viscosityUniformBuffer = device.createBuffer({
    size: 48,
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

  const createStateFromSpawn = (spawn: SpawnData): SimState => ({
    positions: spawn.positions,
    predicted: new Float32Array(spawn.positions),
    velocities: spawn.velocities,
    densities: new Float32Array(spawn.count * 2),
    keys: new Uint32Array(spawn.count),
    sortedKeys: new Uint32Array(spawn.count),
    indices: new Uint32Array(spawn.count),
    sortOffsets: new Uint32Array(spawn.count),
    spatialOffsets: new Uint32Array(spawn.count),
    positionsSorted: new Float32Array(spawn.count * 2),
    predictedSorted: new Float32Array(spawn.count * 2),
    velocitiesSorted: new Float32Array(spawn.count * 2),
    count: spawn.count,
    input: {
      worldX: 0,
      worldY: 0,
      pull: false,
      push: false,
    },
  });

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

  const destroyBuffers = (buffers: (GPUBuffer | null)[]): void => {
    for (const buffer of buffers) {
      buffer?.destroy();
    }
  };

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

  const computeShaderModule = device.createShaderModule({
    code: `
struct SimParams {
  deltaTime: f32,
  gravity: f32,
  interactionRadius: f32,
  interactionStrength: f32,
  inputPoint: vec2<f32>,
  pad0: vec2<f32>,
};

@group(0) @binding(0) var<storage, read> positions: array<vec2<f32>>;
@group(0) @binding(1) var<storage, read_write> velocities: array<vec2<f32>>;
@group(0) @binding(2) var<storage, read_write> predicted: array<vec2<f32>>;
@group(0) @binding(3) var<uniform> params: SimParams;

fn externalForces(pos: vec2<f32>, velocity: vec2<f32>) -> vec2<f32> {
  let gravityAccel = vec2<f32>(0.0, -params.gravity);
  if (params.interactionStrength == 0.0) {
    return gravityAccel;
  }

  let offset = params.inputPoint - pos;
  let sqrDst = dot(offset, offset);
  let radius = params.interactionRadius;
  if (sqrDst < radius * radius && sqrDst > 0.000001) {
    let dst = sqrt(sqrDst);
    let edgeT = dst / radius;
    let centreT = 1.0 - edgeT;
    let dirToCentre = offset / dst;
    let gravityWeight = 1.0 - (centreT * saturate(params.interactionStrength / 10.0));
    var accel = gravityAccel * gravityWeight + dirToCentre * centreT * params.interactionStrength;
    accel -= velocity * centreT;
    return accel;
  }

  return gravityAccel;
}

@compute @workgroup_size(128)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let index = id.x;
  if (index >= arrayLength(&positions)) {
    return;
  }

  let pos = positions[index];
  var vel = velocities[index];
  vel = vel + externalForces(pos, vel) * params.deltaTime;
  velocities[index] = vel;

  let predictionFactor = 1.0 / 120.0;
  predicted[index] = pos + vel * predictionFactor;
}
`,
  });

  const hashShaderModule = device.createShaderModule({
    code: `
struct HashParams {
  radius: f32,
  particleCount: f32,
  pad0: vec2<f32>,
};

@group(0) @binding(0) var<storage, read> predicted: array<vec2<f32>>;
@group(0) @binding(1) var<storage, read_write> keys: array<u32>;
@group(0) @binding(2) var<storage, read_write> indices: array<u32>;
@group(0) @binding(3) var<uniform> params: HashParams;

fn hashCell2D(cellX: i32, cellY: i32) -> u32 {
  let ax = cellX * 15823;
  let by = cellY * 9737333;
  return u32(ax + by);
}

@compute @workgroup_size(128)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let index = id.x;
  let count = u32(params.particleCount + 0.5);
  if (index >= count) {
    return;
  }

  let pos = predicted[index];
  let cellX = i32(floor(pos.x / params.radius));
  let cellY = i32(floor(pos.y / params.radius));
  let hash = hashCell2D(cellX, cellY);
  let key = hash % count;
  keys[index] = key;
  indices[index] = index;
}
`,
  });

  const sortShaderModule = device.createShaderModule({
    code: `
struct SortParams {
  particleCount: u32,
  pad0: vec3<u32>,
};

@group(0) @binding(0) var<storage, read_write> sortOffsets: array<atomic<u32>>;
@group(0) @binding(1) var<uniform> params: SortParams;

@compute @workgroup_size(128)
fn clearOffsets(@builtin(global_invocation_id) id: vec3<u32>) {
  let index = id.x;
  if (index >= params.particleCount) {
    return;
  }
  atomicStore(&sortOffsets[index], 0u);
}

@group(1) @binding(0) var<storage, read> keys: array<u32>;
@group(1) @binding(1) var<storage, read_write> sortOffsetsCount: array<atomic<u32>>;
@group(1) @binding(2) var<uniform> countParams: SortParams;

@compute @workgroup_size(128)
fn countOffsets(@builtin(global_invocation_id) id: vec3<u32>) {
  let index = id.x;
  if (index >= countParams.particleCount) {
    return;
  }
  let key = keys[index];
  atomicAdd(&sortOffsetsCount[key], 1u);
}
`,
  });

  const scatterShaderModule = device.createShaderModule({
    code: `
struct SortParams {
  particleCount: u32,
  pad0: vec3<u32>,
};

@group(0) @binding(0) var<storage, read> keys: array<u32>;
@group(0) @binding(1) var<storage, read_write> sortOffsets: array<u32>;
@group(0) @binding(2) var<storage, read_write> sortedKeys: array<u32>;
@group(0) @binding(3) var<storage, read_write> indices: array<u32>;
@group(0) @binding(4) var<uniform> params: SortParams;

@compute @workgroup_size(1)
fn prefixAndScatter(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x != 0u) {
    return;
  }

  let count = params.particleCount;
  var sum = 0u;
  for (var k = 0u; k < count; k = k + 1u) {
    let c = sortOffsets[k];
    sortOffsets[k] = sum;
    sum = sum + c;
  }

  for (var i = 0u; i < count; i = i + 1u) {
    let key = keys[i];
    let dest = sortOffsets[key];
    sortOffsets[key] = dest + 1u;
    indices[dest] = i;
    sortedKeys[dest] = key;
  }
}
`,
  });

  const spatialOffsetsShaderModule = device.createShaderModule({
    code: `
struct SortParams {
  particleCount: u32,
  pad0: vec3<u32>,
};

@group(0) @binding(0) var<storage, read> sortedKeys: array<u32>;
@group(0) @binding(1) var<storage, read_write> spatialOffsets: array<u32>;
@group(0) @binding(2) var<uniform> params: SortParams;

@compute @workgroup_size(1)
fn buildOffsets(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x != 0u) {
    return;
  }

  let count = params.particleCount;
  for (var i = 0u; i < count; i = i + 1u) {
    spatialOffsets[i] = count;
  }

  for (var i = 0u; i < count; i = i + 1u) {
    if (i == 0u || sortedKeys[i] != sortedKeys[i - 1u]) {
      spatialOffsets[sortedKeys[i]] = i;
    }
  }
}
`,
  });

  const densityShaderModule = device.createShaderModule({
    code: `
struct DensityParams {
  radius: f32,
  spikyPow2Scale: f32,
  spikyPow3Scale: f32,
  particleCountF: f32,
  pad0: vec4<f32>,
};

@group(0) @binding(0) var<storage, read> predicted: array<vec2<f32>>;
@group(0) @binding(1) var<storage, read> sortedKeys: array<u32>;
@group(0) @binding(2) var<storage, read> indices: array<u32>;
@group(0) @binding(3) var<storage, read> spatialOffsets: array<u32>;
@group(0) @binding(4) var<storage, read_write> densities: array<vec2<f32>>;
@group(0) @binding(5) var<uniform> params: DensityParams;

const neighborOffsets = array<vec2<i32>, 9>(
  vec2<i32>(-1, 1),
  vec2<i32>(0, 1),
  vec2<i32>(1, 1),
  vec2<i32>(-1, 0),
  vec2<i32>(0, 0),
  vec2<i32>(1, 0),
  vec2<i32>(-1, -1),
  vec2<i32>(0, -1),
  vec2<i32>(1, -1)
);

fn hashCell2D(cellX: i32, cellY: i32) -> u32 {
  let ax = cellX * 15823;
  let by = cellY * 9737333;
  return u32(ax + by);
}

fn spikyPow2(dst: f32, radius: f32, scale: f32) -> f32 {
  if (dst < radius) {
    let v = radius - dst;
    return v * v * scale;
  }
  return 0.0;
}

fn spikyPow3(dst: f32, radius: f32, scale: f32) -> f32 {
  if (dst < radius) {
    let v = radius - dst;
    return v * v * v * scale;
  }
  return 0.0;
}

@compute @workgroup_size(128)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  let count = u32(params.particleCountF + 0.5);
  if (i >= count) {
    return;
  }

  let pos = predicted[i];
  let originCellX = i32(floor(pos.x / params.radius));
  let originCellY = i32(floor(pos.y / params.radius));

  var density = 0.0;
  var nearDensity = 0.0;
  let radiusSq = params.radius * params.radius;

  for (var n = 0u; n < 9u; n = n + 1u) {
    let cellOffset = neighborOffsets[n];
    let cellX = originCellX + cellOffset.x;
    let cellY = originCellY + cellOffset.y;
    let hash = hashCell2D(cellX, cellY);
    let key = hash % count;
    let start = spatialOffsets[key];
    if (start == count) {
      continue;
    }

    var j = start;
    loop {
      if (j >= count || sortedKeys[j] != key) {
        break;
      }
      let neighborIndex = indices[j];
      let neighborPos = predicted[neighborIndex];
      let dx = neighborPos.x - pos.x;
      let dy = neighborPos.y - pos.y;
      let dstSq = dx * dx + dy * dy;
      if (dstSq <= radiusSq) {
        let dst = sqrt(dstSq);
        density = density + spikyPow2(dst, params.radius, params.spikyPow2Scale);
        nearDensity = nearDensity + spikyPow3(dst, params.radius, params.spikyPow3Scale);
      }
      j = j + 1u;
    }
  }

  densities[i] = vec2<f32>(density, nearDensity);
}
`,
  });

  const pressureShaderModule = device.createShaderModule({
    code: `
struct PressureParams {
  dt: f32,
  targetDensity: f32,
  pressureMultiplier: f32,
  nearPressureMultiplier: f32,
  radius: f32,
  spikyPow2DerivScale: f32,
  spikyPow3DerivScale: f32,
  particleCountF: f32,
  pad0: vec4<f32>,
};

@group(0) @binding(0) var<storage, read> predicted: array<vec2<f32>>;
@group(0) @binding(1) var<storage, read_write> velocities: array<vec2<f32>>;
@group(0) @binding(2) var<storage, read> densities: array<vec2<f32>>;
@group(0) @binding(3) var<storage, read> sortedKeys: array<u32>;
@group(0) @binding(4) var<storage, read> indices: array<u32>;
@group(0) @binding(5) var<storage, read> spatialOffsets: array<u32>;
@group(0) @binding(6) var<uniform> params: PressureParams;

const neighborOffsets = array<vec2<i32>, 9>(
  vec2<i32>(-1, 1),
  vec2<i32>(0, 1),
  vec2<i32>(1, 1),
  vec2<i32>(-1, 0),
  vec2<i32>(0, 0),
  vec2<i32>(1, 0),
  vec2<i32>(-1, -1),
  vec2<i32>(0, -1),
  vec2<i32>(1, -1)
);

fn hashCell2D(cellX: i32, cellY: i32) -> u32 {
  let ax = cellX * 15823;
  let by = cellY * 9737333;
  return u32(ax + by);
}

fn derivativeSpikyPow2(dst: f32, radius: f32, scale: f32) -> f32 {
  if (dst <= radius) {
    let v = radius - dst;
    return -v * scale;
  }
  return 0.0;
}

fn derivativeSpikyPow3(dst: f32, radius: f32, scale: f32) -> f32 {
  if (dst <= radius) {
    let v = radius - dst;
    return -v * v * scale;
  }
  return 0.0;
}

@compute @workgroup_size(128)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  let count = u32(params.particleCountF + 0.5);
  if (i >= count) {
    return;
  }

  let densityPair = densities[i];
  let density = densityPair.x;
  let nearDensity = densityPair.y;
  if (density <= 0.0) {
    return;
  }

  let pressure = (density - params.targetDensity) * params.pressureMultiplier;
  let nearPressure = params.nearPressureMultiplier * nearDensity;

  let pos = predicted[i];
  let originCellX = i32(floor(pos.x / params.radius));
  let originCellY = i32(floor(pos.y / params.radius));
  let radiusSq = params.radius * params.radius;

  var forceX = 0.0;
  var forceY = 0.0;

  for (var n = 0u; n < 9u; n = n + 1u) {
    let cellOffset = neighborOffsets[n];
    let cellX = originCellX + cellOffset.x;
    let cellY = originCellY + cellOffset.y;
    let hash = hashCell2D(cellX, cellY);
    let key = hash % count;
    let start = spatialOffsets[key];
    if (start == count) {
      continue;
    }

    var j = start;
    loop {
      if (j >= count || sortedKeys[j] != key) {
        break;
      }
      let neighborIndex = indices[j];
      if (neighborIndex != i) {
        let neighborPos = predicted[neighborIndex];
        let dx = neighborPos.x - pos.x;
        let dy = neighborPos.y - pos.y;
        let dstSq = dx * dx + dy * dy;
        if (dstSq <= radiusSq) {
          let dst = sqrt(dstSq);
          let invDst = select(0.0, 1.0 / dst, dst > 0.0);
          let dirX = dx * invDst;
          let dirY = dy * invDst;

          let neighborDensityPair = densities[neighborIndex];
          let neighborDensity = neighborDensityPair.x;
          let neighborNearDensity = neighborDensityPair.y;
          let neighborPressure =
            (neighborDensity - params.targetDensity) * params.pressureMultiplier;
          let neighborNearPressure =
            params.nearPressureMultiplier * neighborNearDensity;

          let sharedPressure = (pressure + neighborPressure) * 0.5;
          let sharedNearPressure = (nearPressure + neighborNearPressure) * 0.5;

          if (neighborDensity > 0.0) {
            let scale =
              derivativeSpikyPow2(dst, params.radius, params.spikyPow2DerivScale) *
              (sharedPressure / neighborDensity);
            forceX = forceX + dirX * scale;
            forceY = forceY + dirY * scale;
          }

          if (neighborNearDensity > 0.0) {
            let scale =
              derivativeSpikyPow3(dst, params.radius, params.spikyPow3DerivScale) *
              (sharedNearPressure / neighborNearDensity);
            forceX = forceX + dirX * scale;
            forceY = forceY + dirY * scale;
          }
        }
      }
      j = j + 1u;
    }
  }

  velocities[i].x = velocities[i].x + (forceX / density) * params.dt;
  velocities[i].y = velocities[i].y + (forceY / density) * params.dt;
}
`,
  });

  const viscosityShaderModule = device.createShaderModule({
    code: `
struct ViscosityParams {
  dt: f32,
  viscosityStrength: f32,
  radius: f32,
  poly6Scale: f32,
  particleCountF: f32,
  pad0: vec3<f32>,
};

@group(0) @binding(0) var<storage, read> predicted: array<vec2<f32>>;
@group(0) @binding(1) var<storage, read_write> velocities: array<vec2<f32>>;
@group(0) @binding(2) var<storage, read> sortedKeys: array<u32>;
@group(0) @binding(3) var<storage, read> indices: array<u32>;
@group(0) @binding(4) var<storage, read> spatialOffsets: array<u32>;
@group(0) @binding(5) var<uniform> params: ViscosityParams;

const neighborOffsets = array<vec2<i32>, 9>(
  vec2<i32>(-1, 1),
  vec2<i32>(0, 1),
  vec2<i32>(1, 1),
  vec2<i32>(-1, 0),
  vec2<i32>(0, 0),
  vec2<i32>(1, 0),
  vec2<i32>(-1, -1),
  vec2<i32>(0, -1),
  vec2<i32>(1, -1)
);

fn hashCell2D(cellX: i32, cellY: i32) -> u32 {
  let ax = cellX * 15823;
  let by = cellY * 9737333;
  return u32(ax + by);
}

fn smoothingKernelPoly6(dst: f32, radius: f32, scale: f32) -> f32 {
  if (dst < radius) {
    let v = radius * radius - dst * dst;
    return v * v * v * scale;
  }
  return 0.0;
}

@compute @workgroup_size(128)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  let count = u32(params.particleCountF + 0.5);
  if (i >= count) {
    return;
  }

  let pos = predicted[i];
  let originCellX = i32(floor(pos.x / params.radius));
  let originCellY = i32(floor(pos.y / params.radius));
  let radiusSq = params.radius * params.radius;

  var forceX = 0.0;
  var forceY = 0.0;
  let vel = velocities[i];

  for (var n = 0u; n < 9u; n = n + 1u) {
    let cellOffset = neighborOffsets[n];
    let cellX = originCellX + cellOffset.x;
    let cellY = originCellY + cellOffset.y;
    let hash = hashCell2D(cellX, cellY);
    let key = hash % count;
    let start = spatialOffsets[key];
    if (start == count) {
      continue;
    }

    var j = start;
    loop {
      if (j >= count || sortedKeys[j] != key) {
        break;
      }
      let neighborIndex = indices[j];
      if (neighborIndex != i) {
        let neighborPos = predicted[neighborIndex];
        let dx = neighborPos.x - pos.x;
        let dy = neighborPos.y - pos.y;
        let dstSq = dx * dx + dy * dy;
        if (dstSq <= radiusSq) {
          let dst = sqrt(dstSq);
          let weight = smoothingKernelPoly6(dst, params.radius, params.poly6Scale);
          let neighborVel = velocities[neighborIndex];
          forceX = forceX + (neighborVel.x - vel.x) * weight;
          forceY = forceY + (neighborVel.y - vel.y) * weight;
        }
      }
      j = j + 1u;
    }
  }

  velocities[i].x = velocities[i].x + forceX * params.viscosityStrength * params.dt;
  velocities[i].y = velocities[i].y + forceY * params.viscosityStrength * params.dt;
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

  const computePipeline = device.createComputePipeline({
    layout: 'auto',
    compute: {
      module: computeShaderModule,
      entryPoint: 'main',
    },
  });

  const hashPipeline = device.createComputePipeline({
    layout: 'auto',
    compute: {
      module: hashShaderModule,
      entryPoint: 'main',
    },
  });

  const clearOffsetsPipeline = device.createComputePipeline({
    layout: 'auto',
    compute: {
      module: sortShaderModule,
      entryPoint: 'clearOffsets',
    },
  });

  const countOffsetsPipeline = device.createComputePipeline({
    layout: 'auto',
    compute: {
      module: sortShaderModule,
      entryPoint: 'countOffsets',
    },
  });

  const scatterPipeline = device.createComputePipeline({
    layout: 'auto',
    compute: {
      module: scatterShaderModule,
      entryPoint: 'prefixAndScatter',
    },
  });

  const spatialOffsetsPipeline = device.createComputePipeline({
    layout: 'auto',
    compute: {
      module: spatialOffsetsShaderModule,
      entryPoint: 'buildOffsets',
    },
  });

  const densityPipeline = device.createComputePipeline({
    layout: 'auto',
    compute: {
      module: densityShaderModule,
      entryPoint: 'main',
    },
  });

  const pressurePipeline = device.createComputePipeline({
    layout: 'auto',
    compute: {
      module: pressureShaderModule,
      entryPoint: 'main',
    },
  });

  const viscosityPipeline = device.createComputePipeline({
    layout: 'auto',
    compute: {
      module: viscosityShaderModule,
      entryPoint: 'main',
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

  const lineBindGroup = device.createBindGroup({
    layout: linePipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
  });

  const resetSimulation = (): void => {
    destroyBuffers([
      positionsBuffer,
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
      velocityReadbackBuffer,
      densityReadbackBuffer,
    ]);

    const spawn = createSpawnData(config);
    particleCount = spawn.count;
    state = createStateFromSpawn(spawn);
    physics = createPhysics(state, config, getScale);

    positionsBuffer = createBufferFromArray(
      spawn.positions,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    );
    predictedBuffer = createBufferFromArray(
      new Float32Array(spawn.positions),
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    );
    velocitiesBuffer = createBufferFromArray(
      spawn.velocities,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
    );
    densitiesBuffer = createEmptyBuffer(
      particleCount * 2 * 4,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
    );
    keysBuffer = createEmptyBuffer(
      particleCount * 4,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    );
    sortedKeysBuffer = createEmptyBuffer(
      particleCount * 4,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    );
    indicesBuffer = createEmptyBuffer(
      particleCount * 4,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    );
    sortOffsetsBuffer = createEmptyBuffer(
      particleCount * 4,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    );
    spatialOffsetsBuffer = createEmptyBuffer(
      particleCount * 4,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    );
    positionsSortedBuffer = createEmptyBuffer(
      particleCount * 2 * 4,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    );
    predictedSortedBuffer = createEmptyBuffer(
      particleCount * 2 * 4,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    );
    velocitiesSortedBuffer = createEmptyBuffer(
      particleCount * 2 * 4,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    );
    velocityReadbackBuffer = device.createBuffer({
      size: particleCount * 2 * 4,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    densityReadbackBuffer = device.createBuffer({
      size: particleCount * 2 * 4,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });

    const simBuffers = {
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
    void simBuffers;

    bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: positionsBuffer } },
        { binding: 1, resource: { buffer: velocitiesBuffer } },
        { binding: 2, resource: { buffer: gradientBuffer } },
        { binding: 3, resource: { buffer: uniformBuffer } },
      ],
    });

    computeBindGroup = device.createBindGroup({
      layout: computePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: positionsBuffer } },
        { binding: 1, resource: { buffer: velocitiesBuffer } },
        { binding: 2, resource: { buffer: predictedBuffer } },
        { binding: 3, resource: { buffer: computeUniformBuffer } },
      ],
    });

    hashBindGroup = device.createBindGroup({
      layout: hashPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: predictedBuffer } },
        { binding: 1, resource: { buffer: keysBuffer } },
        { binding: 2, resource: { buffer: indicesBuffer } },
        { binding: 3, resource: { buffer: hashUniformBuffer } },
      ],
    });

    clearOffsetsBindGroup = device.createBindGroup({
      layout: clearOffsetsPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: sortOffsetsBuffer } },
        { binding: 1, resource: { buffer: sortUniformBuffer } },
      ],
    });

    countOffsetsBindGroup = device.createBindGroup({
      layout: countOffsetsPipeline.getBindGroupLayout(1),
      entries: [
        { binding: 0, resource: { buffer: keysBuffer } },
        { binding: 1, resource: { buffer: sortOffsetsBuffer } },
        { binding: 2, resource: { buffer: sortUniformBuffer } },
      ],
    });

    scatterBindGroup = device.createBindGroup({
      layout: scatterPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: keysBuffer } },
        { binding: 1, resource: { buffer: sortOffsetsBuffer } },
        { binding: 2, resource: { buffer: sortedKeysBuffer } },
        { binding: 3, resource: { buffer: indicesBuffer } },
        { binding: 4, resource: { buffer: sortUniformBuffer } },
      ],
    });

    spatialOffsetsBindGroup = device.createBindGroup({
      layout: spatialOffsetsPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: sortedKeysBuffer } },
        { binding: 1, resource: { buffer: spatialOffsetsBuffer } },
        { binding: 2, resource: { buffer: sortUniformBuffer } },
      ],
    });

    densityBindGroup = device.createBindGroup({
      layout: densityPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: predictedBuffer } },
        { binding: 1, resource: { buffer: sortedKeysBuffer } },
        { binding: 2, resource: { buffer: indicesBuffer } },
        { binding: 3, resource: { buffer: spatialOffsetsBuffer } },
        { binding: 4, resource: { buffer: densitiesBuffer } },
        { binding: 5, resource: { buffer: densityUniformBuffer } },
      ],
    });

    pressureBindGroup = device.createBindGroup({
      layout: pressurePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: predictedBuffer } },
        { binding: 1, resource: { buffer: velocitiesBuffer } },
        { binding: 2, resource: { buffer: densitiesBuffer } },
        { binding: 3, resource: { buffer: sortedKeysBuffer } },
        { binding: 4, resource: { buffer: indicesBuffer } },
        { binding: 5, resource: { buffer: spatialOffsetsBuffer } },
        { binding: 6, resource: { buffer: pressureUniformBuffer } },
      ],
    });

    viscosityBindGroup = device.createBindGroup({
      layout: viscosityPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: predictedBuffer } },
        { binding: 1, resource: { buffer: velocitiesBuffer } },
        { binding: 2, resource: { buffer: sortedKeysBuffer } },
        { binding: 3, resource: { buffer: indicesBuffer } },
        { binding: 4, resource: { buffer: spatialOffsetsBuffer } },
        { binding: 5, resource: { buffer: viscosityUniformBuffer } },
      ],
    });
  };

  resetSim = resetSimulation;
  resetSimulation();

  let baseUnitsPerPixel: number | null = null;
  const uniformData = new Float32Array(8);
  const computeData = new Float32Array(8);
  const hashParamsData = new Float32Array(4);
  const sortParamsData = new Uint32Array(4);
  const densityParamsData = new Float32Array(12);
  const pressureParamsData = new Float32Array(12);
  const viscosityParamsData = new Float32Array(12);

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
  const frame = async (now: number): Promise<void> => {
    stats.begin();
    if (
      !state ||
      !physics ||
      !positionsBuffer ||
      !velocitiesBuffer ||
      !predictedBuffer ||
      !velocityReadbackBuffer ||
      !densityReadbackBuffer ||
      !bindGroup ||
      !computeBindGroup ||
      !hashBindGroup ||
      !clearOffsetsBindGroup ||
      !countOffsetsBindGroup ||
      !scatterBindGroup ||
      !spatialOffsetsBindGroup ||
      !densityBindGroup ||
      !pressureBindGroup ||
      !viscosityBindGroup
    ) {
      stats.end();
      stats.update();
      requestAnimationFrame(frame);
      return;
    }
    const dt = Math.min(0.033, (now - lastTime) / 1000);
    lastTime = now;
    if (useGpuExternalForces) {
      const maxDeltaTime = config.maxTimestepFPS
        ? 1 / config.maxTimestepFPS
        : Number.POSITIVE_INFINITY;
      const frameTime = Math.min(dt * config.timeScale, maxDeltaTime);
      const timeStep = frameTime / config.iterationsPerFrame;

      for (let i = 0; i < config.iterationsPerFrame; i += 1) {
        device.queue.writeBuffer(positionsBuffer, 0, state.positions);
        device.queue.writeBuffer(velocitiesBuffer, 0, state.velocities);

        const pull = state.input.pull;
        const push = state.input.push;
        const interactionStrength = push
          ? -config.interactionStrength
          : pull
            ? config.interactionStrength
            : 0;
        computeData[0] = timeStep;
        computeData[1] = config.gravity;
        computeData[2] = config.interactionRadius;
        computeData[3] = interactionStrength;
        computeData[4] = state.input.worldX;
        computeData[5] = state.input.worldY;
        computeData[6] = 0;
        computeData[7] = 0;
        device.queue.writeBuffer(computeUniformBuffer, 0, computeData);

        const computeEncoder = device.createCommandEncoder();
        const computePass = computeEncoder.beginComputePass();
        computePass.setPipeline(computePipeline);
        computePass.setBindGroup(0, computeBindGroup);
        computePass.dispatchWorkgroups(Math.ceil(particleCount / 128));
        computePass.end();
        computeEncoder.copyBufferToBuffer(
          velocitiesBuffer,
          0,
          velocityReadbackBuffer,
          0,
          particleCount * 2 * 4
        );
        device.queue.submit([computeEncoder.finish()]);

        await velocityReadbackBuffer.mapAsync(GPUMapMode.READ);
        const mappedVelocities = new Float32Array(
          velocityReadbackBuffer.getMappedRange()
        );
        state.velocities.set(mappedVelocities);
        velocityReadbackBuffer.unmap();

        physics.predictPositions();
        if (!useGpuDensity || useCpuSpatialDataForGpuDensity) {
          physics.runSpatialHash();
        }

        if (useGpuDensity) {
          device.queue.writeBuffer(predictedBuffer, 0, state.predicted);
          device.queue.writeBuffer(velocitiesBuffer, 0, state.velocities);
          if (useCpuSpatialDataForGpuDensity) {
            device.queue.writeBuffer(sortedKeysBuffer, 0, state.sortedKeys);
            device.queue.writeBuffer(
              spatialOffsetsBuffer,
              0,
              state.spatialOffsets
            );
          } else if (useGpuSpatialHash) {
            const hashEncoder = device.createCommandEncoder();
            const hashPass = hashEncoder.beginComputePass();
            hashPass.setPipeline(hashPipeline);
            hashPass.setBindGroup(0, hashBindGroup);
            hashPass.dispatchWorkgroups(Math.ceil(particleCount / 128));
            hashPass.end();

            const clearPass = hashEncoder.beginComputePass();
            clearPass.setPipeline(clearOffsetsPipeline);
            clearPass.setBindGroup(0, clearOffsetsBindGroup);
            clearPass.dispatchWorkgroups(Math.ceil(particleCount / 128));
            clearPass.end();

            const countPass = hashEncoder.beginComputePass();
            countPass.setPipeline(countOffsetsPipeline);
            countPass.setBindGroup(1, countOffsetsBindGroup);
            countPass.dispatchWorkgroups(Math.ceil(particleCount / 128));
            countPass.end();

            const scatterPass = hashEncoder.beginComputePass();
            scatterPass.setPipeline(scatterPipeline);
            scatterPass.setBindGroup(0, scatterBindGroup);
            scatterPass.dispatchWorkgroups(1);
            scatterPass.end();

            const spatialPass = hashEncoder.beginComputePass();
            spatialPass.setPipeline(spatialOffsetsPipeline);
            spatialPass.setBindGroup(0, spatialOffsetsBindGroup);
            spatialPass.dispatchWorkgroups(1);
            spatialPass.end();

            device.queue.submit([hashEncoder.finish()]);
          }

          const densityEncoder = device.createCommandEncoder();
          const densityPass = densityEncoder.beginComputePass();
          densityPass.setPipeline(densityPipeline);
          densityPass.setBindGroup(0, densityBindGroup);
          densityPass.dispatchWorkgroups(Math.ceil(particleCount / 128));
          densityPass.end();

          if (useGpuDensityReadback) {
            densityEncoder.copyBufferToBuffer(
              densitiesBuffer,
              0,
              densityReadbackBuffer,
              0,
              particleCount * 2 * 4
            );
          }

          device.queue.submit([densityEncoder.finish()]);

          if (useGpuDensityReadback) {
            await densityReadbackBuffer.mapAsync(GPUMapMode.READ);
            const mappedDensities = new Float32Array(
              densityReadbackBuffer.getMappedRange()
            );
            state.densities.set(mappedDensities);
            densityReadbackBuffer.unmap();
          }
        } else {
          physics.calculateDensities();
          if (useGpuPressure) {
            device.queue.writeBuffer(densitiesBuffer, 0, state.densities);
          }
        }

        if (useGpuPressure) {
          const radius = config.smoothingRadius;
          const spikyPow2DerivScale = 12 / (Math.PI * Math.pow(radius, 4));
          const spikyPow3DerivScale = 30 / (Math.PI * Math.pow(radius, 5));
          pressureParamsData[0] = timeStep;
          pressureParamsData[1] = config.targetDensity;
          pressureParamsData[2] = config.pressureMultiplier;
          pressureParamsData[3] = config.nearPressureMultiplier;
          pressureParamsData[4] = radius;
          pressureParamsData[5] = spikyPow2DerivScale;
          pressureParamsData[6] = spikyPow3DerivScale;
          pressureParamsData[7] = particleCount;
          pressureParamsData[8] = 0;
          pressureParamsData[9] = 0;
          pressureParamsData[10] = 0;
          pressureParamsData[11] = 0;
          device.queue.writeBuffer(pressureUniformBuffer, 0, pressureParamsData);

          const pressureEncoder = device.createCommandEncoder();
          const pressurePass = pressureEncoder.beginComputePass();
          pressurePass.setPipeline(pressurePipeline);
          pressurePass.setBindGroup(0, pressureBindGroup);
          pressurePass.dispatchWorkgroups(Math.ceil(particleCount / 128));
          pressurePass.end();
          pressureEncoder.copyBufferToBuffer(
            velocitiesBuffer,
            0,
            velocityReadbackBuffer,
            0,
            particleCount * 2 * 4
          );
          device.queue.submit([pressureEncoder.finish()]);

          await velocityReadbackBuffer.mapAsync(GPUMapMode.READ);
          const pressureVelocities = new Float32Array(
            velocityReadbackBuffer.getMappedRange()
          );
          state.velocities.set(pressureVelocities);
          velocityReadbackBuffer.unmap();
        } else {
          physics.calculatePressure(timeStep);
        }

        if (useGpuViscosity) {
          const radius = config.smoothingRadius;
          const poly6Scale = 4 / (Math.PI * Math.pow(radius, 8));
          viscosityParamsData[0] = timeStep;
          viscosityParamsData[1] = config.viscosityStrength;
          viscosityParamsData[2] = radius;
          viscosityParamsData[3] = poly6Scale;
          viscosityParamsData[4] = particleCount;
          viscosityParamsData[5] = 0;
          viscosityParamsData[6] = 0;
          viscosityParamsData[7] = 0;
          viscosityParamsData[8] = 0;
          viscosityParamsData[9] = 0;
          viscosityParamsData[10] = 0;
          viscosityParamsData[11] = 0;
          device.queue.writeBuffer(
            viscosityUniformBuffer,
            0,
            viscosityParamsData
          );

          const viscosityEncoder = device.createCommandEncoder();
          const viscosityPass = viscosityEncoder.beginComputePass();
          viscosityPass.setPipeline(viscosityPipeline);
          viscosityPass.setBindGroup(0, viscosityBindGroup);
          viscosityPass.dispatchWorkgroups(Math.ceil(particleCount / 128));
          viscosityPass.end();
          viscosityEncoder.copyBufferToBuffer(
            velocitiesBuffer,
            0,
            velocityReadbackBuffer,
            0,
            particleCount * 2 * 4
          );
          device.queue.submit([viscosityEncoder.finish()]);

          await velocityReadbackBuffer.mapAsync(GPUMapMode.READ);
          const viscosityVelocities = new Float32Array(
            velocityReadbackBuffer.getMappedRange()
          );
          state.velocities.set(viscosityVelocities);
          velocityReadbackBuffer.unmap();
        } else {
          physics.calculateViscosity(timeStep);
        }

        physics.updatePositions(timeStep);
      }
    } else {
      physics.step(dt);
    }

    device.queue.writeBuffer(positionsBuffer, 0, state.positions);
    device.queue.writeBuffer(velocitiesBuffer, 0, state.velocities);
    device.queue.writeBuffer(predictedBuffer, 0, state.predicted);
    uniformData[0] = config.boundsSize.x;
    uniformData[1] = config.boundsSize.y;
    uniformData[2] = canvas.width;
    uniformData[3] = canvas.height;
    uniformData[4] = config.particleRadius;
    uniformData[5] = config.velocityDisplayMax;
    uniformData[6] = config.gradientResolution;
    uniformData[7] = 0;
    device.queue.writeBuffer(uniformBuffer, 0, uniformData);
    if (useGpuSpatialHash) {
      hashParamsData[0] = config.smoothingRadius;
      hashParamsData[1] = particleCount;
      hashParamsData[2] = 0;
      hashParamsData[3] = 0;
      device.queue.writeBuffer(hashUniformBuffer, 0, hashParamsData);

      sortParamsData[0] = particleCount;
      sortParamsData[1] = 0;
      sortParamsData[2] = 0;
      sortParamsData[3] = 0;
      device.queue.writeBuffer(sortUniformBuffer, 0, sortParamsData);
    }
    if (useGpuDensity) {
      const radius = config.smoothingRadius;
      const spikyPow2Scale = 6 / (Math.PI * Math.pow(radius, 4));
      const spikyPow3Scale = 10 / (Math.PI * Math.pow(radius, 5));
      densityParamsData[0] = radius;
      densityParamsData[1] = spikyPow2Scale;
      densityParamsData[2] = spikyPow3Scale;
      densityParamsData[3] = particleCount;
      densityParamsData[4] = 0;
      densityParamsData[5] = 0;
      densityParamsData[6] = 0;
      densityParamsData[7] = 0;
      densityParamsData[8] = 0;
      densityParamsData[9] = 0;
      densityParamsData[10] = 0;
      densityParamsData[11] = 0;
      device.queue.writeBuffer(densityUniformBuffer, 0, densityParamsData);
      if (useCpuSpatialDataForGpuDensity) {
        device.queue.writeBuffer(sortedKeysBuffer, 0, state.sortedKeys);
        device.queue.writeBuffer(spatialOffsetsBuffer, 0, state.spatialOffsets);
      }
    }

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
    if (useGpuSpatialHash && !useCpuSpatialDataForGpuDensity) {
      const hashPass = encoder.beginComputePass();
      hashPass.setPipeline(hashPipeline);
      hashPass.setBindGroup(0, hashBindGroup);
      hashPass.dispatchWorkgroups(Math.ceil(particleCount / 128));
      hashPass.end();

      const clearPass = encoder.beginComputePass();
      clearPass.setPipeline(clearOffsetsPipeline);
      clearPass.setBindGroup(0, clearOffsetsBindGroup);
      clearPass.dispatchWorkgroups(Math.ceil(particleCount / 128));
      clearPass.end();

      const countPass = encoder.beginComputePass();
      countPass.setPipeline(countOffsetsPipeline);
      countPass.setBindGroup(1, countOffsetsBindGroup);
      countPass.dispatchWorkgroups(Math.ceil(particleCount / 128));
      countPass.end();

      const scatterPass = encoder.beginComputePass();
      scatterPass.setPipeline(scatterPipeline);
      scatterPass.setBindGroup(0, scatterBindGroup);
      scatterPass.dispatchWorkgroups(1);
      scatterPass.end();

      const spatialPass = encoder.beginComputePass();
      spatialPass.setPipeline(spatialOffsetsPipeline);
      spatialPass.setBindGroup(0, spatialOffsetsBindGroup);
      spatialPass.dispatchWorkgroups(1);
      spatialPass.end();
    }
    if (useGpuDensity && !useGpuExternalForces) {
      const densityPass = encoder.beginComputePass();
      densityPass.setPipeline(densityPipeline);
      densityPass.setBindGroup(0, densityBindGroup);
      densityPass.dispatchWorkgroups(Math.ceil(particleCount / 128));
      densityPass.end();
    }
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
