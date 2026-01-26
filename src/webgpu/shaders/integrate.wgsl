struct IntegrateParams {
  dt: f32,
  collisionDamping: f32,
  hasObstacle: f32,
  pad0: f32,
  halfBounds: vec2<f32>,
  pad1: vec2<f32>,
  obstacleCenter: vec2<f32>,
  obstacleHalf: vec2<f32>,
};

@group(0) @binding(0) var<storage, read_write> positions: array<vec2<f32>>;
@group(0) @binding(1) var<storage, read_write> velocities: array<vec2<f32>>;
@group(0) @binding(2) var<uniform> params: IntegrateParams;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let index = id.x;
  if (index >= arrayLength(&positions)) {
    return;
  }

  var pos = positions[index];
  var vel = velocities[index];

  pos = pos + vel * params.dt;

  let halfBounds = params.halfBounds;
  let edgeDstX = halfBounds.x - abs(pos.x);
  let edgeDstY = halfBounds.y - abs(pos.y);

  if (edgeDstX <= 0.0) {
    pos.x = halfBounds.x * sign(pos.x);
    vel.x = -vel.x * params.collisionDamping;
  }
  if (edgeDstY <= 0.0) {
    pos.y = halfBounds.y * sign(pos.y);
    vel.y = -vel.y * params.collisionDamping;
  }

  if (params.hasObstacle > 0.5) {
    let ox = pos.x - params.obstacleCenter.x;
    let oy = pos.y - params.obstacleCenter.y;
    let obstacleEdgeX = params.obstacleHalf.x - abs(ox);
    let obstacleEdgeY = params.obstacleHalf.y - abs(oy);

    if (obstacleEdgeX >= 0.0 && obstacleEdgeY >= 0.0) {
      if (obstacleEdgeX < obstacleEdgeY) {
        pos.x = params.obstacleHalf.x * sign(ox) + params.obstacleCenter.x;
        vel.x = -vel.x * params.collisionDamping;
      } else {
        pos.y = params.obstacleHalf.y * sign(oy) + params.obstacleCenter.y;
        vel.y = -vel.y * params.collisionDamping;
      }
    }
  }

  positions[index] = pos;
  velocities[index] = vel;
}
