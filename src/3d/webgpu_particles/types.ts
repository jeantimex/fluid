import type { SimConfig, ColorKey } from '../common/types.ts';
import type { EnvironmentConfig } from '../common/environment.ts';

export interface ParticlesConfig extends SimConfig, EnvironmentConfig {
  velocityDisplayMax: number;
  gradientResolution: number;
  colorKeys: ColorKey[];
  densityTextureRes: number;
  densityOffset: number;
  densityMultiplier: number;
  lightStepSize: number;
  shadowSoftness: number;
  extinctionCoefficients: { x: number; y: number; z: number };
}
