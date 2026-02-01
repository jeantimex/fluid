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
import type { EnvironmentConfig } from '../common/environment.ts';

/**
 * Configuration for the raymarch-based fluid renderer.
 *
 * Extends {@link SimConfig} (which defines particle count, bounds, smoothing
 * radius, gravity, etc.) with parameters consumed by the density splat
 * pipeline and the full-screen raymarch fragment shader.
 */
export interface RaymarchConfig extends SimConfig, EnvironmentConfig {
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

  /** Maximum number of ray steps before the march terminates. */
  maxSteps: number;

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
}
