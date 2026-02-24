// =============================================================================
// Whitewater Particle System Compute Kernels
// =============================================================================
// Handles emission, update, and classification of whitewater particles
// (foam, spray, bubbles) based on fluid simulation data.
// =============================================================================

struct WhitewaterUniforms {
  // Grid dimensions
  nx: u32,
  ny: u32,
  nz: u32,
  maxParticles: u32,

  // World-space grid bounds
  gridWidth: f32,
  gridHeight: f32,
  gridDepth: f32,
  dt: f32,

  // Emission parameters
  emissionRate: f32,      // Base emission multiplier
  trappedAirWeight: f32,  // Weight for Ita (bubble emission)
  waveCrestWeight: f32,   // Weight for Iwc (spray emission)
  energyWeight: f32,      // Weight for Ike (energy threshold)

  // Particle physics
  foamLifetime: f32,      // Lifetime for foam particles (seconds)
  sprayLifetime: f32,     // Lifetime for spray particles
  bubbleLifetime: f32,    // Lifetime for bubble particles
  gravity: f32,           // Gravity strength

  // Classification thresholds
  surfaceThreshold: f32,  // |SDF| < this = foam
  sprayThreshold: f32,    // SDF > this = spray
  bubbleThreshold: f32,   // SDF < -this = bubble
  frameNumber: u32,       // For random seed
};

// Particle types
const TYPE_DEAD: u32 = 0u;
const TYPE_FOAM: u32 = 1u;
const TYPE_SPRAY: u32 = 2u;
const TYPE_BUBBLE: u32 = 3u;

@group(0) @binding(0) var<uniform> uniforms: WhitewaterUniforms;
@group(0) @binding(1) var<storage, read> velocity: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> surfaceSDF: array<f32>;
@group(0) @binding(3) var<storage, read> trappedAirPotential: array<f32>;
@group(0) @binding(4) var<storage, read> waveCrestPotential: array<f32>;
@group(0) @binding(5) var<storage, read> kineticEnergyPotential: array<f32>;
@group(0) @binding(6) var<storage, read_write> particlePosLife: array<vec4<f32>>;
@group(0) @binding(7) var<storage, read_write> particleVelType: array<vec4<f32>>;
@group(0) @binding(8) var<storage, read_write> particleCount: atomic<u32>;

// -----------------------------------------------------------------------------
// Helper Functions
// -----------------------------------------------------------------------------

/// Scalar grid index
fn scalarIdx(x: u32, y: u32, z: u32) -> u32 {
  let cx = clamp(x, 0u, uniforms.nx - 1u);
  let cy = clamp(y, 0u, uniforms.ny - 1u);
  let cz = clamp(z, 0u, uniforms.nz - 1u);
  return cx + cy * uniforms.nx + cz * uniforms.nx * uniforms.ny;
}

/// Velocity grid index (staggered MAC grid)
fn velIdx(x: u32, y: u32, z: u32) -> u32 {
  let vnx = uniforms.nx + 1u;
  let vny = uniforms.ny + 1u;
  let cx = clamp(x, 0u, vnx - 1u);
  let cy = clamp(y, 0u, vny - 1u);
  let cz = clamp(z, 0u, uniforms.nz);
  return cx + cy * vnx + cz * vnx * vny;
}

/// Sample velocity at cell center
fn sampleVelocityAtCell(x: u32, y: u32, z: u32) -> vec3<f32> {
  let vx = (velocity[velIdx(x, y, z)].x + velocity[velIdx(x + 1u, y, z)].x) * 0.5;
  let vy = (velocity[velIdx(x, y, z)].y + velocity[velIdx(x, y + 1u, z)].y) * 0.5;
  let vz = (velocity[velIdx(x, y, z)].z + velocity[velIdx(x, y, z + 1u)].z) * 0.5;
  return vec3<f32>(vx, vy, vz);
}

/// Convert grid coordinates to world position (cell center)
fn gridToWorld(x: u32, y: u32, z: u32) -> vec3<f32> {
  let dx = uniforms.gridWidth / f32(uniforms.nx);
  let dy = uniforms.gridHeight / f32(uniforms.ny);
  let dz = uniforms.gridDepth / f32(uniforms.nz);
  return vec3<f32>(
    (f32(x) + 0.5) * dx,
    (f32(y) + 0.5) * dy,
    (f32(z) + 0.5) * dz
  );
}

/// Simple hash function for random numbers
fn hash(seed: u32) -> u32 {
  var x = seed;
  x = x ^ (x >> 16u);
  x = x * 0x7feb352du;
  x = x ^ (x >> 15u);
  x = x * 0x846ca68bu;
  x = x ^ (x >> 16u);
  return x;
}

