/**
 * Application entry point and main loop.
 *
 * This module initializes the fluid simulation and sets up:
 * - Canvas element in the DOM
 * - GUI controls for real-time parameter adjustment
 * - Performance monitoring (FPS counter)
 * - Animation loop with delta-time handling
 *
 * The simulation runs continuously using requestAnimationFrame, which:
 * - Syncs with display refresh rate (typically 60 Hz)
 * - Pauses when tab is not visible (saves CPU/battery)
 * - Provides high-precision timestamps for smooth animation
 */

import './style.css';
import { createSim } from './sim.ts';
import { setupGui } from '../common/gui.ts';

// === DOM Setup ===
// Create canvas element inside the #app container
document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <canvas id="sim-canvas" aria-label="Fluid simulation"></canvas>
`;

// Get canvas reference and create simulation
const canvas = document.querySelector<HTMLCanvasElement>('#sim-canvas')!;
const sim = createSim(canvas);

// === GUI Setup ===
let pauseController: any;
const guiState = {
  paused: false,
  togglePause: () => {
    guiState.paused = !guiState.paused;
    if (pauseController) {
      pauseController.name(guiState.paused ? 'Resume' : 'Pause');
    }
  },
  reset: () => sim.reset(),
};

const { stats, gui } = setupGui(
  sim.config,
  {
    onReset: () => sim.reset(),
    onSmoothingRadiusChange: () => sim.refreshSettings(),
  },
  {
    trackGPU: false,
    title: 'Canvas 2D Fluid',
    subtitle: 'SPH Fluid • Particle Simulation',
    features: [
      'SPH Fluid Simulator',
      'Canvas 2D Rendering',
      'Direct Pixel Manipulation',
      'Spatial Grid Optimization',
      'Box Obstacle Interaction',
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
pauseController = gui
  .add(guiState, 'togglePause')
  .name(guiState.paused ? 'Resume' : 'Pause');
gui.add(guiState, 'reset').name('Reset Simulation');

// === Animation Loop ===

/**
 * Timestamp of the previous frame (milliseconds).
 * Used to calculate delta time for physics integration.
 */
let lastTime = performance.now();

/**
 * Main animation frame callback.
 *
 * This function is called by requestAnimationFrame at approximately 60 Hz
 * (or the display's refresh rate). It:
 * 1. Calculates time elapsed since last frame
 * 2. Advances the physics simulation
 * 3. Renders the current state
 * 4. Updates performance statistics
 * 5. Schedules the next frame
 *
 * Delta time is capped at 33ms (30 FPS equivalent) to prevent the simulation
 * from "exploding" if there's a long pause (e.g., browser tab switching).
 *
 * @param now - High-precision timestamp from requestAnimationFrame (ms)
 */
function frame(now: number): void {
  // Begin stats measurement
  stats.begin();

  // Calculate delta time in seconds, capped for stability
  const dt = Math.min(0.033, (now - lastTime) / 1000);
  lastTime = now;

  if (!guiState.paused) {
    // Run simulation step
    sim.step(dt);
  }

  // Always draw the current state
  sim.draw();

  // End stats measurement and update display
  stats.end();
  stats.update();

  // Schedule next frame
  requestAnimationFrame(frame);
}

// Start the animation loop
requestAnimationFrame(frame);
