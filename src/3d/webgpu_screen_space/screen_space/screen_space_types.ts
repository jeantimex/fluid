import type { SimulationBuffersLinear } from '../simulation_buffers_linear.ts';
import type { RGB, Vec3 } from '../../common/types.ts';
import type { EnvironmentConfig } from '../../common/environment.ts';

export type SimBuffers = SimulationBuffersLinear;

export interface ScreenSpaceTextures {
  depthTexture: GPUTexture | null;
  thicknessTexture: GPUTexture | null;
  normalTexture: GPUTexture | null;
  smoothTextureA: GPUTexture | null;
  smoothTextureB: GPUTexture | null;
  foamTexture: GPUTexture | null;
  shadowTexture: GPUTexture | null;
  shadowSmoothTexture: GPUTexture | null;
}

export interface ScreenSpaceFrame extends EnvironmentConfig {
  viewProjection: Float32Array;
  inverseViewProjection: Float32Array;
  canvasWidth: number;
  canvasHeight: number;
  particleRadius: number;
  foamParticleRadius: number;
  near: number;
  far: number;
  waterColor: RGB;
  deepWaterColor: RGB;
  foamColor: RGB;
  foamOpacity: number;
  extinctionCoeff: Vec3;
  extinctionMultiplier: number;
  refractionStrength: number;
  showFluidShadows: boolean;
  // Overlapping fields removed as they are in EnvironmentConfig: dirToSun
  
  // Obstacle fields (from SimConfig)
  obstacleCentre: Vec3;
  obstacleHalfSize: Vec3; // Derived from size
  obstacleRotation: Vec3;
  obstacleColor: RGB;
  obstacleAlpha: number;

  // Wireframe fields
  showBoundsWireframe: boolean;
  boundsWireframeColor: RGB;
  boundsSize: Vec3;

  // Shadow
  shadowViewProjection: Float32Array | null;
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

export interface CompositePassResources extends ScreenSpaceTextures {
  buffers: SimBuffers;
}

export interface FoamPassResources extends ScreenSpaceTextures {
  buffers: SimBuffers;
  foamPositions: GPUBuffer;
  foamVelocities: GPUBuffer;
  maxFoamParticles: number;
}
