import type { SimConfig, RGB, Vec3 } from '../common/types.ts';
import type { EnvironmentConfig } from '../common/environment.ts';

export interface ScreenSpaceConfig extends SimConfig, EnvironmentConfig {
  screenSpaceDebugMode: number;

  // Foam
  foamSpawnRate: number;
  trappedAirVelocityMin: number;
  trappedAirVelocityMax: number;
  foamKineticEnergyMin: number;
  foamKineticEnergyMax: number;
  bubbleBuoyancy: number;
  bubbleScale: number;
  foamLifetimeMin: number;
  foamLifetimeMax: number;
  foamColor: RGB;
  foamOpacity: number;
  sprayClassifyMaxNeighbours: number;
  bubbleClassifyMinNeighbours: number;
  foamParticleRadius: number;
  spawnRateFadeInTime: number;
  spawnRateFadeStartTime: number;
  bubbleChangeScaleSpeed: number;

  // Rendering
  waterColor: RGB;
  deepWaterColor: RGB;
  extinctionCoeff: Vec3;
  extinctionMultiplier: number;
  refractionStrength: number;
  shadowSoftness: number;
  showFluidShadows: boolean;

  // Wireframe
  showBoundsWireframe: boolean;
  boundsWireframeColor: RGB;

  // Obstacle
  obstacleColor: RGB;
  obstacleAlpha: number;
}
