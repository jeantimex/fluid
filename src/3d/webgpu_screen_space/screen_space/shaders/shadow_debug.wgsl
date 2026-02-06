// Debug shader - renders all particles as white dots to verify shadow pass works

struct Uniforms {
  viewProjection: mat4x4<f32>,
  canvasSize: vec2<f32>,
  particleRadius: f32,
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
  let ndc = clipPos.xyz / clipPos.w;

  let radiusNdc = vec2<f32>(0.02, 0.02);
  let offset = quadPos * radiusNdc;

  var out: VertexOutput;
  // Clamp Z to valid [0,1] range for WebGPU
  let z = clamp(ndc.z, 0.0, 1.0);
  out.position = vec4<f32>(ndc.xy + offset, z, 1.0);
  out.uv = quadPos;
  return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) f32 {
  let d = length(in.uv);
  if (d > 1.0) {
    discard;
  }
  // Return a constant value for debugging
  return 1.0;
}
