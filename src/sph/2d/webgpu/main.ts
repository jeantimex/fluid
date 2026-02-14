/**
 * WebGPU Fluid Simulation - Entry Point
 *
 * This is the main entry point for the WebGPU-accelerated fluid simulation.
 * It handles:
 * - Canvas creation and sizing
 * - WebGPU initialization
 * - Mouse input handling for particle interaction
 * - Window resize handling
 * - The main animation loop
 *
 * The simulation uses SPH (Smoothed Particle Hydrodynamics) to simulate
 * realistic fluid behavior with thousands of particles rendered in real-time.
 *
 * User Interaction:
 * - Left mouse button: Pull/attract particles toward cursor
 * - Right mouse button: Push/repel particles away from cursor
 * - GUI controls: Adjust simulation parameters in real-time
 */

import './style.css';
import { createConfig } from '../common/config.ts';
import { setupGui } from '../common/gui.ts';
import { FluidSimulation } from './fluid_simulation.ts';
import {
  initWebGPU,
  configureContext,
  WebGPUInitError,
} from './webgpu_utils.ts';
import type { SimConfig, InputState } from '../common/types.ts';

// ============================================================================
// Canvas Helpers
// ============================================================================

/**
 * Creates a canvas element inside the app container.
 *
 * The canvas is used for WebGPU rendering. It's created with an aria-label
 * for accessibility.
 *
 * @param app - The container element to insert the canvas into
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

/**
 * Converts canvas (screen) coordinates to world (simulation) coordinates.
 *
 * The simulation uses a coordinate system where:
 * - Origin (0, 0) is at the center of the canvas
 * - X increases to the right
 * - Y increases upward (opposite of screen coordinates)
 * - Units are in simulation world space (not pixels)
 *
 * @param canvas - The canvas element for dimension calculations
 * @param clientX - Mouse X position in client (viewport) coordinates
 * @param clientY - Mouse Y position in client (viewport) coordinates
 * @param scale - Pixels per world unit (canvas.width / boundsSize.x)
 * @returns World coordinates { x, y }
 */
function canvasToWorld(
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
  scale: number
): { x: number; y: number } {
  // Get canvas position on screen
  const rect = canvas.getBoundingClientRect();

  // Account for device pixel ratio (for high-DPI displays)
  const dpr = window.devicePixelRatio || 1;

  // Convert client coordinates to canvas pixel coordinates
  const px = (clientX - rect.left) * dpr;
  const py = (clientY - rect.top) * dpr;

  // Canvas center is the origin in world space
  const originX = canvas.width * 0.5;
  const originY = canvas.height * 0.5;

  // Convert to world coordinates
  // Note: Y is inverted (screen Y increases downward, world Y increases upward)
  return {
    x: (px - originX) / scale,
    y: (originY - py) / scale,
  };
}

/**
 * Sets up pointer input handlers for particle interaction.
 *
 * Handles:
 * - pointermove: Update cursor position in world coordinates
 * - pointerdown: Start pull (left button) or push (right button)
 * - pointerup: Stop pull/push
 * - pointerleave: Stop all interaction when cursor leaves canvas
 * - contextmenu: Prevent right-click menu
 *
 * @param canvas - The canvas element to attach handlers to
 * @param getInput - Function to get the current input state (may be undefined during init)
 * @param getScale - Function to get the current world-to-pixel scale
 */
function setupInputHandlers(
  canvas: HTMLCanvasElement,
  getInput: () => InputState | undefined,
  getScale: () => number
): void {
  /**
   * Updates the input state with the current pointer position in world coordinates.
   */
  const updatePointer = (event: PointerEvent): void => {
    const input = getInput();
    if (!input) return;

    // Convert pointer position to world coordinates
    const world = canvasToWorld(
      canvas,
      event.clientX,
      event.clientY,
      getScale()
    );
    input.worldX = world.x;
    input.worldY = world.y;

    // Prevent default browser behaviors like scrolling/zooming
    if (event.cancelable) {
      event.preventDefault();
    }
  };

  // Track pointer position as it moves
  canvas.addEventListener('pointermove', updatePointer);

  // Handle pointer button press
  canvas.addEventListener('pointerdown', (event) => {
    const input = getInput();
    if (!input) return;

    // Prevent default browser behaviors like scrolling/zooming
    if (event.cancelable) {
      event.preventDefault();
    }

    // Update position first
    updatePointer(event);

    // Left button (0) = pull/attract particles
    if (event.button === 0) input.pull = true;
    // Right button (2) = push/repel particles
    if (event.button === 2) input.push = true;
  });

  // Handle pointer button release
  canvas.addEventListener('pointerup', (event) => {
    const input = getInput();
    if (!input) return;

    if (event.button === 0) input.pull = false;
    if (event.button === 2) input.push = false;
  });

  // Stop interaction when pointer leaves canvas
  canvas.addEventListener('pointerleave', () => {
    const input = getInput();
    if (!input) return;

    input.pull = false;
    input.push = false;
  });

  // Prevent right-click context menu on canvas
  canvas.addEventListener('contextmenu', (event) => {
    event.preventDefault();
  });
}

/**
 * Sets up canvas resize handling for responsive display.
 *
 * When the window is resized, this handler:
 * 1. Updates canvas pixel dimensions (accounting for device pixel ratio)
 * 2. Maintains the simulation's aspect ratio by scaling boundsSize
 * 3. Reconfigures the WebGPU context for the new size
 *
 * The baseUnitsPerPixel is calculated on first resize to maintain
 * consistent world-space scaling regardless of initial window size.
 *
 * @param canvas - The canvas element to resize
 * @param config - Simulation config (boundsSize will be updated)
 * @param context - WebGPU context to reconfigure
 * @param device - WebGPU device for context configuration
 * @param format - Texture format for context configuration
 * @returns The resize function (call immediately after setup)
 */
