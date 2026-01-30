/**
 * Smooth pass skeleton: blur/smooth thickness or depth in screen space.
 */

import type {
  ScreenSpaceFrame,
  SmoothPassResources,
} from '../screen_space_types.ts';

export class SmoothPass {
  private device: GPUDevice;

  constructor(device: GPUDevice) {
    this.device = device;
  }

  resize(_width: number, _height: number) {
    // Placeholder.
  }

  createBindGroup(_resources: SmoothPassResources) {
    // Placeholder.
  }

  encode(
    _encoder: GPUCommandEncoder,
    _resources: SmoothPassResources,
    _frame: ScreenSpaceFrame
  ) {
    // Placeholder.
  }
}
