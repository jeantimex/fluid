export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface SpawnRegion {
  position: Vec3;
  size: Vec3;
}

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
  obstacleSize: Vec3;
  obstacleCentre: Vec3;
  interactionRadius: number;
  interactionStrength: number;
  particleRadius: number;
  spawnDensity: number;
  initialVelocity: Vec3;
  jitterStr: number;
  spawnRegions: SpawnRegion[];
}

export interface InputState {
  worldX: number;
  worldY: number;
  worldZ: number;
  pull: boolean;
  push: boolean;
}

export interface SimState {
  positions: Float32Array; // Stride 4
  predicted: Float32Array; // Stride 4
  velocities: Float32Array; // Stride 4
  densities: Float32Array; // Stride 2

  keys: Uint32Array;
  sortedKeys: Uint32Array;
  indices: Uint32Array;
  sortOffsets: Uint32Array;
  spatialOffsets: Uint32Array;

  positionsSorted: Float32Array; // Stride 4
  predictedSorted: Float32Array; // Stride 4
  velocitiesSorted: Float32Array; // Stride 4

  count: number;
  input: InputState;
}

export interface SpawnData {
  positions: Float32Array; // Stride 4
  velocities: Float32Array; // Stride 4
  count: number;
}
