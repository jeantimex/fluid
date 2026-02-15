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

export function applyObstacleToScene(scene: Scene, x: number, y: number, reset: boolean) {
  let vx = 0.0;
  let vy = 0.0;
  if (!reset) {
    vx = (x - scene.obstacleX) / scene.dt;
    vy = (y - scene.obstacleY) / scene.dt;
  }
  scene.obstacleX = x;
  scene.obstacleY = y;

  const rObstacle = scene.showObstacle ? scene.obstacleRadius : 0;
  const fluid = scene.fluid;
  if (!fluid) return;

  const nY = fluid.numY;

  for (let i = 1; i < fluid.numX - 2; i++) {
    for (let j = 1; j < fluid.numY - 2; j++) {
      fluid.solidMask[i * nY + j] = 1.0;
      const dx = (i + 0.5) * fluid.cellSize - x;
      const dy = (j + 0.5) * fluid.cellSize - y;
      if (rObstacle > 0 && dx * dx + dy * dy < rObstacle * rObstacle) {
        fluid.solidMask[i * nY + j] = 0.0;
        fluid.velocityX[i * nY + j] = vx;
        fluid.velocityX[(i + 1) * nY + j] = vx;
        fluid.velocityY[i * nY + j] = vy;
        fluid.velocityY[i * nY + j + 1] = vy;
      }
    }
  }
  scene.obstacleVelX = vx;
  scene.obstacleVelY = vy;
}
