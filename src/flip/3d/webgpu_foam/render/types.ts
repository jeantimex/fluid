export type Vec3 = [number, number, number];

export interface SceneConfig {
  dirToSun: Vec3;
  floorY: number;
  skyColorHorizon: Vec3;
  sunPower: number;
  skyColorZenith: Vec3;
  sunBrightness: number;
  skyColorGround: Vec3;
  floorSize: number;
  tileCol1: Vec3;
  tileScale: number;
  tileCol2: Vec3;
  tileDarkFactor: number;
  tileCol3: Vec3;
  tileCol4: Vec3;
}
