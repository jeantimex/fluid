struct SimUniforms {
  boundsSize: vec2<f32>,
  canvasSize: vec2<f32>,
  particleRadius: f32,
  velocityDisplayMax: f32,
  gradientResolution: f32,
  pad0: f32,
};

@group(0) @binding(0) var<storage, read> positions: array<vec2<f32>>;
@group(0) @binding(1) var<storage, read> velocities: array<vec2<f32>>;
@group(0) @binding(2) var<storage, read> gradient: array<vec4<f32>>;
@group(0) @binding(3) var<uniform> uniforms: SimUniforms;

struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) localPos: vec2<f32>,
  @location(1) speed: f32,
};

@vertex
fn vs_main(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32
) -> VertexOut {
  var quad = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(1.0, -1.0),
    vec2<f32>(1.0, 1.0),
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(1.0, 1.0),
    vec2<f32>(-1.0, 1.0)
  );

  let pos = positions[instanceIndex];
  let halfBounds = uniforms.boundsSize * 0.5;
  let ndc = vec2<f32>(pos.x / halfBounds.x, pos.y / halfBounds.y);
  let radiusNdc = vec2<f32>(
    uniforms.particleRadius / uniforms.canvasSize.x * 2.0,
    uniforms.particleRadius / uniforms.canvasSize.y * 2.0
  );
  let offset = quad[vertexIndex] * radiusNdc;

  var out: VertexOut;
  out.position = vec4<f32>(ndc + offset, 0.0, 1.0);
  out.localPos = quad[vertexIndex];
  let vel = velocities[instanceIndex];
  out.speed = length(vel);
  return out;
}

@fragment
fn fs_main(
  @location(0) localPos: vec2<f32>,
  @location(1) speed: f32
) -> @location(0) vec4<f32> {
  if (dot(localPos, localPos) > 1.0) {
    discard;
  }
  let t = clamp(speed / uniforms.velocityDisplayMax, 0.0, 1.0);
  let idx = u32(t * (uniforms.gradientResolution - 1.0));
  return gradient[idx];
}
