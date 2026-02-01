/**
 * ============================================================================
 * OBSTACLE FACE SHADER (Lit)
 * ============================================================================
 *
 * Pipeline Stage: Render pass (obstacle faces)
 * Entry Points: vs_main (vertex), fs_main (fragment)
 * Topology: triangle-list
 *
 * Purpose:
 * --------
 * Renders the obstacle box faces with half-Lambert shading identical to
 * the marching cubes surface shader. Each vertex carries a world-space
 * position, a face normal, and an RGBA colour.
 *
 * The uniform buffer shares the same layout as the marching cubes draw
 * shader (96 bytes): viewProjection (64) + surfaceColor (16, unused here)
 * + lightDir (12) + pad (4).
 * ============================================================================
 */

struct Uniforms {
  viewProjection: mat4x4<f32>,
  pad0: vec4<f32>,
  lightDir: vec3<f32>,
  _pad1: f32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct VertexIn {
  @location(0) pos: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) color: vec4<f32>,
};

struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) normal: vec3<f32>,
  @location(1) color: vec4<f32>,
};

@vertex
fn vs_main(input: VertexIn) -> VertexOut {
  var out: VertexOut;
  out.position = uniforms.viewProjection * vec4<f32>(input.pos, 1.0);
  out.normal = input.normal;
  out.color = input.color;
  return out;
}

@fragment
fn fs_main(input: VertexOut) -> @location(0) vec4<f32> {
  let n = normalize(input.normal);
  let l = normalize(uniforms.lightDir);
  let shading = max(dot(n, l) * 0.5 + 0.5, 0.15);
  return vec4<f32>(input.color.rgb * shading, input.color.a);
}
