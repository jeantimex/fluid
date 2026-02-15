import { Scene } from '../canvas2d/types';

interface SimulateSceneOptions {
  enableObstacleCollision?: boolean;
}

export function simulateScene(scene: Scene, options: SimulateSceneOptions = {}) {
  if (scene.paused || !scene.fluid) return;

  const enableObstacleCollision = options.enableObstacleCollision ?? true;
  const obstacleRadius = enableObstacleCollision && scene.showObstacle ? scene.obstacleRadius : 0;
  const obstacleVelX = enableObstacleCollision ? scene.obstacleVelX : 0.0;
  const obstacleVelY = enableObstacleCollision ? scene.obstacleVelY : 0.0;

  scene.fluid.simulate(
    scene.dt,
    scene.gravity,
    scene.flipRatio,
    scene.numPressureIters,
    scene.numParticleIters,
    scene.overRelaxation,
    scene.compensateDrift,
    scene.separateParticles,
    scene.obstacleX,
    scene.obstacleY,
    obstacleRadius,
    obstacleVelX,
    obstacleVelY
  );
}
