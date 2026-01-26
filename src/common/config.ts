/**
 * Configuration factory for the SPH fluid simulation.
 *
 * This module provides default configuration values that produce a visually
 * appealing water-like fluid simulation. The parameters are tuned to balance
 * realism, stability, and performance.
 */

import type { SimConfig } from './types.ts';

/**
 * Creates a new configuration object with default simulation parameters.
 *
 * The default values are calibrated to simulate a water-like fluid with:
 * - Moderate viscosity (flows freely but not too thin)
 * - Good incompressibility (responds to pressure without excessive compression)
 * - Stable behavior at 60 FPS with 2 substeps per frame
 *
 * @returns A new SimConfig object with default values
 */
export function createConfig(): SimConfig {
  return {
    // === Time Integration ===
    timeScale: 1, // Real-time simulation
    maxTimestepFPS: 60, // Cap timestep at 1/60s for stability
    iterationsPerFrame: 2, // 2 substeps balances accuracy vs performance

    // === Forces ===
    gravity: 12, // Positive values pull downward

    // === Collision Response ===
    collisionDamping: 0.95, // Slight energy loss on boundary collision

    // === SPH Core Parameters ===
    // These are the most important parameters for fluid behavior.
    // They are interconnected and tuned together.
    smoothingRadius: 0.35, // Interaction radius (h) in world units
    targetDensity: 55, // Rest density (ρ₀) - what the fluid "wants" to be
    pressureMultiplier: 500, // Stiffness (k) - resistance to compression
    nearPressureMultiplier: 5, // Surface tension approximation
    viscosityStrength: 0.03, // Internal friction (μ)

    // === Simulation Bounds ===
    boundsSize: { x: 17.1, y: 9.3 }, // World size (updated on canvas resize)
    obstacleSize: { x: 0, y: 0 }, // No obstacle by default
    obstacleCentre: { x: 0, y: 0 },

    // === User Interaction ===
    interactionRadius: 2, // Mouse influence radius in world units
    interactionStrength: 90, // Force magnitude for push/pull

    // === Visualization ===
    velocityDisplayMax: 6.5, // Velocity that maps to max gradient color
    particleRadius: 3, // Particle size in pixels
    boundsPaddingPx: 10, // Boundary inset in pixels
    gradientResolution: 64, // Color LUT size

    // Velocity-to-color gradient (blue → green → yellow → orange)
    // These colors create a "heat map" effect based on particle speed
    colorKeys: [
      { t: 4064 / 65535, r: 0.13363299, g: 0.34235913, b: 0.7264151 }, // Slow: blue
      { t: 33191 / 65535, r: 0.2980392, g: 1, b: 0.56327766 }, // Medium: cyan-green
      { t: 46738 / 65535, r: 1, g: 0.9309917, b: 0 }, // Fast: yellow
      { t: 1, r: 0.96862745, g: 0.28555763, b: 0.031372573 }, // Very fast: orange
    ],

    // === Particle Spawning ===
    spawnDensity: 129, // Particles per unit area
    initialVelocity: { x: 0, y: 0 }, // Start at rest
    jitterStr: 0.03, // Small random offset to break symmetry

    // Default spawn region: centered horizontally, slightly above center
    spawnRegions: [{ position: { x: 0, y: 0.66 }, size: { x: 6.42, y: 4.39 } }],
  };
}
