/**
 * =============================================================================
 * Marching Cubes Configuration Types
 * =============================================================================
 *
 * Extends the base simulation configuration with parameters specific to the
 * marching cubes renderer (density volume resolution and iso-surface settings).
 *
 * @module types
 */

import type { SimConfig } from '../common/types.ts';
import type { EnvironmentConfig } from '../common/environment.ts';

export interface MarchingCubesConfig extends SimConfig, EnvironmentConfig {
  /**
   * Resolution of the 3D density texture along its longest axis.
   * The other two axes are scaled proportionally to the bounds aspect ratio.
   */
  densityTextureRes: number;

  /**
   * Iso-surface threshold. Higher values carve away low-density regions,
   * producing a tighter surface.
   */
  isoLevel: number;

  /**
   * Base surface color for the generated mesh (linear RGB).
   */
  surfaceColor: { r: number; g: number; b: number };

  /** Scales shadow ray step size for softer shadows. */
  shadowSoftness: number;

  /** Whether to show the bounds wireframe. */
  showBoundsWireframe: boolean;

  /** Color of the bounds wireframe (linear RGB). */
  boundsWireframeColor: { r: number; g: number; b: number };
}
