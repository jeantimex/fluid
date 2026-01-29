import type { SimConfig } from '../common/types.ts';

export interface RaymarchConfig extends SimConfig {
  densityTextureRes: number;
  densityOffset: number;
  densityMultiplier: number;
  stepSize: number;
  lightStepSize: number;
  maxSteps: number;
  tileCol1: { r: number; g: number; b: number };
  tileCol2: { r: number; g: number; b: number };
  tileCol3: { r: number; g: number; b: number };
  tileCol4: { r: number; g: number; b: number };
  tileColVariation: { x: number; y: number; z: number };
  tileScale: number;
  tileDarkOffset: number;
  tileDarkFactor: number;
  floorAmbient: number;
  sceneExposure: number;
  debugFloorMode: number;
  extinctionCoefficients: { x: number; y: number; z: number };
  indexOfRefraction: number;
  numRefractions: number;
  floorSize: { x: number; y: number; z: number };
}
