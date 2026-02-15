/**
 * Scene Configuration and State
 *
 * This module manages the simulation configuration and UI state.
 */

export interface SceneConfig {
  // Simulation parameters
  gravity: number;
  dt: number;
  flipRatio: number;
  numPressureIters: number;
  numParticleIters: number;
  overRelaxation: number;
  compensateDrift: boolean;
  separateParticles: boolean;
  obstacleRadius: number;

  // Obstacle state
  obstacleX: number;
  obstacleY: number;
  obstacleVelX: number;
  obstacleVelY: number;

  // UI state
  showParticles: boolean;
  showGrid: boolean;
  paused: boolean;
  frameNr: number;
}

/**
 * Creates the default scene configuration.
 */
export function createScene(): SceneConfig {
  return {
    gravity: -9.81,
    dt: 1.0 / 60.0,
    flipRatio: 0.9,
    numPressureIters: 50,
    numParticleIters: 2,
    overRelaxation: 1.9,
    compensateDrift: true,
    separateParticles: true,
    obstacleRadius: 0.15,

    obstacleX: 0.0,
    obstacleY: 0.0,
    obstacleVelX: 0.0,
    obstacleVelY: 0.0,

    showParticles: true,
    showGrid: false,
    paused: true,
    frameNr: 0,
  };
}
