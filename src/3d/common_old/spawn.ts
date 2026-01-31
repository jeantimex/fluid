import type { SimConfig, SpawnData, Vec3 } from './types.ts';

function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function calculateSpawnCountPerAxis(size: Vec3, spawnDensity: number): Vec3 {
  // Match 2D approach: spawnDensity = particles per unit volume
  // Total particles = volume * density
  const volume = size.x * size.y * size.z;
  const targetTotal = Math.ceil(volume * spawnDensity);

  // Distribute proportionally: nx:ny:nz = sx:sy:sz
  // nx * ny * nz = targetTotal
  // nx = k * sx, ny = k * sy, nz = k * sz
  // k^3 * sx * sy * sz = targetTotal
  // k = cbrt(targetTotal / volume)
  const k = Math.pow(targetTotal / volume, 1.0 / 3.0);

  return {
    x: Math.max(1, Math.ceil(size.x * k)),
    y: Math.max(1, Math.ceil(size.y * k)),
    z: Math.max(1, Math.ceil(size.z * k)),
  };
}

interface Region {
  position: Vec3;
  size: Vec3;
}

function spawnInRegion(region: Region, spawnDensity: number): Vec3[] {
  const size = region.size;
  const center = region.position;
  const count = calculateSpawnCountPerAxis(size, spawnDensity);
  const points: Vec3[] = new Array(count.x * count.y * count.z);
  let i = 0;

  for (let z = 0; z < count.z; z += 1) {
    for (let y = 0; y < count.y; y += 1) {
      for (let x = 0; x < count.x; x += 1) {
        const tx = count.x === 1 ? 0.5 : x / (count.x - 1);
        const ty = count.y === 1 ? 0.5 : y / (count.y - 1);
        const tz = count.z === 1 ? 0.5 : z / (count.z - 1);

        const px = (tx - 0.5) * size.x + center.x;
        const py = (ty - 0.5) * size.y + center.y;
        const pz = (tz - 0.5) * size.z + center.z;

        points[i] = { x: px, y: py, z: pz };
        i += 1;
      }
    }
  }

  return points;
}

export function createSpawnData(config: SimConfig): SpawnData {
  const rng = createRng(42);
  const allPoints: Vec3[] = [];

  for (const region of config.spawnRegions) {
    const points = spawnInRegion(region, config.spawnDensity);
    for (const p of points) {
      // Jitter
      // Random vector in unit sphere
      // Simplified: independent jitter per axis
      const jx = (rng() - 0.5) * config.jitterStr;
      const jy = (rng() - 0.5) * config.jitterStr;
      const jz = (rng() - 0.5) * config.jitterStr;

      allPoints.push({
        x: p.x + jx,
        y: p.y + jy,
        z: p.z + jz,
      });
    }
  }

  const count = allPoints.length;
  // Stride 4 (x,y,z,w)
  const positions = new Float32Array(count * 4);
  const velocities = new Float32Array(count * 4);

  for (let i = 0; i < count; i += 1) {
    const idx = i * 4;
    positions[idx] = allPoints[i].x;
    positions[idx + 1] = allPoints[i].y;
    positions[idx + 2] = allPoints[i].z;
    positions[idx + 3] = 1.0; // w = 1 for position

    velocities[idx] = config.initialVelocity.x;
    velocities[idx + 1] = config.initialVelocity.y;
    velocities[idx + 2] = config.initialVelocity.z;
    velocities[idx + 3] = 0.0; // w = 0 for velocity
  }

  return { positions, velocities, count };
}
