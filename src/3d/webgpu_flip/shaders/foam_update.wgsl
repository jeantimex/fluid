/**
 * FLIP-inspired whitewater update (webgpu_flip local variant).
 *
 * Phase 4 goals:
 * - Per-type lifetime decay (foam / bubble / spray).
 * - Foam preservation in dense regions.
 * - Type-specific dynamics controls.
 */

struct FoamUpdateParams {
  // x=dt, y=gravity, z=sprayDrag, w=bubbleBuoyancy
  timeAndForces: vec4<f32>,
  // xyz=maxBounds, w=smoothing radius
  maxBoundsAndRadius: vec4<f32>,
  // xyz=minBounds, w=bubbleNeighbourMin
  minBoundsAndBubbleNeighbourMin: vec4<f32>,
  // xyz=grid resolution, w=sprayNeighbourMax
  gridResAndSprayNeighbourMax: vec4<f32>,
  // x=bubbleScale, y=scaleChangeSpeed, z=foamLayerDepth, w=foamLayerOffset
  bubbleScaleAndLayer: vec4<f32>,
  // x=hysteresisFrames, y=foamAdvectionStrength, z=bubbleDrag, w=sprayFriction
  hysteresisAndDynamics: vec4<f32>,
  // x=sprayRestitution, y=foamDecay, z=bubbleDecay, w=sprayDecay
  restitutionAndDecay: vec4<f32>,
  // x=foamPreservationRate, y=foamDensityMin, z=foamDensityMax, w=preservationEnabled
  preservation: vec4<f32>,
};

@group(0) @binding(0) var<storage, read_write> foamPositions: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> foamVelocities: array<vec4<f32>>;
@group(0) @binding(2) var<uniform> params: FoamUpdateParams;
@group(0) @binding(3) var<storage, read> fluidPositions: array<vec4<f32>>; // Predicted
@group(0) @binding(4) var<storage, read> fluidVelocities: array<vec4<f32>>;
@group(0) @binding(5) var<storage, read> sortOffsets: array<u32>;
@group(0) @binding(6) var<storage, read_write> foamState: array<u32>;

const TYPE_BUBBLE: u32 = 0u;
const TYPE_FOAM: u32 = 1u;
const TYPE_SPRAY: u32 = 2u;
const TYPE_UNKNOWN: u32 = 255u;

fn unpackType(state: u32) -> u32 {
  return state & 0xffu;
}

fn unpackCounter(state: u32) -> u32 {
  return (state >> 8u) & 0xffu;
}

fn packState(particleType: u32, counter: u32) -> u32 {
  return (counter << 8u) | (particleType & 0xffu);
}

