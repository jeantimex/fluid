/**
 * Foam post-process shader.
 *
 * Converts raw foam splats into a cohesive patch mask using
 * directional blur, soft-thresholding, edge boost, and temporal blend.
 */

struct FullscreenOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

struct FoamPostUniforms {
  // x=texelSizeX, y=texelSizeY, z=threshold, w=softness
  texelAndThreshold: vec4<f32>,
  // x=blurRadius, y=edgeBoost, z=temporalBlend, w=anisotropy
  postParams: vec4<f32>,
};

@group(0) @binding(0) var rawFoamTex: texture_2d<f32>;
@group(0) @binding(1) var thicknessTex: texture_2d<f32>;
@group(0) @binding(2) var historyTex: texture_2d<f32>;
@group(0) @binding(3) var samp: sampler;
@group(0) @binding(4) var<uniform> uniforms: FoamPostUniforms;

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

fn sampleFoam(uv: vec2<f32>) -> f32 {
  return textureSample(rawFoamTex, samp, uv).r;
}

@fragment
fn fs_main(in: FullscreenOut) -> @location(0) f32 {
  let texel = uniforms.texelAndThreshold.xy;
  let threshold = max(0.0, uniforms.texelAndThreshold.z);
  let softness = max(1e-4, uniforms.texelAndThreshold.w);

  let blurRadius = max(1.0, uniforms.postParams.x);
  let edgeBoost = max(0.0, uniforms.postParams.y);
  let temporalBlend = clamp(uniforms.postParams.z, 0.0, 0.98);
  let anisotropy = max(0.0, uniforms.postParams.w);

  let tL = textureSample(thicknessTex, samp, in.uv - vec2<f32>(texel.x, 0.0)).r;
  let tR = textureSample(thicknessTex, samp, in.uv + vec2<f32>(texel.x, 0.0)).r;
  let tD = textureSample(thicknessTex, samp, in.uv + vec2<f32>(0.0, texel.y)).r;
  let tU = textureSample(thicknessTex, samp, in.uv - vec2<f32>(0.0, texel.y)).r;
  let grad = vec2<f32>(tR - tL, tU - tD);

  let gradLen = length(grad);
  let dir = select(vec2<f32>(1.0, 0.0), normalize(grad), gradLen > 1e-5);
  let perp = vec2<f32>(-dir.y, dir.x);

  let major = 1.0 + anisotropy * 1.75;
  let minor = 1.0;

  var sum = 0.0;
  var wsum = 0.0;

  let w0 = 0.227027;
  let w1 = 0.1945946;
  let w2 = 0.1216216;

  let dirStep = dir * texel * blurRadius * major;
  let perpStep = perp * texel * blurRadius * minor;

  let c = sampleFoam(in.uv);
  sum += c * w0;
  wsum += w0;

  let d1a = sampleFoam(in.uv + dirStep);
  let d1b = sampleFoam(in.uv - dirStep);
  let p1a = sampleFoam(in.uv + perpStep);
  let p1b = sampleFoam(in.uv - perpStep);
  sum += (d1a + d1b) * (w1 * 0.65) + (p1a + p1b) * (w1 * 0.35);
  wsum += w1 * 2.0;

  let d2a = sampleFoam(in.uv + dirStep * 2.0);
  let d2b = sampleFoam(in.uv - dirStep * 2.0);
  let p2a = sampleFoam(in.uv + perpStep * 2.0);
  let p2b = sampleFoam(in.uv - perpStep * 2.0);
  sum += (d2a + d2b) * (w2 * 0.65) + (p2a + p2b) * (w2 * 0.35);
  wsum += w2 * 2.0;

  let blurred = select(0.0, sum / wsum, wsum > 0.0);

  let edge = clamp(gradLen * edgeBoost * 5.0, 0.0, 1.0);
  let boosted = blurred * (1.0 + edge);

  let low = max(0.0, threshold - softness * 0.5);
  let high = max(low + 1e-4, threshold + softness * 0.5);
  let mask = smoothstep(low, high, boosted);

  let history = textureSample(historyTex, samp, in.uv).r;
  return mix(mask, history, temporalBlend);
}
