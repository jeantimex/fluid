/**
 * ============================================================================
 * FOAM UPDATE COMPUTE SHADER (WITH FLUID ADVECTION)
 * ============================================================================
 *
 * Entry Point: main
 * Workgroup Size: 256 threads
 *
 * Purpose:
 * --------
 * Updates foam particle physics with classification:
 * 1. Foam: Advected by fluid velocity (stays on surface)
 * 2. Bubble: Buoyancy pushes it up + fluid advection
 * 3. Spray: Ballistic (gravity + drag)
 *
 * Uses neighbor search (Linear Grid) to determine particle type and
 * local fluid velocity.
 * ============================================================================
 */

struct FoamUpdateParams {
  dt: f32,
  gravity: f32,
  dragCoeff: f32,
  buoyancy: f32,
  boundsHalf: vec3<f32>,
  radius: f32,
  minBounds: vec3<f32>,
  pad0: f32,
  gridRes: vec3<f32>,
  pad1: f32,
  minBubble: u32,
  maxSpray: u32,
  pad2: vec2<u32>,
};

@group(0) @binding(0) var<storage, read_write> foamPositions: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> foamVelocities: array<vec4<f32>>;
@group(0) @binding(2) var<uniform> params: FoamUpdateParams;
@group(0) @binding(3) var<storage, read> fluidPositions: array<vec4<f32>>; // Predicted
@group(0) @binding(4) var<storage, read> fluidVelocities: array<vec4<f32>>;
@group(0) @binding(5) var<storage, read> sortOffsets: array<u32>;

/** Poly6 kernel: W(r,h) = (h²-r²)³ × scale. Using unscaled for weighting. */
fn poly6Weight(dst: f32, radius: f32) -> f32 {
  if (dst < radius) {
    let v = radius * radius - dst * dst;
    return v * v * v;
  }
  return 0.0;
}

fn getGridIndex(pos: vec3<f32>) -> u32 {
    let gridRes = vec3<u32>(u32(params.gridRes.x), u32(params.gridRes.y), u32(params.gridRes.z));
    let localPos = pos - params.minBounds;
    let cellX = u32(clamp(floor(localPos.x / params.radius), 0.0, f32(gridRes.x - 1u)));
    let cellY = u32(clamp(floor(localPos.y / params.radius), 0.0, f32(gridRes.y - 1u)));
    let cellZ = u32(clamp(floor(localPos.z / params.radius), 0.0, f32(gridRes.z - 1u)));
    return cellX + gridRes.x * (cellY + gridRes.y * cellZ);
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let index = id.x;
  if (index >= arrayLength(&foamPositions)) { return; }

  var posData = foamPositions[index];
  var velData = foamVelocities[index];
  var lifetime = posData.w;

  if (lifetime <= 0.0) { return; }

  // Decrement lifetime (dissolve)
  lifetime -= params.dt;

  var pos = posData.xyz;
  var vel = velData.xyz;
  let scale = velData.w;

  // ========================================================================
  // NEIGHBOR SEARCH (FLUID COUPLING)
  // ========================================================================
  var velocitySum = vec3<f32>(0.0);
  var weightSum = 0.0;
  var neighbourCount = 0u;

  let radiusSq = params.radius * params.radius;
  
  // Grid lookup
  let gridRes = vec3<i32>(i32(params.gridRes.x), i32(params.gridRes.y), i32(params.gridRes.z));
  let localPos = pos - params.minBounds;
  let cellX = i32(floor(localPos.x / params.radius));
  let cellY = i32(floor(localPos.y / params.radius));
  let cellZ = i32(floor(localPos.z / params.radius));

  // 3x3x3 Search
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
             let fPos = fluidPositions[j].xyz;
             let offset = fPos - pos;
             let dstSq = dot(offset, offset);

             if (dstSq < radiusSq) {
               let dst = sqrt(dstSq);
               let weight = poly6Weight(dst, params.radius);
               
               velocitySum += fluidVelocities[j].xyz * weight;
               weightSum += weight;
               neighbourCount++;
             }
           }
        }
      }
    }
  }

  // ========================================================================
  // CLASSIFICATION & UPDATE
  // ========================================================================
  let isSpray = neighbourCount <= params.maxSpray;
  let isBubble = neighbourCount >= params.minBubble;
  let isFoam = !isSpray && !isBubble;

  if (isFoam) {
    // Foam: Advected by fluid
    if (weightSum > 0.0001) {
      vel = velocitySum / weightSum;
    }
  } else if (isBubble) {
    // Bubble: Buoyancy + Advection
    // Accelerate bubble to match fluid velocity
    if (weightSum > 0.0001) {
      let fluidVel = velocitySum / weightSum;
      let accelFluid = (fluidVel - vel) * 3.0; // Coupling strength
      let accelBuoyancy = vec3<f32>(0.0, -params.gravity * params.buoyancy, 0.0); // Upward
      vel += (accelFluid + accelBuoyancy) * params.dt;
    }
  } else {
    // Spray: Gravity + Drag
    vel.y += params.gravity * params.dt;
    vel *= (1.0 - params.dragCoeff * params.dt);
  }

  // Integrate
  pos += vel * params.dt;

  // Boundary
  let damping = 0.5;
  let hb = params.boundsHalf;
  if (pos.x < -hb.x || pos.x > hb.x) { pos.x = clamp(pos.x, -hb.x, hb.x); vel.x *= -damping; }
  if (pos.y < -hb.y || pos.y > hb.y) { pos.y = clamp(pos.y, -hb.y, hb.y); vel.y *= -damping; }
  if (pos.z < -hb.z || pos.z > hb.z) { pos.z = clamp(pos.z, -hb.z, hb.z); vel.z *= -damping; }

  foamPositions[index] = vec4<f32>(pos, lifetime);
  foamVelocities[index] = vec4<f32>(vel, scale);
}