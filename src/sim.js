const CONFIG = {
  timeScale: 1,
  maxTimestepFPS: 60,
  iterationsPerFrame: 3,
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
  spawnDensity: 159,
  initialVelocity: { x: 0, y: 0 },
  jitterStr: 0.03,
  spawnRegions: [
    { position: { x: 0, y: 0.66 }, size: { x: 6.42, y: 4.39 } },
  ],
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

export function createSim(canvas) {
  const ctx = canvas.getContext('2d')
  const spawn = createSpawnData(CONFIG)
  const count = spawn.count
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

  const bounds = CONFIG.boundsSize
  const scaleX = canvas.width / bounds.x
  const scaleY = canvas.height / bounds.y
  const scale = Math.min(scaleX, scaleY)
  const originX = canvas.width * 0.5
  const originY = canvas.height * 0.5

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

  const radius = CONFIG.smoothingRadius
  const radiusSq = radius * radius
  const poly6Scale = 4 / (Math.PI * Math.pow(radius, 8))
  const spikyPow3Scale = 10 / (Math.PI * Math.pow(radius, 5))
  const spikyPow2Scale = 6 / (Math.PI * Math.pow(radius, 4))
  const spikyPow3DerivScale = 30 / (Math.PI * Math.pow(radius, 5))
  const spikyPow2DerivScale = 12 / (Math.PI * Math.pow(radius, 4))

  function externalForcesStep(dt) {
    const positions = state.positions
    const predicted = state.predicted
    const velocities = state.velocities
    const pull = state.input.pull
    const push = state.input.push
    const interactionStrength = push
      ? -CONFIG.interactionStrength
      : pull
        ? CONFIG.interactionStrength
        : 0
    const inputX = state.input.worldX
    const inputY = state.input.worldY
    const inputRadius = CONFIG.interactionRadius
    const inputRadiusSq = inputRadius * inputRadius

    for (let i = 0; i < state.count; i += 1) {
      const idx = i * 2
      let vx = velocities[idx]
      let vy = velocities[idx + 1]

      let ax = 0
      let ay = CONFIG.gravity
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

      const pressure = (density - CONFIG.targetDensity) * CONFIG.pressureMultiplier
      const nearPressure = CONFIG.nearPressureMultiplier * nearDensity

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
                (neighbourDensity - CONFIG.targetDensity) *
                CONFIG.pressureMultiplier
              const neighbourNearPressure =
                CONFIG.nearPressureMultiplier * neighbourNearDensity
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

      velocities[idx] += forceX * CONFIG.viscosityStrength * dt
      velocities[idx + 1] += forceY * CONFIG.viscosityStrength * dt
    }
  }

  function handleCollisions() {
    const positions = state.positions
    const velocities = state.velocities
    const halfX = bounds.x * 0.5
    const halfY = bounds.y * 0.5
    const obstacleHalfX = CONFIG.obstacleSize.x * 0.5
    const obstacleHalfY = CONFIG.obstacleSize.y * 0.5
    const hasObstacle =
      CONFIG.obstacleSize.x > 0 && CONFIG.obstacleSize.y > 0

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
        vx *= -CONFIG.collisionDamping
      }
      if (edgeDstY <= 0) {
        py = halfY * Math.sign(py)
        vy *= -CONFIG.collisionDamping
      }

      if (hasObstacle) {
        const ox = px - CONFIG.obstacleCentre.x
        const oy = py - CONFIG.obstacleCentre.y
        const obstacleEdgeX = obstacleHalfX - Math.abs(ox)
        const obstacleEdgeY = obstacleHalfY - Math.abs(oy)
        if (obstacleEdgeX >= 0 && obstacleEdgeY >= 0) {
          if (obstacleEdgeX < obstacleEdgeY) {
            px =
              obstacleHalfX * Math.sign(ox) + CONFIG.obstacleCentre.x
            vx *= -CONFIG.collisionDamping
          } else {
            py =
              obstacleHalfY * Math.sign(oy) + CONFIG.obstacleCentre.y
            vy *= -CONFIG.collisionDamping
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
    const maxDeltaTime = CONFIG.maxTimestepFPS
      ? 1 / CONFIG.maxTimestepFPS
      : Number.POSITIVE_INFINITY
    const frameTime = Math.min(dt * CONFIG.timeScale, maxDeltaTime)
    const timeStep = frameTime / CONFIG.iterationsPerFrame

    for (let i = 0; i < CONFIG.iterationsPerFrame; i += 1) {
      externalForcesStep(timeStep)
      runSpatialHash()
      calculateDensities()
      calculatePressure(timeStep)
      calculateViscosity(timeStep)
      updatePositions(timeStep)
    }
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = '#0a0f18'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    ctx.strokeStyle = '#1b2432'
    ctx.lineWidth = 1
    const halfW = (bounds.x * scale) / 2
    const halfH = (bounds.y * scale) / 2
    ctx.strokeRect(originX - halfW, originY - halfH, halfW * 2, halfH * 2)

    ctx.fillStyle = '#7bdcff'
    const radius = 2
    for (let i = 0; i < state.count; i += 1) {
      const x = state.positions[i * 2]
      const y = state.positions[i * 2 + 1]
      const p = worldToCanvas(x, y)
      ctx.beginPath()
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  return { step, draw, state }
}
