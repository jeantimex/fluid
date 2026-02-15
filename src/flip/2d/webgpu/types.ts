export interface SimParams {
  density: number;
  width: number;
  height: number;
  spacing: number;
  particleRadius: number;
  maxParticles: number;
  
  // Physics
  gravity: number;
  dt: number;
  flipRatio: number;
  numPressureIters: number;
  numParticleIters: number;
  overRelaxation: number;
  compensateDrift: boolean;
  separateParticles: boolean;
}

export const DEFAULT_PARAMS: SimParams = {
  density: 1000.0,
  width: 2.0, // World units (scaled to fit viewport)
  height: 2.0,
  spacing: 2.0 / 100.0, // Grid cell size
  particleRadius: 0.3 * (2.0 / 100.0),
  maxParticles: 20000,

  gravity: -9.81,
  dt: 1.0 / 60.0,
  flipRatio: 0.9,
  numPressureIters: 100,
  numParticleIters: 2,
  overRelaxation: 1.9,
  compensateDrift: true,
  separateParticles: true,
};
