import { Scene } from '../canvas2d/types';

export function simulateScene(scene: Scene) {
  if (scene.paused || !scene.fluid) return;

  const obstacleRadius = scene.showObstacle ? scene.obstacleRadius : 0;
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
    scene.obstacleVelX,
    scene.obstacleVelY
  );
}
