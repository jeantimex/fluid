/**
 * ============================================================================
 * FOAM SPAWN COMPUTE SHADER
 * ============================================================================
 *
 * Entry Point: main
 * Workgroup Size: 256 threads
 *
 * Purpose:
 * --------
 * Spawns foam/spray particles from high-velocity surface fluid particles.
 * Uses a ring-buffer approach with an atomic counter as write head that wraps
 * around MAX_FOAM slots. Dead particles (lifetime <= 0) are naturally
 * overwritten.
 *
 * Spawn Criteria:
 * ---------------
 * - Speed factor: smoothstep over [speedMin, speedMax]
 * - Surface factor: low density = near surface = more foam
 * - Combined probability: speedFactor * surfaceFactor * spawnRate * dt
 * - PCG hash for per-particle random number
 *
 * ============================================================================
 */

struct FoamSpawnParams {
  dt: f32,
  spawnRate: f32,
  speedMin: f32,
  speedMax: f32,
  densityThreshold: f32,
  maxFoam: u32,
  frameCount: u32,
  particleCount: u32,
  boundsHalf: vec3<f32>,
  pad0: f32,
};

@group(0) @binding(0) var<storage, read> positions: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read> velocities: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> densities: array<vec2<f32>>;
@group(0) @binding(3) var<storage, read_write> foamPositions: array<vec4<f32>>;
@group(0) @binding(4) var<storage, read_write> foamVelocities: array<vec4<f32>>;
@group(0) @binding(5) var<storage, read_write> foamCounter: atomic<u32>;
@group(0) @binding(6) var<uniform> params: FoamSpawnParams;

fn pcgHash(input: u32) -> u32 {
  var state = input * 747796405u + 2891336453u;
  var word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}

fn randomFloat(seed: u32) -> f32 {
  return f32(pcgHash(seed)) / 4294967295.0;
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let index = id.x;
  if (index >= params.particleCount) {
    return;
  }

  let pos = positions[index].xyz;
  let vel = velocities[index].xyz;
  let density = densities[index].x;

  let speed = length(vel);

  // Speed factor: higher speed = more foam
  let speedFactor = smoothstep(params.speedMin, params.speedMax, speed);

  // Surface factor: low density = near surface = more foam
  let surfaceFactor = 1.0 - smoothstep(
    params.densityThreshold * 0.7,
    params.densityThreshold,
    density
  );

  let spawnProbability = speedFactor * surfaceFactor * params.spawnRate * params.dt;

  // PCG hash for randomness
  let baseSeed = index * 1000u + params.frameCount;
  let r0 = randomFloat(baseSeed);

  if (r0 >= spawnProbability) {
    return;
  }

  // Spawn a foam particle
  let slot = atomicAdd(&foamCounter, 1u) % params.maxFoam;

  // Random offsets for variation
  let r1 = randomFloat(baseSeed + 1u);
  let r2 = randomFloat(baseSeed + 2u);
  let r3 = randomFloat(baseSeed + 3u);
  let r4 = randomFloat(baseSeed + 4u);
  let r5 = randomFloat(baseSeed + 5u);
  let r6 = randomFloat(baseSeed + 6u);
  let r7 = randomFloat(baseSeed + 7u);

  // Position: particle position + small random offset along velocity direction
  let velDir = select(vec3<f32>(0.0, 1.0, 0.0), normalize(vel), speed > 0.01);
  let offset = velDir * (r1 * 0.1) + vec3<f32>(
    (r2 - 0.5) * 0.05,
    (r3 - 0.5) * 0.05,
    (r4 - 0.5) * 0.05
  );
  let foamPos = pos + offset;

  // Velocity: particle velocity with random spread
  let foamVel = vel * (0.8 + r5 * 0.4) + vec3<f32>(
    (r6 - 0.5) * 2.0,
    r7 * 2.0,
    (r1 - 0.5) * 2.0
  );

  // Lifetime: 3-8 seconds
  let lifetime = 3.0 + r2 * 5.0;

  // Scale: 0.3-0.5
  let scale = 0.3 + r3 * 0.2;

  // Write foam particle (position.w = lifetime, velocity.w = scale)
  foamPositions[slot] = vec4<f32>(foamPos, lifetime);
  foamVelocities[slot] = vec4<f32>(foamVel, scale);
}
