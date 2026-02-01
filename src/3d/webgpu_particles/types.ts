import type { SimConfig, ColorKey } from '../common/types.ts';
import type { EnvironmentConfig } from '../common/environment.ts';

export interface ParticlesConfig extends SimConfig, EnvironmentConfig {
  velocityDisplayMax: number;
  gradientResolution: number;
  colorKeys: ColorKey[];
}
