/**
 * WebGPU Initialization Utilities
 *
 * This module provides helper functions for initializing WebGPU, which is
 * a modern graphics API that provides low-level access to GPU hardware
 * for both rendering and compute operations.
 *
 * WebGPU initialization involves several steps:
 * 1. Check if the browser supports WebGPU (navigator.gpu)
 * 2. Request an adapter (represents the physical GPU)
 * 3. Request a device (logical connection to the GPU)
 * 4. Get a canvas context for rendering
 * 5. Configure the context with the device and preferred format
 */

/**
 * Contains the essential WebGPU objects needed for rendering.
 */
export interface WebGPUContext {
  /** The logical GPU device used to create resources and submit commands */
  device: GPUDevice;
  /** The canvas context that manages the swap chain for presenting frames */
  context: GPUCanvasContext;
  /** The preferred texture format for the canvas (e.g., 'bgra8unorm') */
  format: GPUTextureFormat;
  /** Whether subgroup operations are supported */
  supportsSubgroups: boolean;
  /** Whether running on a mobile device (use for performance optimizations) */
  isMobile: boolean;
}

/**
 * Detects if the current device is a mobile device.
 * Used to enable mobile-specific optimizations like shared memory shaders.
 */
export function detectMobile(): boolean {
  // Check for mobile user agent patterns
  const userAgent = navigator.userAgent.toLowerCase();
  const mobileKeywords = [
    'android',
    'iphone',
    'ipad',
    'ipod',
    'mobile',
    'tablet',
  ];
  const isMobileUA = mobileKeywords.some((keyword) =>
    userAgent.includes(keyword)
  );

  // Also check for touch capability as a secondary signal
  const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

  // Check screen size (mobile typically < 1024px width)
  const isSmallScreen = window.innerWidth < 1024;

  // Consider mobile if user agent matches OR (has touch AND small screen)
  return isMobileUA || (hasTouch && isSmallScreen);
}

/**
 * Custom error class for WebGPU initialization failures.
 * Thrown when WebGPU is not supported or initialization fails.
 */
export class WebGPUInitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebGPUInitError';
  }
}

/**
 * Initializes WebGPU and returns the device, context, and preferred format.
 *
 * This function performs the complete WebGPU initialization sequence:
 * 1. Checks for WebGPU support via navigator.gpu
 * 2. Requests a GPU adapter (physical GPU representation)
 * 3. Requests a logical device from the adapter
 * 4. Gets a WebGPU context from the canvas
 * 5. Determines the preferred texture format for the display
 *
 * @param canvas - The HTML canvas element to use for rendering
 * @returns Promise resolving to WebGPU device, context, and texture format
 * @throws WebGPUInitError if WebGPU is not supported or initialization fails
 *
 * @example
 * ```typescript
 * const canvas = document.querySelector('canvas');
 * const { device, context, format } = await initWebGPU(canvas);
 * ```
 */
export async function initWebGPU(
  canvas: HTMLCanvasElement
): Promise<WebGPUContext> {
  // Check if WebGPU is available in this browser
  if (!navigator.gpu) {
    throw new WebGPUInitError('WebGPU is not supported in this browser.');
  }

  // Request a GPU adapter - this represents the physical GPU hardware
  // Returns null if no suitable adapter is found
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    throw new WebGPUInitError('Unable to acquire a WebGPU adapter.');
  }

  // Check if subgroups are supported for optimized prefix sum operations
  const supportsSubgroups = adapter.features.has('subgroups');
  if (supportsSubgroups) {
    console.log('WebGPU subgroups supported - enabling optimized prefix sum');
  }

  // Request a logical device from the adapter
  // The device is used to create all GPU resources (buffers, textures, pipelines)
  // Request subgroups feature if available for optimized compute operations
  const requiredFeatures: GPUFeatureName[] = [];
  if (supportsSubgroups) {
    requiredFeatures.push('subgroups' as GPUFeatureName);
  }
  const device = await adapter.requestDevice({
    requiredFeatures,
  });

  // Get a WebGPU rendering context from the canvas
  // This context manages the textures used for displaying rendered frames
  const context = canvas.getContext('webgpu');
  if (!context) {
    throw new WebGPUInitError('Unable to create a WebGPU context.');
  }

  // Get the preferred texture format for this display
  // This is typically 'bgra8unorm' on most systems
  const format = navigator.gpu.getPreferredCanvasFormat();

  // Detect mobile for performance optimizations
  const isMobile = detectMobile();
  if (isMobile) {
    console.log(
      'Mobile device detected - enabling shared memory optimizations'
    );
  }

  return { device, context, format, supportsSubgroups, isMobile };
}

/**
 * Configures the canvas context with the given device and format.
 *
 * This must be called whenever the canvas is resized to update the
 * swap chain textures to match the new canvas dimensions.
 *
 * @param context - The WebGPU canvas context to configure
 * @param device - The GPU device to associate with the context
 * @param format - The texture format to use for the swap chain
 *
 * Configuration options:
 * - device: Links the context to a specific GPU device
 * - format: Texture format for the swap chain (usually from getPreferredCanvasFormat)
 * - alphaMode: 'opaque' means no transparency (better performance)
 */
export function configureContext(
  context: GPUCanvasContext,
  device: GPUDevice,
  format: GPUTextureFormat
): void {
  context.configure({
    device,
    format,
    alphaMode: 'opaque',
  });
}
