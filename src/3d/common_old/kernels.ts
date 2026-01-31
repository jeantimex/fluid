/**
 * SPH (Smoothed Particle Hydrodynamics) kernel functions.
 *
 * Kernel functions (also called smoothing functions or weight functions) are
 * the mathematical foundation of SPH. They define how physical quantities
 * are interpolated between particles based on distance.
 *
 * A kernel function W(r, h) has these properties:
 * - Normalized: ∫W(r,h)dr = 1 (total influence sums to 1)
 * - Compact support: W(r,h) = 0 for r ≥ h (zero outside smoothing radius)
 * - Symmetric: W depends only on |r|, not direction
 * - Monotonically decreasing: closer particles have more influence
 *
 * Different kernels have different properties:
 * - Poly6: Good for density estimation (smooth, no discontinuities)
 * - Spiky: Good for pressure forces (sharp gradient at r=0 prevents clustering)
 *
 * The "scale" parameters are normalization constants precomputed from the
 * smoothing radius to avoid repeated calculation.
 *
 * Reference: Müller et al., "Particle-Based Fluid Simulation for Interactive
 * Applications" (2003)
 */

import type { ColorKey, RGB } from './types.ts';

/**
 * Poly6 smoothing kernel for density estimation.
 *
 * Formula: W(r,h) = (315 / 64πh⁹) · (h² - r²)³  for r < h
 *
 * This kernel is smooth everywhere (C² continuous) and has a maximum at r=0.
 * It's ideal for density calculation because its gradient is zero at r=0,
 * which prevents numerical instability when particles overlap.
 *
 * The (h² - r²)³ term creates a smooth falloff that reaches zero at r=h
 * with zero derivative (tangent smoothly meets zero).
 *
 * @param dst - Distance between particles
 * @param radius - Smoothing radius (h)
 * @param scale - Precomputed normalization: 4 / (π · h⁸)
 * @returns Kernel value at distance dst
 */
export function smoothingKernelPoly6(
  dst: number,
  radius: number,
  scale: number
): number {
  if (dst < radius) {
    // (h² - r²)³ · scale
    const v = radius * radius - dst * dst;
    return v * v * v * scale;
  }
  return 0;
}

/**
 * Spiky kernel (cubic) for near-pressure forces.
 *
 * Formula: W(r,h) = (15 / πh⁶) · (h - r)³  for r < h
 *
 * The spiky kernel has a sharp peak at r=0 (non-zero gradient), which
 * creates strong repulsive forces when particles get very close. This
 * prevents particle clumping and improves surface tension behavior.
 *
 * The cubic version (pow3) provides stronger near-field repulsion than
 * the quadratic version, useful for maintaining particle separation.
 *
 * @param dst - Distance between particles
 * @param radius - Smoothing radius (h)
 * @param scale - Precomputed normalization: 10 / (π · h⁵)
 * @returns Kernel value at distance dst
 */
export function spikyKernelPow3(
  dst: number,
  radius: number,
  scale: number
): number {
  if (dst < radius) {
    // (h - r)³ · scale
    const v = radius - dst;
    return v * v * v * scale;
  }
  return 0;
}

/**
 * Spiky kernel (quadratic) for pressure forces.
 *
 * Formula: W(r,h) = (15 / 2πh⁵) · (h - r)²  for r < h
 *
 * Similar to the cubic spiky kernel but with weaker near-field behavior.
 * Used for standard pressure force calculations where the sharp peak
 * prevents particles from passing through each other.
 *
 * @param dst - Distance between particles
 * @param radius - Smoothing radius (h)
 * @param scale - Precomputed normalization: 6 / (π · h⁴)
 * @returns Kernel value at distance dst
 */
export function spikyKernelPow2(
  dst: number,
  radius: number,
  scale: number
): number {
  if (dst < radius) {
    // (h - r)² · scale
    const v = radius - dst;
    return v * v * scale;
  }
  return 0;
}

/**
 * Gradient of the cubic spiky kernel (derivative with respect to r).
 *
 * Formula: ∇W(r,h) = -(45 / πh⁶) · (h - r)²  for r ≤ h
 *
 * The gradient is used to compute pressure forces. The negative sign
 * indicates that force points from high to low density (outward from
 * compressed regions).
 *
 * Note: This returns the scalar derivative. The actual gradient vector
 * is this value multiplied by the unit direction vector (r̂ = r/|r|).
 *
 * @param dst - Distance between particles
 * @param radius - Smoothing radius (h)
 * @param scale - Precomputed normalization: 30 / (π · h⁵)
 * @returns Gradient magnitude (negative, pointing toward particle)
 */
export function derivativeSpikyPow3(
  dst: number,
  radius: number,
  scale: number
): number {
  if (dst <= radius) {
    // -(h - r)² · scale
    const v = radius - dst;
    return -v * v * scale;
  }
  return 0;
}

/**
 * Gradient of the quadratic spiky kernel.
 *
 * Formula: ∇W(r,h) = -(30 / πh⁵) · (h - r)  for r ≤ h
 *
 * Linear falloff of gradient magnitude from center to edge.
 * Used for standard pressure force calculations.
 *
 * @param dst - Distance between particles
 * @param radius - Smoothing radius (h)
 * @param scale - Precomputed normalization: 12 / (π · h⁴)
 * @returns Gradient magnitude (negative)
 */
export function derivativeSpikyPow2(
  dst: number,
  radius: number,
  scale: number
): number {
  if (dst <= radius) {
    // -(h - r) · scale
    const v = radius - dst;
    return -v * scale;
  }
  return 0;
}

/**
 * Builds a color lookup table (LUT) from gradient keyframes.
 *
 * This function pre-interpolates a color gradient into a fixed-size array
 * for fast runtime lookup. Using a LUT avoids repeated interpolation
 * calculations during rendering.
 *
 * The gradient uses linear interpolation between keyframes. Each keyframe
 * specifies a position (t) in [0,1] and an RGB color.
 *
 * @param keys - Array of color keyframes with position (t) and RGB values
 * @param resolution - Number of entries in the output LUT
 * @returns Array of interpolated RGB colors
 *
 * @example
 * const keys = [
 *   { t: 0, r: 0, g: 0, b: 1 },     // Blue at start
 *   { t: 1, r: 1, g: 0, b: 0 },     // Red at end
 * ]
 * const lut = buildGradientLut(keys, 256)
 * // lut[0] ≈ blue, lut[255] ≈ red, lut[128] ≈ purple
 */
export function buildGradientLut(keys: ColorKey[], resolution: number): RGB[] {
  // Sort keyframes by position for correct interpolation
  const sorted = [...keys].sort((a, b) => a.t - b.t);
  const lut: RGB[] = new Array(resolution);

  for (let i = 0; i < resolution; i += 1) {
    // Map array index to [0, 1] range
    const t = resolution === 1 ? 0 : i / (resolution - 1);

    // Find the two keyframes that bracket this position
    let left = sorted[0];
    let right = sorted[sorted.length - 1];

    for (let k = 0; k < sorted.length - 1; k += 1) {
      const a = sorted[k];
      const b = sorted[k + 1];
      if (t >= a.t && t <= b.t) {
        left = a;
        right = b;
        break;
      }
    }

    // Linear interpolation between bracketing keyframes
    const span = right.t - left.t || 1; // Avoid division by zero
    const localT = (t - left.t) / span;

    const r = left.r + (right.r - left.r) * localT;
    const g = left.g + (right.g - left.g) * localT;
    const b = left.b + (right.b - left.b) * localT;

    lut[i] = { r, g, b };
  }

  return lut;
}
