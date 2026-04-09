export interface Vec2 {
  x: number;
  y: number;
}

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export type AppState =
  | 'loading'
  | 'needs-permission'
  | 'ready'
  | 'denied'
  | 'not-supported';

export interface FluidPalette {
  fluidColor: RGB;
  foamColor: RGB;
  colorDiffusionCoeff: number;
  foamReturnRate: number;
}

export interface SimulationParams {
  dt: number;
  flipRatio: number;
  numPressureIters: number;
  numParticleIters: number;
  overRelaxation: number;
  compensateDrift: boolean;
  separateParticles: boolean;
  damping: number;
  showParticles: boolean;
  showGrid: boolean;
  resolution: number;
  relWaterWidth: number;
  relWaterHeight: number;
  numParticles: number;
}
