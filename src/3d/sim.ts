/**
 * Lightweight 3D simulation bootstrap (no physics/rendering yet).
 */

import type { Sim, SimState, SpawnData } from './common/types.ts';
import { createConfig } from './common/config.ts';
import { createSpawnData } from './common/spawn.ts';

function createStateFromSpawn(spawn: SpawnData): SimState {
  const count = spawn.count;

  return {
    positions: spawn.positions,
    predicted: new Float32Array(spawn.positions),
    velocities: spawn.velocities,
    densities: new Float32Array(count * 2),

    keys: new Uint32Array(count),
    sortedKeys: new Uint32Array(count),
    indices: new Uint32Array(count),
    sortOffsets: new Uint32Array(count),
    spatialOffsets: new Uint32Array(count),

    positionsSorted: new Float32Array(count * 3),
    predictedSorted: new Float32Array(count * 3),
    velocitiesSorted: new Float32Array(count * 3),

    count,

    input: {
      world: { x: 0, y: 0, z: 0 },
      pull: false,
      push: false,
    },
  };
}

export function createSim(): Sim {
  const config = createConfig();
  const spawn = createSpawnData(config);
  const state = createStateFromSpawn(spawn);

  function reset(): void {
    const nextSpawn = createSpawnData(config);
    const nextCount = nextSpawn.count;

    state.positions = nextSpawn.positions;
    state.predicted = new Float32Array(nextSpawn.positions);
    state.velocities = nextSpawn.velocities;

    state.densities = new Float32Array(nextCount * 2);
    state.keys = new Uint32Array(nextCount);
    state.sortedKeys = new Uint32Array(nextCount);
    state.indices = new Uint32Array(nextCount);
    state.sortOffsets = new Uint32Array(nextCount);
    state.spatialOffsets = new Uint32Array(nextCount);

    state.positionsSorted = new Float32Array(nextCount * 3);
    state.predictedSorted = new Float32Array(nextCount * 3);
    state.velocitiesSorted = new Float32Array(nextCount * 3);

    state.count = nextCount;
  }

  return {
    state,
    config,
    reset,
  };
}
