import { createConfig } from './sim/config.js'
import { buildGradientLut } from './sim/kernels.js'
import { createPhysics } from './sim/physics.js'
import { createRenderer } from './sim/renderer.js'
import { createSpawnData } from './sim/spawn.js'

function createStateFromSpawn(spawn) {
  const count = spawn.count
  return {
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
    input: {
      worldX: 0,
      worldY: 0,
      pull: false,
      push: false,
    },
  }
}

function installInputHandlers(canvas, canvasToWorld, inputState) {
  const updatePointer = (event) => {
    const rect = canvas.getBoundingClientRect()
    const px = event.clientX - rect.left
    const py = event.clientY - rect.top
    const world = canvasToWorld(px, py)
    inputState.worldX = world.x
    inputState.worldY = world.y
  }

  canvas.addEventListener('mousemove', updatePointer)
  canvas.addEventListener('mousedown', (event) => {
    updatePointer(event)
    if (event.button === 0) inputState.pull = true
    if (event.button === 2) inputState.push = true
  })
  canvas.addEventListener('mouseup', (event) => {
    if (event.button === 0) inputState.pull = false
    if (event.button === 2) inputState.push = false
  })
  canvas.addEventListener('mouseleave', () => {
    inputState.pull = false
    inputState.push = false
  })
  canvas.addEventListener('contextmenu', (event) => {
    event.preventDefault()
  })
}

export function createSim(canvas) {
  const config = createConfig()
  const spawn = createSpawnData(config)
  const state = createStateFromSpawn(spawn)
  const gradientLut = buildGradientLut(
    config.colorKeys,
    config.gradientResolution
  )
  const renderer = createRenderer(canvas, config, gradientLut)
  installInputHandlers(canvas, renderer.canvasToWorld, state.input)

  const physics = createPhysics(state, config, renderer.getScale)

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

  function step(dt) {
    physics.step(dt)
  }

  function draw() {
    renderer.draw(state)
  }

  return {
    step,
    draw,
    state,
    config,
    refreshSettings: physics.refreshSettings,
    applyParticleScale: physics.applyParticleScale,
    reset,
  }
}
