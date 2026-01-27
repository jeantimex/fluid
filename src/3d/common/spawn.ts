/**
 * Particle spawning utilities for 3D simulations.
 */

import type { SimConfig, SpawnData, SpawnRegion, Vec3 } from './types.ts';

function randomInUnitSphere(): Vec3 {
  // Rejection sampling inside unit sphere.
  while (true) {
    const x = Math.random() * 2 - 1;
    const y = Math.random() * 2 - 1;
    const z = Math.random() * 2 - 1;
    const d2 = x * x + y * y + z * z;
    if (d2 > 0 && d2 <= 1) {
      return { x, y, z };
    }
  }
}

function calcParticlesPerAxis(region: SpawnRegion, density: number): number {
  const volume = region.size.x * region.size.y * region.size.z;
  const targetCount = Math.max(0, volume * density);
  const perAxis = Math.floor(Math.cbrt(targetCount));
  return Math.max(1, perAxis);
}

function spawnRegion(region: SpawnRegion, perAxis: number): Vec3[] {
  const points: Vec3[] = [];
  const nx = perAxis;
  const ny = perAxis;
  const nz = perAxis;

  const sx = region.size.x;
  const sy = region.size.y;
  const sz = region.size.z;

  for (let z = 0; z < nz; z += 1) {
    const tz = nz > 1 ? z / (nz - 1) : 0.5;
    const pz = (tz - 0.5) * sz + region.center.z;

    for (let y = 0; y < ny; y += 1) {
      const ty = ny > 1 ? y / (ny - 1) : 0.5;
      const py = (ty - 0.5) * sy + region.center.y;

      for (let x = 0; x < nx; x += 1) {
        const tx = nx > 1 ? x / (nx - 1) : 0.5;
        const px = (tx - 0.5) * sx + region.center.x;

        points.push({ x: px, y: py, z: pz });
      }
    }
  }

  return points;
}

export function createSpawnData(config: SimConfig): SpawnData {
  const positions: number[] = [];
  const velocities: number[] = [];

  for (let i = 0; i < config.spawnRegions.length; i += 1) {
    const region = config.spawnRegions[i];
    const perAxis = calcParticlesPerAxis(region, config.spawnDensity);
    const points = spawnRegion(region, perAxis);

    for (let p = 0; p < points.length; p += 1) {
      const base = points[p];
      const jitter = randomInUnitSphere();

      const px = base.x + jitter.x * config.jitterStr;
      const py = base.y + jitter.y * config.jitterStr;
      const pz = base.z + jitter.z * config.jitterStr;

      positions.push(px, py, pz);
      velocities.push(
        config.initialVelocity.x,
        config.initialVelocity.y,
        config.initialVelocity.z
      );
    }
  }

  const count = positions.length / 3;

  return {
    positions: new Float32Array(positions),
    velocities: new Float32Array(velocities),
    count,
  };
}
