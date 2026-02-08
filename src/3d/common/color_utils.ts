/**
 * Converts a normalized RGB color (components in [0, 1]) to a hex string.
 *
 * Used to bridge the config's normalized color values with lil-gui's
 * `addColor` control, which expects CSS hex strings like `"#7eb7e7"`.
 *
 * @param rgb - Color with r, g, b in [0, 1]
 * @returns Hex string in the form `"#rrggbb"`
 */
export function rgbToHex(rgb: { r: number; g: number; b: number }): string {
  const toByte = (value: number): number =>
    Math.max(0, Math.min(255, Math.round(value * 255)));
  const r = toByte(rgb.r).toString(16).padStart(2, '0');
  const g = toByte(rgb.g).toString(16).padStart(2, '0');
  const b = toByte(rgb.b).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
}

/**
 * Converts a CSS hex color string to an RGB object with byte values (0-255).
 *
 * The caller divides each component by 255 before writing back to the config
 * to restore the normalized [0, 1] range used by the shader uniforms.
 *
 * @param hex - Hex string, with or without leading `#` (e.g. `"#7eb7e7"`)
 * @returns RGB object with r, g, b in [0, 255]
 */
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const normalized = hex.trim().replace('#', '');
  if (normalized.length !== 6) {
    return { r: 0, g: 0, b: 0 };
  }
  const value = Number.parseInt(normalized, 16);
  return {
    r: (value >> 16) & 0xff,
    g: (value >> 8) & 0xff,
    b: value & 0xff,
  };
}
