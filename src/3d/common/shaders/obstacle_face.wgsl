/**
 * ==========================================================================
 * OBSTACLE FACE SHADER (Shadowed)
 * ==========================================================================
 */

// Beginner note: this is a standard vertex/fragment shader that also samples
// the shadow map to darken the obstacle where fluid blocks the light.

struct Uniforms {
  viewProjection: mat4x4<f32>,
  canvasSize: vec2<f32>,
  particleRadius: f32,
  velocityDisplayMax: f32,
  sceneExposure: f32,
  ambient: f32,
  sunBrightness: f32,
  pad0: f32,
  lightDir: vec3<f32>,
  pad1: f32,
};

struct ShadowUniforms {
  lightViewProjection: mat4x4<f32>,
  shadowSoftness: f32,
  particleShadowRadius: f32,
  pad0: vec2<f32>,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var shadowTex: texture_depth_2d;
@group(0) @binding(2) var shadowSampler: sampler_comparison;
@group(0) @binding(3) var<uniform> shadowUniforms: ShadowUniforms;

struct VertexIn {
  @location(0) pos: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) color: vec4<f32>,
};

struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) normal: vec3<f32>,
  @location(1) color: vec4<f32>,
  @location(2) worldPos: vec3<f32>,
};

@vertex
fn vs_main(input: VertexIn) -> VertexOut {
  var out: VertexOut;
  out.position = uniforms.viewProjection * vec4<f32>(input.pos, 1.0);
  out.normal = input.normal;
  out.color = input.color;
  out.worldPos = input.pos;
  return out;
}

fn sampleShadow(worldPos: vec3<f32>, ndotl: f32) -> f32 {
  let lightPos = shadowUniforms.lightViewProjection * vec4<f32>(worldPos, 1.0);
  let ndc = lightPos.xyz / lightPos.w;
  let uv = vec2<f32>(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);

  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 || ndc.z < 0.0 || ndc.z > 1.0) {
    return 1.0;
  }

  // Use larger bias for obstacle to prevent self-shadowing artifacts
  let bias = max(0.01 * (1.0 - ndotl), 0.005);
  let depth = ndc.z - bias;
  let softness = shadowUniforms.shadowSoftness;

  if (softness <= 0.001) {
    return textureSampleCompareLevel(shadowTex, shadowSampler, uv, depth);
  }

  let texel = vec2<f32>(1.0 / 2048.0) * softness;
  var sum = 0.0;
  sum += textureSampleCompareLevel(shadowTex, shadowSampler, uv, depth);
  sum += textureSampleCompareLevel(shadowTex, shadowSampler, uv + vec2<f32>(texel.x, 0.0), depth);
  sum += textureSampleCompareLevel(shadowTex, shadowSampler, uv + vec2<f32>(-texel.x, 0.0), depth);
  sum += textureSampleCompareLevel(shadowTex, shadowSampler, uv + vec2<f32>(0.0, texel.y), depth);
  sum += textureSampleCompareLevel(shadowTex, shadowSampler, uv + vec2<f32>(0.0, -texel.y), depth);

  return sum * 0.2;
}

@fragment
fn fs_main(input: VertexOut) -> @location(0) vec4<f32> {
  let n = normalize(input.normal);
  let l = normalize(uniforms.lightDir);
  let ndotl = max(dot(n, l), 0.0);
  let shadow = sampleShadow(input.worldPos, ndotl);
  // Use standard diffuse lighting (matching environment.wgsl) instead of half-lambert
  let shading = uniforms.ambient + ndotl * uniforms.sunBrightness * shadow;
  return vec4<f32>(input.color.rgb * shading * uniforms.sceneExposure, input.color.a);
}
