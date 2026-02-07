/**
 * =============================================================================
 * WebGPU 3D Fluid Simulation (Screen-Space) - Application Entry Point
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
 *    │      ├─► FluidBuffers        (GPU memory management)
 *    │      ├─► SpatialGrid         (linear grid sorting)
 *    │      ├─► FluidPhysics        (SPH compute pipelines)
 *    │      ├─► FoamPipeline        (foam spawn/update)
 *    │      └─► Renderer            (screen-space visualization)
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
import { FluidSimulation } from './fluid_simulation.ts';
import type { ScreenSpaceConfig } from './types.ts';
import { OrbitCamera } from '../common/orbit_camera.ts';
import {
  initWebGPU,
  configureContext,
  WebGPUInitError,
} from '../common/webgpu_utils.ts';
import { setupInputHandlers } from '../common/input_handler.ts';

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
    '<canvas id="sim-canvas" aria-label="Fluid screen-space simulation"></canvas>';
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

// Initialize simulation configuration with default values
const config: ScreenSpaceConfig = {
  ...createConfig(),
  ...createDefaultEnvironmentConfig(),
  viscosityStrength: 0.01,
  iterationsPerFrame: 3,

  // Foam Settings (matching Unity exact values)
  foamSpawnRate: 70,
  trappedAirVelocityMin: 5,
  trappedAirVelocityMax: 25,
  foamKineticEnergyMin: 15,
  foamKineticEnergyMax: 80,
  bubbleBuoyancy: 1.4,
  bubbleScale: 0.3,
  foamLifetimeMin: 10,
  foamLifetimeMax: 30,
  waterColor: { r: 0.3, g: 0.9, b: 0.8 },
  deepWaterColor: { r: 0.02, g: 0.15, b: 0.45 },
  foamColor: { r: 0.95, g: 0.98, b: 1.0 },
  foamOpacity: 2.5,
  sprayClassifyMaxNeighbours: 5,
  bubbleClassifyMinNeighbours: 15,
  foamParticleRadius: 1.0,
  spawnRateFadeInTime: 0.75,
  spawnRateFadeStartTime: 0.1,
  bubbleChangeScaleSpeed: 7,

  // Rendering
  extinctionCoeff: { x: 2.12, y: 0.43, z: 0.3 },
  extinctionMultiplier: 2.24,
  refractionStrength: 9.15,
  shadowSoftness: 2.5,
  showFluidShadows: true,

  // Wireframe
  showBoundsWireframe: false,
  boundsWireframeColor: { r: 1.0, g: 1.0, b: 1.0 },

  // Obstacle
  obstacleColor: { r: 1.0, g: 0.0, b: 0.0 },
  obstacleAlpha: 1.0,
};

// Simulation instance (initialized asynchronously in main())
let simulation: FluidSimulation | null = null;

// Initialize the orbit camera with default view position
const camera = new OrbitCamera();
camera.radius = 30.0; // Distance from target
camera.theta = Math.PI / 6; // Original rotation
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
    title: 'WebGPU 3D Fluid',
    subtitle: 'SPH Fluid • Screen-Space Rendering',
    features: [
      'SPH Fluid Simulator (GPU)',
      'Multi-Pass Screen-Space Renderer',
      'Curvature-Flow Smoothing',
      'Foam & Spray Simulation',
      'Refraction & Beer-Lambert Law',
      'Bilateral Depth Filtering'
    ],
    interactions: [
      'Click & Drag (Background): Orbit Camera',
      'Click & Drag (Fluid): Pull Particles',
      'Shift + Click & Drag: Push Particles',
      'Mouse Wheel: Zoom In/Out'
    ],
    githubUrl: 'https://github.com/jeantimex/fluid',
  }
);

// Add particle radius control to the Particles folder
const particlesFolder = gui.folders.find((f) => f._title === 'Particles');
if (particlesFolder) {
  particlesFolder
    .add(config, 'particleRadius', 1, 5, 0.1)
    .name('Particle Radius');
}

// ---------------------------------------------------------------------------
// Foam GUI Controls (screen-space demo only)
// ---------------------------------------------------------------------------
const foamFolder = gui.addFolder('Foam');
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

// ---------------------------------------------------------------------------
// Screen-space GUI Controls
// ---------------------------------------------------------------------------
const renderingFolder = gui.addFolder('Screen Space');
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

const shadowFolder = gui.folders.find((f) => f._title === 'Shadow');
if (shadowFolder) {
  shadowFolder.add(config, 'showFluidShadows').name('Fluid Shadows');
}

renderingFolder.addColor(config, 'waterColor').name('Water Color');
renderingFolder.addColor(config, 'deepWaterColor').name('Deep Water Color');

let pauseController: any;
const guiState = {
  paused: false,
  togglePause: () => {
    guiState.paused = !guiState.paused;
    if (pauseController) {
      pauseController.name(guiState.paused ? 'Resume' : 'Pause');
    }
  },
  reset: () => simulation?.reset(),
};

// Add Pause and Reset Buttons at the end
pauseController = gui.add(guiState, 'togglePause').name(guiState.paused ? 'Resume' : 'Pause');
gui.add(guiState, 'reset').name('Reset Simulation');

// Debug GUI removed (screen-space demo only)

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
      if (!guiState.paused) {
        // Run physics simulation step(s)
        await simulation.step(dt);
      }

      // Render the current state with the camera's view matrix
      simulation.render(camera.viewMatrix);
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
