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
import { rgbToHex, hexToRgb } from '../common/color_utils.ts';

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
  t.viscosityStrength = s.viscosityStrength; 
  
  // Sync container bounds
  t.boundsSize.x = s.boundsSize.x;
  t.boundsSize.y = s.boundsSize.y;
  t.boundsSize.z = s.boundsSize.z;

  // Sync interaction
  t.interactionRadius = s.interactionRadius;
  t.interactionStrength = s.interactionStrength;

  // Sync obstacle
  t.obstacleSize.x = s.obstacleSize.x;
  t.obstacleSize.y = s.obstacleSize.y;
  t.obstacleSize.z = s.obstacleSize.z;
  t.obstacleCentre.x = s.obstacleCentre.x;
  t.obstacleCentre.y = s.obstacleCentre.y;
  t.obstacleCentre.z = s.obstacleCentre.z;
  t.obstacleRotation.x = s.obstacleRotation.x;
  t.obstacleRotation.y = s.obstacleRotation.y;
  t.obstacleRotation.z = s.obstacleRotation.z;
  
  if (s.obstacleColor && t.obstacleColor) {
    t.obstacleColor.r = s.obstacleColor.r;
    t.obstacleColor.g = s.obstacleColor.g;
    t.obstacleColor.b = s.obstacleColor.b;
  }
  if (typeof s.obstacleAlpha === 'number' && typeof t.obstacleAlpha === 'number') {
    t.obstacleAlpha = s.obstacleAlpha;
  }

  // Sync Raymarch specific
  const sRay = s as any;
  const tRay = t as any;
  if (sRay.fluidColor && tRay.fluidColor) {
    tRay.fluidColor.r = sRay.fluidColor.r;
    tRay.fluidColor.g = sRay.fluidColor.g;
    tRay.fluidColor.b = sRay.fluidColor.b;
  }
  
  // Sync Environment
  const sEnv = s as any;
  const tEnv = t as any;
  if (sEnv.floorAmbient !== undefined && tEnv.floorAmbient !== undefined) {
      tEnv.floorAmbient = sEnv.floorAmbient;
      tEnv.sceneExposure = sEnv.sceneExposure;
      tEnv.sunBrightness = sEnv.sunBrightness;
      tEnv.debugFloorMode = sEnv.debugFloorMode;
      tEnv.globalBrightness = sEnv.globalBrightness;
      tEnv.globalSaturation = sEnv.globalSaturation;
      
      if (sEnv.tileCol1 && tEnv.tileCol1) Object.assign(tEnv.tileCol1, sEnv.tileCol1);
      if (sEnv.tileCol2 && tEnv.tileCol2) Object.assign(tEnv.tileCol2, sEnv.tileCol2);
      if (sEnv.tileCol3 && tEnv.tileCol3) Object.assign(tEnv.tileCol3, sEnv.tileCol3);
      if (sEnv.tileCol4 && tEnv.tileCol4) Object.assign(tEnv.tileCol4, sEnv.tileCol4);
  }
}

