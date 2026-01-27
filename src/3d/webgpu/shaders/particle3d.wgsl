struct Uniforms {
  viewProjection: mat4x4<f32>,
  radius: f32,
  velocityDisplayMax: f32,
  pad0: vec2<f32>,
};

@group(0) @binding(0) var<storage, read> positions: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read> velocities: array<vec4<f32>>;
@group(0) @binding(2) var<uniform> uniforms: Uniforms;
@group(0) @binding(3) var<storage, read> gradient: array<vec4<f32>>;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) color: vec3<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instanceIndex: u32) -> VertexOutput {
  let pos = positions[instanceIndex].xyz;
  let vel = velocities[instanceIndex].xyz;
  
  var quadPos = vec2<f32>(0.0, 0.0);
  switch (vertexIndex) {
    case 0u: { quadPos = vec2<f32>(-1.0, -1.0); }
    case 1u: { quadPos = vec2<f32>( 1.0, -1.0); }
    case 2u: { quadPos = vec2<f32>(-1.0,  1.0); }
    case 3u: { quadPos = vec2<f32>(-1.0,  1.0); }
    case 4u: { quadPos = vec2<f32>( 1.0, -1.0); }
    case 5u: { quadPos = vec2<f32>( 1.0,  1.0); }
    default: { quadPos = vec2<f32>(0.0, 0.0); }
  }

  let clipPos = uniforms.viewProjection * vec4<f32>(pos, 1.0);
  
  var out: VertexOutput;
  out.position = clipPos + vec4<f32>(quadPos * uniforms.radius, 0.0, 0.0);
  
  out.uv = quadPos;
  let speed = length(vel);
  let t = saturate(speed / uniforms.velocityDisplayMax);
  let index = u32(t * f32(arrayLength(&gradient) - 1u));
  out.color = gradient[index].rgb;
  
  return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
  let d = length(in.uv);
  if (d > 1.0) { discard; }
  return vec4<f32>(in.color, 1.0);
}
