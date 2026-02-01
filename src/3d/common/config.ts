import type { SimConfig } from './types.ts';

export function createConfig(): SimConfig {
  return {
    timeScale: 2,
    maxTimestepFPS: 60,
    iterationsPerFrame: 3,
    gravity: -10,
    collisionDamping: 0.95,
    smoothingRadius: 0.2,
    targetDensity: 630,
    pressureMultiplier: 288,
    nearPressureMultiplier: 2.16,
    viscosityStrength: 0.001,

    boundsSize: { x: 24, y: 10, z: 15 },
    obstacleSize: { x: 0, y: 0, z: 0 },
    obstacleCentre: { x: 0, y: -2, z: 0 },
    obstacleRotation: { x: 0, y: 0, z: 0 },
    obstacleColor: { r: 1.0, g: 0.0, b: 0.0 },
    obstacleAlpha: 0.8,

    interactionRadius: 2,
    interactionStrength: 90,

    particleRadius: 2.5, // In pixels, same as 2D
    // Unity Fluid Particles scene: particleSpawnDensity = 600
    spawnDensity: 600,

    initialVelocity: { x: 0, y: 0, z: 0 },
    jitterStr: 0.035,

    // Match Unity Fluid Particles scene spawn regions
    spawnRegions: [
      { position: { x: -8.3, y: -1.3, z: 3.65 }, size: { x: 7, y: 7, z: 7 } },
      { position: { x: -8.3, y: -1.3, z: -3.65 }, size: { x: 7, y: 7, z: 7 } },
    ],
  };
}
