import type { SimConfig } from './types.ts';

export function createConfig(): SimConfig {
  return {
    timeScale: 1,
    maxTimestepFPS: 60,
    iterationsPerFrame: 3,
    gravity: -10,
    collisionDamping: 0.95,
    smoothingRadius: 0.2,
    targetDensity: 630,
    pressureMultiplier: 288,
    nearPressureMultiplier: 2.15,
    viscosityStrength: 0,
    
    boundsSize: { x: 3, y: 3, z: 3 },
    obstacleSize: { x: 0, y: 0, z: 0 },
    obstacleCentre: { x: 0, y: 0, z: 0 },
    
    interactionRadius: 0.5,
    interactionStrength: 50,
    
    particleRadius: 0.02, 
    spawnDensity: 630, 
    
    initialVelocity: { x: 0, y: 0, z: 0 },
    jitterStr: 0.005,
    
    spawnRegions: [{ position: { x: 0, y: 0, z: 0 }, size: { x: 2.5, y: 2.5, z: 2.5 } }],
  };
}
