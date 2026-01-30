/**
 * Normal pass skeleton: reconstruct normals from depth.
 */

import type {
  NormalPassResources,
  ScreenSpaceFrame,
} from '../screen_space_types.ts';

export class NormalPass {
  private device: GPUDevice;

  constructor(device: GPUDevice) {
    this.device = device;
  }

  resize(_width: number, _height: number) {
    // Placeholder.
  }

  createBindGroup(_resources: NormalPassResources) {
    // Placeholder.
  }

  encode(
    _encoder: GPUCommandEncoder,
    _resources: NormalPassResources,
    _frame: ScreenSpaceFrame
  ) {
    // Placeholder.
  }
}
