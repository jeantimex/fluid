/**
 * Particle Collision Compute Shader
 *
 * Handles boundary collisions (walls) and obstacle collisions (movable disk).
 * This is an embarrassingly parallel operation - one thread per particle.
 */

struct SimParams {
  // Floats
  h: f32,
  fInvSpacing: f32,
  particleRadius: f32,
  pInvSpacing: f32,
  gravity: f32,
  dt: f32,
  flipRatio: f32,
  overRelaxation: f32,
  particleRestDensity: f32,
  domainWidth: f32,
  domainHeight: f32,
  _pad0: f32,

  // Ints
  fNumX: i32,
  fNumY: i32,
  fNumCells: i32,
  numParticles: i32,
  maxParticles: i32,
  pNumX: i32,
  pNumY: i32,
  pNumCells: i32,
};

struct ObstacleParams {
  x: f32,
  y: f32,
  vx: f32,
  vy: f32,
  radius: f32,
  _pad0: f32,
  _pad1: f32,
  _pad2: f32,
};

@group(0) @binding(0) var<storage, read_write> positions: array<vec2<f32>>;
@group(0) @binding(1) var<storage, read_write> velocities: array<vec2<f32>>;
@group(0) @binding(2) var<uniform> params: SimParams;
@group(0) @binding(3) var<uniform> obstacle: ObstacleParams;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;

  // Bounds check
  if (i >= u32(params.numParticles)) {
    return;
  }

  let h = 1.0 / params.fInvSpacing;
  let r = params.particleRadius;

  // Boundary limits
  let minX = h + r;
  let maxX = f32(params.fNumX - 1) * h - r;
  let minY = h + r;
  let maxY = f32(params.fNumY - 1) * h - r;

  var pos = positions[i];
  var vel = velocities[i];

  // Obstacle collision
  let obstacleMinDist = obstacle.radius + r;
  let dx = pos.x - obstacle.x;
  let dy = pos.y - obstacle.y;
  let d2 = dx * dx + dy * dy;

  if (d2 < obstacleMinDist * obstacleMinDist) {
    vel.x = obstacle.vx;
    vel.y = obstacle.vy;
  }

  // Wall collisions
  if (pos.x < minX) {
    pos.x = minX;
    vel.x = 0.0;
  }
  if (pos.x > maxX) {
    pos.x = maxX;
    vel.x = 0.0;
  }
  if (pos.y < minY) {
    pos.y = minY;
    vel.y = 0.0;
  }
  if (pos.y > maxY) {
    pos.y = maxY;
    vel.y = 0.0;
  }

  positions[i] = pos;
  velocities[i] = vel;
}
