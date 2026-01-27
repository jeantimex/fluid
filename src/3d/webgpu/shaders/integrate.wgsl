struct IntegrateParams {
  dt: f32,
  collisionDamping: f32,
  hasObstacle: f32,
  pad0: f32,
  halfBounds: vec3<f32>,
  pad1: f32,
  obstacleCenter: vec3<f32>,
  pad2: f32,
  obstacleHalf: vec3<f32>,
  pad3: f32,
};

@group(0) @binding(0) var<storage, read_write> positions: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> velocities: array<vec4<f32>>;
@group(0) @binding(2) var<uniform> params: IntegrateParams;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let index = id.x;
  if (index >= arrayLength(&positions)) {
    return;
  }

  var pos = positions[index].xyz;
  var vel = velocities[index].xyz;

  pos = pos + vel * params.dt;

  let halfBounds = params.halfBounds;
  
  // X Collision
  let edgeDstX = halfBounds.x - abs(pos.x);
  if (edgeDstX <= 0.0) {
    pos.x = halfBounds.x * sign(pos.x);
    vel.x = -vel.x * params.collisionDamping;
  }
  
  // Y Collision
  let edgeDstY = halfBounds.y - abs(pos.y);
  if (edgeDstY <= 0.0) {
    pos.y = halfBounds.y * sign(pos.y);
    vel.y = -vel.y * params.collisionDamping;
  }

  // Z Collision
  let edgeDstZ = halfBounds.z - abs(pos.z);
  if (edgeDstZ <= 0.0) {
    pos.z = halfBounds.z * sign(pos.z);
    vel.z = -vel.z * params.collisionDamping;
  }

  positions[index] = vec4<f32>(pos, 1.0);
  velocities[index] = vec4<f32>(vel, 0.0);
}
