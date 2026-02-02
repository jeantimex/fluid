import type { FluidAppAdapter } from '../types.ts';
import { MarchingCubesAdapter } from './marching_cubes_adapter.ts';
import { ParticlesAdapter } from './particles_adapter.ts';
import { RaymarchAdapter } from './raymarch_adapter.ts';
import { ScreenSpaceAdapter } from './screen_space_adapter.ts';

export type AdapterFactory = () => FluidAppAdapter;

export interface AdapterRegistryEntry {
  name: string;
  create: AdapterFactory;
}

export const adapterRegistry: AdapterRegistryEntry[] = [
  { name: 'Particles', create: () => new ParticlesAdapter() },
  { name: 'Marching Cubes', create: () => new MarchingCubesAdapter() },
  { name: 'Raymarch', create: () => new RaymarchAdapter() },
  { name: 'Screen Space', create: () => new ScreenSpaceAdapter() },
];
