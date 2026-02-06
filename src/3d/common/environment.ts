import type { RGB, Vec3, SimConfig } from './types.ts';

export interface EnvironmentConfig {
  // Lighting
  dirToSun: Vec3;
  floorAmbient: number;
  sceneExposure: number;
  sunBrightness: number;

  // Sky (Procedural)
  skyColorHorizon: RGB;
  skyColorZenith: RGB;
  skyColorGround: RGB;
  sunPower: number; // exponent for sun highlight

  // Floor (Checkerboard)
  floorSize: Vec3;
  floorCenter: Vec3;
  tileScale: number;
  tileDarkFactor: number;
  tileCol1: RGB; // -X, +Z
  tileCol2: RGB; // +X, +Z
  tileCol3: RGB; // -X, -Z
  tileCol4: RGB; // +X, -Z
  tileColVariation: Vec3; // HSV variation
  debugFloorMode: number; // 0=normal, 1=red, 2=flat
  globalBrightness: number;
  globalSaturation: number;
}

export function createDefaultEnvironmentConfig(): EnvironmentConfig {
  return {
    // Lighting (from basic demo defaults)
    dirToSun: { x: -0.83, y: 0.42, z: -0.36 },
    floorAmbient: 0.58,
    sceneExposure: 1.1,
    sunBrightness: 1.0,

    // Sky
    skyColorHorizon: { r: 1.0, g: 1.0, b: 1.0 },
    skyColorZenith: { r: 0.08, g: 0.37, b: 0.73 },
    skyColorGround: { r: 0.55, g: 0.50, b: 0.55 },
    sunPower: 500.0,

    // Floor
    floorSize: { x: 100, y: 1, z: 100 },
    floorCenter: { x: 0, y: -5.5, z: 0 },
    tileScale: 1.0,
    tileDarkFactor: -0.35, // HSV Value shift for checker pattern
    
    // Unity Fluid Raymarch scene colors
    tileCol1: { r: 0.20392157, g: 0.5176471, b: 0.7764706 },   // Light Blue
    tileCol2: { r: 0.6081319, g: 0.36850303, b: 0.8584906 },    // Purple
    tileCol3: { r: 0.3019758, g: 0.735849, b: 0.45801795 },  // Green
    tileCol4: { r: 0.8018868, g: 0.6434483, b: 0.36690104 },  // Yellow/Brown
    tileColVariation: { x: 0.33, y: 0.0, z: 0.47 },
    debugFloorMode: 0,
    globalBrightness: 1.0,
    globalSaturation: 1.0,
  };
}

/**
 * Writes environment parameters to a Float32Array for GPU upload.
 * Layout must match EnvironmentUniforms in environment.wgsl.
 * Total size: 60 floats (240 bytes).
 */
export function writeEnvironmentUniforms(
  buffer: Float32Array, 
  offset: number, 
  env: EnvironmentConfig, 
  sim: SimConfig
): void {
  let i = offset;

  // 0-3: dirToSun, floorAmbient
  buffer[i++] = env.dirToSun.x;
  buffer[i++] = env.dirToSun.y;
  buffer[i++] = env.dirToSun.z;
  buffer[i++] = env.floorAmbient;

  // 4-7: skyColorHorizon, sunPower
  buffer[i++] = env.skyColorHorizon.r;
  buffer[i++] = env.skyColorHorizon.g;
  buffer[i++] = env.skyColorHorizon.b;
  buffer[i++] = env.sunPower;

  // 8-11: skyColorZenith, sceneExposure
  buffer[i++] = env.skyColorZenith.r;
  buffer[i++] = env.skyColorZenith.g;
  buffer[i++] = env.skyColorZenith.b;
  buffer[i++] = env.sceneExposure;

  // 12-15: skyColorGround, debugFloorMode
  buffer[i++] = env.skyColorGround.r;
  buffer[i++] = env.skyColorGround.g;
  buffer[i++] = env.skyColorGround.b;
  buffer[i++] = env.debugFloorMode;

  // 16-19: floorSize, tileScale
  buffer[i++] = env.floorSize.x;
  buffer[i++] = env.floorSize.y;
  buffer[i++] = env.floorSize.z;
  buffer[i++] = env.tileScale;

  // 20-23: floorCenter, tileDarkFactor
  buffer[i++] = env.floorCenter.x;
  buffer[i++] = env.floorCenter.y;
  buffer[i++] = env.floorCenter.z;
  buffer[i++] = env.tileDarkFactor;

  // 24-27: tileCol1, sunBrightness
  buffer[i++] = env.tileCol1.r;
  buffer[i++] = env.tileCol1.g;
  buffer[i++] = env.tileCol1.b;
  buffer[i++] = env.sunBrightness;

  // 28-31: tileCol2, globalBrightness
  buffer[i++] = env.tileCol2.r;
  buffer[i++] = env.tileCol2.g;
  buffer[i++] = env.tileCol2.b;
  buffer[i++] = env.globalBrightness;

  // 32-35: tileCol3, globalSaturation
  buffer[i++] = env.tileCol3.r;
  buffer[i++] = env.tileCol3.g;
  buffer[i++] = env.tileCol3.b;
  buffer[i++] = env.globalSaturation;

  // 36-39: tileCol4, pad
  buffer[i++] = env.tileCol4.r;
  buffer[i++] = env.tileCol4.g;
  buffer[i++] = env.tileCol4.b;
  buffer[i++] = 0;

  // 40-43: tileColVariation, pad
  buffer[i++] = env.tileColVariation.x;
  buffer[i++] = env.tileColVariation.y;
  buffer[i++] = env.tileColVariation.z;
  buffer[i++] = 0;

  // 44-47: obstacleCenter, pad
  // obstacleCentre.y is the bottom of the obstacle, compute actual center
  buffer[i++] = sim.obstacleCentre.x;
  buffer[i++] = sim.obstacleCentre.y + sim.obstacleSize.y * 0.5;
  buffer[i++] = sim.obstacleCentre.z;
  buffer[i++] = 0;

  // 48-51: obstacleHalfSize, pad
  buffer[i++] = sim.obstacleSize.x * 0.5;
  buffer[i++] = sim.obstacleSize.y * 0.5;
  buffer[i++] = sim.obstacleSize.z * 0.5;
  buffer[i++] = 0;

  // 52-55: obstacleRotation, obstacleAlpha
  buffer[i++] = sim.obstacleRotation.x;
  buffer[i++] = sim.obstacleRotation.y;
  buffer[i++] = sim.obstacleRotation.z;
  buffer[i++] = sim.obstacleAlpha ?? 0.8;

  // 56-59: obstacleColor, pad
  const obsCol = sim.obstacleColor ?? { r: 1, g: 0, b: 0 };
  buffer[i++] = obsCol.r;
  buffer[i++] = obsCol.g;
  buffer[i++] = obsCol.b;
  buffer[i++] = 0;
}
