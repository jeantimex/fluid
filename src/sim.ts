/**
 * Simulation factory and state management.
 *
 * This module serves as the main entry point for creating and managing
 * the fluid simulation. It coordinates:
 * - Initial state creation from spawn data
 * - Input handling for mouse interaction
 * - Connecting physics, rendering, and configuration
 *
 * The simulation uses a factory pattern rather than classes, which:
 * - Keeps state encapsulated within closures
 * - Avoids `this` binding issues
 * - Makes the API simple and explicit
 */

import type { InputState, Sim, SimState, SpawnData, Vec2 } from './types.ts'
import { createConfig } from './sim/config.ts'
import { buildGradientLut } from './sim/kernels.ts'
import { createPhysics } from './sim/physics.ts'
import { createRenderer } from './sim/renderer.ts'
import { createSpawnData } from './sim/spawn.ts'

/**
 * Creates the initial simulation state from spawn data.
 *
 * This function allocates all the typed arrays needed for the simulation.
 * Arrays are sized based on particle count and use Float32Array/Uint32Array
 * for performance (cache-friendly, SIMD-compatible).
 *
 * Memory layout uses interleaved 2D vectors: [x0, y0, x1, y1, ...]
 * This keeps x and y components adjacent in memory for better cache behavior
 * when processing particles sequentially.
 *
 * @param spawn - Initial spawn data with positions and velocities
 * @returns Complete simulation state with all arrays allocated
 */
function createStateFromSpawn(spawn: SpawnData): SimState {
  const count = spawn.count

  return {
    // Primary particle data
    positions: spawn.positions,
    predicted: new Float32Array(spawn.positions),  // Copy for prediction
    velocities: spawn.velocities,

    // Density data (interleaved [density, nearDensity, ...])
    densities: new Float32Array(count * 2),

    // Spatial hashing arrays
    keys: new Uint32Array(count),           // Hash keys per particle
    sortedKeys: new Uint32Array(count),     // Keys in sorted order
    indices: new Uint32Array(count),        // Original indices after sort
    sortOffsets: new Uint32Array(count),    // Counting sort workspace
    spatialOffsets: new Uint32Array(count), // Bucket start indices

    // Double buffers for sorting (avoids allocation during simulation)
    positionsSorted: new Float32Array(count * 2),
    predictedSorted: new Float32Array(count * 2),
    velocitiesSorted: new Float32Array(count * 2),

    count,

    // User input state
    input: {
      worldX: 0,
      worldY: 0,
      pull: false,
      push: false,
    },
  }
}

/**
 * Sets up mouse event handlers for user interaction.
 *
 * The simulation supports two interaction modes:
 * - Left click (pull): Attracts nearby particles toward cursor
 * - Right click (push): Repels nearby particles away from cursor
 *
 * Mouse position is continuously tracked and converted to world coordinates
 * so the physics engine can apply forces in the correct location.
 *
 * Context menu is disabled to allow right-click for push interaction.
 *
 * @param canvas - HTML canvas element to attach handlers to
 * @param canvasToWorld - Coordinate conversion function from renderer
 * @param inputState - Mutable input state to update
 */
function installInputHandlers(
  canvas: HTMLCanvasElement,
  canvasToWorld: (x: number, y: number) => Vec2,
  inputState: InputState
): void {
  /**
   * Updates world-space cursor position from a mouse event.
   */
  const updatePointer = (event: MouseEvent): void => {
    // Get canvas-relative pixel coordinates
    const rect = canvas.getBoundingClientRect()
    const px = event.clientX - rect.left
    const py = event.clientY - rect.top

    // Convert to world coordinates
    const world = canvasToWorld(px, py)
    inputState.worldX = world.x
    inputState.worldY = world.y
  }

  // Track mouse movement
  canvas.addEventListener('mousemove', updatePointer)

  // Handle mouse button press
  canvas.addEventListener('mousedown', (event) => {
    updatePointer(event)
    if (event.button === 0) inputState.pull = true   // Left click = pull
    if (event.button === 2) inputState.push = true   // Right click = push
  })

  // Handle mouse button release
  canvas.addEventListener('mouseup', (event) => {
    if (event.button === 0) inputState.pull = false
    if (event.button === 2) inputState.push = false
  })

  // Cancel interaction when mouse leaves canvas
  canvas.addEventListener('mouseleave', () => {
    inputState.pull = false
    inputState.push = false
  })

  // Prevent context menu on right-click
  canvas.addEventListener('contextmenu', (event) => {
    event.preventDefault()
  })
}

/**
 * Creates a complete fluid simulation instance.
 *
 * This is the main factory function that assembles all simulation components:
 * 1. Creates configuration with default parameters
 * 2. Spawns initial particles
 * 3. Initializes simulation state
 * 4. Sets up rendering
 * 5. Installs input handlers
 * 6. Creates physics engine
 *
 * The returned Sim object provides a clean interface for:
 * - Advancing the simulation (step)
 * - Rendering the current state (draw)
 * - Resetting to initial conditions (reset)
 * - Accessing configuration for GUI binding
 *
 * @param canvas - HTML canvas element for rendering
 * @returns Simulation interface for controlling the fluid simulation
 *
 * @example
 * const canvas = document.querySelector('canvas')
 * const sim = createSim(canvas)
 *
 * // Main loop
 * function frame(now) {
 *   const dt = (now - lastTime) / 1000
 *   sim.step(dt)
 *   sim.draw()
 *   requestAnimationFrame(frame)
 * }
 */
export function createSim(canvas: HTMLCanvasElement): Sim {
  // Create configuration with default parameters
  const config = createConfig()

  // Generate initial particle positions and velocities
  const spawn = createSpawnData(config)

  // Allocate simulation state arrays
  const state = createStateFromSpawn(spawn)

  // Build color gradient lookup table for velocity visualization
  const gradientLut = buildGradientLut(
    config.colorKeys,
    config.gradientResolution
  )

  // Create renderer for canvas output
  const renderer = createRenderer(canvas, config, gradientLut)

  // Set up mouse interaction handlers
  installInputHandlers(canvas, renderer.canvasToWorld, state.input)

  // Create physics engine
  const physics = createPhysics(state, config, renderer.getScale)

  /**
   * Resets the simulation to initial conditions.
   *
   * This function:
   * 1. Generates new spawn data based on current config
   * 2. Reallocates all particle arrays for the new count
   * 3. Preserves the same state object reference (important for physics)
   *
   * Called when the user changes spawn density or requests a reset.
   * The particle count may change if spawnDensity was modified.
   */
  function reset(): void {
    const nextSpawn = createSpawnData(config)
    const nextCount = nextSpawn.count

    // Replace particle data arrays
    state.positions = nextSpawn.positions
    state.predicted = new Float32Array(nextSpawn.positions)
    state.velocities = nextSpawn.velocities

    // Reallocate derived arrays for new particle count
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

  /**
   * Advances the simulation by the given time delta.
   *
   * @param dt - Time elapsed since last frame (seconds)
   */
  function step(dt: number): void {
    physics.step(dt)
  }

  /**
   * Renders the current simulation state to the canvas.
   */
  function draw(): void {
    renderer.draw(state)
  }

  // Return the public simulation interface
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
