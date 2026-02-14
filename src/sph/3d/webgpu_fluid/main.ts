import './style.css';
import type { SimConfig } from '../common/types.ts';
import { setupGui } from '../common/gui.ts';
import { OrbitCamera } from '../common/orbit_camera.ts';
import { setupInputHandlers } from '../common/input_handler.ts';
import {
  initWebGPU,
  configureContext,
  WebGPUInitError,
} from '../common/webgpu_utils.ts';
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
const style = document.createElement('style');
style.textContent = `
  #gui-container {
    position: fixed;
    top: 0;
    right: 0;
    z-index: 10001;
    background: #1a1a1a;
    color: #fff;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    box-sizing: border-box;
    box-shadow: 0 4px 20px rgba(0,0,0,0.5);
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    width: 280px;
    max-width: 100vw;
    height: auto;
    max-height: 100vh;
    display: flex;
    flex-direction: column;
    user-select: none;
    overflow: hidden;
  }
  #gui-container.collapsed {
    width: 44px;
    height: 44px;
    border-radius: 22px;
    top: 10px;
    right: 10px;
    cursor: pointer;
    overflow: hidden;
  }
  #gui-container.collapsed:hover {
    background: #2a2a2a;
  }
  #gui-container .gui-content-wrapper {
    transition: opacity 0.2s ease;
    opacity: 1;
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    flex-grow: 1;
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.2) transparent;
  }
  #gui-container .gui-content-wrapper::-webkit-scrollbar {
    width: 6px;
  }
  #gui-container .gui-content-wrapper::-webkit-scrollbar-thumb {
    background-color: rgba(255, 255, 255, 0.2);
    border-radius: 3px;
  }
  #gui-container.collapsed .gui-content-wrapper {
    opacity: 0;
    pointer-events: none;
    display: none;
  }
  #gui-container .gui-toggle-btn {
    background: none;
    border: none;
    color: white;
    cursor: pointer;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0.7;
    transition: opacity 0.2s;
    width: 44px;
    height: 44px;
    flex-shrink: 0;
  }
  #gui-container .gui-toggle-btn:hover {
    opacity: 1;
  }
  #gui-container.collapsed .gui-toggle-btn {
    opacity: 1;
  }
  #gui-container .gui-header-main {
    display: flex;
    align-items: center;
    background: #1a1a1a;
    flex-shrink: 0;
  }
  #gui-container .gui-title-area {
    flex-grow: 1;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-right: 11px;
    overflow: hidden;
  }
  #gui-container.collapsed .gui-title-area {
    display: none;
  }
  #gui-container .lil-gui.root,
  #gui-container .lil-gui.lil-root {
    width: 100% !important;
    border: none;
    box-shadow: none;
    background: transparent;
  }
  #gui-container .lil-gui.root > .children,
  #gui-container .lil-gui.lil-root > .children {
    border: none;
  }
  #gui-container .custom-gui-folder-header {
    display: flex;
    align-items: center;
    padding: 1px;
    cursor: pointer;
    user-select: none;
    font-size: 11px;
    font-weight: 700;
    color: rgba(255, 255, 255, 0.9);
  }
  #gui-container .custom-gui-folder-content {
    overflow: hidden;
    max-height: none;
    transition: max-height 0.3s ease-out;
  }
  @media (max-width: 480px) {
    #gui-container:not(.collapsed) {
      width: 100vw;
      top: 0;
      right: 0;
    }
  }
`;
document.head.appendChild(style);

const guiContainer = document.createElement('div');
guiContainer.id = 'gui-container';
if (window.innerWidth <= 480) {
  guiContainer.classList.add('collapsed');
}
document.body.appendChild(guiContainer);

const headerMain = document.createElement('div');
headerMain.className = 'gui-header-main';
guiContainer.appendChild(headerMain);

const toggleBtn = document.createElement('button');
toggleBtn.className = 'gui-toggle-btn';
toggleBtn.innerHTML = '<span class="material-icons">menu</span>';
headerMain.appendChild(toggleBtn);

const titleArea = document.createElement('div');
titleArea.className = 'gui-title-area';
headerMain.appendChild(titleArea);

const contentWrapper = document.createElement('div');
contentWrapper.className = 'gui-content-wrapper';
guiContainer.appendChild(contentWrapper);

const toggleCollapse = (e?: Event) => {
  if (e) e.stopPropagation();
  guiContainer.classList.toggle('collapsed');
};

toggleBtn.onclick = toggleCollapse;
guiContainer.onclick = () => {
  if (guiContainer.classList.contains('collapsed')) {
    guiContainer.classList.remove('collapsed');
  }
};

