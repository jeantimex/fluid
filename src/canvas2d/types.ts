/**
 * Type definitions for the SPH (Smoothed Particle Hydrodynamics) fluid simulation.
 *
 * SPH is a mesh-free Lagrangian method used for simulating fluid dynamics.
 * Instead of using a fixed grid, SPH represents the fluid as a collection of
 * particles that carry physical properties (position, velocity, density, etc.)
 * and interact with neighboring particles within a smoothing radius.
 */

/**
 * 2D vector representation used throughout the simulation.
 * Used for positions, velocities, sizes, and other 2D quantities.
 */
export interface Vec2 {
  x: number;
  y: number;
}

/**
 * Color key for gradient interpolation.
 * Used to map particle velocities to colors for visualization.
 *
 * @property t - Normalized position in gradient [0, 1]
 * @property r - Red component [0, 1]
 * @property g - Green component [0, 1]
 * @property b - Blue component [0, 1]
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
 * Defines a rectangular region where particles are spawned.
 *
 * @property position - Center of the spawn region in world coordinates
 * @property size - Width and height of the spawn region
 */
export interface SpawnRegion {
  position: Vec2;
  size: Vec2;
}

/**
 * Complete configuration for the fluid simulation.
 * These parameters control the physical behavior and visual appearance.
 */
export interface SimConfig {
  /** Simulation speed multiplier (1.0 = real-time) */
  timeScale: number;

  /** Maximum timestep expressed as FPS (e.g., 60 = max 1/60s per step) */
  maxTimestepFPS: number;

  /** Number of physics substeps per frame for stability */
  iterationsPerFrame: number;

  /** Gravitational acceleration (negative = downward) */
  gravity: number;

  /** Velocity retention on collision [0, 1] (1 = perfectly elastic) */
  collisionDamping: number;

  /**
   * SPH smoothing radius (h).
   * Defines the range of particle-particle interactions.
   * Larger values = smoother but slower simulation.
   */
  smoothingRadius: number;

  /**
   * Rest density (ρ₀) the fluid tries to maintain.
   * Particles compress/expand to reach this density.
   */
  targetDensity: number;

  /**
   * Pressure stiffness coefficient (k).
   * Higher values = less compressible fluid.
   */
  pressureMultiplier: number;

  /**
   * Near-pressure coefficient for surface tension effects.
   * Prevents particle clumping at close range.
   */
  nearPressureMultiplier: number;

  /**
   * Viscosity coefficient (μ).
   * Higher values = thicker fluid (honey vs water).
   */
  viscosityStrength: number;

  /** Simulation boundary dimensions in world units */
  boundsSize: Vec2;

  /** Optional obstacle dimensions (0 = no obstacle) */
  obstacleSize: Vec2;

  /** Obstacle center position in world coordinates */
  obstacleCentre: Vec2;

  /** Radius of mouse interaction force */
  interactionRadius: number;

  /** Strength of mouse push/pull force */
  interactionStrength: number;

  /** Maximum velocity for color gradient mapping */
  velocityDisplayMax: number;

  /** Visual radius of particles in pixels */
  particleRadius: number;

  /** Padding from boundary edges in pixels */
  boundsPaddingPx: number;

  /** Number of entries in the color gradient lookup table */
  gradientResolution: number;

  /** Color gradient keyframes for velocity visualization */
  colorKeys: ColorKey[];

  /** Particle density for spawning (particles per unit area) */
  spawnDensity: number;

  /** Initial velocity assigned to spawned particles */
  initialVelocity: Vec2;

  /** Random position jitter applied to spawned particles */
  jitterStr: number;

  /** Regions where particles are initially spawned */
  spawnRegions: SpawnRegion[];
}

/**
 * Mouse/pointer input state for user interaction.
 */
export interface InputState {
  /** Pointer X position in world coordinates */
  worldX: number;

  /** Pointer Y position in world coordinates */
  worldY: number;

  /** True when left mouse button is pressed (attract particles) */
  pull: boolean;

  /** True when right mouse button is pressed (repel particles) */
  push: boolean;
}

/**
 * Complete simulation state containing all particle data.
 *
 * Arrays are stored in SoA (Structure of Arrays) format for cache efficiency.
 * Position/velocity arrays store interleaved [x0, y0, x1, y1, ...] data.
 *
 * The simulation uses double-buffering for positions/velocities during
 * spatial sorting to avoid allocation overhead.
 */
export interface SimState {
  /** Current particle positions [x0, y0, x1, y1, ...] */
  positions: Float32Array;

  /**
   * Predicted positions for density calculation.
   * Particles are moved slightly forward in time to improve stability.
   */
  predicted: Float32Array;

  /** Current particle velocities [vx0, vy0, vx1, vy1, ...] */
  velocities: Float32Array;

  /**
   * Particle densities [density0, nearDensity0, density1, nearDensity1, ...].
   * Near density is used for surface tension simulation.
   */
  densities: Float32Array;

  /** Spatial hash keys for each particle (unsorted) */
  keys: Uint32Array;

  /** Spatial hash keys after sorting */
  sortedKeys: Uint32Array;

  /** Original particle indices after spatial sorting */
  indices: Uint32Array;

  /** Temporary array for counting sort offsets */
  sortOffsets: Uint32Array;

  /**
   * Start index for each spatial hash bucket.
   * Used for O(1) neighbor lookup during SPH calculations.
   */
  spatialOffsets: Uint32Array;

  /** Double-buffer for positions during sorting */
  positionsSorted: Float32Array;

  /** Double-buffer for predicted positions during sorting */
  predictedSorted: Float32Array;

  /** Double-buffer for velocities during sorting */
  velocitiesSorted: Float32Array;

  /** Current number of active particles */
  count: number;

  /** User input state */
  input: InputState;
}

/**
 * Data returned from particle spawning.
 */
export interface SpawnData {
  /** Initial particle positions */
  positions: Float32Array;

  /** Initial particle velocities */
  velocities: Float32Array;

  /** Number of spawned particles */
  count: number;
}

/**
 * Renderer interface for drawing the simulation.
 */
export interface Renderer {
  /** Render current simulation state to canvas */
  draw: (state: SimState) => void;

  /** Convert world coordinates to canvas pixels */
  worldToCanvas: (x: number, y: number) => Vec2;

  /** Convert canvas pixels to world coordinates */
  canvasToWorld: (x: number, y: number) => Vec2;

  /** Get current world-to-canvas scale factor */
  getScale: () => number;
}

/**
 * Physics engine interface.
 */
export interface Physics {
  /** Advance simulation by dt seconds */
  step: (dt: number) => void;

  /** Recalculate derived values after config changes */
  refreshSettings: () => void;

  /** Apply scaling heuristics when particle radius changes */
  applyParticleScale: () => void;
}

/**
 * Main simulation interface exposed to the UI.
 */
export interface Sim {
  /** Advance simulation by dt seconds */
  step: (dt: number) => void;

  /** Render current state */
  draw: () => void;

  /** Direct access to simulation state */
  state: SimState;

  /** Direct access to configuration */
  config: SimConfig;

  /** Recalculate physics constants */
  refreshSettings: () => void;

  /** Apply particle radius scaling */
  applyParticleScale: () => void;

  /** Reset simulation with new particles */
  reset: () => void;
}
