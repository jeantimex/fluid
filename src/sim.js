function createConfig() {
  return {
    timeScale: 1,
    maxTimestepFPS: 60,
    iterationsPerFrame: 2,
    gravity: -12,
    collisionDamping: 0.95,
    smoothingRadius: 0.35,
    targetDensity: 55,
    pressureMultiplier: 500,
    nearPressureMultiplier: 5,
    viscosityStrength: 0.03,
    boundsSize: { x: 17.1, y: 9.3 },
    obstacleSize: { x: 0, y: 0 },
    obstacleCentre: { x: 0, y: 0 },
    interactionRadius: 2,
    interactionStrength: 90,
    velocityDisplayMax: 6.5,
    particleRadius: 2,
    boundsPaddingPx: 10,
    gradientResolution: 64,
    colorKeys: [
      { t: 4064 / 65535, r: 0.13363299, g: 0.34235913, b: 0.7264151 },
      { t: 33191 / 65535, r: 0.2980392, g: 1, b: 0.56327766 },
      { t: 46738 / 65535, r: 1, g: 0.9309917, b: 0 },
      { t: 1, r: 0.96862745, g: 0.28555763, b: 0.031372573 },
    ],
    spawnDensity: 129,
    initialVelocity: { x: 0, y: 0 },
    jitterStr: 0.03,
    spawnRegions: [
      { position: { x: 0, y: 0.66 }, size: { x: 6.42, y: 4.39 } },
    ],
  }
}

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

