/**
 * =============================================================================
 * WebGPU 3D Fluid Simulation - Application Entry Point
 * =============================================================================
 *
 * This is the main entry point for the 3D SPH (Smoothed Particle Hydrodynamics)
 * fluid simulation using WebGPU. It orchestrates the initialization and main
 * loop of the application.
 *
 * ## Responsibilities
 *
 * 1. **Canvas Setup**: Creates and configures the HTML canvas for WebGPU rendering
 * 2. **WebGPU Initialization**: Acquires GPU device and configures the rendering context
 * 3. **Input Handling**: Sets up mouse/touch interactions for camera control and
 *    particle manipulation (push/pull forces)
 * 4. **Animation Loop**: Runs the main simulation/render loop at display refresh rate
 *
 * ## Architecture Overview
 *
 * ```
 * main.ts (this file)
 *    │
 *    ├─► FluidSimulation    (simulation orchestrator)
 *    │      ├─► SimulationBuffers   (GPU memory management)
 *    │      ├─► ComputePipelines    (compute shader pipelines)
 *    │      └─► Renderer            (particle visualization)
 *    │
 *    ├─► OrbitCamera        (3D camera controls)
 *    │
 *    └─► GUI                (lil-gui controls panel)
 * ```
 *
 * ## Input System
 *
 * The input system supports three interaction modes:
 * - **Camera Orbit**: Click and drag on empty space to rotate the camera
 * - **Camera Zoom**: Mouse wheel to zoom in/out
 * - **Particle Interaction**: Click and drag inside the bounding box to push/pull particles
 *   - Left click: Pull (attract particles toward cursor)
 *   - Right click: Push (repel particles away from cursor)
 *
 * Ray casting is used to detect whether the user clicked inside the simulation bounds
 * and to convert 2D screen coordinates to 3D world coordinates for particle interaction.
 *
 * @module main
 */

import './style.css';
import { createConfig } from '../common/config.ts';
import { setupGui } from '../common/gui.ts';

/**
 * Converts a normalized RGB color (components in [0, 1]) to a hex string.
 *
 * Used to bridge the config's normalized color values with lil-gui's
 * `addColor` control, which expects CSS hex strings like `"#7eb7e7"`.
 *
 * @param rgb - Color with r, g, b in [0, 1]
 * @returns Hex string in the form `"#rrggbb"`
 */
function rgbToHex(rgb: { r: number; g: number; b: number }): string {
  const toByte = (value: number): number =>
    Math.max(0, Math.min(255, Math.round(value * 255)));
  const r = toByte(rgb.r).toString(16).padStart(2, '0');
  const g = toByte(rgb.g).toString(16).padStart(2, '0');
  const b = toByte(rgb.b).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
}

/**
 * Converts a CSS hex color string to an RGB object with byte values (0–255).
 *
 * The caller divides each component by 255 before writing back to the config
 * to restore the normalized [0, 1] range used by the shader uniforms.
 *
 * @param hex - Hex string, with or without leading `#` (e.g. `"#7eb7e7"`)
 * @returns RGB object with r, g, b in [0, 255]
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const normalized = hex.trim().replace('#', '');
  if (normalized.length !== 6) {
    return { r: 0, g: 0, b: 0 };
  }
  const value = Number.parseInt(normalized, 16);
  return {
    r: (value >> 16) & 0xff,
    g: (value >> 8) & 0xff,
    b: value & 0xff,
  };
}
import { FluidSimulation } from './fluid_simulation.ts';
import { OrbitCamera } from '../webgpu_particles/orbit_camera.ts';
import {
  initWebGPU,
  configureContext,
  WebGPUInitError,
} from '../webgpu_particles/webgpu_utils.ts';
import { setupInputHandlers } from './input_handler.ts';
import type { RaymarchConfig } from './types.ts';

/**
 * Creates and inserts a canvas element into the application container.
 *
 * The canvas is configured with:
 * - An accessibility label for screen readers
 * - An ID for easy querying
 *
 * @param app - The parent container element for the canvas
 * @returns The created canvas element
 * @throws Error if canvas creation fails
 */
function createCanvas(app: HTMLDivElement): HTMLCanvasElement {
  app.innerHTML =
    '<canvas id="sim-canvas" aria-label="Fluid simulation"></canvas>';
  const canvas = document.querySelector<HTMLCanvasElement>('#sim-canvas');
  if (!canvas) {
    throw new Error('Failed to create canvas element');
  }
  return canvas;
}

// =============================================================================
// Application Initialization
// =============================================================================

