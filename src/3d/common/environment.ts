import type { RGB, Vec3, SimConfig } from './types.ts';

export interface EnvironmentConfig {
  // Lighting
  dirToSun: Vec3;
  floorAmbient: number;
  sceneExposure: number;

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
}

export function createDefaultEnvironmentConfig(): EnvironmentConfig {
  return {
    // Lighting (from Raymarch demo defaults)
    dirToSun: { x: 0.83, y: 0.42, z: 0.36 }, // Approximate normalized vector
    floorAmbient: 1.0,
    sceneExposure: 1.4,

    // Sky (Matches raymarch.wgsl hardcoded values)
    skyColorHorizon: { r: 1.0, g: 1.0, b: 1.0 },
    skyColorZenith: { r: 0.08, g: 0.37, b: 0.73 },
    skyColorGround: { r: 0.35 * 0.53, g: 0.3 * 0.53, b: 0.35 * 0.53 }, // 0.1855, 0.159, 0.1855
    sunPower: 500.0,

    // Floor
    floorSize: { x: 80, y: 0.05, z: 80 },
    floorCenter: { x: 0, y: -5.025, z: 0 }, // Just below bounds usually
    tileScale: 1.0,
    tileDarkFactor: 0.5,
    
    // Raymarch demo colors
    tileCol1: { r: 126 / 255, g: 183 / 255, b: 231 / 255 }, // Blue
    tileCol2: { r: 210 / 255, g: 165 / 255, b: 240 / 255 }, // Purple
    tileCol3: { r: 153 / 255, g: 229 / 255, b: 199 / 255 }, // Green
    tileCol4: { r: 237 / 255, g: 225 / 255, b: 167 / 255 }, // Yellow
    tileColVariation: { x: 0, y: 0, z: 0 },
    debugFloorMode: 0,
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

  // 24-27: tileCol1, pad
  buffer[i++] = env.tileCol1.r;
  buffer[i++] = env.tileCol1.g;
  buffer[i++] = env.tileCol1.b;
  buffer[i++] = 0;

  // 28-31: tileCol2, pad
  buffer[i++] = env.tileCol2.r;
  buffer[i++] = env.tileCol2.g;
  buffer[i++] = env.tileCol2.b;
  buffer[i++] = 0;

  // 32-35: tileCol3, pad
  buffer[i++] = env.tileCol3.r;
  buffer[i++] = env.tileCol3.g;
  buffer[i++] = env.tileCol3.b;
  buffer[i++] = 0;

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
  buffer[i++] = sim.obstacleCentre.x;
  buffer[i++] = sim.obstacleCentre.y;
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