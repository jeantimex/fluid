import {
  derivativeSpikyPow2,
  derivativeSpikyPow3,
  smoothingKernelPoly6,
  spikyKernelPow2,
  spikyKernelPow3,
} from './kernels.js'
import { hashCell2D, neighborOffsets } from './spatial.js'

export function createPhysics(state, config, getScale) {
  const baseParams = {
    particleRadius: config.particleRadius,
    smoothingRadius: config.smoothingRadius,
    targetDensity: config.targetDensity,
    pressureMultiplier: config.pressureMultiplier,
    nearPressureMultiplier: config.nearPressureMultiplier,
    viscosityStrength: config.viscosityStrength,
  }

  let radius = config.smoothingRadius
  let radiusSq = radius * radius
  let poly6Scale = 4 / (Math.PI * Math.pow(radius, 8))
  let spikyPow3Scale = 10 / (Math.PI * Math.pow(radius, 5))
  let spikyPow2Scale = 6 / (Math.PI * Math.pow(radius, 4))
  let spikyPow3DerivScale = 30 / (Math.PI * Math.pow(radius, 5))
  let spikyPow2DerivScale = 12 / (Math.PI * Math.pow(radius, 4))

  function refreshSettings() {
    radius = config.smoothingRadius
    radiusSq = radius * radius
    poly6Scale = 4 / (Math.PI * Math.pow(radius, 8))
    spikyPow3Scale = 10 / (Math.PI * Math.pow(radius, 5))
    spikyPow2Scale = 6 / (Math.PI * Math.pow(radius, 4))
    spikyPow3DerivScale = 30 / (Math.PI * Math.pow(radius, 5))
    spikyPow2DerivScale = 12 / (Math.PI * Math.pow(radius, 4))
  }

  // Heuristic scaling to keep fluid behavior similar when particle radius changes.
  function applyParticleScale() {
    const baseRadius = Math.max(0.0001, baseParams.particleRadius)
    const scaleFactor = config.particleRadius / baseRadius
    const scaleSq = scaleFactor * scaleFactor
    config.smoothingRadius = baseParams.smoothingRadius * scaleFactor
    config.targetDensity = baseParams.targetDensity * scaleSq
    config.pressureMultiplier = baseParams.pressureMultiplier / scaleSq
    config.nearPressureMultiplier = baseParams.nearPressureMultiplier / scaleSq
    config.viscosityStrength = baseParams.viscosityStrength / scaleFactor
    refreshSettings()
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
          ax =
            ax * gravityWeight +
            dirX * centreT * interactionStrength -
            vx * centreT
          ay =
            ay * gravityWeight +
            dirY * centreT * interactionStrength -
            vy * centreT
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

  // Counting sort by spatial hash so neighbors are contiguous.
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
    const padding = paddingPx / getScale()
    const halfX = Math.max(0, config.boundsSize.x * 0.5 - padding)
    const halfY = Math.max(0, config.boundsSize.y * 0.5 - padding)
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

  return { step, refreshSettings, applyParticleScale }
}
