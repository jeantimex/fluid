import { Scene } from '../canvas2d/types';
import { createDefaultScene } from './scene';

export interface SimulationContext {
  scene: Scene;
  simWidth: number;
  simHeight: number;
  cScale: number;
}

export function createSimulationContext(): SimulationContext {
  return {
    scene: createDefaultScene(),
    simWidth: 1.0,
    simHeight: 3.0,
    cScale: 300.0,
  };
}
