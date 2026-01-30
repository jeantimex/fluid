struct FullscreenOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> FullscreenOut {
  var pos = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>( 1.0,  1.0)
  );

  var out: FullscreenOut;
  let p = pos[vertexIndex];
  out.position = vec4<f32>(p, 0.0, 1.0);
  out.uv = vec2<f32>(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5);
  return out;
}

@group(0) @binding(0) var srcTex: texture_2d<f32>;
@group(0) @binding(1) var srcSampler: sampler;

@fragment
fn fs_main(in: FullscreenOut) -> @location(0) f32 {
  let dims = textureDimensions(srcTex);
  let texel = 1.0 / vec2<f32>(dims);

  let c0 = textureSample(srcTex, srcSampler, in.uv).r;
  let c1 = textureSample(srcTex, srcSampler, in.uv + vec2<f32>( texel.x, 0.0)).r;
  let c2 = textureSample(srcTex, srcSampler, in.uv + vec2<f32>(-texel.x, 0.0)).r;
  let c3 = textureSample(srcTex, srcSampler, in.uv + vec2<f32>(0.0,  texel.y)).r;
  let c4 = textureSample(srcTex, srcSampler, in.uv + vec2<f32>(0.0, -texel.y)).r;

  return (c0 + c1 + c2 + c3 + c4) * 0.2;
}