function setupResizeHandler(
  canvas: HTMLCanvasElement,
  config: SimConfig,
  context: GPUCanvasContext,
  device: GPUDevice,
  format: GPUTextureFormat
): () => void {
  // Store the initial units-per-pixel ratio to maintain consistent scaling
  let baseUnitsPerPixel: number | null = null;

  const resize = (): void => {
    // Get the canvas's CSS dimensions
    const rect = canvas.getBoundingClientRect();

    // Calculate base scaling on first resize
    if (baseUnitsPerPixel === null) {
      baseUnitsPerPixel = config.boundsSize.x / Math.max(1, rect.width);
    }

    // Account for high-DPI displays
    const dpr = window.devicePixelRatio || 1;

    // Calculate new canvas dimensions in pixels
    const nextWidth = Math.max(1, Math.round(rect.width * dpr));
    const nextHeight = Math.max(1, Math.round(rect.height * dpr));

    // Only update if dimensions actually changed
    if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
      // Update canvas pixel dimensions
      canvas.width = nextWidth;
      canvas.height = nextHeight;

      // Update simulation bounds to match new aspect ratio
      // This keeps the world-space scale consistent
      config.boundsSize = {
        x: (canvas.width / dpr) * baseUnitsPerPixel,
        y: (canvas.height / dpr) * baseUnitsPerPixel,
      };

      // Reconfigure WebGPU context for new canvas size
      configureContext(context, device, format);
    }
  };

  // Listen for window resize events
  window.addEventListener('resize', resize);

  // Return the resize function for immediate use
  return resize;
}

// ============================================================================
// Main Application
// ============================================================================

// Get the app container element
const app = document.querySelector<HTMLDivElement>('#app');
if (!app) {
  throw new Error('Missing #app container');
}

// Create canvas for rendering
const canvas = createCanvas(app);

// Create simulation configuration with default parameters
const config = createConfig();

// Simulation instance (initialized asynchronously)
let simulation: FluidSimulation | null = null;

// Setup GUI controls and performance stats
// trackGPU: true enables GPU timing measurements in stats-gl
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

const { stats, gui } = setupGui(
  config,
  {
    // Callback when reset button is clicked
    onReset: () => simulation?.reset(),
    // Callback when smoothing radius changes (requires physics refresh)
    onSmoothingRadiusChange: () => simulation?.refreshSettings(),
  },
  {
    trackGPU: true,
    title: 'WebGPU 2D Fluid',
    subtitle: 'SPH Fluid • Particle Simulation',
    features: [
      'SPH Fluid Simulator (GPU)',
      'WebGPU Compute Pipelines',
      'Bitonic Sort Optimization',
      'Spatial Grid Optimization',
      'High-Performance Rendering',
    ],
    interactions: [
      'Click & Drag: Pull Particles',
      'Right Click & Drag: Push Particles',
      'Mouse Wheel: Zoom In/Out',
    ],
    githubUrl: 'https://github.com/jeantimex/fluid',
  }
);

// Add Pause and Reset Buttons at the end
pauseController = gui.add(guiState, 'togglePause').name(guiState.paused ? 'Resume' : 'Pause');
gui.add(guiState, 'reset').name('Reset Simulation');

/**
 * Main initialization and animation loop.
 *
 * This async function:
 * 1. Initializes WebGPU
 * 2. Creates the fluid simulation
 * 3. Sets up input and resize handlers
 * 4. Starts the animation loop
 */
async function main(): Promise<void> {
  // ========================================================================
  // Initialize WebGPU
  // ========================================================================
  let device: GPUDevice;
  let context: GPUCanvasContext;
  let format: GPUTextureFormat;

  try {
    // Attempt to initialize WebGPU
    ({ device, context, format } = await initWebGPU(canvas));
  } catch (error) {
    // Show user-friendly error message if WebGPU is not supported
    if (error instanceof WebGPUInitError) {
      app!.innerHTML = `<p>${error.message}</p>`;
      return;
    }
    // Re-throw unexpected errors
    throw error;
  }

  // ========================================================================
  // Create Simulation
  // ========================================================================
  simulation = new FluidSimulation(device, context, canvas, config, format);

  // ========================================================================
  // Setup Input and Resize Handlers
  // ========================================================================

  // Scale function for coordinate conversion
  const getScale = (): number => canvas.width / config.boundsSize.x;

  // Setup mouse input for particle interaction
  setupInputHandlers(canvas, () => simulation?.simulationState.input, getScale);

  // Setup window resize handling and trigger initial resize
  const resize = setupResizeHandler(canvas, config, context, device, format);
  resize();

  // ========================================================================
  // Animation Loop
  // ========================================================================

  // Track time for delta time calculation
  let lastTime = performance.now();

  /**
   * Main animation frame callback.
   * Called every frame via requestAnimationFrame.
   *
   * @param now - Current timestamp in milliseconds
   */
  const frame = async (now: number): Promise<void> => {
    // Start performance measurement
    stats.begin();

    // Calculate delta time in seconds, capped at 33ms (~30 FPS minimum)
    // This prevents simulation instability from large time steps
    const dt = Math.min(0.033, (now - lastTime) / 1000);
    lastTime = now;

    if (!guiState.paused) {
      // Advance simulation by one frame
      await simulation!.step(dt);
    }

    // Always render current state
    simulation!.render();

    // End performance measurement and update display
    stats.end();
    stats.update();

    // Request next frame
    requestAnimationFrame(frame);
  };

  // Start the animation loop
  requestAnimationFrame(frame);
}

// Start the application
// Using void to explicitly ignore the Promise return value
void main();
