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
import { createDefaultEnvironmentConfig } from '../common/environment.ts';
import { setupGui } from '../common/gui.ts';

import { rgbToHex, hexToRgb } from '../common/color_utils.ts';
import { FluidSimulation } from './fluid_simulation.ts';
import { OrbitCamera } from '../webgpu_particles/orbit_camera.ts';
import {
  initWebGPU,
  configureContext,
  WebGPUInitError,
} from '../webgpu_particles/webgpu_utils.ts';
import { setupInputHandlers } from '../webgpu_particles/input_handler.ts';
import type { MarchingCubesConfig } from './types.ts';

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
// adds marching-cubes-specific parameters: density volume resolution + iso level.
const config: MarchingCubesConfig = {
  ...createConfig(),
  ...createDefaultEnvironmentConfig(),
  timeScale: 1.0,
  boundsSize: { x: 16, y: 12, z: 8 },
  spawnRegions: [{ position: { x: 3.92, y: -1.94, z: 0 }, size: { x: 7, y: 7, z: 7 } }],
  viscosityStrength: 0.001,
  iterationsPerFrame: 3,
  nearPressureMultiplier: 2.25,
  densityTextureRes: 150,
  isoLevel: 75,
  surfaceColor: { r: 15 / 255, g: 91 / 255, b: 234 / 255 },
  shadowSoftness: 1.0,
  showParticleShadows: true,
  showBoundsWireframe: false,
  boundsWireframeColor: { r: 1.0, g: 1.0, b: 1.0 },
};

// Simulation instance (initialized asynchronously in main())
let simulation: FluidSimulation | null = null;

// Initialize the orbit camera with default view position
const camera = new OrbitCamera();
camera.radius = 30.0; // Distance from target
camera.theta = Math.PI / 6; // 30 degrees horizontal rotation
camera.phi = Math.PI / 2.5; // ~72 degrees from vertical (looking slightly down)

// Set up the GUI controls panel
const { stats, gui } = setupGui(
  config,
  {
    onReset: () => simulation?.reset(),
    onSmoothingRadiusChange: () => {},
  },
  {
    trackGPU: true, // Enable GPU timing statistics
    title: 'WebGPU 3D Fluid Marching Cubes',
    githubUrl: 'https://github.com/jeantimex/fluid',
  }
);

// Add Unity-style time scale toggle (normal/slow)
const performanceFolder = gui.folders.find((folder) => (folder as any)._title === 'Performance');
if (performanceFolder) {
  const timeMode = { mode: 'Normal' };
  performanceFolder
    .add(timeMode, 'mode', { Normal: 'Normal', Slow: 'Slow' })
    .name('Time Mode')
    .onChange((value: string) => {
      config.timeScale = value === 'Slow' ? 0.2 : 1.0;
    });
}

// ---------------------------------------------------------------------------
// Marching Cubes GUI Controls
// ---------------------------------------------------------------------------
const marchingFolder = gui.addFolder('Marching Cubes');
marchingFolder.close();
marchingFolder
  .add(config, 'densityTextureRes', 32, 256, 1)
  .name('Density Texture Res')
  .onFinishChange(() => simulation?.reset());
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

marchingFolder
  .add(config, 'showParticleShadows')
  .name('Show Shadows');

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
  let lastTime: number | null = null;

  /**
   * Main animation loop callback.
   * Called by requestAnimationFrame at display refresh rate (typically 60Hz).
   *
   * @param now - Current timestamp in milliseconds
   */
  const frame = async (now: number) => {
    if (lastTime === null) lastTime = now;
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
