import './style.css';
import type { SimConfig } from '../common/types.ts';
import { setupGui } from '../common/gui.ts';
import { OrbitCamera } from '../webgpu_particles/orbit_camera.ts';
import { setupInputHandlers } from '../webgpu_particles/input_handler.ts';
import {
  initWebGPU,
  configureContext,
  WebGPUInitError,
} from '../webgpu_particles/webgpu_utils.ts';
import { adapterRegistry } from './adapters/registry.ts';
import type { FluidAppAdapter } from './types.ts';

function createCanvas(app: HTMLDivElement): HTMLCanvasElement {
  app.innerHTML = `
    <div id="controls">
      <label for="renderer-select">Renderer</label>
      <select id="renderer-select"></select>
      <button id="reset-btn" type="button">Reset</button>
    </div>
    <canvas id="sim-canvas" aria-label="Fluid simulation"></canvas>
  `;
  const canvas = document.querySelector<HTMLCanvasElement>('#sim-canvas');
  if (!canvas) {
    throw new Error('Failed to create canvas element');
  }
  return canvas;
}

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Missing #app container');

const canvas = createCanvas(app);
const select = document.querySelector<HTMLSelectElement>('#renderer-select');
const resetButton = document.querySelector<HTMLButtonElement>('#reset-btn');
if (!select || !resetButton) {
  throw new Error('Missing UI controls');
}

const camera = new OrbitCamera();

const inputConfig = { boundsSize: { x: 1, y: 1, z: 1 } } as SimConfig;

for (const entry of adapterRegistry) {
  const option = document.createElement('option');
  option.value = entry.name;
  option.textContent = entry.name;
  select.appendChild(option);
}

let activeAdapter: FluidAppAdapter | null = null;
let device: GPUDevice;
let context: GPUCanvasContext;
let format: GPUTextureFormat;
let updateInertia: (() => void) | null = null;
let isSwitching = false;
let guiState:
  | {
      gui: ReturnType<typeof setupGui>['gui'];
      stats: ReturnType<typeof setupGui>['stats'];
      container: HTMLElement;
    }
  | null = null;

function syncInputConfig(config: SimConfig): void {
  inputConfig.boundsSize.x = config.boundsSize.x;
  inputConfig.boundsSize.y = config.boundsSize.y;
  inputConfig.boundsSize.z = config.boundsSize.z;
}

function getInputState() {
  return activeAdapter?.getInputState();
}

function setCanvasSize(): void {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(window.innerWidth * dpr));
  canvas.height = Math.max(1, Math.floor(window.innerHeight * dpr));
}

function destroyGui(): void {
  if (!guiState) return;
  guiState.gui.destroy();
  guiState.container.remove();
  guiState.stats.dom.remove();
  guiState = null;
}

function setupParticlesGui(adapter: FluidAppAdapter): void {
  destroyGui();
  const { gui, stats } = setupGui(
    adapter.config,
    {
      onReset: () => activeAdapter?.reset(),
      onSmoothingRadiusChange: () => {},
    },
    {
      trackGPU: true,
      title: 'WebGPU 3D Fluid',
      githubUrl: 'https://github.com/jeantimex/fluid',
    }
  );

  const particlesFolder = gui.folders.find((f) => f._title === 'Particles');
  if (particlesFolder) {
    particlesFolder
      .add(adapter.config as any, 'particleRadius', 1, 5, 0.1)
      .name('Particle Radius');
  }

  const container = gui.domElement.parentElement ?? gui.domElement;
  guiState = { gui, stats, container };
}

async function switchAdapter(name: string): Promise<void> {
  const entry = adapterRegistry.find((adapter) => adapter.name === name);
  if (!entry) return;
  if (activeAdapter?.name === entry.name) return;

  isSwitching = true;
  activeAdapter?.destroy?.();

  activeAdapter = entry.create();
  activeAdapter.applyCameraDefaults(camera);
  syncInputConfig(activeAdapter.config);

  setCanvasSize();
  configureContext(context, device, format);
  activeAdapter.init({ device, context, canvas, format });
  activeAdapter.resize();

  if (activeAdapter.name === 'Particles') {
    setupParticlesGui(activeAdapter);
    activeAdapter.reset();
  } else {
    destroyGui();
  }

  isSwitching = false;
}

async function main() {
  try {
    ({ device, context, format } = await initWebGPU(canvas));
  } catch (error) {
    if (error instanceof WebGPUInitError) {
      app!.innerHTML = `<p>${error.message}</p>`;
      return;
    }
    throw error;
  }

  updateInertia = setupInputHandlers(
    canvas,
    getInputState,
    camera,
    inputConfig
  );

  window.addEventListener('resize', () => {
    setCanvasSize();
    activeAdapter?.resize();
  });

  const initialAdapter = adapterRegistry[0];
  if (!initialAdapter) {
    throw new Error('No adapters registered');
  }

  select.value = initialAdapter.name;
  await switchAdapter(initialAdapter.name);

  select.addEventListener('change', async (event) => {
    const target = event.target as HTMLSelectElement;
    await switchAdapter(target.value);
  });

  resetButton.addEventListener('click', () => {
    activeAdapter?.reset();
  });

  let lastTime: number | null = null;
  const frame = async (now: number) => {
    if (lastTime === null) lastTime = now;
    if (guiState) guiState.stats.begin();
    const dt = Math.min(0.033, (now - lastTime) / 1000);
    lastTime = now;

    updateInertia?.();

    if (activeAdapter && !isSwitching) {
      await activeAdapter.step(dt);
      activeAdapter.render(camera);
    }

    if (guiState) {
      guiState.stats.end();
      guiState.stats.update();
    }
    requestAnimationFrame(frame);
  };

  requestAnimationFrame(frame);
}

main();