const titleSpan = document.createElement('span');
titleSpan.style.cssText = `
  font-size: 16px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;
titleSpan.textContent = 'WebGPU 3D Fluid';
titleArea.appendChild(titleSpan);

const githubUrl = 'https://github.com/jeantimex/fluid';
const githubLink = document.createElement('a');
githubLink.href = githubUrl;
githubLink.target = '_blank';
githubLink.rel = 'noopener noreferrer';
githubLink.title = 'View on GitHub';
githubLink.style.cssText = `
  display: flex;
  align-items: center;
  color: #fff;
  opacity: 0.7;
  transition: opacity 0.2s;
  margin-left: 10px;
`;
githubLink.onpointerenter = () => (githubLink.style.opacity = '1');
githubLink.onpointerleave = () => (githubLink.style.opacity = '0.7');
githubLink.innerHTML = `
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
  </svg>
`;
titleArea.appendChild(githubLink);

const subtitle = document.createElement('div');
subtitle.id = 'gui-subtitle';
subtitle.style.cssText = `
  padding: 5px 11px 5px 11px;
  font-size: 11px;
  font-weight: 400;
  opacity: 0.6;
  line-height: 1.4;
  letter-spacing: 0.01em;
  white-space: normal;
  overflow-wrap: break-word;
  max-width: 220px;
`;

const author = document.createElement('div');
author.style.cssText = `
  padding: 0 11px 10px 11px;
  font-size: 10px;
  font-weight: 400;
  opacity: 1.0;
  letter-spacing: 0.01em;
`;
author.innerHTML =
  'Original Author: <a href="https://github.com/SebLague" target="_blank" rel="noopener noreferrer" style="color: inherit; text-decoration: underline;">Sebastian Lague</a>';

const webgpuAuthor = document.createElement('div');
webgpuAuthor.style.cssText = `
  padding: 0 11px 10px 11px;
  font-size: 10px;
  font-weight: 400;
  opacity: 1.0;
  letter-spacing: 0.01em;
`;
webgpuAuthor.innerHTML =
  'WebGPU Author: <a href="https://github.com/jeantimex" target="_blank" rel="noopener noreferrer" style="color: inherit; text-decoration: underline;">jeantimex</a>';

const youtube = document.createElement('div');
youtube.style.cssText = `
  padding: 0 11px 10px 11px;
  font-size: 10px;
  font-weight: 400;
  opacity: 1.0;
  letter-spacing: 0.01em;
  display: flex;
  align-items: center;
  gap: 4px;
`;
youtube.innerHTML = `
  <svg width="14" height="14" viewBox="0 0 24 24" fill="#FF0000">
    <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zM9.5 16.5v-9l7 4.5-7 4.5z"/>
  </svg>
  <a href="https://youtu.be/kOkfC5fLfgE?si=IHlf5YZt_mAhDWKR" target="_blank" rel="noopener noreferrer" style="color: inherit; text-decoration: underline;">Coding Adventure: Rendering Fluids</a>
`;

const subtitleMap: Record<string, string> = {
  Particles: 'SPH Fluid • Particle Simulation',
  Raymarch: 'SPH Fluid • Volumetric Raymarching',
  'Marching Cubes': 'SPH Fluid • Marching Cubes Reconstruction',
  'Screen Space': 'SPH Fluid • Screen-Space Rendering',
};

const featureMap: Record<string, string[]> = {
  Particles: [
    'SPH Fluid Simulator (GPU)',
    'Billboard Particle Rendering',
    'Frustum Culling',
    'Dynamic Shadow Mapping',
    'Precise Particle Interaction',
    'Box/Sphere Obstacles',
  ],
  Raymarch: [
    'SPH Fluid Simulator (GPU)',
    'Volumetric Density Splatting',
    'Physically-Based Raymarching',
    'Refraction & Reflection',
    'Beer–Lambert Transmittance',
    'Shadows & Ambient Occlusion',
  ],
  'Marching Cubes': [
    'SPH Fluid Simulator (GPU)',
    'Marching Cubes Meshing (Compute)',
    'Indirect Instanced Drawing',
    'Lambertian Shading',
    'Dynamic Shadow Mapping',
    'Box/Sphere Obstacles',
  ],
  'Screen Space': [
    'SPH Fluid Simulator (GPU)',
    'Multi-Pass Screen-Space Renderer',
    'Curvature-Flow Smoothing',
    'Foam & Spray Simulation',
    'Refraction & Beer-Lambert Law',
    'Bilateral Depth Filtering',
  ],
};

const interactionMap: Record<string, string[]> = {
  Particles: [
    'Click & Drag (Background): Orbit Camera',
    'Click & Drag (Fluid): Pull Particles',
    'Shift + Click & Drag: Push Particles',
    'Mouse Wheel: Zoom In/Out',
  ],
  Raymarch: [
    'Click & Drag (Background): Orbit Camera',
    'Click & Drag (Fluid): Pull Particles',
    'Shift + Click & Drag: Push Particles',
    'Mouse Wheel: Zoom In/Out',
  ],
  'Marching Cubes': [
    'Click & Drag (Background): Orbit Camera',
    'Click & Drag (Fluid): Pull Particles',
    'Shift + Click & Drag: Push Particles',
    'Mouse Wheel: Zoom In/Out',
  ],
  'Screen Space': [
    'Click & Drag (Background): Orbit Camera',
    'Click & Drag (Fluid): Pull Particles',
    'Shift + Click & Drag: Push Particles',
    'Mouse Wheel: Zoom In/Out',
  ],
};

const header = document.createElement('div');
header.style.cssText = `
  background: #1a1a1a;
  color: #fff;
  box-sizing: border-box;