// Get the application container element
const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Missing #app container');

// Create the rendering canvas
const canvas = createCanvas(app);

// Initialize simulation configuration with default values.
// Spreads the base SPH config (particle count, bounds, gravity, etc.) then
// adds raymarch-specific parameters: density volume resolution, ray step sizes,
// floor tile colors, extinction coefficients, and refraction settings.
const config: RaymarchConfig = {
  ...createConfig(),
  viscosityStrength: 0.001,
  iterationsPerFrame: 2,
  densityTextureRes: 150,
  densityOffset: 200,
  densityMultiplier: 0.05,
  stepSize: 0.02,
  lightStepSize: 0.1,
  shadowSoftness: 1.0,
  maxSteps: 512,
  fluidColor: { r: 0.4, g: 0.7, b: 1.0 },
  tileCol1: { r: 126 / 255, g: 183 / 255, b: 231 / 255 }, // Blue
  tileCol2: { r: 210 / 255, g: 165 / 255, b: 240 / 255 }, // Purple
  tileCol3: { r: 153 / 255, g: 229 / 255, b: 199 / 255 }, // Green
  tileCol4: { r: 237 / 255, g: 225 / 255, b: 167 / 255 }, // Yellow
  tileColVariation: { x: 0, y: 0, z: 0 },
  tileScale: 1,
  tileDarkOffset: -0.35,
  tileDarkFactor: 0.5,
  floorAmbient: 0.58,
  sceneExposure: 1.1,
  debugFloorMode: 0,
  extinctionCoefficients: { x: 2.12, y: 0.43, z: 0.3 },
  indexOfRefraction: 1.33,
  numRefractions: 4,
  floorSize: { x: 80, y: 0.05, z: 80 },
  obstacleColor: { r: 1.0, g: 0.0, b: 0.0 },
  obstacleAlpha: 0.8,
  showBoundsWireframe: false,
  boundsWireframeColor: { r: 1.0, g: 1.0, b: 1.0 },
};

// Simulation instance (initialized asynchronously in main())
let simulation: FluidSimulation | null = null;

// Initialize the orbit camera with default view position
const camera = new OrbitCamera();
camera.radius = 28.0; // Moved back to see the whole water volume
camera.theta = 0.39; // Rotated 160 degrees from original position
camera.phi = 1.27; // Adjusted to match Unity (approx 72.7 degrees)

// Set up the GUI controls panel
const { stats, gui } = setupGui(
  config,
  {
    onReset: () => simulation?.reset(),
    onSmoothingRadiusChange: () => {},
  },
  {
    trackGPU: true, // Enable GPU timing statistics
    title: 'WebGPU 3D Fluid Raymarch',
    githubUrl: 'https://github.com/jeantimex/fluid',
  }
);

// ---------------------------------------------------------------------------
// Raymarch GUI Controls
// ---------------------------------------------------------------------------
// Adds a collapsible folder to the lil-gui panel exposing raymarch-specific
// parameters (density texture resolution, step size, max steps, tile colors).
// Color pickers use hex strings, bridged to normalized [0,1] via rgbToHex/hexToRgb.

const raymarchFolder = gui.addFolder('Raymarch');
raymarchFolder.close();
const fluidColorState = { fluidColor: rgbToHex(config.fluidColor) };
raymarchFolder
  .addColor(fluidColorState, 'fluidColor')
  .name('Fluid Color')
  .onChange((value: string) => {
    const rgb = hexToRgb(value);
    config.fluidColor.r = rgb.r / 255;
    config.fluidColor.g = rgb.g / 255;
    config.fluidColor.b = rgb.b / 255;
  });
raymarchFolder
  .add(config, 'densityTextureRes', 32, 256, 1)
  .name('Density Texture Res')
  .onFinishChange(() => simulation?.reset());
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

raymarchFolder
  .add(config, 'tileDarkFactor', 0.1, 0.9, 0.01)
  .name('Tile Dark Factor');

// Proxy state object holding hex-string versions of the tile colors.
// lil-gui's addColor binds to these strings; onChange callbacks convert
// back to normalized [0,1] and write into the config for the shader.
const tileColorState = {
  tileCol1: rgbToHex(config.tileCol1),
  tileCol2: rgbToHex(config.tileCol2),
  tileCol3: rgbToHex(config.tileCol3),
  tileCol4: rgbToHex(config.tileCol4),
};


