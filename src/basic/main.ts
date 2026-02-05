/**
 * Unity Basic Scene - WebGPU Port
 *
 * This is a port of the Unity Fluid-Sim scene setup to WebGPU.
 * It renders the background and checkered floor tiles without the fluid simulation.
 *
 * Scene data extracted from: Fluid-Sim/Assets/Scenes/Fluid ScreenSpace 1.unity
 */

import './style.css';
import { OrbitCamera } from './orbit_camera';
import { SceneRenderer, SceneConfig } from './renderer';

// Scene configuration from Unity
// Values from environment.wgsl defaults and Unity scene
const config: SceneConfig = {
  // Tile colors from Unity environmentSettings
  // Quadrant mapping: determined by hitPos.x and hitPos.z signs
  tileCol1: { r: 0.5647059, g: 0.4683025, b: 0.25490198 },    // Yellow (swapped)
  tileCol2: { r: 0.424268, g: 0.27100393, b: 0.6603774 },     // Pink/Purple
  tileCol3: { r: 0.14057493, g: 0.3679245, b: 0.16709903 },   // Green
  tileCol4: { r: 0.07164471, g: 0.19658183, b: 0.4339623 },   // Blue (swapped)

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

  // Sky colors - neutral gray background matching Unity
  skyColorHorizon: { r: 0.92, g: 0.92, b: 0.92 }, // Neutral white horizon
  skyColorZenith: { r: 0.60, g: 0.70, b: 0.85 },  // Light blue zenith
  skyColorGround: { r: 0.52, g: 0.50, b: 0.52 },  // Neutral gray ground

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

  canvas.addEventListener('mousedown', (e) => {
    isDragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
  });

  canvas.addEventListener('mousemove', (e) => {
    if (!isDragging) return;

    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;

    camera.rotate(dx * 0.005, dy * 0.005);
  });

  canvas.addEventListener('mouseup', () => {
    isDragging = false;
  });

  canvas.addEventListener('mouseleave', () => {
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
