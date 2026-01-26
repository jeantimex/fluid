/**
 * Particle spawning utilities.
 *
 * This module handles the initial placement of particles in the simulation.
 * Particles are spawned in a regular grid pattern within defined regions,
 * with small random jitter to break symmetry and prevent artificial patterns.
 *
 * Proper initial particle placement is important because:
 * - Uniform spacing prevents initial pressure spikes
 * - Jitter breaks numerical symmetry that could cause artifacts
 * - Grid density determines the effective resolution of the fluid
 */

import type { SimConfig, SpawnData, Vec2 } from './types.ts';

/**
 * Creates a deterministic pseudo-random number generator.
 *
 * Uses a Linear Congruential Generator (LCG) algorithm, which produces
 * a sequence of pseudo-random numbers based on a seed value. The same
 * seed always produces the same sequence, ensuring reproducible results.
 *
 * LCG formula: next = (a * current + c) mod m
 * - a = 1664525 (multiplier)
 * - c = 1013904223 (increment)
 * - m = 2^32 (modulus, implicit via >>> 0)
 *
 * These specific constants are from Numerical Recipes and have good
 * statistical properties for this simple generator.
 *
 * @param seed - Initial seed value (integer)
 * @returns Function that returns next random number in [0, 1)
 */
function createRng(seed: number): () => number {
  let state = seed >>> 0; // Convert to unsigned 32-bit integer

  return () => {
    // LCG iteration with well-known constants
    state = (1664525 * state + 1013904223) >>> 0;

    // Normalize to [0, 1) range
    return state / 4294967296; // 2^32
  };
}

/**
 * Calculates optimal grid dimensions for particle spawning.
 *
 * Given a region size and target density, this function determines how
 * many particles to place along each axis to achieve approximately uniform
 * coverage with the requested particle count.
 *
 * The algorithm:
 * 1. Calculate total particle count from area × density
 * 2. Distribute particles proportionally to width/height ratio
 * 3. Round up to ensure full coverage
 *
 * This produces a grid where particles are roughly equidistant in both
 * dimensions, regardless of the region's aspect ratio.
 *
 * @param size - Width and height of the spawn region
 * @param spawnDensity - Target particles per unit area
 * @returns Number of particles along X and Y axes
 */
function calculateSpawnCountPerAxis(size: Vec2, spawnDensity: number): Vec2 {
  const area = size.x * size.y;
  const targetTotal = Math.ceil(area * spawnDensity);

  // Calculate proportional distribution
  const lenSum = size.x + size.y;
  const tx = size.x / lenSum; // X proportion
  const ty = size.y / lenSum; // Y proportion

  // Solve for grid dimensions: nx * ny ≈ targetTotal, nx/ny ≈ tx/ty
  const m = Math.sqrt(targetTotal / (tx * ty));
  const nx = Math.ceil(tx * m);
  const ny = Math.ceil(ty * m);

  return { x: nx, y: ny };
}

/**
 * Internal interface for spawn region definition.
 */
interface Region {
  position: Vec2;
  size: Vec2;
}

/**
 * Generates particle positions within a rectangular region.
 *
 * Creates a uniform grid of points centered on the region's position.
 * Points are distributed evenly from edge to edge of the region.
 *
 * For a region of size (w, h) centered at (cx, cy):
 * - X coordinates range from (cx - w/2) to (cx + w/2)
 * - Y coordinates range from (cy - h/2) to (cy + h/2)
 *
 * @param region - Region definition with position and size
 * @param spawnDensity - Particles per unit area
 * @returns Array of 2D positions on a regular grid
 */
function spawnInRegion(region: Region, spawnDensity: number): Vec2[] {
  const size = region.size;
  const center = region.position;
  const count = calculateSpawnCountPerAxis(size, spawnDensity);
  const points: Vec2[] = new Array(count.x * count.y);
  let i = 0;

  for (let y = 0; y < count.y; y += 1) {
    for (let x = 0; x < count.x; x += 1) {
      // Normalize grid coordinates to [0, 1] range
      // Handle edge case where count is 1 (single particle centered)
      const tx = count.x === 1 ? 0.5 : x / (count.x - 1);
      const ty = count.y === 1 ? 0.5 : y / (count.y - 1);

      // Map to world coordinates centered on region
      const px = (tx - 0.5) * size.x + center.x;
      const py = (ty - 0.5) * size.y + center.y;

      points[i] = { x: px, y: py };
      i += 1;
    }
  }

  return points;
}

/**
 * Creates initial particle data for the simulation.
 *
 * This is the main entry point for particle spawning. It:
 * 1. Generates grid positions for each spawn region
 * 2. Applies random jitter to break symmetry
 * 3. Packs positions and velocities into typed arrays
 *
 * The jitter is applied as a small random displacement in a random
 * direction. This prevents perfectly aligned particles which could
 * cause numerical artifacts in the pressure solver.
 *
 * The RNG is seeded with a fixed value (42) for reproducibility.
 * Each simulation reset produces identical initial conditions.
 *
 * @param config - Simulation configuration with spawn parameters
 * @returns SpawnData containing position/velocity arrays and count
 *
 * @example
 * const config = createConfig()
 * const spawn = createSpawnData(config)
 * console.log(`Spawned ${spawn.count} particles`)
 */
export function createSpawnData(config: SimConfig): SpawnData {
  // Create deterministic RNG for reproducible results
  const rng = createRng(42);
  const allPoints: Vec2[] = [];

  // Generate particles for each spawn region
  for (const region of config.spawnRegions) {
    const points = spawnInRegion(region, config.spawnDensity);

    // Apply random jitter to each point
    for (const p of points) {
      // Random direction (0 to 2π)
      const angle = rng() * Math.PI * 2;
      const dirX = Math.cos(angle);
      const dirY = Math.sin(angle);

      // Random magnitude centered at zero (-jitterStr/2 to +jitterStr/2)
      const jitter = (rng() - 0.5) * config.jitterStr;

      allPoints.push({
        x: p.x + dirX * jitter,
        y: p.y + dirY * jitter,
      });
    }
  }

  // Pack into typed arrays for efficient memory access
  const count = allPoints.length;
  const positions = new Float32Array(count * 2); // Interleaved [x0, y0, x1, y1, ...]
  const velocities = new Float32Array(count * 2);

  for (let i = 0; i < count; i += 1) {
    positions[i * 2] = allPoints[i].x;
    positions[i * 2 + 1] = allPoints[i].y;
    velocities[i * 2] = config.initialVelocity.x;
    velocities[i * 2 + 1] = config.initialVelocity.y;
  }

  return { positions, velocities, count };
}