function createSpawnData(config) {
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

const hashK1 = 15823
const hashK2 = 9737333
const neighborOffsets = [
  [-1, 1],
  [0, 1],
  [1, 1],
  [-1, 0],
  [0, 0],
  [1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
]

function hashCell2D(cellX, cellY) {
  const ax = Math.imul(cellX | 0, hashK1)
  const by = Math.imul(cellY | 0, hashK2)
  return (ax + by) >>> 0
}

function smoothingKernelPoly6(dst, radius, scale) {
  if (dst < radius) {
    const v = radius * radius - dst * dst
    return v * v * v * scale
  }
  return 0
}

function spikyKernelPow3(dst, radius, scale) {
  if (dst < radius) {
    const v = radius - dst
    return v * v * v * scale
  }
  return 0
}

function spikyKernelPow2(dst, radius, scale) {
  if (dst < radius) {
    const v = radius - dst
    return v * v * scale
  }
  return 0
}

function derivativeSpikyPow3(dst, radius, scale) {
  if (dst <= radius) {
    const v = radius - dst
    return -v * v * scale
  }
  return 0
}

function derivativeSpikyPow2(dst, radius, scale) {
  if (dst <= radius) {
    const v = radius - dst
    return -v * scale
  }
  return 0
}

function buildGradientLut(keys, resolution) {
  const sorted = [...keys].sort((a, b) => a.t - b.t)
  const lut = new Array(resolution)
  for (let i = 0; i < resolution; i += 1) {
    const t = resolution === 1 ? 0 : i / (resolution - 1)
    let left = sorted[0]
    let right = sorted[sorted.length - 1]
    for (let k = 0; k < sorted.length - 1; k += 1) {
      const a = sorted[k]
      const b = sorted[k + 1]
      if (t >= a.t && t <= b.t) {
        left = a
        right = b
        break
      }
    }
    const span = right.t - left.t || 1
    const localT = (t - left.t) / span
    const r = left.r + (right.r - left.r) * localT
    const g = left.g + (right.g - left.g) * localT
    const b = left.b + (right.b - left.b) * localT
    lut[i] = { r, g, b }
  }
  return lut
}

export function createSim(canvas) {
  const ctx = canvas.getContext('2d')
  const config = createConfig()
  const spawn = createSpawnData(config)
  const count = spawn.count
  const gradientLut = buildGradientLut(
    config.colorKeys,
    config.gradientResolution
  )
  let imageData = ctx.createImageData(canvas.width, canvas.height)
  let pixelBuffer = imageData.data
  const state = {
    positions: spawn.positions,
    predicted: new Float32Array(spawn.positions),
    velocities: spawn.velocities,
    densities: new Float32Array(count * 2),
    keys: new Uint32Array(count),
    sortedKeys: new Uint32Array(count),
    indices: new Uint32Array(count),
    sortOffsets: new Uint32Array(count),
    spatialOffsets: new Uint32Array(count),
    positionsSorted: new Float32Array(count * 2),
    predictedSorted: new Float32Array(count * 2),
    velocitiesSorted: new Float32Array(count * 2),
    count,
    lastDt: 0,
    input: {
      worldX: 0,
      worldY: 0,
      pull: false,
      push: false,
    },
  }

  let baseUnitsPerPixel = null
  let bounds = config.boundsSize
  let scale = canvas.width / bounds.x
  let originX = canvas.width * 0.5
  let originY = canvas.height * 0.5

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect()
    const nextWidth = Math.max(1, Math.round(rect.width))
    const nextHeight = Math.max(1, Math.round(rect.height))
    if (baseUnitsPerPixel === null) {
      const refWidth = Math.max(1, rect.width)
      baseUnitsPerPixel = config.boundsSize.x / refWidth
    }
    if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
      canvas.width = nextWidth
      canvas.height = nextHeight
      imageData = ctx.createImageData(canvas.width, canvas.height)
      pixelBuffer = imageData.data
    }

    config.boundsSize = {
      x: canvas.width * baseUnitsPerPixel,
      y: canvas.height * baseUnitsPerPixel,
    }
    bounds = config.boundsSize
    scale = canvas.width / bounds.x
    originX = canvas.width * 0.5
    originY = canvas.height * 0.5
  }

  resizeCanvas()
  window.addEventListener('resize', resizeCanvas)

  function worldToCanvas(x, y) {
    return {
      x: originX + x * scale,
      y: originY - y * scale,
    }
  }

  function canvasToWorld(x, y) {
    return {
      x: (x - originX) / scale,
      y: (originY - y) / scale,
    }
  }

  function installInputHandlers() {
    const updatePointer = (event) => {
      const rect = canvas.getBoundingClientRect()
      const px = event.clientX - rect.left
      const py = event.clientY - rect.top
      const world = canvasToWorld(px, py)
      state.input.worldX = world.x
      state.input.worldY = world.y
    }

    canvas.addEventListener('mousemove', updatePointer)
    canvas.addEventListener('mousedown', (event) => {
      updatePointer(event)
      if (event.button === 0) state.input.pull = true
      if (event.button === 2) state.input.push = true
    })
    canvas.addEventListener('mouseup', (event) => {
      if (event.button === 0) state.input.pull = false
      if (event.button === 2) state.input.push = false
    })
    canvas.addEventListener('mouseleave', () => {
      state.input.pull = false
      state.input.push = false
    })
    canvas.addEventListener('contextmenu', (event) => {
      event.preventDefault()
    })
  }

  installInputHandlers()

  let radius = config.smoothingRadius
  let radiusSq = radius * radius
  let poly6Scale = 4 / (Math.PI * Math.pow(radius, 8))
  let spikyPow3Scale = 10 / (Math.PI * Math.pow(radius, 5))
  let spikyPow2Scale = 6 / (Math.PI * Math.pow(radius, 4))
  let spikyPow3DerivScale = 30 / (Math.PI * Math.pow(radius, 5))
  let spikyPow2DerivScale = 12 / (Math.PI * Math.pow(radius, 4))
  let stampRadius = -1
  let stampOffsets = []

  function refreshSettings() {
    radius = config.smoothingRadius
    radiusSq = radius * radius
    poly6Scale = 4 / (Math.PI * Math.pow(radius, 8))
    spikyPow3Scale = 10 / (Math.PI * Math.pow(radius, 5))
    spikyPow2Scale = 6 / (Math.PI * Math.pow(radius, 4))
    spikyPow3DerivScale = 30 / (Math.PI * Math.pow(radius, 5))
    spikyPow2DerivScale = 12 / (Math.PI * Math.pow(radius, 4))
  }

  function rebuildStamp() {
    const nextRadius = Math.max(1, Math.round(config.particleRadius))
    if (nextRadius === stampRadius) return
    stampRadius = nextRadius
    const offsets = []
    const r2 = stampRadius * stampRadius
    for (let oy = -stampRadius; oy <= stampRadius; oy += 1) {
      for (let ox = -stampRadius; ox <= stampRadius; ox += 1) {
        if (ox * ox + oy * oy <= r2) {
          offsets.push([ox, oy])
        }
      }
    }
    stampOffsets = offsets
  }

  function reset() {
    const nextSpawn = createSpawnData(config)
    const nextCount = nextSpawn.count
    state.positions = nextSpawn.positions
    state.predicted = new Float32Array(nextSpawn.positions)
    state.velocities = nextSpawn.velocities
    state.densities = new Float32Array(nextCount * 2)
    state.keys = new Uint32Array(nextCount)
    state.sortedKeys = new Uint32Array(nextCount)
    state.indices = new Uint32Array(nextCount)
    state.sortOffsets = new Uint32Array(nextCount)
    state.spatialOffsets = new Uint32Array(nextCount)
    state.positionsSorted = new Float32Array(nextCount * 2)
    state.predictedSorted = new Float32Array(nextCount * 2)
    state.velocitiesSorted = new Float32Array(nextCount * 2)
    state.count = nextCount
  }

  function externalForcesStep(dt) {
    const positions = state.positions
    const predicted = state.predicted
    const velocities = state.velocities
    const pull = state.input.pull
    const push = state.input.push
    const interactionStrength = push
      ? -config.interactionStrength
      : pull
        ? config.interactionStrength
        : 0
    const inputX = state.input.worldX
    const inputY = state.input.worldY
    const inputRadius = config.interactionRadius
    const inputRadiusSq = inputRadius * inputRadius

    for (let i = 0; i < state.count; i += 1) {
      const idx = i * 2
      let vx = velocities[idx]
      let vy = velocities[idx + 1]

      let ax = 0
      let ay = config.gravity
      if (interactionStrength !== 0) {
        const dx = inputX - positions[idx]
        const dy = inputY - positions[idx + 1]
        const sqrDst = dx * dx + dy * dy
        if (sqrDst < inputRadiusSq) {
          const dst = Math.sqrt(sqrDst)
          const edgeT = dst / inputRadius
          const centreT = 1 - edgeT
          const invDst = dst > 0 ? 1 / dst : 0
          const dirX = dx * invDst
          const dirY = dy * invDst
          const gravityWeight = 1 - centreT * Math.min(1, interactionStrength / 10)
          ax = ax * gravityWeight + dirX * centreT * interactionStrength - vx * centreT
          ay = ay * gravityWeight + dirY * centreT * interactionStrength - vy * centreT
        }
      }

      vx += ax * dt
      vy += ay * dt

      velocities[idx] = vx
      velocities[idx + 1] = vy

      const predictionFactor = 1 / 120
      predicted[idx] = positions[idx] + vx * predictionFactor
      predicted[idx + 1] = positions[idx + 1] + vy * predictionFactor
    }
  }

  function runSpatialHash() {
    const count = state.count
    const predicted = state.predicted
    const keys = state.keys
    const sortedKeys = state.sortedKeys
    const indices = state.indices
    const sortOffsets = state.sortOffsets

    sortOffsets.fill(0)
    for (let i = 0; i < count; i += 1) {
      const idx = i * 2
      const cellX = Math.floor(predicted[idx] / radius)
      const cellY = Math.floor(predicted[idx + 1] / radius)
      const hash = hashCell2D(cellX, cellY)
      const key = hash % count
      keys[i] = key
      sortOffsets[key] += 1
    }

    let sum = 0
    for (let k = 0; k < count; k += 1) {
      const c = sortOffsets[k]
      sortOffsets[k] = sum
      sum += c
    }

    for (let i = 0; i < count; i += 1) {
      const key = keys[i]
      const dest = sortOffsets[key]
      sortOffsets[key] = dest + 1
      indices[dest] = i
      sortedKeys[dest] = key
    }

    const positions = state.positions
    const velocities = state.velocities
    const positionsSorted = state.positionsSorted
    const predictedSorted = state.predictedSorted
    const velocitiesSorted = state.velocitiesSorted

    for (let i = 0; i < count; i += 1) {
      const src = indices[i] * 2
      const dst = i * 2
      positionsSorted[dst] = positions[src]
      positionsSorted[dst + 1] = positions[src + 1]
      predictedSorted[dst] = predicted[src]
      predictedSorted[dst + 1] = predicted[src + 1]
      velocitiesSorted[dst] = velocities[src]
      velocitiesSorted[dst + 1] = velocities[src + 1]
    }

    state.positions = positionsSorted
    state.predicted = predictedSorted
    state.velocities = velocitiesSorted
    state.positionsSorted = positions
    state.predictedSorted = predicted
    state.velocitiesSorted = velocities

    const spatialOffsets = state.spatialOffsets
    spatialOffsets.fill(count)
    for (let i = 0; i < count; i += 1) {
      if (i === 0 || sortedKeys[i] !== sortedKeys[i - 1]) {
        spatialOffsets[sortedKeys[i]] = i
      }
    }
  }

  function calculateDensities() {
    const count = state.count
    const predicted = state.predicted
    const densities = state.densities
    const sortedKeys = state.sortedKeys
    const spatialOffsets = state.spatialOffsets

    for (let i = 0; i < count; i += 1) {
      const idx = i * 2
      const posX = predicted[idx]
      const posY = predicted[idx + 1]
      const originCellX = Math.floor(posX / radius)
      const originCellY = Math.floor(posY / radius)

      let density = 0
      let nearDensity = 0

      for (let n = 0; n < neighborOffsets.length; n += 1) {
        const offset = neighborOffsets[n]
        const cellX = originCellX + offset[0]
        const cellY = originCellY + offset[1]
        const key = hashCell2D(cellX, cellY) % count
        let currIndex = spatialOffsets[key]

        while (currIndex < count) {
          const neighbourKey = sortedKeys[currIndex]
          if (neighbourKey !== key) break

          const nIdx = currIndex * 2
          const dx = predicted[nIdx] - posX
          const dy = predicted[nIdx + 1] - posY
          const sqrDst = dx * dx + dy * dy

          if (sqrDst <= radiusSq) {
            const dst = Math.sqrt(sqrDst)
            density += spikyKernelPow2(dst, radius, spikyPow2Scale)
            nearDensity += spikyKernelPow3(dst, radius, spikyPow3Scale)
          }

          currIndex += 1
        }
      }

      densities[idx] = density
      densities[idx + 1] = nearDensity
    }
  }

  function calculatePressure(dt) {
    const count = state.count
    const predicted = state.predicted
    const velocities = state.velocities
    const densities = state.densities
    const sortedKeys = state.sortedKeys
    const spatialOffsets = state.spatialOffsets

    for (let i = 0; i < count; i += 1) {
      const idx = i * 2
      const density = densities[idx]
      const nearDensity = densities[idx + 1]
      if (density <= 0) continue

      const pressure = (density - config.targetDensity) * config.pressureMultiplier
      const nearPressure = config.nearPressureMultiplier * nearDensity

      const posX = predicted[idx]
      const posY = predicted[idx + 1]
      const originCellX = Math.floor(posX / radius)
      const originCellY = Math.floor(posY / radius)

      let forceX = 0
      let forceY = 0

      for (let n = 0; n < neighborOffsets.length; n += 1) {
        const offset = neighborOffsets[n]
        const cellX = originCellX + offset[0]
        const cellY = originCellY + offset[1]
        const key = hashCell2D(cellX, cellY) % count
        let currIndex = spatialOffsets[key]

        while (currIndex < count) {
          const neighbourKey = sortedKeys[currIndex]
          if (neighbourKey !== key) break
          if (currIndex !== i) {
            const nIdx = currIndex * 2
            const dx = predicted[nIdx] - posX
            const dy = predicted[nIdx + 1] - posY
            const sqrDst = dx * dx + dy * dy

            if (sqrDst <= radiusSq) {
              const dst = Math.sqrt(sqrDst)
              const invDst = dst > 0 ? 1 / dst : 0
              const dirX = dx * invDst
              const dirY = dy * invDst

              const neighbourDensity = densities[nIdx]
              const neighbourNearDensity = densities[nIdx + 1]
              const neighbourPressure =
                (neighbourDensity - config.targetDensity) *
                config.pressureMultiplier
              const neighbourNearPressure =
                config.nearPressureMultiplier * neighbourNearDensity
              const sharedPressure = (pressure + neighbourPressure) * 0.5
              const sharedNearPressure =
                (nearPressure + neighbourNearPressure) * 0.5

              if (neighbourDensity > 0) {
                const scale =
                  derivativeSpikyPow2(dst, radius, spikyPow2DerivScale) *
                  (sharedPressure / neighbourDensity)
                forceX += dirX * scale
                forceY += dirY * scale
              }
              if (neighbourNearDensity > 0) {
                const scale =
                  derivativeSpikyPow3(dst, radius, spikyPow3DerivScale) *
                  (sharedNearPressure / neighbourNearDensity)
                forceX += dirX * scale
                forceY += dirY * scale
              }
            }
          }

          currIndex += 1
        }
      }

      velocities[idx] += (forceX / density) * dt
      velocities[idx + 1] += (forceY / density) * dt
    }
  }

  function calculateViscosity(dt) {
    const count = state.count
    const predicted = state.predicted
    const velocities = state.velocities
    const sortedKeys = state.sortedKeys
    const spatialOffsets = state.spatialOffsets

    for (let i = 0; i < count; i += 1) {
      const idx = i * 2
      const posX = predicted[idx]
      const posY = predicted[idx + 1]
      const originCellX = Math.floor(posX / radius)
      const originCellY = Math.floor(posY / radius)

      let forceX = 0
      let forceY = 0
      const velX = velocities[idx]
      const velY = velocities[idx + 1]

      for (let n = 0; n < neighborOffsets.length; n += 1) {
        const offset = neighborOffsets[n]
        const cellX = originCellX + offset[0]
        const cellY = originCellY + offset[1]
        const key = hashCell2D(cellX, cellY) % count
        let currIndex = spatialOffsets[key]

        while (currIndex < count) {
          const neighbourKey = sortedKeys[currIndex]
          if (neighbourKey !== key) break
          if (currIndex !== i) {
            const nIdx = currIndex * 2
            const dx = predicted[nIdx] - posX
            const dy = predicted[nIdx + 1] - posY
            const sqrDst = dx * dx + dy * dy

            if (sqrDst <= radiusSq) {
              const dst = Math.sqrt(sqrDst)
              const weight = smoothingKernelPoly6(dst, radius, poly6Scale)
              forceX += (velocities[nIdx] - velX) * weight
              forceY += (velocities[nIdx + 1] - velY) * weight
            }
          }

          currIndex += 1
        }
      }

      velocities[idx] += forceX * config.viscosityStrength * dt
      velocities[idx + 1] += forceY * config.viscosityStrength * dt
    }
  }

  function handleCollisions() {
    const positions = state.positions
    const velocities = state.velocities
    const paddingPx =
      Math.max(1, Math.round(config.particleRadius)) + config.boundsPaddingPx
    const padding = paddingPx / scale
    const halfX = Math.max(0, bounds.x * 0.5 - padding)
    const halfY = Math.max(0, bounds.y * 0.5 - padding)
    const obstacleHalfX = config.obstacleSize.x * 0.5
    const obstacleHalfY = config.obstacleSize.y * 0.5
    const hasObstacle =
      config.obstacleSize.x > 0 && config.obstacleSize.y > 0

    for (let i = 0; i < state.count; i += 1) {
      const idx = i * 2
      let px = positions[idx]
      let py = positions[idx + 1]
      let vx = velocities[idx]
      let vy = velocities[idx + 1]

      const edgeDstX = halfX - Math.abs(px)
      const edgeDstY = halfY - Math.abs(py)

      if (edgeDstX <= 0) {
        px = halfX * Math.sign(px)
        vx *= -config.collisionDamping
      }
      if (edgeDstY <= 0) {
        py = halfY * Math.sign(py)
        vy *= -config.collisionDamping
      }

      if (hasObstacle) {
        const ox = px - config.obstacleCentre.x
        const oy = py - config.obstacleCentre.y
        const obstacleEdgeX = obstacleHalfX - Math.abs(ox)
        const obstacleEdgeY = obstacleHalfY - Math.abs(oy)
        if (obstacleEdgeX >= 0 && obstacleEdgeY >= 0) {
          if (obstacleEdgeX < obstacleEdgeY) {
            px =
              obstacleHalfX * Math.sign(ox) + config.obstacleCentre.x
            vx *= -config.collisionDamping
          } else {
            py =
              obstacleHalfY * Math.sign(oy) + config.obstacleCentre.y
            vy *= -config.collisionDamping
          }
        }
      }

      positions[idx] = px
      positions[idx + 1] = py
      velocities[idx] = vx
      velocities[idx + 1] = vy
    }
  }

  function updatePositions(dt) {
    const positions = state.positions
    const velocities = state.velocities

    for (let i = 0; i < state.count; i += 1) {
      const idx = i * 2
      positions[idx] += velocities[idx] * dt
      positions[idx + 1] += velocities[idx + 1] * dt
    }

    handleCollisions()
  }

  function step(dt) {
    state.lastDt = dt
    const maxDeltaTime = config.maxTimestepFPS
      ? 1 / config.maxTimestepFPS
      : Number.POSITIVE_INFINITY
    const frameTime = Math.min(dt * config.timeScale, maxDeltaTime)
    const timeStep = frameTime / config.iterationsPerFrame

    for (let i = 0; i < config.iterationsPerFrame; i += 1) {
      externalForcesStep(timeStep)
      runSpatialHash()
      calculateDensities()
      calculatePressure(timeStep)
      calculateViscosity(timeStep)
      updatePositions(timeStep)
    }
  }

  function draw() {
    const width = canvas.width
    const height = canvas.height
    pixelBuffer.fill(0)

    const bg = [5, 7, 11]
    for (let i = 0; i < pixelBuffer.length; i += 4) {
      pixelBuffer[i] = bg[0]
      pixelBuffer[i + 1] = bg[1]
      pixelBuffer[i + 2] = bg[2]
      pixelBuffer[i + 3] = 255
    }

    const maxSpeed = config.velocityDisplayMax
    rebuildStamp()
    for (let i = 0; i < state.count; i += 1) {
      const x = state.positions[i * 2]
      const y = state.positions[i * 2 + 1]
      const p = worldToCanvas(x, y)
      const vx = state.velocities[i * 2]
      const vy = state.velocities[i * 2 + 1]
      const speed = Math.sqrt(vx * vx + vy * vy)
      const t = Math.max(0, Math.min(1, speed / maxSpeed))
      const idx = Math.min(
        gradientLut.length - 1,
        Math.floor(t * (gradientLut.length - 1))
      )
      const col = gradientLut[idx]
      const r = Math.round(col.r * 255)
      const g = Math.round(col.g * 255)
      const b = Math.round(col.b * 255)
      const px = Math.round(p.x)
      const py = Math.round(p.y)

      for (let j = 0; j < stampOffsets.length; j += 1) {
        const offset = stampOffsets[j]
        const yy = py + offset[1]
        if (yy < 0 || yy >= height) continue
        const xx = px + offset[0]
        if (xx < 0 || xx >= width) continue
        const idx = (yy * width + xx) * 4
        pixelBuffer[idx] = r
        pixelBuffer[idx + 1] = g
        pixelBuffer[idx + 2] = b
        pixelBuffer[idx + 3] = 255
      }
    }

    ctx.putImageData(imageData, 0, 0)

    const halfW = (bounds.x * scale) / 2
    const halfH = (bounds.y * scale) / 2
    ctx.strokeStyle = '#1b2432'
    ctx.lineWidth = 1
    ctx.strokeRect(originX - halfW, originY - halfH, halfW * 2, halfH * 2)
  }

  return { step, draw, state, config, refreshSettings, reset }
}
