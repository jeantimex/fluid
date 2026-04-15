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
  sprayColor: RGB;
  bubbleColor: RGB;
}

export interface SimulationParams {
  dt: number;
  picRatio: number;
  numPressureIters: number;
  numParticleIters: number;
  overRelaxation: number;
  compensateDrift: boolean;
  separateParticles: boolean;
  damping: number;
  enableWhitewater: boolean;
  maxDiffuseParticles: number;
  diffuseEmissionRate: number;
  diffuseMinSpeed: number;
  diffuseLifetime: number;
  showDiffuseParticles: boolean;
  showParticles: boolean;
  showGrid: boolean;
  resolution: number;
  relWaterWidth: number;
  relWaterHeight: number;
  numParticles: number;
}
