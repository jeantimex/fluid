/**
 * FLIP-inspired whitewater spawn pass (webgpu_flip local variant).
 *
 * Phase 2 goals:
 * - Multi-signal emission potential
 *   - energy potential
 *   - convergence/trapped-air potential
 *   - turbulence potential (velocity variance proxy)
 *   - wavecrest potential (surface anisotropy proxy)
 * - Optional obstacle influence modulation
 * - Deterministic stochastic spawn rounding
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
  emitterRate: f32,
  airMin: f32,
  airMax: f32,
  energyMin: f32,
  energyMax: f32,
  turbulenceMin: f32,
  turbulenceMax: f32,

  maxFoam: u32,
  frameCount: u32,
  particleCount: u32,
  flags: u32, // bit0: obstacle enabled, bit1: sphere obstacle

  radius: f32,
  lifeMin: f32,
  lifeMax: f32,
  wavecrestSharpness: f32,

  minBounds: vec3<f32>,
  pad0: f32,
  gridRes: vec3<f32>,
  bubbleScale: f32,

  obstacleCenter: vec3<f32>,
  obstacleInfluenceBase: f32,
  obstacleHalfSize: vec3<f32>,
  obstacleInfluenceDecay: f32,

  obstacleRadius: f32,
  spraySpeedBoost: f32,
  wavecrestMin: f32,
  wavecrestMax: f32,
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
  return clamp((val - minVal) / max(1e-6, maxVal - minVal), 0.0, 1.0);
}

fn hasObstacle() -> bool {
  return (params.flags & 1u) != 0u;
}

fn isSphereObstacle() -> bool {
  return (params.flags & 2u) != 0u;
}

fn distanceToObstacleSurface(pos: vec3<f32>) -> f32 {
  if (!hasObstacle()) {
    return 1e9;
  }

  if (isSphereObstacle()) {
    return abs(length(pos - params.obstacleCenter) - params.obstacleRadius);
  }

  let q = abs(pos - params.obstacleCenter) - params.obstacleHalfSize;
  let outside = length(max(q, vec3<f32>(0.0)));
  let inside = min(max(q.x, max(q.y, q.z)), 0.0);
  let signedDist = outside + inside;
  return abs(signedDist);
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let index = id.x;
  if (index >= params.particleCount) {
    return;
  }

  let pos = fluidPositions[index].xyz;
  let vel = fluidVelocities[index].xyz;

  var weightedVelocityDifference = 0.0;
  var weightedVelSum = vec3<f32>(0.0);
  var weightedVelSqSum = 0.0;
  var weightedOffsetSum = vec3<f32>(0.0);
  var weightedCount = 0.0;
  var neighbourCount = 0u;

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

        if (cx < 0 || cx >= gridRes.x || cy < 0 || cy >= gridRes.y || cz < 0 || cz >= gridRes.z) {
          continue;
        }

        let key = u32(cx) + u32(gridRes.x) * (u32(cy) + u32(gridRes.y) * u32(cz));
        let start = sortOffsets[key];
        let end = sortOffsets[key + 1u];

        for (var j = start; j < end; j++) {
          if (j == index) {
            continue;
          }

          let neighborPos = fluidPositions[j].xyz;
          let offset = neighborPos - pos;
          let dstSq = dot(offset, offset);
          if (dstSq >= radiusSq || dstSq <= 1e-12) {
            continue;
          }

          neighbourCount++;

          let dst = sqrt(dstSq);
          let influence = 1.0 - clamp(dst / params.radius, 0.0, 1.0);
          let neighborVel = fluidVelocities[j].xyz;

          let dirToNeighbor = offset / dst;
          let relVel = vel - neighborVel;
          let relVelMag = length(relVel);
          let relVelDir = relVel / max(relVelMag, 1e-6);
          let convergeWeight = 1.0 - dot(relVelDir, -dirToNeighbor);
          weightedVelocityDifference += relVelMag * convergeWeight * influence;

          weightedVelSum += neighborVel * influence;
          weightedVelSqSum += dot(neighborVel, neighborVel) * influence;
          weightedOffsetSum += offset * influence;
          weightedCount += influence;
        }
      }
    }
  }

  let energyPotential = remap01(dot(vel, vel), params.energyMin, params.energyMax);
  let trappedAirPotential = remap01(weightedVelocityDifference, params.airMin, params.airMax);

  var turbulencePotential = 0.0;
  var wavecrestPotential = 0.0;

  if (weightedCount > 1e-6) {
    let meanVel = weightedVelSum / weightedCount;
    let velVariance = max(0.0, weightedVelSqSum / weightedCount - dot(meanVel, meanVel));
    turbulencePotential = remap01(velVariance, params.turbulenceMin, params.turbulenceMax);

    let shear = length(vel - meanVel);
    wavecrestPotential = remap01(shear, params.wavecrestMin, params.wavecrestMax);

    let avgOffset = weightedOffsetSum / weightedCount;
    if (length(avgOffset) > 1e-5 && length(vel) > 1e-5) {
      let outward = normalize(-avgOffset);
      let velDir = normalize(vel);
      let alignment = dot(velDir, outward);
      if (alignment < params.wavecrestSharpness) {
        wavecrestPotential = 0.0;
      }
    }
  }

  // Surface-likelihood gate: suppress interior emission for dense neighborhoods.
  let surfaceLikelihood = 1.0 - clamp(f32(neighbourCount) / 32.0, 0.0, 1.0);
  wavecrestPotential *= surfaceLikelihood;

  let obstacleDistance = distanceToObstacleSurface(pos);
  let obstacleFactor = params.obstacleInfluenceBase + exp(-obstacleDistance * params.obstacleInfluenceDecay);

  let spawnSignal =
    0.45 * trappedAirPotential +
    0.30 * wavecrestPotential +
    0.25 * turbulencePotential;
  let particleSpawnFactor = params.emitterRate * energyPotential * spawnSignal * obstacleFactor * params.dt;

  let particleSpawnCount = i32(floor(particleSpawnFactor));
  let fractionalSpawnRemainder = particleSpawnFactor - f32(particleSpawnCount);

  let baseSeed = index * 1000u + params.frameCount;
  var actualSpawnCount = particleSpawnCount;
  if (randomFloat(baseSeed) < fractionalSpawnRemainder) {
    actualSpawnCount += 1;
  }
  if (actualSpawnCount <= 0) {
    return;
  }

  let count = min(actualSpawnCount, 12);

  // Build an emitter frame aligned to local velocity.
  let axis = normalize(select(vec3<f32>(0.0, 1.0, 0.0), vel, length(vel) > 1e-5));
  let aux = select(vec3<f32>(1.0, 0.0, 0.0), vec3<f32>(0.0, 1.0, 0.0), abs(axis.x) > 0.9);
  let e1 = normalize(cross(axis, aux));
  let e2 = normalize(cross(axis, e1));

  let emitterRadius = params.radius * 0.6;

  for (var i = 0; i < count; i++) {
    let slot = atomicAdd(&foamCounter, 1u) % params.maxFoam;
    let s = baseSeed + u32(i) * 17u;

    let xr = randomFloat(s + 1u);
    let xt = randomFloat(s + 2u);
    let xh = randomFloat(s + 3u);
    let r = emitterRadius * sqrt(xr);
    let theta = xt * 6.2831853;
    let h = xh * length(vel) * params.dt * params.spraySpeedBoost;

    let spawnPos = pos + r * cos(theta) * e1 + r * sin(theta) * e2 + h * axis;
    let velocityNoise = vec3<f32>(
      randomFloat(s + 4u) - 0.5,
      randomFloat(s + 5u) - 0.5,
      randomFloat(s + 6u) - 0.5
    );
    let foamVel = vel * mix(0.75, 1.25, randomFloat(s + 7u)) + velocityNoise * 1.2;
    let lifetime = mix(params.lifeMin, params.lifeMax, randomFloat(s + 8u));
    let scale = mix(params.bubbleScale, 1.0, randomFloat(s + 9u));

    foamPositions[slot] = vec4<f32>(spawnPos, lifetime);
    foamVelocities[slot] = vec4<f32>(foamVel, scale);
  }
}
