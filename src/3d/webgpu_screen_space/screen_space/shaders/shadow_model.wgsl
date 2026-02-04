struct ModelUniforms {
  viewProj: mat4x4<f32>,
  model: mat4x4<f32>,
  lightDir: vec3<f32>,
  pad0: f32,
  lightViewProjection: mat4x4<f32>,
};

@group(0) @binding(0) var<uniform> uniforms: ModelUniforms;

struct VSIn {
  @location(0) position: vec3<f32>,
};

@vertex
fn vs_main(input: VSIn) -> @builtin(position) vec4<f32> {
  let worldPos = uniforms.model * vec4<f32>(input.position, 1.0);
  return uniforms.lightViewProjection * worldPos;
}
