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
@group(0) @binding(1) var depthTex: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;

fn bilateralWeight(dc: f32, dn: f32) -> f32 {
  let sigma = 0.02;
  let diff = dn - dc;
  return exp(- (diff * diff) / (sigma * sigma));
}

@fragment
fn fs_main(in: FullscreenOut) -> @location(0) f32 {
  let dims = textureDimensions(srcTex);
  let texel = 1.0 / vec2<f32>(dims);

  let depthCenter = textureSample(depthTex, samp, in.uv).r;

  var sum = 0.0;
  var wsum = 0.0;

  for (var y = -1; y <= 1; y = y + 1) {
    for (var x = -1; x <= 1; x = x + 1) {
      let offset = vec2<f32>(f32(x), f32(y)) * texel;
      let uv = in.uv + offset;
      let t = textureSample(srcTex, samp, uv).r;
      let d = textureSample(depthTex, samp, uv).r;
      let w = bilateralWeight(depthCenter, d);
      sum = sum + t * w;
      wsum = wsum + w;
    }
  }

  return select(0.0, sum / wsum, wsum > 0.0);
}