/// Random float in [0, 1)
fn randomFloat(seed: u32) -> f32 {
  return f32(hash(seed) & 0x00FFFFFFu) / f32(0x01000000u);
}

/// Random float in [-1, 1)
fn randomFloatSigned(seed: u32) -> f32 {
  return randomFloat(seed) * 2.0 - 1.0;
}

// =============================================================================
// EMIT WHITEWATER - Spawn particles based on emission potentials
// =============================================================================
// Each thread processes one grid cell. If potentials exceed thresholds,
// emit a new particle at that cell's location.
// =============================================================================

@compute @workgroup_size(8, 4, 4)
fn emitWhitewater(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= uniforms.nx || id.y >= uniforms.ny || id.z >= uniforms.nz) { return; }

  let si = scalarIdx(id.x, id.y, id.z);
  let sdf = surfaceSDF[si];

  // Only emit near the surface (|SDF| < 2)
  if (abs(sdf) > 2.0) { return; }

  // Get emission potentials
  let ita = trappedAirPotential[si];  // Trapped air (vorticity)
  let iwc = waveCrestPotential[si];   // Wave crest (v·n)
  let ike = kineticEnergyPotential[si]; // Kinetic energy

  // Compute emission probability
  // Higher potentials = higher chance of emission
  let trappedAirProb = ita * uniforms.trappedAirWeight;
  let waveCrestProb = iwc * uniforms.waveCrestWeight;
  let energyFactor = clamp(ike * uniforms.energyWeight, 0.0, 1.0);

  // Combined probability (clamped to reasonable range)
  let emissionProb = clamp(
    (trappedAirProb + waveCrestProb) * energyFactor * uniforms.emissionRate,
    0.0,
    0.5  // Max 50% chance per cell per frame
  );

  // Generate random number for this cell
  let cellSeed = si + uniforms.frameNumber * 8192u;
  let rand = randomFloat(cellSeed);

  // Probabilistic emission
  if (rand > emissionProb) { return; }

  // Allocate a slot using atomic counter with circular wrapping
  // When buffer is full, new particles overwrite oldest ones
  let rawIdx = atomicAdd(&particleCount, 1u);
  let particleIdx = rawIdx % uniforms.maxParticles;

  // Get world position and velocity at this cell
  let worldPos = gridToWorld(id.x, id.y, id.z);
  let cellVel = sampleVelocityAtCell(id.x, id.y, id.z);

  // Add small random offset to position (within cell)
  let dx = uniforms.gridWidth / f32(uniforms.nx);
  let dy = uniforms.gridHeight / f32(uniforms.ny);
  let dz = uniforms.gridDepth / f32(uniforms.nz);
  let offset = vec3<f32>(
    randomFloatSigned(cellSeed + 1u) * dx * 0.4,
    randomFloatSigned(cellSeed + 2u) * dy * 0.4,
    randomFloatSigned(cellSeed + 3u) * dz * 0.4
  );

  // Determine initial type based on SDF
  var particleType = TYPE_FOAM;
  var lifetime = uniforms.foamLifetime;
  if (sdf > uniforms.sprayThreshold) {
    particleType = TYPE_SPRAY;
    lifetime = uniforms.sprayLifetime;
  } else if (sdf < -uniforms.bubbleThreshold) {
    particleType = TYPE_BUBBLE;
    lifetime = uniforms.bubbleLifetime;
  }

  // Add some velocity variation based on potentials
  let velNoise = vec3<f32>(
    randomFloatSigned(cellSeed + 4u),
    randomFloatSigned(cellSeed + 5u),
    randomFloatSigned(cellSeed + 6u)
  ) * (ita * 0.1 + iwc * 0.2);

  // Store particle data
  // lifetime stored as remaining fraction (1.0 = full, 0.0 = dead)
  particlePosLife[particleIdx] = vec4<f32>(worldPos + offset, 1.0);
  particleVelType[particleIdx] = vec4<f32>(cellVel + velNoise, f32(particleType));
}

// =============================================================================
// UPDATE WHITEWATER - Advect particles and apply physics
// =============================================================================
// Each thread processes one particle. Applies different physics based on type:
// - Foam: Stays at surface, slight upward buoyancy
// - Spray: Ballistic trajectory (gravity), air drag
// - Bubble: Rises through fluid, buoyancy
// =============================================================================

