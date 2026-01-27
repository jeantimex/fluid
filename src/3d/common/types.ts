/**
 * Type definitions for the 3D SPH (Smoothed Particle Hydrodynamics) simulation.
 */

/**
 * 3D vector representation used for positions, velocities, and sizes.
 */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Color key for gradient interpolation.
 */
export interface ColorKey {
  t: number;
  r: number;
  g: number;
  b: number;
}

/**
 * RGB color representation with normalized components [0, 1].
 */
export interface RGB {
  r: number;
  g: number;
  b: number;
}

/**
 * Defines a box region where particles are spawned.
 */
export interface SpawnRegion {
  center: Vec3;
  size: Vec3;
}

/**
 * Configuration for the 3D fluid simulation.
 */
export interface SimConfig {
  timeScale: number;
  maxTimestepFPS: number;
  iterationsPerFrame: number;

  gravity: number;
  collisionDamping: number;

  smoothingRadius: number;
  targetDensity: number;
  pressureMultiplier: number;
  nearPressureMultiplier: number;
  viscosityStrength: number;

  boundsSize: Vec3;
  boundsCenter: Vec3;

  interactionRadius: number;
  interactionStrength: number;

  velocityDisplayMax: number;
  particleRadius: number;
  gradientResolution: number;
  colorKeys: ColorKey[];

  spawnDensity: number;
  initialVelocity: Vec3;
  jitterStr: number;
  spawnRegions: SpawnRegion[];
}

/**
 * Mouse/pointer input state for user interaction.
 */
export interface InputState {
  world: Vec3;
  pull: boolean;
  push: boolean;
}

/**
 * Simulation state containing all particle data arrays.
 */
export interface SimState {
  positions: Float32Array;
  predicted: Float32Array;
  velocities: Float32Array;
  densities: Float32Array;

  keys: Uint32Array;
  sortedKeys: Uint32Array;
  indices: Uint32Array;
  sortOffsets: Uint32Array;
  spatialOffsets: Uint32Array;

  positionsSorted: Float32Array;
  predictedSorted: Float32Array;
  velocitiesSorted: Float32Array;

  count: number;
  input: InputState;
}

/**
 * Data returned from particle spawning.
 */
export interface SpawnData {
  positions: Float32Array;
  velocities: Float32Array;
  count: number;
}

/**
 * Lightweight simulation interface (bootstrap stage).
 */
export interface Sim {
  state: SimState;
  config: SimConfig;
  reset: () => void;
}
