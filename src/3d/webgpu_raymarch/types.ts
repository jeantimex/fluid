import type { SimConfig } from '../common/types.ts';

export interface RaymarchConfig extends SimConfig {
  densityTextureRes: number;
  densityOffset: number;
  densityMultiplier: number;
  stepSize: number;
  maxSteps: number;
}
