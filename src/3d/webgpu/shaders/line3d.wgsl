/**
 * Wireframe Line Shader
 *
 * Renders the bounding box and obstacles as simple 3D lines.
 * Uses the same view-projection matrix as the particles to ensure alignment.
 */

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
  // Transform world position to clip space
  out.position = uniforms.viewProjection * vec4<f32>(input.pos, 1.0);
  // Pass color through to fragment shader
  out.color = input.color;
  return out;
}

@fragment
fn fs_main(@location(0) color: vec4<f32>) -> @location(0) vec4<f32> {
  return color;
}