`;
header.appendChild(subtitle);
header.appendChild(author);
header.appendChild(webgpuAuthor);
header.appendChild(youtube);

const featContainer = document.createElement('div');
featContainer.id = 'gui-features';
featContainer.style.cssText = `
  padding: 5px 11px 10px 11px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
`;
header.appendChild(featContainer);

const intContainer = document.createElement('div');
intContainer.id = 'gui-interactions';
intContainer.style.cssText = `
  padding: 5px 11px 10px 11px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
`;
header.appendChild(intContainer);

// --- Custom Collapsible About Section ---
const aboutSection = document.createElement('div');
aboutSection.className = 'custom-gui-folder';
aboutSection.style.cssText = `
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.02);
`;

const aboutHeader = document.createElement('div');
aboutHeader.className = 'custom-gui-folder-header';
aboutHeader.innerHTML = `
  <span class="material-icons folder-arrow" style="
    font-family: 'Material Icons';
    font-size: 16px;
    transition: transform 0.2s;
    transform: rotate(90deg);
    text-transform: none;
  ">chevron_right</span>
  About
`;

const aboutContent = document.createElement('div');
aboutContent.className = 'custom-gui-folder-content';

let isAboutOpen = true;
aboutHeader.onclick = () => {
  if (aboutContent.style.maxHeight === 'none') {
    aboutContent.style.maxHeight = aboutContent.scrollHeight + 'px';
    aboutContent.offsetHeight;
  }

  isAboutOpen = !isAboutOpen;
  const arrow = aboutHeader.querySelector('.folder-arrow') as HTMLElement;
  if (isAboutOpen) {
    arrow.style.transform = 'rotate(90deg)';
    aboutContent.style.maxHeight = aboutContent.scrollHeight + 'px';
  } else {
    arrow.style.transform = 'rotate(0deg)';
    aboutContent.style.maxHeight = '0';
  }
};

aboutSection.appendChild(aboutHeader);
aboutSection.appendChild(aboutContent);
aboutContent.appendChild(header);

contentWrapper.appendChild(aboutSection);

const mainGui = new GUI({
  container: contentWrapper,
  title: 'Simulation Settings',
});
const mainStats = new Stats({ trackGPU: true, horizontal: true });
mainStats.dom.style.display = 'none';
document.body.appendChild(mainStats.dom);

// Renderer Selection State
const guiState = {
  renderer: adapterRegistry[0].name,
  paused: false,
  togglePause: () => {
    guiState.paused = !guiState.paused;
    if (pauseController) {
      pauseController.name(guiState.paused ? 'Resume' : 'Pause');
    }
  },
  reset: () => activeAdapter?.reset(),
};

let pauseController: any;
let activeAdapter: FluidAppAdapter | null = null;
let device: GPUDevice;
let context: GPUCanvasContext;
let format: GPUTextureFormat;
let updateInertia: (() => void) | null = null;
let isSwitching = false;

// Add Renderer Selector to GUI (Always at the top)
mainGui
  .add(
    guiState,
    'renderer',
    adapterRegistry.map((a) => a.name)
  )
  .name('Renderer')
  .onChange((name: string) => switchAdapter(name));

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

function syncAdapterConfig(
  source: FluidAppAdapter,
  target: FluidAppAdapter
): void {
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
  if (
    typeof s.obstacleAlpha === 'number' &&
    typeof t.obstacleAlpha === 'number'
  ) {
    t.obstacleAlpha = s.obstacleAlpha;
  }

  // Sync Raymarch specific
  const sRay = s as any;
  const tRay = t as any;
  if (sRay.renderScale !== undefined && tRay.renderScale !== undefined) {
    tRay.renderScale = sRay.renderScale;
  }

  // Sync Environment
  const sEnv = s as any;
  const tEnv = t as any;
  if (sEnv.floorAmbient !== undefined && tEnv.floorAmbient !== undefined) {
    tEnv.floorAmbient = sEnv.floorAmbient;
    tEnv.sceneExposure = sEnv.sceneExposure;
    tEnv.sunBrightness = sEnv.sunBrightness;
    tEnv.globalBrightness = sEnv.globalBrightness;
    tEnv.globalSaturation = sEnv.globalSaturation;

    if (sEnv.tileCol1 && tEnv.tileCol1)
      Object.assign(tEnv.tileCol1, sEnv.tileCol1);
    if (sEnv.tileCol2 && tEnv.tileCol2)
      Object.assign(tEnv.tileCol2, sEnv.tileCol2);
    if (sEnv.tileCol3 && tEnv.tileCol3)
      Object.assign(tEnv.tileCol3, sEnv.tileCol3);
    if (sEnv.tileCol4 && tEnv.tileCol4)
      Object.assign(tEnv.tileCol4, sEnv.tileCol4);
  }
}

function updateGui(adapter: FluidAppAdapter): void {
  // Update dynamic subtitle
  const subtitleEl = document.getElementById('gui-subtitle');
  if (subtitleEl) {
    subtitleEl.textContent = (subtitleMap as any)[adapter.name] || '';
  }

  // Update dynamic features
  const featEl = document.getElementById('gui-features');
  if (featEl) {
    featEl.innerHTML = '';
    const features = (featureMap as any)[adapter.name];
    if (features && features.length > 0) {
      featEl.style.display = 'block';
      const label = document.createElement('div');
      label.style.cssText = `
        font-size: 10px;
        font-weight: 600;
        opacity: 0.8;
        text-transform: uppercase;
        margin-bottom: 4px;
      `;
      label.textContent = 'Features:';
      featEl.appendChild(label);

      const list = document.createElement('ul');
      list.style.cssText = `
        margin: 0;
        padding: 0 0 0 14px;
        font-size: 10px;
        opacity: 0.7;
        line-height: 1.4;
      `;
      features.forEach((f: string) => {
        const li = document.createElement('li');
        li.textContent = f;
        list.appendChild(li);
      });
      featEl.appendChild(list);
    } else {
      featEl.style.display = 'none';
    }
  }

  // Update dynamic interactions
  const intEl = document.getElementById('gui-interactions');
  if (intEl) {
    intEl.innerHTML = '';
    const interactions = (interactionMap as any)[adapter.name];
    if (interactions && interactions.length > 0) {
      intEl.style.display = 'block';
      const label = document.createElement('div');
      label.style.cssText = `
        font-size: 10px;
        font-weight: 600;
        opacity: 0.8;
        text-transform: uppercase;
        margin-bottom: 4px;
      `;
      label.textContent = 'Interactions:';
      intEl.appendChild(label);

      const list = document.createElement('ul');
      list.style.cssText = `
        margin: 0;
        padding: 0 0 0 14px;
        font-size: 10px;
        opacity: 0.7;
        line-height: 1.4;
      `;
      interactions.forEach((i: string) => {
        const li = document.createElement('li');
        li.textContent = i;
        list.appendChild(li);
      });
      intEl.appendChild(list);
    } else {
      intEl.style.display = 'none';
    }
  }

  // Clear existing folders
  const folders = [...mainGui.folders];
  for (const folder of folders) {
    folder.destroy();
  }

  // Clear existing controllers EXCEPT 'Renderer'
  const controllers = [...mainGui.controllers];
  for (const controller of controllers) {
    if (controller._name !== 'Renderer') {
      controller.destroy();
    }
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

  // ... (adapter specific controls) ...

  // -------------------------------------------------------------------------
  // Particles Adapter Controls
  // -------------------------------------------------------------------------
  if (adapter.name === 'Particles') {
    const particlesFolder = mainGui.folders.find(
      (f) => f._title === 'Particles'
    );
    if (particlesFolder) {
      particlesFolder
        .add(config, 'particleRadius', 1, 5, 0.1)
        .name('Particle Radius');
    }

    const shadowFolder = mainGui.folders.find((f) => f._title === 'Shadow');
    if (shadowFolder) {
      shadowFolder
        .add(config, 'densityTextureRes', 32, 256, 1)
        .name('Volume Res')
        .onFinishChange(() => activeAdapter?.reset());
      shadowFolder
        .add(config, 'densityOffset', 0, 500, 1)
        .name('Density Offset');
      shadowFolder
        .add(config, 'densityMultiplier', 0.0, 0.2, 0.001)
        .name('Density Multiplier');
      shadowFolder
        .add(config, 'lightStepSize', 0.01, 0.5, 0.01)
        .name('Light Step');
      shadowFolder.add(config, 'showFluidShadows').name('Fluid Shadows');
    }
  }

  // -------------------------------------------------------------------------
  // Raymarch Adapter Controls
  // -------------------------------------------------------------------------
  else if (adapter.name === 'Raymarch') {
    const raymarchFolder = mainGui.addFolder('Raymarch');
    raymarchFolder.close();
    raymarchFolder
      .add(config, 'densityTextureRes', 32, 256, 1)
      .name('Density Texture Res')
      .onFinishChange(() => activeAdapter?.reset());
    raymarchFolder
      .add(config, 'densityOffset', 0, 400, 1)
      .name('Density Offset');
    raymarchFolder
      .add(config, 'densityMultiplier', 0.0, 0.2, 0.001)
      .name('Density Multiplier');
    raymarchFolder
      .add(config, 'renderScale', 0.1, 1.0, 0.05)
      .name('Render Scale');
    raymarchFolder.add(config, 'stepSize', 0.01, 0.5, 0.01).name('Step Size');
    raymarchFolder.add(config, 'maxSteps', 32, 2048, 32).name('Max Steps');
    const extinctionFolder = raymarchFolder.addFolder(
      'Extinction (Absorption)'
    );
    extinctionFolder
      .add(config.extinctionCoefficients, 'x', 0, 50, 0.1)
      .name('Red');
    extinctionFolder
      .add(config.extinctionCoefficients, 'y', 0, 50, 0.1)
      .name('Green');
    extinctionFolder
      .add(config.extinctionCoefficients, 'z', 0, 50, 0.1)
      .name('Blue');

    const shadowFolder = mainGui.folders.find((f) => f._title === 'Shadow');
    if (shadowFolder) {
      shadowFolder.add(config, 'showFluidShadows').name('Fluid Shadows');
    }
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

    const shadowFolder = mainGui.folders.find((f) => f._title === 'Shadow');
    if (shadowFolder) {
      shadowFolder.add(config, 'showFluidShadows').name('Fluid Shadows');
    }
  }

  // -------------------------------------------------------------------------
  // Screen Space Adapter Controls
  // -------------------------------------------------------------------------
  else if (adapter.name === 'Screen Space') {
    const particlesFolder = mainGui.folders.find(
      (f) => f._title === 'Particles'
    );
    if (particlesFolder) {
      particlesFolder
        .add(config, 'particleRadius', 1, 5, 0.1)
        .name('Particle Radius');
    }

    const foamFolder = mainGui.addFolder('Foam');
    foamFolder.close();
    foamFolder.add(config, 'foamSpawnRate', 0, 1000, 1).name('Spawn Rate');
    foamFolder
      .add(config, 'trappedAirVelocityMin', 0, 50, 0.1)
      .name('Air Vel Min');
    foamFolder
      .add(config, 'trappedAirVelocityMax', 0, 100, 0.1)
      .name('Air Vel Max');
    foamFolder
      .add(config, 'foamKineticEnergyMin', 0, 50, 0.1)
      .name('Kinetic Min');
    foamFolder
      .add(config, 'foamKineticEnergyMax', 0, 200, 0.1)
      .name('Kinetic Max');
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

    const shadowFolder = mainGui.folders.find((f) => f._title === 'Shadow');
    if (shadowFolder) {
      shadowFolder.add(config, 'showFluidShadows').name('Fluid Shadows');
    }

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

  // Add Pause and Reset Buttons at the end
  pauseController = mainGui
    .add(guiState, 'togglePause')
    .name(guiState.paused ? 'Resume' : 'Pause');
  mainGui.add(guiState, 'reset').name('Reset Simulation');
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
      if (!guiState.paused) {
        await activeAdapter.step(dt);
      }
      activeAdapter.render(camera);
    }

    mainStats.end();
    mainStats.update();
    requestAnimationFrame(frame);
  };

  requestAnimationFrame(frame);
}

main();
