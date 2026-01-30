/**
 * ============================================================================
 * FOAM SPAWN COMPUTE SHADER (MATCHING UNITY)
 * ============================================================================
 *
 * Entry Point: main
 * Workgroup Size: 256 threads
 *
 * Purpose:
 * --------
 * Spawns foam/spray particles using Unity's "Trapped Air" model.
 * 
 * Logic:
 * 1. Calculate 'weightedVelocityDifference' by searching neighbors.
 * 2. Calculate 'kineticEnergy' (speed squared).
 * 3. Spawn probability = trappedAirFactor * kineticEnergyFactor * dt.
 *
 * ============================================================================
 */

@group(0) @binding(0) var<storage, read> fluidPositions: array<vec4<f32>>; // Predicted
@group(0) @binding(1) var<storage, read> fluidVelocities: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> foamPositions: array<vec4<f32>>;
@group(0) @binding(4) var<storage, read_write> foamVelocities: array<vec4<f32>>;
@group(0) @binding(5) var<storage, read_write> foamCounter: atomic<u32>;
@group(0) @binding(6) var<uniform> params: FoamSpawnParams;
@group(0) @binding(7) var<storage, read> sortOffsets: array<u32>;

struct FoamSpawnParams {
  dt: f32,
  airRate: f32,
  airMin: f32,
  airMax: f32,
  kinMin: f32,
  kinMax: f32,
  maxFoam: u32,
  frameCount: u32,
  particleCount: u32,
  radius: f32,
  pad0: vec2<f32>,
  minBounds: vec3<f32>,
  pad1: f32,
  gridRes: vec3<f32>,
  bubbleScale: f32,
};

fn pcgHash(input: u32) -> u32 {
  var state = input * 747796405u + 2891336453u;
  var word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}

fn randomFloat(seed: u32) -> f32 {
  return f32(pcgHash(seed)) / 4294967295.0;
}

fn remap01(val: f32, minVal: f32, maxVal: f32) -> f32 {
  return saturate((val - minVal) / (maxVal - minVal));
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let index = id.x;
  if (index >= params.particleCount) { return; }

  let pos = fluidPositions[index].xyz;
  let vel = fluidVelocities[index].xyz;
  
  // ========================================================================
  // NEIGHBOR SEARCH (TRAPPED AIR CALCULATION)
  // ========================================================================
  var weightedVelocityDifference = 0.0;
  let radiusSq = params.radius * params.radius;

  let gridRes = vec3<i32>(i32(params.gridRes.x), i32(params.gridRes.y), i32(params.gridRes.z));
  let localPos = pos - params.minBounds;
  let cellX = i32(floor(localPos.x / params.radius));
  let cellY = i32(floor(localPos.y / params.radius));
  let cellZ = i32(floor(localPos.z / params.radius));

  for (var z = -1; z <= 1; z++) {
    for (var y = -1; y <= 1; y++) {
      for (var x = -1; x <= 1; x++) {
        let cx = cellX + x;
        let cy = cellY + y;
        let cz = cellZ + z;

        if (cx >= 0 && cx < gridRes.x && cy >= 0 && cy < gridRes.y && cz >= 0 && cz < gridRes.z) {
           let key = u32(cx) + u32(gridRes.x) * (u32(cy) + u32(gridRes.y) * u32(cz));
           let start = sortOffsets[key];
           let end = sortOffsets[key + 1u];

           for (var j = start; j < end; j++) {
             if (j == index) { continue; }
             
             let fPos = fluidPositions[j].xyz;
             let offset = fPos - pos;
             let dstSq = dot(offset, offset);

             if (dstSq < radiusSq) {
               let dst = sqrt(dstSq);
               let dirToNeighbour = offset / dst;
               
               let relativeVelocity = vel - fluidVelocities[j].xyz;
               let relVelMag = length(relativeVelocity);
               let relVelDir = relativeVelocity / max(0.000001, relVelMag);
               
               // Unity: 1 - dot(relVelDir, -dirToNeighbour)
               let convergeWeight = 1.0 - dot(relVelDir, -dirToNeighbour);
               let influence = 1.0 - saturate(dst / params.radius);
               
               weightedVelocityDifference += relVelMag * convergeWeight * influence;
             }
           }
        }
      }
    }
  }

  // ========================================================================
  // SPAWN CALCULATION
  // ========================================================================
  let trappedAirFactor = params.airRate * remap01(weightedVelocityDifference, params.airMin, params.airMax);
  let kineticEnergyFactor = remap01(dot(vel, vel), params.kinMin, params.kinMax);
  let particleSpawnFactor = trappedAirFactor * kineticEnergyFactor * params.dt;

  let particleSpawnCount = i32(floor(particleSpawnFactor));
  let fractionalSpawnRemainder = particleSpawnFactor - f32(particleSpawnCount);

  let baseSeed = index * 1000u + params.frameCount;
  var actualSpawnCount = particleSpawnCount;
  if (randomFloat(baseSeed) < fractionalSpawnRemainder) {
    actualSpawnCount += 1;
  }

  if (actualSpawnCount <= 0) { return; }

  // Clamp spawn count to avoid massive bursts
  let count = min(actualSpawnCount, 10); 

  for (var i = 0; i < count; i++) {
    let slot = atomicAdd(&foamCounter, 1u) % params.maxFoam;
    
    let s = baseSeed + u32(i) * 7u;
    let r1 = randomFloat(s + 1u);
    let r2 = randomFloat(s + 2u);
    let r3 = randomFloat(s + 3u);
    
    // Unity uses a cylinder spawner based on velocity, let's approximate
    let spawnPos = pos + vel * params.dt * randomFloat(s + 4u);
    let foamVel = vel + vec3<f32>(randomFloat(s+5u)-0.5, randomFloat(s+6u), randomFloat(s+7u)-0.5) * 2.0;
    
    let lifetime = mix(5.0, 15.0, randomFloat(s + 8u));
    let scale = (params.bubbleScale + 1.0) / 2.0;

    foamPositions[slot] = vec4<f32>(spawnPos, lifetime);
    foamVelocities[slot] = vec4<f32>(foamVel, scale);
  }
}