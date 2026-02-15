import { FlipFluid } from './fluid';

export const FLUID_CELL = 0;
export const AIR_CELL = 1;
export const SOLID_CELL = 2;

export interface Scene {
  gravity: number;
  dt: number;
  flipRatio: number;
  numPressureIters: number;
  numParticleIters: number;
  overRelaxation: number;
  compensateDrift: boolean;
  separateParticles: boolean;
  obstacleX: number;
  obstacleY: number;
  obstacleRadius: number;
  paused: boolean;
  obstacleVelX: number;
  obstacleVelY: number;
  showParticles: boolean;
  showGrid: boolean;
  particleCount: number;
  particleRadiusScale: number;
  fluid: FlipFluid | null;
}
