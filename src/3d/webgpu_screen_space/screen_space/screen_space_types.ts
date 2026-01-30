import type { SimulationBuffers } from '../simulation_buffers.ts';
import type { SimulationBuffersLinear } from '../simulation_buffers_linear.ts';

export type SimBuffers = SimulationBuffers | SimulationBuffersLinear;

export interface ScreenSpaceTextures {
  depthTexture: GPUTexture | null;
  thicknessTexture: GPUTexture | null;
  normalTexture: GPUTexture | null;
  smoothTextureA: GPUTexture | null;
  smoothTextureB: GPUTexture | null;
  shadowTexture: GPUTexture | null;
}

export interface ScreenSpaceFrame {
  viewProjection: Float32Array;
  canvasWidth: number;
  canvasHeight: number;
  particleRadius: number;
  near: number;
  far: number;
}

export interface DepthPassResources extends ScreenSpaceTextures {
  buffers: SimBuffers;
}

export interface ThicknessPassResources extends ScreenSpaceTextures {
  buffers: SimBuffers;
}

export interface NormalPassResources extends ScreenSpaceTextures {
  buffers: SimBuffers;
}

export interface SmoothPassResources extends ScreenSpaceTextures {
  buffers: SimBuffers;
}

export interface ShadowPassResources extends ScreenSpaceTextures {
  buffers: SimBuffers;
}

export interface CompositePassResources extends ScreenSpaceTextures {
  buffers: SimBuffers;
}

export interface CompositePassInputs {
  targetView: GPUTextureView;
}
