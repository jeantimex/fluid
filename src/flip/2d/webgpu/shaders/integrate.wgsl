struct SimParams {
  width : f32,
  height : f32,
  gravity : f32,
  dt : f32,
}

@group(0) @binding(0) var<uniform> params : SimParams;
@group(0) @binding(1) var<storage, read_write> positions : array<vec2<f32>>;
@group(0) @binding(2) var<storage, read_write> velocities : array<vec2<f32>>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id : vec3<u32>) {
  let index = id.x;
  if (index >= arrayLength(&positions)) {
    return;
  }

  var pos = positions[index];
  var vel = velocities[index];

  // Apply gravity
  vel.y += params.gravity * params.dt;

  // Integrate position
  pos += vel * params.dt;

  // Boundary Collisions (Walls)
  // Matching ref.html logic: minX = h + r, maxX = (numX-1)*h - r...
  // For now, let's use simple [0, width] bounds with a small margin
  let margin = 0.02; 
  
  if (pos.x < margin) {
    pos.x = margin;
    vel.x = 0.0;
  }
  if (pos.x > params.width - margin) {
    pos.x = params.width - margin;
    vel.x = 0.0;
  }
  if (pos.y < margin) {
    pos.y = margin;
    vel.y = 0.0;
  }
  if (pos.y > params.height - margin) {
    pos.y = params.height - margin;
    vel.y = 0.0;
  }

  positions[index] = pos;
  velocities[index] = vel;
}
