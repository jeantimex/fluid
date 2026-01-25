// Deterministic LCG for spawn jitter.
function createRng(seed) {
  let state = seed >>> 0
  return () => {
    state = (1664525 * state + 1013904223) >>> 0
    return state / 4294967296
  }
}

function calculateSpawnCountPerAxis(size, spawnDensity) {
  const area = size.x * size.y
  const targetTotal = Math.ceil(area * spawnDensity)
  const lenSum = size.x + size.y
  const tx = size.x / lenSum
  const ty = size.y / lenSum
  const m = Math.sqrt(targetTotal / (tx * ty))
  const nx = Math.ceil(tx * m)
  const ny = Math.ceil(ty * m)
  return { x: nx, y: ny }
}

function spawnInRegion(region, spawnDensity) {
  const size = region.size
  const center = region.position
  const count = calculateSpawnCountPerAxis(size, spawnDensity)
  const points = new Array(count.x * count.y)
  let i = 0

  for (let y = 0; y < count.y; y += 1) {
    for (let x = 0; x < count.x; x += 1) {
      const tx = count.x === 1 ? 0.5 : x / (count.x - 1)
      const ty = count.y === 1 ? 0.5 : y / (count.y - 1)
      const px = (tx - 0.5) * size.x + center.x
      const py = (ty - 0.5) * size.y + center.y
      points[i] = { x: px, y: py }
      i += 1
    }
  }

  return points
}

export function createSpawnData(config) {
  const rng = createRng(42)
  const allPoints = []

  for (const region of config.spawnRegions) {
    const points = spawnInRegion(region, config.spawnDensity)
    for (const p of points) {
      const angle = rng() * Math.PI * 2
      const dirX = Math.cos(angle)
      const dirY = Math.sin(angle)
      const jitter = (rng() - 0.5) * config.jitterStr
      allPoints.push({
        x: p.x + dirX * jitter,
        y: p.y + dirY * jitter,
      })
    }
  }

  const count = allPoints.length
  const positions = new Float32Array(count * 2)
  const velocities = new Float32Array(count * 2)

  for (let i = 0; i < count; i += 1) {
    positions[i * 2] = allPoints[i].x
    positions[i * 2 + 1] = allPoints[i].y
    velocities[i * 2] = config.initialVelocity.x
    velocities[i * 2 + 1] = config.initialVelocity.y
  }

  return { positions, velocities, count }
}
