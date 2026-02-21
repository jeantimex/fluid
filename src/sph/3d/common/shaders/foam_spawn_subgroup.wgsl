/**
 * ============================================================================
 * FOAM SPAWN COMPUTE SHADER - SUBGROUP OPTIMIZED
 * ============================================================================
 *
 * This version uses subgroup operations to reduce atomic contention.
 * Instead of every thread doing atomicAdd for each foam particle spawn,
 * threads within a subgroup coordinate:
 *   1. Each thread calculates its total spawn count
 *   2. subgroupExclusiveAdd gives local offset within subgroup
 *   3. Only lane 0 does the global atomicAdd for the whole subgroup
 *   4. subgroupBroadcastFirst shares the base offset with all lanes
 *
 * This significantly reduces atomic contention when many particles spawn foam.
 * ============================================================================
 */

enable subgroups;

@group(0) @binding(0) var<storage, read> fluidPositions: array<vec4<f32>>;
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
  lifeMin: f32,
  lifeMax: f32,
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
fn main(
  @builtin(global_invocation_id) id: vec3<u32>,
  @builtin(subgroup_size) sg_size: u32,
  @builtin(subgroup_invocation_id) sg_lane: u32
) {
  let index = id.x;
  let outOfBounds = index >= params.particleCount;

  // Even out-of-bounds threads must participate in subgroup operations
  var mySpawnCount: u32 = 0u;
  var baseSeed: u32 = 0u;
  var pos: vec3<f32>;
  var vel: vec3<f32>;

  if (!outOfBounds) {
    pos = fluidPositions[index].xyz;
    vel = fluidVelocities[index].xyz;

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

    baseSeed = index * 1000u + params.frameCount;
    var actualSpawnCount = particleSpawnCount;
    if (randomFloat(baseSeed) < fractionalSpawnRemainder) {
      actualSpawnCount += 1;
    }

    // Clamp spawn count to avoid massive bursts
    mySpawnCount = u32(clamp(actualSpawnCount, 0, 10));
  }

  // =========================================================================
  // SUBGROUP FOAM ALLOCATION
  // =========================================================================
  // Instead of each thread doing atomicAdd per foam particle, we use subgroup ops:
  // 1. Get exclusive prefix sum of spawn counts within subgroup
  // 2. Get total spawns for entire subgroup
  // 3. Only lane 0 does the global atomicAdd
  // 4. Broadcast result to all lanes using subgroupBroadcastFirst

  // Get my offset within the subgroup
  let localOffset = subgroupExclusiveAdd(mySpawnCount);

  // Get total foam particles for this subgroup
  let subgroupTotal = subgroupAdd(mySpawnCount);

  // Lane 0 does the global atomic allocation
  var subgroupBase: u32 = 0u;
  if (sg_lane == 0u) {
    if (subgroupTotal > 0u) {
      subgroupBase = atomicAdd(&foamCounter, subgroupTotal);
    }
  }

  // Broadcast the base index from lane 0 to all lanes
  subgroupBase = subgroupBroadcastFirst(subgroupBase);

  // Now each thread knows its global base slot: subgroupBase + localOffset
  let baseSlot = subgroupBase + localOffset;

  // Early exit if we have no foam to spawn
  if (mySpawnCount == 0u) {
    return;
  }

  // ========================================================================
  // SPAWN FOAM PARTICLES
  // ========================================================================
  for (var i: u32 = 0u; i < mySpawnCount; i++) {
    // Ring buffer index
    let slot = (baseSlot + i) % params.maxFoam;

    let s = baseSeed + i * 7u;

    // Unity uses a cylinder spawner based on velocity, let's approximate
    let spawnPos = pos + vel * params.dt * randomFloat(s + 4u);
    let foamVel = vel + vec3<f32>(randomFloat(s+5u)-0.5, randomFloat(s+6u), randomFloat(s+7u)-0.5) * 2.0;

    let lifetime = mix(params.lifeMin, params.lifeMax, randomFloat(s + 8u));
    let scale = (params.bubbleScale + 1.0) / 2.0;

    foamPositions[slot] = vec4<f32>(spawnPos, lifetime);
    foamVelocities[slot] = vec4<f32>(foamVel, scale);
  }
}
