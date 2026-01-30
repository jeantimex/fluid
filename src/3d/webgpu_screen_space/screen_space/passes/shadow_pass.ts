/**
 * Shadow pass skeleton: render shadow map and optional smoothing.
 */

import type {
  ScreenSpaceFrame,
  ShadowPassResources,
} from '../screen_space_types.ts';

export class ShadowPass {
  private device: GPUDevice;

  constructor(device: GPUDevice) {
    this.device = device;
  }

  resize(_width: number, _height: number) {
    // Placeholder.
  }

  createBindGroup(_resources: ShadowPassResources) {
    // Placeholder.
  }

  encode(
    _encoder: GPUCommandEncoder,
    _resources: ShadowPassResources,
    _frame: ScreenSpaceFrame
  ) {
    // Placeholder.
  }
}
