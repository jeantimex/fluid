/**
 * Unity Basic Scene - WebGPU Port
 *
 * This is a port of the Unity Fluid-Sim scene setup to WebGPU.
 * It renders the background and checkered floor tiles without the fluid simulation.
 *
 * Scene data extracted from: Fluid-Sim/Assets/Scenes/Fluid ScreenSpace 1.unity
 */

import './style.css';
import GUI from 'lil-gui';
import { OrbitCamera } from './orbit_camera';
import { SceneRenderer, SceneConfig } from './renderer';

// Scene configuration from Unity
// Values from environment.wgsl defaults and Unity scene
const config: SceneConfig = {
  // Tile colors from Unity environmentSettings
  // Quadrant mapping: determined by hitPos.x and hitPos.z signs
  // Original Unity colors (linear space) - will be gamma corrected in shader
  tileCol1: { r: 0.5647059, g: 0.4683025, b: 0.25490198 }, // Yellow
  tileCol2: { r: 0.424268, g: 0.27100393, b: 0.6603774 }, // Pink
  tileCol3: { r: 0.14057493, g: 0.3679245, b: 0.16709903 }, // Green
  tileCol4: { r: 0.07164471, g: 0.19658183, b: 0.4339623 }, // Blue

  // Floor parameters
  floorY: -5.0, // Bottom of simulation box (scale Y = 10, centered at origin)
  tileScale: 0.87,
  tileDarkFactor: 0.2, // HSV Value offset for checker pattern (Unity: tileDarkOffset=0.2)
  floorSize: 80, // Large floor

  // Tile color variation (HSV) - will be multiplied by 0.1 in shader
  tileColVariation: { x: 0.2, y: 0.0, z: 0.73 },

  // Light direction (normalized, pointing toward sun)
  // From environment.wgsl defaults
  dirToSun: { x: -0.83, y: 0.42, z: -0.36 },

  // Sky colors from Unity FluidRender.shader
  skyColorHorizon: { r: 1.0, g: 1.0, b: 1.0 }, // Pure white
  skyColorZenith: { r: 0.08, g: 0.37, b: 0.73 }, // Blue
  skyColorGround: { r: 0.55, g: 0.5, b: 0.55 }, // Warm gray with slight purple tint

  // Lighting parameters
  sunPower: 500.0, // Exponent for sun highlight
  sunBrightness: 1.0,
  floorAmbient: 0.58, // Ambient light on floor
};

