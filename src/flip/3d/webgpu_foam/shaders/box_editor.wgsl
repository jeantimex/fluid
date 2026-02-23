// Box editor wireframe shader.
//
// Purpose:
// - Render the container boundary overlay in world space.
// - Keep transforms simple: unit geometry scaled + translated by uniforms.
//
// Coordinate flow:
// model(unit cube) -> world(simOffset + size) -> view -> clip.

struct Uniforms {
  // Standard camera matrices shared with scene rendering.
  projectionMatrix: mat4x4<f32>,
  viewMatrix: mat4x4<f32>,
  // Per-draw transform for a unit cube.
  translation: vec3<f32>,
  scale: vec3<f32>,
  // Output line color.
  color: vec4<f32>,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
};

@vertex
fn vs_main(@location(0) position: vec3<f32>) -> VertexOutput {
  var out: VertexOutput;
  // Transform unit-geometry vertex into world space.
  let scaledPos = position * uniforms.scale + uniforms.translation;
  out.position = uniforms.projectionMatrix * uniforms.viewMatrix * vec4<f32>(scaledPos, 1.0);
  return out;
}

@fragment
fn fs_main() -> @location(0) vec4<f32> {
  return uniforms.color;
}
