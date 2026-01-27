struct SimParams {
  deltaTime: f32,
  gravity: f32,
  pad0: vec2<f32>,
};

@group(0) @binding(0) var<storage, read> positions: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> velocities: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> predicted: array<vec4<f32>>;
@group(0) @binding(3) var<uniform> params: SimParams;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let index = id.x;
  if (index >= arrayLength(&positions)) {
    return;
  }

  let pos = positions[index].xyz;
  var vel = velocities[index].xyz;

  // Apply gravity
  let gravityAccel = vec3<f32>(0.0, params.gravity, 0.0);
  
  vel = vel + gravityAccel * params.deltaTime;
  velocities[index] = vec4<f32>(vel, 0.0);

  // Prediction
  let predictionFactor = 1.0 / 120.0;
  predicted[index] = vec4<f32>(pos + vel * predictionFactor, 1.0);
}