async function main() {
  // Get app container
  const app = document.querySelector<HTMLDivElement>('#app');
  if (!app) throw new Error('Missing #app container');

  // Create canvas
  app.innerHTML = '<canvas id="sim-canvas" aria-label="Basic scene"></canvas>';
  const canvas = document.querySelector<HTMLCanvasElement>('#sim-canvas');
  if (!canvas) throw new Error('Failed to create canvas');

  // Initialize WebGPU
  if (!navigator.gpu) {
    app.innerHTML = '<p>WebGPU is not supported in this browser.</p>';
    return;
  }

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    app.innerHTML = '<p>Failed to get WebGPU adapter.</p>';
    return;
  }

  const device = await adapter.requestDevice();
  const context = canvas.getContext('webgpu');
  if (!context) {
    app.innerHTML = '<p>Failed to get WebGPU context.</p>';
    return;
  }

  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({
    device,
    format,
    alphaMode: 'premultiplied',
  });

  // Set initial canvas size
  const dpr = window.devicePixelRatio || 1;
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;

  // Create renderer
  const renderer = new SceneRenderer(device, context, canvas, format, config);

  // GUI controls for adjusting colors
  const gui = new GUI({ title: 'Scene Settings' });

  // Global adjustments
  const globalFolder = gui.addFolder('Global');
  const globalSettings = { brightness: 1.0, saturation: 1.0 };
  globalFolder
    .add(globalSettings, 'brightness', 0.1, 4.0, 0.1)
    .name('Brightness');
  globalFolder
    .add(globalSettings, 'saturation', 0.0, 2.0, 0.1)
    .name('Saturation');

  // Helper to convert RGB object to hex and back
  const rgbToHex = (c: { r: number; g: number; b: number }) => {
    const toHex = (v: number) =>
      Math.round(Math.min(1, Math.max(0, v)) * 255)
        .toString(16)
        .padStart(2, '0');
    return '#' + toHex(c.r) + toHex(c.g) + toHex(c.b);
  };

  // Color controls for each tile (gamma corrected for display)
  const linearToSrgb = (c: number) => Math.pow(c, 1 / 2.2);
  const toHex = (v: number) =>
    Math.round(Math.min(1, Math.max(0, linearToSrgb(v))) * 255)
      .toString(16)
      .padStart(2, '0');
  const colorSettings = {
    tile1:
      '#' +
      toHex(config.tileCol1.r) +
      toHex(config.tileCol1.g) +
      toHex(config.tileCol1.b),
    tile2:
      '#' +
      toHex(config.tileCol2.r) +
      toHex(config.tileCol2.g) +
      toHex(config.tileCol2.b),
    tile3:
      '#' +
      toHex(config.tileCol3.r) +
      toHex(config.tileCol3.g) +
      toHex(config.tileCol3.b),
    tile4:
      '#' +
      toHex(config.tileCol4.r) +
      toHex(config.tileCol4.g) +
      toHex(config.tileCol4.b),
  };

  // Convert hex (sRGB) back to linear for config
  const srgbToLinear = (c: number) => Math.pow(c, 2.2);
  const hexToRgb = (hex: string) => {
    const r = srgbToLinear(parseInt(hex.slice(1, 3), 16) / 255);
    const g = srgbToLinear(parseInt(hex.slice(3, 5), 16) / 255);
    const b = srgbToLinear(parseInt(hex.slice(5, 7), 16) / 255);
    return { r, g, b };
  };

  const colorsFolder = gui.addFolder('Tile Colors');
  colorsFolder
    .addColor(colorSettings, 'tile1')
    .name('Tile 1 (Yellow)')
    .onChange((v: string) => {
      config.tileCol1 = hexToRgb(v);
    });
  colorsFolder
    .addColor(colorSettings, 'tile2')
    .name('Tile 2 (Pink)')
    .onChange((v: string) => {
      config.tileCol2 = hexToRgb(v);
    });
  colorsFolder
    .addColor(colorSettings, 'tile3')
    .name('Tile 3 (Green)')
    .onChange((v: string) => {
      config.tileCol3 = hexToRgb(v);
    });
  colorsFolder
    .addColor(colorSettings, 'tile4')
    .name('Tile 4 (Blue)')
    .onChange((v: string) => {
      config.tileCol4 = hexToRgb(v);
    });

  // Sky color controls
  const skySettings = {
    horizon: rgbToHex(config.skyColorHorizon),
    zenith: rgbToHex(config.skyColorZenith),
    ground: rgbToHex(config.skyColorGround),
  };

  const hexToRgbDirect = (hex: string) => {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    return { r, g, b };
  };

  const skyFolder = gui.addFolder('Sky');
  skyFolder
    .addColor(skySettings, 'horizon')
    .name('Horizon')
    .onChange((v: string) => {
      config.skyColorHorizon = hexToRgbDirect(v);
    });
  skyFolder
    .addColor(skySettings, 'zenith')
    .name('Zenith')
    .onChange((v: string) => {
      config.skyColorZenith = hexToRgbDirect(v);
    });
  skyFolder
    .addColor(skySettings, 'ground')
    .name('Ground')
    .onChange((v: string) => {
      config.skyColorGround = hexToRgbDirect(v);
    });

  // Store global settings reference for renderer
  (config as any).globalBrightness = globalSettings.brightness;
  (config as any).globalSaturation = globalSettings.saturation;

  // Update global settings on change
  globalFolder.onChange(() => {
    (config as any).globalBrightness = globalSettings.brightness;
    (config as any).globalSaturation = globalSettings.saturation;
  });

  // Initialize camera to match Unity camera
  // Unity camera position: {x: -17.063494, y: 7.0107126, z: 19.292461}
  // Camera is in -X, +Z quadrant, looking toward center
  const camera = new OrbitCamera();
  camera.target = { x: 0, y: -2, z: 0 };
  camera.radius = 28;
  // theta = atan2(-17, 19) ≈ -0.73 radians (-42 degrees)
  camera.theta = -Math.PI * 0.23;
  // phi from vertical = acos(7/26) ≈ 74 degrees ≈ 1.3 radians
  camera.phi = Math.PI * 0.41;

  // Input handling for camera control
  let isDragging = false;
  let lastX = 0;
  let lastY = 0;

  canvas.addEventListener('pointerdown', (e) => {
    isDragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!isDragging) return;

    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;

    camera.rotate(dx * 0.005, dy * 0.005);
  });

  canvas.addEventListener('pointerup', () => {
    isDragging = false;
  });

  canvas.addEventListener('pointerleave', () => {
    isDragging = false;
  });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    camera.zoom(e.deltaY * 0.05);
  });

  // Handle window resize
  window.addEventListener('resize', () => {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    context.configure({
      device,
      format,
      alphaMode: 'premultiplied',
    });
  });

  // Animation loop
  function frame() {
    renderer.render(camera.viewMatrix, camera.position);
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

main();
