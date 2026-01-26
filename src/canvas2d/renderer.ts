/**
 * Canvas 2D renderer for particle visualization.
 *
 * This module handles all rendering concerns:
 * - Canvas setup and resize handling
 * - Coordinate system transformation (world ↔ screen)
 * - Particle rendering with velocity-based coloring
 *
 * The renderer uses direct pixel manipulation via ImageData for maximum
 * performance. Each particle is drawn as a filled circle using a precomputed
 * "stamp" of pixel offsets.
 *
 * Coordinate System:
 * - World coordinates: Origin at center, Y-up (mathematical convention)
 * - Canvas coordinates: Origin at top-left, Y-down (screen convention)
 * - Scale factor converts between them, maintaining aspect ratio
 */

import type {
  RGB,
  Renderer,
  SimConfig,
  SimState,
  Vec2,
} from '../common/types.ts';

/**
 * Creates a renderer for the fluid simulation.
 *
 * The renderer manages a 2D canvas context and provides methods for:
 * - Drawing particles with velocity-based colors
 * - Converting between world and canvas coordinates
 * - Handling canvas resize while preserving physics scale
 *
 * Performance Optimizations:
 * - Direct pixel buffer manipulation (faster than fillRect)
 * - Precomputed circular stamp for particle drawing
 * - Color lookup table for velocity → RGB mapping
 *
 * @param canvas - HTML canvas element to render to
 * @param config - Simulation configuration
 * @param gradientLut - Precomputed color gradient for velocity mapping
 * @returns Renderer interface with draw and coordinate conversion methods
 */
