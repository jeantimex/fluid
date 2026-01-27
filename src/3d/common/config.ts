/**
 * Configuration factory for the 3D SPH fluid simulation.
 */

import type { SimConfig } from './types.ts';

export function createConfig(): SimConfig {
  return {
    // === Time Integration ===
    timeScale: 1,
    maxTimestepFPS: 60,
    iterationsPerFrame: 3,

    // === Forces ===
    gravity: -10,

    // === Collision Response ===
    collisionDamping: 0.95,

    // === SPH Core Parameters ===
    smoothingRadius: 0.2,
    targetDensity: 630,
    pressureMultiplier: 288,
    nearPressureMultiplier: 2.16,
    viscosityStrength: 0,

    // === Simulation Bounds ===
    boundsSize: { x: 24, y: 10, z: 15 },
    boundsCenter: { x: 0, y: 0, z: 0 },

    // === Interaction ===
    interactionRadius: 2,
    interactionStrength: 90,

    // === Visualization ===
    velocityDisplayMax: 8,
    particleRadius: 0.04,
    gradientResolution: 50,
    colorKeys: [
      { t: 4064 / 65535, r: 0.13363299, g: 0.34235913, b: 0.7264151 },
      { t: 33191 / 65535, r: 0.2980392, g: 1, b: 0.56327766 },
      { t: 46738 / 65535, r: 1, g: 0.9309917, b: 0 },
      { t: 1, r: 0.96862745, g: 0.28555763, b: 0.031372573 },
    ],

    // === Particle Spawning ===
    spawnDensity: 600,
    initialVelocity: { x: 0, y: 0, z: 0 },
    jitterStr: 0.035,
    spawnRegions: [
      {
        center: { x: -8.3, y: -1.3, z: 3.65 },
        size: { x: 7, y: 7, z: 7 },
      },
      {
        center: { x: -8.3, y: -1.3, z: -3.65 },
        size: { x: 7, y: 7, z: 7 },
      },
    ],
  };
}