@compute @workgroup_size(256)
fn updateWhitewater(@builtin(global_invocation_id) id: vec3<u32>) {
  let idx = id.x;
  // Process all slots up to maxParticles (circular buffer may wrap)
  if (idx >= uniforms.maxParticles) { return; }

  var posLife = particlePosLife[idx];
  var velType = particleVelType[idx];

  let particleType = u32(velType.w);

  // Skip dead/uninitialized particles
  if (particleType == TYPE_DEAD) { return; }

  var pos = posLife.xyz;
  var vel = velType.xyz;
  var life = posLife.w;

  let dt = uniforms.dt;

  // Age the particle
  var maxLife = uniforms.foamLifetime;
  if (particleType == TYPE_SPRAY) {
    maxLife = uniforms.sprayLifetime;
  } else if (particleType == TYPE_BUBBLE) {
    maxLife = uniforms.bubbleLifetime;
  }
  life -= dt / maxLife;

  // Kill if expired
  if (life <= 0.0) {
    particleVelType[idx] = vec4<f32>(0.0, 0.0, 0.0, 0.0);
    particlePosLife[idx] = vec4<f32>(0.0, 0.0, 0.0, 0.0);
    return;
  }

  // Apply physics based on type
  if (particleType == TYPE_SPRAY) {
    // Spray: Full gravity, air drag
    vel.y -= uniforms.gravity * dt;
    vel *= 0.99; // Air drag
  } else if (particleType == TYPE_BUBBLE) {
    // Bubble: Buoyancy (rise), water drag
    vel.y += uniforms.gravity * 0.5 * dt; // Buoyancy (opposite of gravity)
    vel *= 0.95; // Water drag (more than air)
  } else {
    // Foam: Slight damping, stays at surface
    vel *= 0.98;
    // Could add surface tracking here
  }

  // Advect
  pos += vel * dt;

  // Boundary clamping
  pos.x = clamp(pos.x, 0.01, uniforms.gridWidth - 0.01);
  pos.y = clamp(pos.y, 0.01, uniforms.gridHeight - 0.01);
  pos.z = clamp(pos.z, 0.01, uniforms.gridDepth - 0.01);

  // Store updated values
  particlePosLife[idx] = vec4<f32>(pos, life);
  particleVelType[idx] = vec4<f32>(vel, f32(particleType));
}

// =============================================================================
// CLASSIFY WHITEWATER - Reclassify particles based on current SDF
// =============================================================================
// Particles can transition between types as they move:
// - Spray entering fluid → Foam or Bubble
// - Bubble reaching surface → Foam
// - Foam leaving surface → Spray
// =============================================================================

@compute @workgroup_size(256)
fn classifyWhitewater(@builtin(global_invocation_id) id: vec3<u32>) {
  let idx = id.x;
  // Process all slots up to maxParticles (circular buffer may wrap)
  if (idx >= uniforms.maxParticles) { return; }

  var posLife = particlePosLife[idx];
  var velType = particleVelType[idx];

  let currentType = u32(velType.w);
  if (currentType == TYPE_DEAD) { return; }

  let pos = posLife.xyz;

  // Convert world position to grid coordinates
  let dx = uniforms.gridWidth / f32(uniforms.nx);
  let dy = uniforms.gridHeight / f32(uniforms.ny);
  let dz = uniforms.gridDepth / f32(uniforms.nz);

  let gx = u32(clamp(pos.x / dx, 0.0, f32(uniforms.nx - 1u)));
  let gy = u32(clamp(pos.y / dy, 0.0, f32(uniforms.ny - 1u)));
  let gz = u32(clamp(pos.z / dz, 0.0, f32(uniforms.nz - 1u)));

  let si = scalarIdx(gx, gy, gz);
  let sdf = surfaceSDF[si];

  // Classify based on SDF
  var newType = currentType;
  if (sdf > uniforms.sprayThreshold) {
    newType = TYPE_SPRAY;
  } else if (sdf < -uniforms.bubbleThreshold) {
    newType = TYPE_BUBBLE;
  } else {
    newType = TYPE_FOAM;
  }

  // Update type if changed
  if (newType != currentType) {
    particleVelType[idx] = vec4<f32>(velType.xyz, f32(newType));
  }
}

// =============================================================================
// RESET COUNT - Reset particle counter (called at start of frame)
// =============================================================================

@compute @workgroup_size(1)
fn resetCount() {
  atomicStore(&particleCount, 0u);
}

// =============================================================================
// COMPACT PARTICLES - Remove dead particles and compact the array
// =============================================================================
// This is a simple version - a more efficient approach would use parallel
// prefix sum, but this works for moderate particle counts.
// For now, we just mark dead particles and let them age out.
// =============================================================================
