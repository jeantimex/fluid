import type { SimulationBuffers } from '../simulation_buffers.ts';
import type { SimulationBuffersLinear } from '../simulation_buffers_linear.ts';
import type { RGB, Vec3 } from '../../common/types.ts';

export type SimBuffers = SimulationBuffers | SimulationBuffersLinear;

export interface ScreenSpaceTextures {
  depthTexture: GPUTexture | null;
  thicknessTexture: GPUTexture | null;
  normalTexture: GPUTexture | null;
  smoothTextureA: GPUTexture | null;
  smoothTextureB: GPUTexture | null;
  shadowTexture: GPUTexture | null;
  foamTexture: GPUTexture | null;
}

export interface ScreenSpaceFrame {
  viewProjection: Float32Array;
  inverseViewProjection: Float32Array;
  lightViewProjection: Float32Array;
  canvasWidth: number;
  canvasHeight: number;
  particleRadius: number;
  foamParticleRadius: number;
  near: number;
  far: number;
  foamColor: RGB;
  foamOpacity: number;
  extinctionCoeff: Vec3;
  extinctionMultiplier: number;
  refractionStrength: number;
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

export interface FoamPassResources extends ScreenSpaceTextures {
  buffers: SimBuffers;
  foamPositions: GPUBuffer;
  foamVelocities: GPUBuffer;
  maxFoamParticles: number;
}

export interface CompositePassInputs {
  targetView: GPUTextureView;
}
