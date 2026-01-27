import type { SimConfig } from './types.ts';

export function createConfig(): SimConfig {
  return {
    timeScale: 1,
    maxTimestepFPS: 60,
    iterationsPerFrame: 2,
    gravity: -12,
    collisionDamping: 0.95,
    smoothingRadius: 0.2,
    targetDensity: 630,
    pressureMultiplier: 288,
    nearPressureMultiplier: 2.16,
    viscosityStrength: 0,

    boundsSize: { x: 3, y: 3, z: 6 },
    obstacleSize: { x: 0, y: 0, z: 0 },
    obstacleCentre: { x: 0, y: 0, z: 0 },

    interactionRadius: 2,
    interactionStrength: 90,

    particleRadius: 2.5,  // In pixels, same as 2D
    // Unity Fluid Particles scene: particleSpawnDensity = 600
    spawnDensity: 600, 
    velocityDisplayMax: 6.5,
    gradientResolution: 64,

    colorKeys: [
      { t: 4064 / 65535, r: 0.13363299, g: 0.34235913, b: 0.7264151 }, // Slow: blue
      { t: 33191 / 65535, r: 0.2980392, g: 1, b: 0.56327766 }, // Medium: cyan-green
      { t: 46738 / 65535, r: 1, g: 0.9309917, b: 0 }, // Fast: yellow
      { t: 1, r: 0.96862745, g: 0.28555763, b: 0.031372573 }, // Very fast: orange
    ],
    
    initialVelocity: { x: 0, y: 0, z: 0 },
    jitterStr: 0.035,
    
    // Reduced spawn volume (~5k particles at density 600), centered within bounds
    spawnRegions: [
      { position: { x: 0, y: 0, z: 1.5 }, size: { x: 1.6, y: 1.6, z: 1.6 } },
      { position: { x: 0, y: 0, z: -1.5 }, size: { x: 1.6, y: 1.6, z: 1.6 } },
    ],
  };
}