export function createRenderer(
  canvas: HTMLCanvasElement,
  config: SimConfig,
  gradientLut: RGB[]
): Renderer {
  // Get 2D rendering context (non-null assertion - we know canvas supports 2D)
  const ctx = canvas.getContext('2d')!;

  // Image data for direct pixel manipulation
  let imageData = ctx.createImageData(canvas.width, canvas.height);
  let pixelBuffer = imageData.data;

  // Coordinate transformation state
  let baseUnitsPerPixel: number | null = null; // Set on first resize
  let scale = canvas.width / config.boundsSize.x;
  let originX = canvas.width * 0.5; // Canvas center X
  let originY = canvas.height * 0.5; // Canvas center Y

  // Particle stamp (circular pattern of pixel offsets)
  let stampRadius = -1;
  let stampOffsets: [number, number][] = [];

  /**
   * Handles canvas resize events.
   *
   * When the canvas size changes, this function:
   * 1. Updates canvas dimensions to match CSS size
   * 2. Recreates the pixel buffer
   * 3. Recalculates the world bounds to maintain scale
   *
   * The key insight is that we preserve the "units per pixel" ratio from
   * the first resize. This ensures physics behavior stays consistent even
   * as the window is resized - particles don't suddenly move faster or
   * slower because the viewport changed.
   */
  function resizeCanvas(): void {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    // Calculate canvas dimensions in device pixels for sharp rendering
    const nextWidth = Math.max(1, Math.round(rect.width * dpr));
    const nextHeight = Math.max(1, Math.round(rect.height * dpr));

    // Capture initial scale on first resize (use CSS pixels for physics consistency)
    if (baseUnitsPerPixel === null) {
      const refWidth = Math.max(1, rect.width);
      baseUnitsPerPixel = config.boundsSize.x / refWidth;
    }

    // Resize canvas buffer if dimensions changed
    if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
      canvas.width = nextWidth;
      canvas.height = nextHeight;
      imageData = ctx.createImageData(canvas.width, canvas.height);
      pixelBuffer = imageData.data;
    }

    // Update world bounds to maintain consistent scale
    // Use CSS pixels (divide by DPR) to keep physics behavior consistent
    config.boundsSize = {
      x: (canvas.width / dpr) * baseUnitsPerPixel,
      y: (canvas.height / dpr) * baseUnitsPerPixel,
    };

    // Recalculate transformation parameters
    scale = canvas.width / config.boundsSize.x;
    originX = canvas.width * 0.5;
    originY = canvas.height * 0.5;
  }

  /**
   * Converts world coordinates to canvas pixel coordinates.
   *
   * World space: Origin at center, positive Y is up
   * Canvas space: Origin at top-left, positive Y is down
   *
   * Transform: canvas = origin + world * scale (with Y flipped)
   *
   * @param x - World X coordinate
   * @param y - World Y coordinate
   * @returns Canvas pixel coordinates
   */
  function worldToCanvas(x: number, y: number): Vec2 {
    return {
      x: originX + x * scale,
      y: originY - y * scale, // Flip Y axis
    };
  }

  /**
   * Converts canvas pixel coordinates to world coordinates.
   *
   * This is the inverse of worldToCanvas, used for mouse interaction.
   *
   * @param x - Canvas X coordinate (pixels)
   * @param y - Canvas Y coordinate (pixels)
   * @returns World coordinates
   */
  function canvasToWorld(x: number, y: number): Vec2 {
    return {
      x: (x - originX) / scale,
      y: (originY - y) / scale, // Flip Y axis
    };
  }

  /**
   * Rebuilds the particle stamp when radius changes.
   *
   * The stamp is a list of (dx, dy) pixel offsets that form a filled circle.
   * By precomputing this, we avoid per-particle circle calculations.
   *
   * For a particle at pixel (px, py), we draw all pixels (px+dx, py+dy)
   * where (dx, dy) is in the stamp and the resulting pixel is in bounds.
   *
   * The stamp is rebuilt only when particleRadius changes.
   */
  function rebuildStamp(): void {
    // Scale particle radius by DPR since canvas uses device pixels
    const dpr = window.devicePixelRatio || 1;
    const nextRadius = Math.max(1, Math.round(config.particleRadius * dpr));
    if (nextRadius === stampRadius) return;

    stampRadius = nextRadius;
    const offsets: [number, number][] = [];
    const r2 = stampRadius * stampRadius;

    // Generate all pixel offsets within the circle
    for (let oy = -stampRadius; oy <= stampRadius; oy += 1) {
      for (let ox = -stampRadius; ox <= stampRadius; ox += 1) {
        // Check if offset is within circle (using squared distance)
        if (ox * ox + oy * oy <= r2) {
          offsets.push([ox, oy]);
        }
      }
    }

    stampOffsets = offsets;
  }

  /**
   * Renders the current simulation state to the canvas.
   *
   * Rendering steps:
   * 1. Clear the buffer with background color
   * 2. For each particle:
   *    a. Transform world position to canvas pixels
   *    b. Calculate velocity magnitude and map to color
   *    c. Draw the particle stamp at that position
   * 3. Copy the buffer to the canvas
   * 4. Draw the boundary rectangle
   *
   * The velocity-to-color mapping creates a visual "temperature" effect
   * where slow particles are blue and fast particles are orange.
   *
   * @param state - Current simulation state with particle data
   */
  function draw(state: SimState): void {
    const width = canvas.width;
    const height = canvas.height;

    // Clear buffer and fill with dark background
    pixelBuffer.fill(0);
    const bg = [5, 7, 11]; // Dark blue-gray background
    for (let i = 0; i < pixelBuffer.length; i += 4) {
      pixelBuffer[i] = bg[0]; // R
      pixelBuffer[i + 1] = bg[1]; // G
      pixelBuffer[i + 2] = bg[2]; // B
      pixelBuffer[i + 3] = 255; // A (fully opaque)
    }

    const maxSpeed = config.velocityDisplayMax;
    rebuildStamp();

    // Draw each particle
    for (let i = 0; i < state.count; i += 1) {
      // Get particle position and velocity from interleaved arrays
      const x = state.positions[i * 2];
      const y = state.positions[i * 2 + 1];
      const p = worldToCanvas(x, y);

      const vx = state.velocities[i * 2];
      const vy = state.velocities[i * 2 + 1];

      // Calculate speed and map to color gradient
      const speed = Math.sqrt(vx * vx + vy * vy);
      const t = Math.max(0, Math.min(1, speed / maxSpeed));

      // Look up color in precomputed gradient
      const idx = Math.min(
        gradientLut.length - 1,
        Math.floor(t * (gradientLut.length - 1))
      );
      const col = gradientLut[idx];

      // Convert normalized color to 8-bit
      const r = Math.round(col.r * 255);
      const g = Math.round(col.g * 255);
      const b = Math.round(col.b * 255);

      // Particle center in pixels
      const px = Math.round(p.x);
      const py = Math.round(p.y);

      // Draw the stamp (filled circle)
      for (let j = 0; j < stampOffsets.length; j += 1) {
        const offset = stampOffsets[j];
        const yy = py + offset[1];
        if (yy < 0 || yy >= height) continue;

        const xx = px + offset[0];
        if (xx < 0 || xx >= width) continue;

        // Calculate pixel buffer index (RGBA format)
        const pixelIndex = (yy * width + xx) * 4;
        pixelBuffer[pixelIndex] = r;
        pixelBuffer[pixelIndex + 1] = g;
        pixelBuffer[pixelIndex + 2] = b;
        pixelBuffer[pixelIndex + 3] = 255;
      }
    }

    // Copy pixel buffer to canvas
    ctx.putImageData(imageData, 0, 0);

    // Draw boundary rectangle
    const halfW = (config.boundsSize.x * scale) / 2;
    const halfH = (config.boundsSize.y * scale) / 2;
    ctx.strokeStyle = '#1b2432'; // Dark border color
    ctx.lineWidth = 1;
    ctx.strokeRect(originX - halfW, originY - halfH, halfW * 2, halfH * 2);

    if (config.obstacleSize.x > 0 && config.obstacleSize.y > 0) {
      const obstacleHalfW = (config.obstacleSize.x * scale) / 2;
      const obstacleHalfH = (config.obstacleSize.y * scale) / 2;
      const obstacleCenter = worldToCanvas(
        config.obstacleCentre.x,
        config.obstacleCentre.y
      );
      ctx.strokeStyle = '#36516d';
      ctx.strokeRect(
        obstacleCenter.x - obstacleHalfW,
        obstacleCenter.y - obstacleHalfH,
        obstacleHalfW * 2,
        obstacleHalfH * 2
      );
    }
  }

  // Initialize canvas size
  resizeCanvas();

  // Handle window resize
  window.addEventListener('resize', resizeCanvas);

  return {
    draw,
    worldToCanvas,
    canvasToWorld,
    getScale: () => scale,
  };
}
