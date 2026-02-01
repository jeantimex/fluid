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

export interface MarchingCubesConfig extends SimConfig {
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
}
