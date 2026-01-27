struct Uniforms {
  viewProjection: mat4x4<f32>,
  radius: f32,
  pad0: vec3<f32>,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct VertexIn {
  @location(0) pos: vec3<f32>,
  @location(1) color: vec4<f32>,
};

struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
};

@vertex
fn vs_main(input: VertexIn) -> VertexOut {
  var out: VertexOut;
  out.position = uniforms.viewProjection * vec4<f32>(input.pos, 1.0);
  out.color = input.color;
  return out;
}

@fragment
fn fs_main(@location(0) color: vec4<f32>) -> @location(0) vec4<f32> {
  return color;
}
