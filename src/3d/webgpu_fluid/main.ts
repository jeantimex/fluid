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
import GUI from 'lil-gui';
import Stats from 'stats-gl';

function createCanvas(app: HTMLDivElement): HTMLCanvasElement {
  // Clean container
  app.innerHTML = '';
  
  // Create Canvas
  const canvas = document.createElement('canvas');
  canvas.id = 'sim-canvas';
  canvas.ariaLabel = 'Fluid simulation';
  app.appendChild(canvas);
  
  return canvas;
}

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Missing #app container');

const canvas = createCanvas(app);
const camera = new OrbitCamera();
const inputConfig = { boundsSize: { x: 1, y: 1, z: 1 } } as SimConfig;

// Initialize Persistent GUI and Stats
const mainGui = new GUI({ title: 'Simulation Settings' });
const mainStats = new Stats({ trackGPU: true, horizontal: true });
document.body.appendChild(mainStats.dom);

// Renderer Selection State
const guiState = {
  renderer: adapterRegistry[0].name,
  reset: () => activeAdapter?.reset(),
};

let activeAdapter: FluidAppAdapter | null = null;
let device: GPUDevice;
let context: GPUCanvasContext;
let format: GPUTextureFormat;
let updateInertia: (() => void) | null = null;
let isSwitching = false;

// Add Renderer Selector to GUI (Always at the top)
mainGui.add(guiState, 'renderer', adapterRegistry.map(a => a.name))
  .name('Renderer')
  .onChange((name: string) => switchAdapter(name));

// Add Reset Button to GUI
mainGui.add(guiState, 'reset').name('Reset Simulation');

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

function syncAdapterConfig(source: FluidAppAdapter, target: FluidAppAdapter): void {
  const s = source.config;
  const t = target.config;

  // Sync common simulation parameters
  t.gravity = s.gravity;
  t.timeScale = s.timeScale;
  t.maxTimestepFPS = s.maxTimestepFPS;
  t.iterationsPerFrame = s.iterationsPerFrame;
  t.collisionDamping = s.collisionDamping;
  t.smoothingRadius = s.smoothingRadius;
  t.spawnDensity = s.spawnDensity;
  t.viscosityStrength = s.viscosityStrength; // Sync viscosity even if defaults differ
  
  // Sync container bounds
  t.boundsSize.x = s.boundsSize.x;
  t.boundsSize.y = s.boundsSize.y;
  t.boundsSize.z = s.boundsSize.z;

  // Sync interaction
  t.interactionRadius = s.interactionRadius;
  t.interactionStrength = s.interactionStrength;

  // Sync obstacle (if present in both, usually yes as part of SimConfig)
  t.obstacleSize.x = s.obstacleSize.x;
  t.obstacleSize.y = s.obstacleSize.y;
  t.obstacleSize.z = s.obstacleSize.z;
  t.obstacleCentre.x = s.obstacleCentre.x;
  t.obstacleCentre.y = s.obstacleCentre.y;
  t.obstacleCentre.z = s.obstacleCentre.z;
  t.obstacleRotation.x = s.obstacleRotation.x;
  t.obstacleRotation.y = s.obstacleRotation.y;
  t.obstacleRotation.z = s.obstacleRotation.z;
  
  // Try to sync obstacle color/alpha if they exist
  if (s.obstacleColor && t.obstacleColor) {
    t.obstacleColor.r = s.obstacleColor.r;
    t.obstacleColor.g = s.obstacleColor.g;
    t.obstacleColor.b = s.obstacleColor.b;
  }
  if (typeof s.obstacleAlpha === 'number' && typeof t.obstacleAlpha === 'number') {
    t.obstacleAlpha = s.obstacleAlpha;
  }
  
  // Sync Environment if available (checked via type casting or property existence)
  const sEnv = s as any;
  const tEnv = t as any;
  if (sEnv.floorAmbient !== undefined && tEnv.floorAmbient !== undefined) {
      tEnv.floorAmbient = sEnv.floorAmbient;
      tEnv.sceneExposure = sEnv.sceneExposure;
      tEnv.sunBrightness = sEnv.sunBrightness;
      tEnv.debugFloorMode = sEnv.debugFloorMode;
      
      // Sync Tile Colors
      if (sEnv.tileCol1 && tEnv.tileCol1) Object.assign(tEnv.tileCol1, sEnv.tileCol1);
      if (sEnv.tileCol2 && tEnv.tileCol2) Object.assign(tEnv.tileCol2, sEnv.tileCol2);
      if (sEnv.tileCol3 && tEnv.tileCol3) Object.assign(tEnv.tileCol3, sEnv.tileCol3);
      if (sEnv.tileCol4 && tEnv.tileCol4) Object.assign(tEnv.tileCol4, sEnv.tileCol4);
  }
}

function updateGui(adapter: FluidAppAdapter): void {
  // Clear existing folders (Environment, Particles, etc.)
  // We keep the top-level controllers (Renderer, Reset)
  const folders = [...mainGui.folders];
  for (const folder of folders) {
    folder.destroy();
  }

  // Populate GUI with new adapter's config
  // Pass mainGui and mainStats to reuse them
  setupGui(
    adapter.config,
    {
      onReset: () => activeAdapter?.reset(),
      onSmoothingRadiusChange: () => {},
    },
    {
      trackGPU: true, // Stats already created, but this option keeps logic consistent
    },
    mainGui,
    mainStats
  );

  // Add extra controls for Particles adapter
  if (adapter.name === 'Particles') {
    const particlesFolder = mainGui.folders.find((f) => f._title === 'Particles');
    if (particlesFolder) {
      particlesFolder
        .add(adapter.config as any, 'particleRadius', 1, 5, 0.1)
        .name('Particle Radius');
    }
  }
}

async function switchAdapter(name: string): Promise<void> {
  const entry = adapterRegistry.find((adapter) => adapter.name === name);
  if (!entry) return;
  if (activeAdapter?.name === entry.name) return;

  isSwitching = true;
  
  // 1. Create new adapter
  const nextAdapter = entry.create();
  
  // 2. Sync Configuration (preserve values from current adapter)
  if (activeAdapter) {
    syncAdapterConfig(activeAdapter, nextAdapter);
    activeAdapter.destroy?.();
  }

  // 3. Set as active
  activeAdapter = nextAdapter;
  activeAdapter.applyCameraDefaults(camera);
  syncInputConfig(activeAdapter.config);

  // 4. Initialize Graphics
  setCanvasSize();
  configureContext(context, device, format);
  activeAdapter.init({ device, context, canvas, format });
  activeAdapter.resize();

  // 5. Update GUI (Clear old folders, add new ones with synced config)
  updateGui(activeAdapter);

  // 6. Ensure state matches GUI (Fixes chaotic start)
  if (activeAdapter.name === 'Particles') {
    activeAdapter.reset();
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

  // Initial load
  await switchAdapter(initialAdapter.name);

  // Animation Loop
  let lastTime: number | null = null;
  const frame = async (now: number) => {
    if (lastTime === null) lastTime = now;
    mainStats.begin(); // Use mainStats directly
    const dt = Math.min(0.033, (now - lastTime) / 1000);
    lastTime = now;

    updateInertia?.();

    if (activeAdapter && !isSwitching) {
      await activeAdapter.step(dt);
      activeAdapter.render(camera);
    }

    mainStats.end();
    mainStats.update();
    requestAnimationFrame(frame);
  };

  requestAnimationFrame(frame);
}

main();