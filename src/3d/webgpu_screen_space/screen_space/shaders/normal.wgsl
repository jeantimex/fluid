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

@group(0) @binding(0) var depthTex: texture_2d<f32>;
@group(0) @binding(1) var depthSampler: sampler;

@fragment
fn fs_main(in: FullscreenOut) -> @location(0) vec4<f32> {
  let dims = textureDimensions(depthTex);
  let texel = 1.0 / vec2<f32>(dims);

  let dC = textureSample(depthTex, depthSampler, in.uv).r;
  let dR = textureSample(depthTex, depthSampler, in.uv + vec2<f32>(texel.x, 0.0)).r;
  let dU = textureSample(depthTex, depthSampler, in.uv + vec2<f32>(0.0, texel.y)).r;

  let strength = 200.0;
  let dzdx = (dR - dC) * strength;
  let dzdy = (dU - dC) * strength;

  let n = normalize(vec3<f32>(-dzdx, -dzdy, 1.0));
  return vec4<f32>(n * 0.5 + 0.5, 1.0);
}
