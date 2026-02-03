/**
 * =============================================================================
 * Raymarch Configuration Types
 * =============================================================================
 *
 * Extends the base simulation configuration with parameters specific to the
 * raymarched volume rendering pipeline. These control density splatting,
 * ray stepping, floor tiling, lighting, and optical properties of the fluid.
 *
 * @module types
 */

import type { SimConfig } from '../common/types.ts';

/**
 * Configuration for the raymarch-based fluid renderer.
 *
 * Extends {@link SimConfig} (which defines particle count, bounds, smoothing
 * radius, gravity, etc.) with parameters consumed by the density splat
 * pipeline and the full-screen raymarch fragment shader.
 */
export interface RaymarchConfig extends SimConfig {
  // ---------------------------------------------------------------------------
  // Density Volume
  // ---------------------------------------------------------------------------

  /**
   * Resolution of the 3D density texture along its longest axis.
   * The other two axes are scaled proportionally to the bounds aspect ratio.
   * Higher values produce sharper fluid surfaces but increase GPU cost.
   * Typical range: 32–256.
   */
  densityTextureRes: number;

  /**
   * Offset subtracted from the raw density value when sampling.
   * Acts as an iso-surface threshold — higher values carve away
   * low-density regions, producing a tighter fluid surface.
   */
  densityOffset: number;

  /**
   * Multiplier applied to the sampled density during raymarching.
   * Controls how opaque the fluid appears per unit of ray travel.
   */
  densityMultiplier: number;

  // ---------------------------------------------------------------------------
  // Raymarching
  // ---------------------------------------------------------------------------

  /** World-space distance between successive ray samples (primary rays). */
  stepSize: number;

  /** World-space distance between successive samples along shadow/light rays. */
  lightStepSize: number;

  /** Softness of the particle shadow map sampling (0 = hard). */
  shadowSoftness: number;

  /** Maximum number of ray steps before the march terminates. */
  maxSteps: number;

  // ---------------------------------------------------------------------------
  // Floor Tile Colors
  // ---------------------------------------------------------------------------

  /** Tile color for the −X, +Z quadrant (blue by default). Components in [0, 1]. */
  tileCol1: { r: number; g: number; b: number };

  /** Tile color for the +X, +Z quadrant (purple by default). Components in [0, 1]. */
  tileCol2: { r: number; g: number; b: number };

  /** Tile color for the −X, −Z quadrant (green by default). Components in [0, 1]. */
  tileCol3: { r: number; g: number; b: number };

  /** Tile color for the +X, −Z quadrant (yellow by default). Components in [0, 1]. */
  tileCol4: { r: number; g: number; b: number };

  /** HSV variation applied per-tile for subtle randomization. */
  tileColVariation: { x: number; y: number; z: number };

  /** World-space scale of the tile grid (tiles per unit). */
  tileScale: number;

  /** Brightness offset applied to the "dark" tiles in the checkerboard. */
  tileDarkOffset: number;

  /** Multiplier applied to the "dark" tiles in the checkerboard (0–1). */
  tileDarkFactor: number;

  // ---------------------------------------------------------------------------
  // Lighting & Exposure
  // ---------------------------------------------------------------------------

  /** Ambient light level on the floor (0 = fully shadowed, 1 = fully lit). */
  floorAmbient: number;

  /** Global exposure multiplier applied to the final color output. */
  sceneExposure: number;

  /**
   * Debug visualization mode for the floor:
   * - 0 = normal rendering
   * - 1 = solid red (hit test)
   * - 2 = flat quadrant colors (no checkerboard)
   */
  debugFloorMode: number;

  // ---------------------------------------------------------------------------
  // Optical Properties
  // ---------------------------------------------------------------------------

  /**
   * Per-channel extinction (absorption) coefficients for Beer–Lambert
   * transmittance. Higher values make the fluid more opaque along that
   * color channel, producing tinted shadows and color shifts.
   * Stored as { x: red, y: green, z: blue }.
   */
  extinctionCoefficients: { x: number; y: number; z: number };

  /** Index of refraction for the fluid (water ≈ 1.33). */
  indexOfRefraction: number;

  /**
   * Number of refraction bounces to trace per pixel.
   * More bounces produce more realistic caustics and internal reflections
   * but increase cost linearly.
   */
  numRefractions: number;

  // ---------------------------------------------------------------------------
  // Floor Geometry
  // ---------------------------------------------------------------------------

  /** Dimensions (width, height, depth) of the floor slab in world units. */
  floorSize: { x: number; y: number; z: number };

  /** Solid color used to render the obstacle box (linear RGB). */
  obstacleColor: { r: number; g: number; b: number };

  /** Opacity for the obstacle box (0 = transparent, 1 = opaque). */
  obstacleAlpha: number;
}
