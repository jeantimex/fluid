struct SimParams {
  deltaTime: f32,
  gravity: f32,
  interactionRadius: f32,
  interactionStrength: f32,
  inputPoint: vec2<f32>,
  pad0: vec2<f32>,
};

@group(0) @binding(0) var<storage, read> positions: array<vec2<f32>>;
@group(0) @binding(1) var<storage, read_write> velocities: array<vec2<f32>>;
@group(0) @binding(2) var<storage, read_write> predicted: array<vec2<f32>>;
@group(0) @binding(3) var<uniform> params: SimParams;

fn externalForces(pos: vec2<f32>, velocity: vec2<f32>) -> vec2<f32> {
  let gravityAccel = vec2<f32>(0.0, -params.gravity);
  if (params.interactionStrength == 0.0) {
    return gravityAccel;
  }

  let offset = params.inputPoint - pos;
  let sqrDst = dot(offset, offset);
  let radius = params.interactionRadius;
  if (sqrDst < radius * radius && sqrDst > 0.000001) {
    let dst = sqrt(sqrDst);
    let edgeT = dst / radius;
    let centreT = 1.0 - edgeT;
    let dirToCentre = offset / dst;
    let gravityWeight = 1.0 - (centreT * saturate(params.interactionStrength / 10.0));
    var accel = gravityAccel * gravityWeight + dirToCentre * centreT * params.interactionStrength;
    accel -= velocity * centreT;
    return accel;
  }

  return gravityAccel;
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let index = id.x;
  if (index >= arrayLength(&positions)) {
    return;
  }

  let pos = positions[index];
  var vel = velocities[index];
  vel = vel + externalForces(pos, vel) * params.deltaTime;
  velocities[index] = vel;

  let predictionFactor = 1.0 / 120.0;
  predicted[index] = pos + vel * predictionFactor;
}
