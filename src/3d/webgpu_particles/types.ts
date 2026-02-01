import type { SimConfig, ColorKey } from '../common/types.ts';

export interface ParticlesConfig extends SimConfig {
  velocityDisplayMax: number;
  gradientResolution: number;
  colorKeys: ColorKey[];
}
