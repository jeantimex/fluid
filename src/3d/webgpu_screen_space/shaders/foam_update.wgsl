/**
 * ============================================================================
 * FOAM UPDATE COMPUTE SHADER
 * ============================================================================
 *
 * Entry Point: main
 * Workgroup Size: 256 threads
 *
 * Purpose:
 * --------
 * Updates foam particle physics each frame. Applies gravity, air drag,
 * and boundary collision. Decrements lifetime. Dead particles (lifetime <= 0)
 * are skipped and will produce degenerate triangles in the vertex shader.
 *
 * ============================================================================
 */

struct FoamUpdateParams {
  dt: f32,
  gravity: f32,
  dragCoeff: f32,
  pad0: f32,
  boundsHalf: vec3<f32>,
  pad1: f32,
};

@group(0) @binding(0) var<storage, read_write> foamPositions: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> foamVelocities: array<vec4<f32>>;
@group(0) @binding(2) var<uniform> params: FoamUpdateParams;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let index = id.x;
  if (index >= arrayLength(&foamPositions)) {
    return;
  }

  var posData = foamPositions[index];
  var velData = foamVelocities[index];

  var lifetime = posData.w;

  // Skip dead particles
  if (lifetime <= 0.0) {
    return;
  }

  // Decrement lifetime
  lifetime -= params.dt;

  var pos = posData.xyz;
  var vel = velData.xyz;
  let scale = velData.w;

  // Gravity
  vel.y += params.gravity * params.dt;

  // Air drag
  vel *= (1.0 - params.dragCoeff * params.dt);

  // Integrate position
  pos += vel * params.dt;

  // Boundary collision with reflection
  let damping = 0.1;
  let hb = params.boundsHalf;

  if (pos.x < -hb.x) {
    pos.x = -hb.x;
    vel.x = abs(vel.x) * damping;
  } else if (pos.x > hb.x) {
    pos.x = hb.x;
    vel.x = -abs(vel.x) * damping;
  }

  if (pos.y < -hb.y) {
    pos.y = -hb.y;
    vel.y = abs(vel.y) * damping;
  } else if (pos.y > hb.y) {
    pos.y = hb.y;
    vel.y = -abs(vel.y) * damping;
  }

  if (pos.z < -hb.z) {
    pos.z = -hb.z;
    vel.z = abs(vel.z) * damping;
  } else if (pos.z > hb.z) {
    pos.z = hb.z;
    vel.z = -abs(vel.z) * damping;
  }

  // Write back
  foamPositions[index] = vec4<f32>(pos, lifetime);
  foamVelocities[index] = vec4<f32>(vel, scale);
}
