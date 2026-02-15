import { Scene } from '../canvas2d/types';

export function createDefaultScene(): Scene {
  return {
    gravity: -9.81,
    dt: 1.0 / 120.0,
    flipRatio: 0.9,
    numPressureIters: 100,
    numParticleIters: 2,
    overRelaxation: 1.9,
    compensateDrift: true,
    separateParticles: true,
    obstacleX: 0.0,
    obstacleY: 0.0,
    obstacleRadius: 0.15,
    paused: false,
    obstacleVelX: 0.0,
    obstacleVelY: 0.0,
    showParticles: true,
    showGrid: false,
    showObstacle: true,
    particleCount: 15000,
    particleRadiusScale: 0.3,
    fluid: null,
  };
}
