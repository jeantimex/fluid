/**
 * Shared GUI setup for simulation controls.
 *
 * This module creates the lil-gui control panel and stats display
 * used by both canvas2d and webgpu implementations.
 */

import GUI, { Controller } from 'lil-gui';
import Stats from 'stats-gl';
import type { SimConfig } from './types.ts';

/**
 * Calculates the total particle count based on spawn regions and density.
 * This replicates the logic from spawn.ts to show accurate counts in the GUI.
 */
function calculateParticleCount(config: SimConfig): number {
  let total = 0;
  for (const region of config.spawnRegions) {
    const area = region.size.x * region.size.y;
    const targetTotal = Math.ceil(area * config.spawnDensity);

    // Replicate grid calculation from spawn.ts
    const lenSum = region.size.x + region.size.y;
    const tx = region.size.x / lenSum;
    const ty = region.size.y / lenSum;
    const m = Math.sqrt(targetTotal / (tx * ty));
    const nx = Math.ceil(tx * m);
    const ny = Math.ceil(ty * m);

    total += nx * ny;
  }
  return total;
}

export interface GuiCallbacks {
  onReset: () => void;
  onSmoothingRadiusChange: () => void;
}

export interface GuiOptions {
  trackGPU?: boolean;
}

export interface GuiSetup {
  gui: GUI;
  stats: Stats;
  uiState: { showStats: boolean };
}

/**
 * Creates the GUI control panel and stats display.
 *
 * @param config - The simulation config object to bind controls to
 * @param callbacks - Handlers for reset and settings changes
 * @param options - Optional settings (e.g., trackGPU for stats)
 */
export function setupGui(
  config: SimConfig,
  callbacks: GuiCallbacks,
  options: GuiOptions = {}
): GuiSetup {
  const gui = new GUI({ title: 'Simulation Settings' });
  const stats = new Stats({
    trackGPU: options.trackGPU ?? false,
    horizontal: true,
  });
  stats.dom.style.display = 'none';
  document.body.appendChild(stats.dom);

  const uiState = { showStats: false };

  // === Particles Folder ===
  const particlesFolder = gui.addFolder('Particles');
  particlesFolder.close();

  // Display object for particle count (updated dynamically)
  const display = { particleCount: calculateParticleCount(config) };

  // Helper to update particle count display
  const updateParticleCount = (): void => {
    display.particleCount = calculateParticleCount(config);
    particleCountController.updateDisplay();
  };

  particlesFolder
    .add(config, 'spawnDensity', 10, 300, 1)
    .name('Spawn Density')
    .onFinishChange(() => {
      updateParticleCount();
      callbacks.onReset();
    });

  // Particle count display (read-only)
  const particleCountController: Controller = particlesFolder
    .add(display, 'particleCount')
    .name('Particle Count')
    .disable();

  particlesFolder.add(config, 'gravity', -30, 30, 1).name('Gravity');

  particlesFolder
    .add(config, 'collisionDamping', 0, 1, 0.01)
    .name('Collision Damping');

  particlesFolder
    .add(config, 'smoothingRadius', 0.05, 3, 0.01)
    .name('Smoothing Radius')
    .onChange(() => callbacks.onSmoothingRadiusChange());

  particlesFolder
    .add(config, 'targetDensity', 0, 3000, 1)
    .name('Target Density');

  particlesFolder
    .add(config, 'pressureMultiplier', 0, 2000, 1)
    .name('Pressure Multiplier');

  particlesFolder
    .add(config, 'nearPressureMultiplier', 0, 40, 0.1)
    .name('Near Pressure Multiplier');

  particlesFolder
    .add(config, 'viscosityStrength', 0, 0.2, 0.001)
    .name('Viscosity Strength');

  particlesFolder
    .add(config, 'particleRadius', 1, 5, 0.1)
    .name('Particle Radius');

  // === Obstacle Folder ===
  const obstacleFolder = gui.addFolder('Obstacle');
  obstacleFolder.close();

  obstacleFolder.add(config.obstacleSize, 'x', 0, 20, 0.01).name('Size X');
  obstacleFolder.add(config.obstacleSize, 'y', 0, 20, 0.01).name('Size Y');
  obstacleFolder
    .add(config.obstacleCentre, 'x', -10, 10, 0.01)
    .name('Center X');
  obstacleFolder
    .add(config.obstacleCentre, 'y', -10, 10, 0.01)
    .name('Center Y');

  // === Interaction Folder ===
  const interactionFolder = gui.addFolder('Interaction');
  interactionFolder.close();

  interactionFolder
    .add(config, 'interactionRadius', 0, 10, 0.01)
    .name('Radius');
  interactionFolder
    .add(config, 'interactionStrength', 0, 200, 1)
    .name('Strength');

  // === Performance Folder ===
  const performanceFolder = gui.addFolder('Performance');
  performanceFolder.close();

  performanceFolder.add(config, 'timeScale', 0, 2, 0.01).name('Time Scale');
  performanceFolder
    .add(config, 'maxTimestepFPS', 0, 120, 1)
    .name('Max Timestep FPS');
  performanceFolder
    .add(config, 'iterationsPerFrame', 1, 8, 1)
    .name('Iterations Per Frame');
  performanceFolder
    .add(uiState, 'showStats')
    .name('Show FPS')
    .onChange((value: boolean) => {
      stats.dom.style.display = value ? 'block' : 'none';
    });

  return { gui, stats, uiState };
}