raymarchFolder
  .addColor(tileColorState, 'tileCol1')
  .name('Tile Color 1')
  .onChange((value: string) => {
    const rgb = hexToRgb(value);
    config.tileCol1.r = rgb.r / 255;
    config.tileCol1.g = rgb.g / 255;
    config.tileCol1.b = rgb.b / 255;
  });

raymarchFolder
  .addColor(tileColorState, 'tileCol2')
  .name('Tile Color 2')
  .onChange((value: string) => {
    const rgb = hexToRgb(value);
    config.tileCol2.r = rgb.r / 255;
    config.tileCol2.g = rgb.g / 255;
    config.tileCol2.b = rgb.b / 255;
  });

raymarchFolder
  .addColor(tileColorState, 'tileCol3')
  .name('Tile Color 3')
  .onChange((value: string) => {
    const rgb = hexToRgb(value);
    config.tileCol3.r = rgb.r / 255;
    config.tileCol3.g = rgb.g / 255;
    config.tileCol3.b = rgb.b / 255;
  });

raymarchFolder
  .addColor(tileColorState, 'tileCol4')
  .name('Tile Color 4')
  .onChange((value: string) => {
    const rgb = hexToRgb(value);
    config.tileCol4.r = rgb.r / 255;
    config.tileCol4.g = rgb.g / 255;
    config.tileCol4.b = rgb.b / 255;
  });


/**
 * Main Application Entry Point
 *
 * Initializes WebGPU, creates the simulation, sets up event handlers,
 * and starts the main animation loop.
 *
 * ## Initialization Sequence
 *
 * 1. Initialize WebGPU (device, context, format)
 * 2. Configure the canvas context for rendering
 * 3. Create the FluidSimulation instance
 * 4. Set up input handlers for camera and particle interaction
 * 5. Set up window resize handler
 * 6. Start the animation loop
 *
 * ## Animation Loop
 *
 * Each frame:
 * 1. Calculate delta time (capped at 33ms to prevent instability)
 * 2. Run simulation step (may include multiple substeps)
 * 3. Render the current state
 * 4. Update stats display
 * 5. Request next frame
 */
async function main() {
  let device: GPUDevice;
  let context: GPUCanvasContext;
  let format: GPUTextureFormat;

  // -------------------------------------------------------------------------
  // WebGPU Initialization
  // -------------------------------------------------------------------------

  try {
    ({ device, context, format } = await initWebGPU(canvas));
  } catch (error) {
    if (error instanceof WebGPUInitError) {
      // Display user-friendly error message for WebGPU issues
      app!.innerHTML = `<p>${error.message}</p>`;
      return;
    }
    throw error;
  }

  // Configure the canvas context with the acquired device
  configureContext(context, device, format);

  // -------------------------------------------------------------------------
  // Simulation Setup
  // -------------------------------------------------------------------------

  simulation = new FluidSimulation(device, context, canvas, config, format);

  // Set up input handlers (camera control + particle interaction)
  const updateInertia = setupInputHandlers(
    canvas,
    () => simulation?.simulationState.input,
    camera,
    config
  );

  // -------------------------------------------------------------------------
  // Window Resize Handling
  // -------------------------------------------------------------------------

  /**
   * Handles window resize events.
   * Updates canvas dimensions and reconfigures the WebGPU context.
   */
  window.addEventListener('resize', () => {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    configureContext(context, device, format);
  });

  // Set initial canvas size
  const dpr = window.devicePixelRatio || 1;
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  configureContext(context, device, format);

  // -------------------------------------------------------------------------
  // Animation Loop
  // -------------------------------------------------------------------------

  /** Timestamp of the last frame for delta time calculation */
  let lastTime = performance.now();

  /**
   * Main animation loop callback.
   * Called by requestAnimationFrame at display refresh rate (typically 60Hz).
   *
   * @param now - Current timestamp in milliseconds
   */
  const frame = async (now: number) => {
    stats.begin(); // Start frame timing

    // Calculate delta time in seconds
    // Cap at 33ms (~30 FPS minimum) to prevent instability from large time steps
    const dt = Math.min(0.033, (now - lastTime) / 1000);
    lastTime = now;

    // Apply camera inertia (coasting after drag release)
    updateInertia();

    if (simulation) {
      // Run physics simulation step(s)
      await simulation.step(dt);

      // Render the current state with the camera transform
      simulation.render(camera);
    }

    stats.end(); // End frame timing
    stats.update(); // Update FPS display

    // Schedule next frame
    requestAnimationFrame(frame);
  };

  // Start the animation loop
  requestAnimationFrame(frame);
}

// Launch the application
main();
