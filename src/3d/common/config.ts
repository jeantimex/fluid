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

    interactionRadius: 2,
    interactionStrength: 90,

    particleRadius: 2.5, // In pixels, same as 2D
    // Unity Fluid Particles scene: particleSpawnDensity = 600
    spawnDensity: 600,
    velocityDisplayMax: 6.5,
    screenSpaceDebugMode: 4,
    gradientResolution: 64,

    colorKeys: [
      { t: 4064 / 65535, r: 0.13363299, g: 0.34235913, b: 0.7264151 }, // Slow: blue
      { t: 33191 / 65535, r: 0.2980392, g: 1, b: 0.56327766 }, // Medium: cyan-green
      { t: 46738 / 65535, r: 1, g: 0.9309917, b: 0 }, // Fast: yellow
      { t: 1, r: 0.96862745, g: 0.28555763, b: 0.031372573 }, // Very fast: orange
    ],

    initialVelocity: { x: 0, y: 0, z: 0 },
    jitterStr: 0.035,

    // Match Unity Fluid Particles scene spawn regions
    spawnRegions: [
      { position: { x: -8.3, y: -1.3, z: 3.65 }, size: { x: 7, y: 7, z: 7 } },
      { position: { x: -8.3, y: -1.3, z: -3.65 }, size: { x: 7, y: 7, z: 7 } },
    ],

    // Foam Settings (matching Unity exact values)
    foamSpawnRate: 70,
    trappedAirVelocityMin: 5,
    trappedAirVelocityMax: 25,
    foamKineticEnergyMin: 15,
    foamKineticEnergyMax: 80,
    bubbleBuoyancy: 1.4,
    bubbleScale: 0.3,
    foamLifetimeMin: 10,
    foamLifetimeMax: 30,
    foamColor: { r: 0.95, g: 0.98, b: 1.0 },
    foamOpacity: 2.5,
    sprayClassifyMaxNeighbours: 5,
    bubbleClassifyMinNeighbours: 15,
    extinctionCoeff: { x: 2.12, y: 0.43, z: 0.3 },
    extinctionMultiplier: 2.24,
    refractionStrength: 9.15,
    foamParticleRadius: 1.0,
    spawnRateFadeInTime: 0.75,
    spawnRateFadeStartTime: 0.1,
    bubbleChangeScaleSpeed: 7,
  };
}
