struct Uniforms {
  viewProjection: mat4x4<f32>,
  particleRadius: f32,
  lightScale: vec2<f32>,
  _pad: f32,
};

@group(0) @binding(0) var<storage, read> positions: array<vec4<f32>>;
@group(0) @binding(1) var<uniform> uniforms: Uniforms;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32
) -> VertexOutput {
  let pos = positions[instanceIndex].xyz;

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
  let radiusNdc = vec2<f32>(
    uniforms.particleRadius * uniforms.lightScale.x,
    uniforms.particleRadius * uniforms.lightScale.y
  );
  let offset = quadPos * radiusNdc * clipPos.w;

  var out: VertexOutput;
  out.position = clipPos + vec4<f32>(offset, 0.0, 0.0);
  out.uv = quadPos;
  return out;
}

@fragment
fn fs_main(in: VertexOutput) {
  let d = length(in.uv);
  if (d > 1.0) {
    discard;
  }
}
