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
import GUI from 'lil-gui';
import Stats from 'stats-gl';
import { createSim } from './sim.ts';

// === DOM Setup ===
// Create canvas element inside the #app container
document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <canvas id="sim-canvas" aria-label="Fluid simulation"></canvas>
`;

// Get canvas reference and create simulation
const canvas = document.querySelector<HTMLCanvasElement>('#sim-canvas')!;
const sim = createSim(canvas);

// === GUI Setup ===
// lil-gui provides a lightweight control panel for adjusting simulation parameters
const gui = new GUI({ title: 'Simulation Settings' });

// stats-gl provides FPS and performance monitoring
const stats = new Stats({ trackGPU: false, horizontal: true });
stats.dom.style.display = 'none';
document.body.appendChild(stats.dom);

// UI state for controlling stats visibility
const uiState = { showStats: false };

// === Parameter Controls ===
// Each control binds to a config property and optionally triggers callbacks

const particlesFolder = gui.addFolder('Particles');

// Spawn density control - requires simulation reset to take effect
particlesFolder
  .add(sim.config, 'spawnDensity', 10, 300, 1)
  .name('Spawn Density')
  .onFinishChange(() => sim.reset()); // Reset when slider is released

// Gravity control - affects simulation immediately
particlesFolder.add(sim.config, 'gravity', -30, 30, 1).name('Gravity');

// Collision damping - how much energy is lost on boundary collision
particlesFolder
  .add(sim.config, 'collisionDamping', 0, 1, 0.01)
  .name('Collision Damping');

// Smoothing radius - requires kernel recalculation
const smoothingCtrl = particlesFolder
  .add(sim.config, 'smoothingRadius', 0.05, 3, 0.01)
  .name('Smoothing Radius')
  .onChange(sim.refreshSettings); // Recalculate kernel constants

// Target density - rest density the fluid tries to maintain
const targetDensityCtrl = particlesFolder
  .add(sim.config, 'targetDensity', 0, 3000, 1)
  .name('Target Density');

// Pressure multiplier - stiffness of the fluid
const pressureCtrl = particlesFolder
  .add(sim.config, 'pressureMultiplier', 0, 2000, 1)
  .name('Pressure Multiplier');

// Near pressure - close-range repulsion for surface tension
const nearPressureCtrl = particlesFolder
  .add(sim.config, 'nearPressureMultiplier', 0, 40, 0.1)
  .name('Near Pressure Multiplier');

// Viscosity - internal friction (higher = thicker fluid)
const viscosityCtrl = particlesFolder
  .add(sim.config, 'viscosityStrength', 0, 0.2, 0.001)
  .name('Viscosity Strength');

// Particle radius - visual size, also triggers parameter scaling
const particleRadiusCtrl = particlesFolder
  .add(sim.config, 'particleRadius', 1, 6, 1)
  .name('Particle Radius');

// When particle radius changes, scale related parameters to maintain behavior
particleRadiusCtrl.onChange(() => {
  sim.applyParticleScale();

  // Update GUI displays to show new computed values
  smoothingCtrl.updateDisplay();
  targetDensityCtrl.updateDisplay();
  pressureCtrl.updateDisplay();
  nearPressureCtrl.updateDisplay();
  viscosityCtrl.updateDisplay();
});

// Obstacle controls
const obstacleFolder = gui.addFolder('Obstacle');
obstacleFolder.close();

obstacleFolder.add(sim.config.obstacleSize, 'x', 0, 20, 0.01).name('Size X');
obstacleFolder.add(sim.config.obstacleSize, 'y', 0, 20, 0.01).name('Size Y');
obstacleFolder
  .add(sim.config.obstacleCentre, 'x', -10, 10, 0.01)
  .name('Center X');
obstacleFolder
  .add(sim.config.obstacleCentre, 'y', -10, 10, 0.01)
  .name('Center Y');

const performanceFolder = gui.addFolder('Performance');
performanceFolder.close();

// Time scale - slow motion or speed up
performanceFolder.add(sim.config, 'timeScale', 0, 2, 0.01).name('Time Scale');

// Maximum timestep - prevents instability on frame drops
performanceFolder
  .add(sim.config, 'maxTimestepFPS', 0, 120, 1)
  .name('Max Timestep FPS');

// Iterations per frame - more = more accurate but slower
performanceFolder
  .add(sim.config, 'iterationsPerFrame', 1, 8, 1)
  .name('Iterations Per Frame');

// Toggle FPS display
performanceFolder
  .add(uiState, 'showStats')
  .name('Show FPS')
  .onChange((value: boolean) => {
    stats.dom.style.display = value ? 'block' : 'none';
  });

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

  // Run simulation step and render
  sim.step(dt);
  sim.draw();

  // End stats measurement and update display
  stats.end();
  stats.update();

  // Schedule next frame
  requestAnimationFrame(frame);
}

// Start the animation loop
requestAnimationFrame(frame);
