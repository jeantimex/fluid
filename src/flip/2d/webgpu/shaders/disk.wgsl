/**
 * Disk/Obstacle Rendering Shader
 *
 * Renders the obstacle as a solid colored disk using pre-computed mesh geometry.
 * Uses indexed triangle rendering with a fan pattern.
 */

struct Uniforms {
  domainSize: vec2<f32>,
  translation: vec2<f32>,
  scale: f32,
  _pad0: f32,
  _pad1: f32,
  _pad2: f32,
  color: vec3<f32>,
  _pad3: f32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> vertices: array<vec2<f32>>;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec3<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  var output: VertexOutput;

  // Get vertex position from buffer
  let localPos = vertices[vertexIndex];

  // Apply scale and translation
  let worldPos = uniforms.translation + localPos * uniforms.scale;

  // Transform to NDC: [-1, 1] range
  let screenPos = vec2<f32>(
    2.0 * worldPos.x / uniforms.domainSize.x - 1.0,
    2.0 * worldPos.y / uniforms.domainSize.y - 1.0
  );

  output.position = vec4<f32>(screenPos, 0.0, 1.0);
  output.color = uniforms.color;

  return output;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
  return vec4<f32>(input.color, 1.0);
}
