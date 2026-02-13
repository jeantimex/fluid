import type { SimConfig, RGB, Vec3 } from '../common/types.ts';
import type { EnvironmentConfig } from '../common/environment.ts';

export interface ScreenSpaceConfig extends SimConfig, EnvironmentConfig {
  // -------------------------------------------------------------------------
  // FLIP Whitewater (Track 3 scaffolding)
  // -------------------------------------------------------------------------
  whitewaterEmitterRate: number;
  wavecrestMin: number;
  wavecrestMax: number;
  wavecrestSharpness: number;
  energyMin: number;
  energyMax: number;
  turbulenceMin: number;
  turbulenceMax: number;
  obstacleInfluenceBase: number;
  obstacleInfluenceDecay: number;
  foamLayerDepth: number;
  foamLayerOffset: number;
  foamBubbleHysteresis: number;
  sprayNeighborMax: number;
  bubbleNeighborMin: number;
  foamLifetimeDecay: number;
  bubbleLifetimeDecay: number;
  sprayLifetimeDecay: number;
  foamPreservationEnabled: boolean;
  foamPreservationRate: number;
  foamDensityMin: number;
  foamDensityMax: number;
  foamAdvectionStrength: number;
  bubbleDrag: number;
  sprayDrag: number;
  sprayFriction: number;
  sprayRestitution: number;
  foamRenderMode: 'points' | 'patches';
  foamBlurPasses: number;
  foamThreshold: number;
  foamSoftness: number;
  foamAnisotropy: number;
  foamEdgeBoost: number;
  foamTemporalBlend: number;

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

  // Debug
  screenSpaceDebugMode?: number;
}