/** Poly6 kernel: W(r,h) = (h²-r²)³ (unscaled weighting). */
fn poly6Weight(dst: f32, radius: f32) -> f32 {
  if (dst < radius) {
    let v = radius * radius - dst * dst;
    return v * v * v;
  }
  return 0.0;
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let index = id.x;
  if (index >= arrayLength(&foamPositions)) {
    return;
  }

  var posData = foamPositions[index];
  var velData = foamVelocities[index];
  var lifetime = posData.w;

  if (lifetime <= 0.0) {
    return;
  }

  var pos = posData.xyz;
  var vel = velData.xyz;
  let scale = velData.w;
  let dt = params.timeAndForces.x;
  let gravity = params.timeAndForces.y;
  let sprayDrag = params.timeAndForces.z;
  let bubbleBuoyancy = params.timeAndForces.w;
  let radius = params.maxBoundsAndRadius.w;
  let bubbleNeighbourMin = params.minBoundsAndBubbleNeighbourMin.w;
  let sprayNeighbourMax = params.gridResAndSprayNeighbourMax.w;

  // -------------------------------------------------------------------------
  // Neighbor sampling (fluid coupling + surface-band proxy)
  // -------------------------------------------------------------------------
  var velocitySum = vec3<f32>(0.0);
  var positionSum = vec3<f32>(0.0);
  var weightSum = 0.0;
  var neighbourCount = 0u;

  let radiusSq = radius * radius;
  let gridRes = vec3<i32>(
    i32(params.gridResAndSprayNeighbourMax.x),
    i32(params.gridResAndSprayNeighbourMax.y),
    i32(params.gridResAndSprayNeighbourMax.z)
  );
  let localPos = pos - params.minBoundsAndBubbleNeighbourMin.xyz;
  let cellX = i32(floor(localPos.x / radius));
  let cellY = i32(floor(localPos.y / radius));
  let cellZ = i32(floor(localPos.z / radius));

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
          let fPos = fluidPositions[j].xyz;
          let offset = fPos - pos;
          let dstSq = dot(offset, offset);

          if (dstSq < radiusSq) {
            let dst = sqrt(dstSq);
            let weight = poly6Weight(dst, radius);

            velocitySum += fluidVelocities[j].xyz * weight;
            positionSum += fPos * weight;
            weightSum += weight;
            neighbourCount++;
          }
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Classification with hysteresis
  // -------------------------------------------------------------------------
  var desiredType = TYPE_FOAM;
  let neighbourCountF = f32(neighbourCount);

  if (neighbourCountF <= sprayNeighbourMax) {
    desiredType = TYPE_SPRAY;
  } else {
    if (weightSum > 1e-5) {
      let localMeanPos = positionSum / weightSum;
      let foamBandHalfWidth = max(0.0, params.bubbleScaleAndLayer.z) * radius;
      let foamOffset = params.bubbleScaleAndLayer.w * radius;
      let relativeY = (pos.y - localMeanPos.y) - foamOffset;

      if (relativeY < -foamBandHalfWidth && neighbourCountF >= bubbleNeighbourMin) {
        desiredType = TYPE_BUBBLE;
      } else if (relativeY > foamBandHalfWidth) {
        desiredType = TYPE_SPRAY;
      } else {
        desiredType = TYPE_FOAM;
      }
    }
  }

  var state = foamState[index];
  var prevType = unpackType(state);
  var counter: u32 = 0u;

  if (prevType == TYPE_UNKNOWN) {
    prevType = desiredType;
  }

  if (desiredType != prevType) {
    counter = min(255u, unpackCounter(state) + 1u);
    let threshold = u32(max(1.0, round(params.hysteresisAndDynamics.x)));
    if (counter < threshold) {
      desiredType = prevType;
    } else {
      counter = 0u;
    }
  }

  foamState[index] = packState(desiredType, counter);

  let isFoam = desiredType == TYPE_FOAM;
  let isBubble = desiredType == TYPE_BUBBLE;
  let isSpray = desiredType == TYPE_SPRAY;

  // -------------------------------------------------------------------------
  // Type-dependent dynamics
  // -------------------------------------------------------------------------
  if (isFoam) {
    if (weightSum > 0.0001) {
      let fluidVel = velocitySum / weightSum;
      let advectionT = clamp(params.hysteresisAndDynamics.y * dt, 0.0, 1.0);
      vel = mix(vel, fluidVel, advectionT);
    }
  } else if (isBubble) {
    if (weightSum > 0.0001) {
      let fluidVel = velocitySum / weightSum;
      let accelFluid = (fluidVel - vel) * params.hysteresisAndDynamics.z;
      let accelBuoyancy = vec3<f32>(0.0, -gravity * bubbleBuoyancy, 0.0);
      vel += (accelFluid + accelBuoyancy) * dt;
    }
  } else {
    vel.y += gravity * dt;
    vel *= max(0.0, 1.0 - sprayDrag * dt);
    vel.xz *= max(0.0, 1.0 - params.hysteresisAndDynamics.w * dt);
  }

  // -------------------------------------------------------------------------
  // Lifetime management
  // -------------------------------------------------------------------------
  var decay = params.restitutionAndDecay.y;
  if (isBubble) {
    decay = params.restitutionAndDecay.z;
  } else if (isSpray) {
    decay = params.restitutionAndDecay.w;
  }
  lifetime -= dt * max(0.0, decay);

  if (isFoam && params.preservation.w > 0.5) {
    let minDensity = params.preservation.y;
    let maxDensity = max(minDensity + 1e-4, params.preservation.z);
    let densityT = clamp((neighbourCountF - minDensity) / (maxDensity - minDensity), 0.0, 1.0);
    lifetime += dt * max(0.0, params.preservation.x) * densityT;
  }
  lifetime = max(0.0, lifetime);

  let targetScale = select(1.0, params.bubbleScaleAndLayer.x, isBubble);
  let newScale = mix(scale, targetScale, dt * params.bubbleScaleAndLayer.y);

  pos += vel * dt;

  let restitution = select(0.5, clamp(params.restitutionAndDecay.x, 0.0, 1.0), isSpray);
  let sprayFriction = clamp(params.hysteresisAndDynamics.w, 0.0, 1.0);
  let minB = params.minBoundsAndBubbleNeighbourMin.xyz;
  let maxB = params.maxBoundsAndRadius.xyz;
  if (pos.x < minB.x) {
    pos.x = minB.x;
    vel.x *= -restitution;
    if (isSpray) {
      vel.yz *= (1.0 - sprayFriction);
    }
  }
  if (pos.x > maxB.x) {
    pos.x = maxB.x;
    vel.x *= -restitution;
    if (isSpray) {
      vel.yz *= (1.0 - sprayFriction);
    }
  }
  if (pos.y < minB.y) {
    pos.y = minB.y;
    vel.y *= -restitution;
    if (isSpray) {
      vel.xz *= (1.0 - sprayFriction);
    }
  }
  if (pos.y > maxB.y) {
    pos.y = maxB.y;
    vel.y *= -restitution;
    if (isSpray) {
      vel.xz *= (1.0 - sprayFriction);
    }
  }
  if (pos.z < minB.z) {
    pos.z = minB.z;
    vel.z *= -restitution;
    if (isSpray) {
      vel.xy *= (1.0 - sprayFriction);
    }
  }
  if (pos.z > maxB.z) {
    pos.z = maxB.z;
    vel.z *= -restitution;
    if (isSpray) {
      vel.xy *= (1.0 - sprayFriction);
    }
  }

  foamPositions[index] = vec4<f32>(pos, lifetime);
  foamVelocities[index] = vec4<f32>(vel, newScale);
}