function updateGui(adapter: FluidAppAdapter): void {
  // Clear existing folders
  const folders = [...mainGui.folders];
  for (const folder of folders) {
    folder.destroy();
  }

  // Populate GUI with new adapter's config
  setupGui(
    adapter.config,
    {
      onReset: () => activeAdapter?.reset(),
      onSmoothingRadiusChange: () => {},
    },
    {
      trackGPU: true,
    },
    mainGui,
    mainStats
  );

  const config = adapter.config as any;

  // -------------------------------------------------------------------------
  // Particles Adapter Controls
  // -------------------------------------------------------------------------
  if (adapter.name === 'Particles') {
    const particlesFolder = mainGui.folders.find((f) => f._title === 'Particles');
    if (particlesFolder) {
      particlesFolder
        .add(config, 'particleRadius', 1, 5, 0.1)
        .name('Particle Radius');
    }
  }

  // -------------------------------------------------------------------------
  // Raymarch Adapter Controls
  // -------------------------------------------------------------------------
  else if (adapter.name === 'Raymarch') {
    const raymarchFolder = mainGui.addFolder('Raymarch');
    raymarchFolder.close();
    raymarchFolder.addColor(config, 'fluidColor').name('Fluid Color');
    raymarchFolder
      .add(config, 'densityTextureRes', 32, 256, 1)
      .name('Density Texture Res')
      .onFinishChange(() => activeAdapter?.reset());
    raymarchFolder.add(config, 'densityOffset', 0, 400, 1).name('Density Offset');
    raymarchFolder
      .add(config, 'densityMultiplier', 0.0, 0.2, 0.001)
      .name('Density Multiplier');
    raymarchFolder.add(config, 'stepSize', 0.01, 0.5, 0.01).name('Step Size');
    raymarchFolder.add(config, 'maxSteps', 32, 2048, 32).name('Max Steps');
    const extinctionFolder = raymarchFolder.addFolder('Extinction (Absorption)');
    extinctionFolder.add(config.extinctionCoefficients, 'x', 0, 50, 0.1).name('Red');
    extinctionFolder.add(config.extinctionCoefficients, 'y', 0, 50, 0.1).name('Green');
    extinctionFolder.add(config.extinctionCoefficients, 'z', 0, 50, 0.1).name('Blue');
  }

  // -------------------------------------------------------------------------
  // Marching Cubes Adapter Controls
  // -------------------------------------------------------------------------
  else if (adapter.name === 'Marching Cubes') {
    const marchingFolder = mainGui.addFolder('Marching Cubes');
    marchingFolder.close();
    marchingFolder
      .add(config, 'densityTextureRes', 32, 256, 1)
      .name('Density Texture Res')
      .onFinishChange(() => activeAdapter?.reset());
    marchingFolder.add(config, 'isoLevel', 0, 200, 1).name('Iso Level');

    const surfaceColorState = {
      surfaceColor: rgbToHex(config.surfaceColor),
    };

    marchingFolder
      .addColor(surfaceColorState, 'surfaceColor')
      .name('Surface Color')
      .onChange((value: string) => {
        const rgb = hexToRgb(value);
        config.surfaceColor.r = rgb.r / 255;
        config.surfaceColor.g = rgb.g / 255;
        config.surfaceColor.b = rgb.b / 255;
      });
  }

  // -------------------------------------------------------------------------
  // Screen Space Adapter Controls
  // -------------------------------------------------------------------------
  else if (adapter.name === 'Screen Space') {
    const particlesFolder = mainGui.folders.find((f) => f._title === 'Particles');
    if (particlesFolder) {
      particlesFolder
        .add(config, 'particleRadius', 1, 5, 0.1)
        .name('Particle Radius');
    }

    const foamFolder = mainGui.addFolder('Foam');
    foamFolder.close();
    foamFolder.add(config, 'foamSpawnRate', 0, 1000, 1).name('Spawn Rate');
    foamFolder.add(config, 'trappedAirVelocityMin', 0, 50, 0.1).name('Air Vel Min');
    foamFolder
      .add(config, 'trappedAirVelocityMax', 0, 100, 0.1)
      .name('Air Vel Max');
    foamFolder.add(config, 'foamKineticEnergyMin', 0, 50, 0.1).name('Kinetic Min');
    foamFolder.add(config, 'foamKineticEnergyMax', 0, 200, 0.1).name('Kinetic Max');
    foamFolder.add(config, 'bubbleBuoyancy', 0, 5, 0.1).name('Buoyancy');
    foamFolder.add(config, 'bubbleScale', 0, 2, 0.01).name('Scale');
    foamFolder.add(config, 'foamLifetimeMin', 0, 30, 0.1).name('Lifetime Min');
    foamFolder.add(config, 'foamLifetimeMax', 0, 60, 0.1).name('Lifetime Max');
    foamFolder.addColor(config, 'foamColor').name('Color');
    foamFolder.add(config, 'foamOpacity', 0, 20, 0.1).name('Opacity');
    foamFolder
      .add(config, 'sprayClassifyMaxNeighbours', 0, 20, 1)
      .name('Spray Max Neighbors');
    foamFolder
      .add(config, 'bubbleClassifyMinNeighbours', 0, 50, 1)
      .name('Bubble Min Neighbors');
    foamFolder
      .add(config, 'foamParticleRadius', 0.1, 5, 0.1)
      .name('Particle Radius');
    foamFolder
      .add(config, 'spawnRateFadeInTime', 0, 5, 0.01)
      .name('Spawn Fade-In Time');
    foamFolder
      .add(config, 'spawnRateFadeStartTime', 0, 5, 0.01)
      .name('Spawn Fade Start');
    foamFolder
      .add(config, 'bubbleChangeScaleSpeed', 0, 20, 0.1)
      .name('Bubble Scale Speed');

    const renderingFolder = mainGui.addFolder('Rendering');
    renderingFolder.close();
    renderingFolder
      .add(config.extinctionCoeff, 'x', 0, 5, 0.01)
      .name('Extinction R');
    renderingFolder
      .add(config.extinctionCoeff, 'y', 0, 5, 0.01)
      .name('Extinction G');
    renderingFolder
      .add(config.extinctionCoeff, 'z', 0, 5, 0.01)
      .name('Extinction B');
    renderingFolder
      .add(config, 'extinctionMultiplier', 0, 10, 0.01)
      .name('Extinction Multiplier');
    renderingFolder
      .add(config, 'refractionStrength', 0, 20, 0.01)
      .name('Refraction Strength');

    const debugFolder = mainGui.addFolder('Debug');
    debugFolder.close();
    debugFolder
      .add(config, 'screenSpaceDebugMode', {
        Shaded: 4,
        Depth: 0,
        Thickness: 1,
        Normal: 2,
        Smooth: 3,
      })
      .name('Screen-Space View');
  }
}

async function switchAdapter(name: string): Promise<void> {
  const entry = adapterRegistry.find((adapter) => adapter.name === name);
  if (!entry) return;
  if (activeAdapter?.name === entry.name) return;

  isSwitching = true;
  
  const nextAdapter = entry.create();
  
  if (activeAdapter) {
    syncAdapterConfig(activeAdapter, nextAdapter);
    activeAdapter.destroy?.();
  } else {
    nextAdapter.applyCameraDefaults(camera);
  }

  activeAdapter = nextAdapter;
  syncInputConfig(activeAdapter.config);

  setCanvasSize();
  configureContext(context, device, format);
  activeAdapter.init({ device, context, canvas, format });
  activeAdapter.resize();

  updateGui(activeAdapter);

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

  await switchAdapter(initialAdapter.name);

  let lastTime: number | null = null;
  const frame = async (now: number) => {
    if (lastTime === null) lastTime = now;
    mainStats.begin();
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
