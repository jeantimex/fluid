struct Vertex {
  position: vec3<f32>,
  normal: vec3<f32>,
};

struct Uniforms {
  viewProjection: mat4x4<f32>,
  color: vec4<f32>,
  lightDir: vec3<f32>,
  ambient: f32,
  sceneExposure: f32,
  sunBrightness: f32,
};

#include "../../common/shaders/shadow_common.wgsl"

@group(0) @binding(0) var<storage, read> vertices: array<Vertex>;
@group(0) @binding(1) var<uniform> uniforms: Uniforms;
@group(0) @binding(2) var shadowTex: texture_depth_2d;
@group(0) @binding(3) var shadowSampler: sampler_comparison;
@group(0) @binding(4) var<uniform> shadowUniforms: ShadowUniforms;

struct VSOut {
  @builtin(position) position: vec4<f32>,
  @location(0) normal: vec3<f32>,
  @location(1) worldPos: vec3<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VSOut {
  let v = vertices[vertexIndex];
  var out: VSOut;
  out.position = uniforms.viewProjection * vec4<f32>(v.position, 1.0);
  out.normal = v.normal;
  out.worldPos = v.position;
  return out;
}

fn sampleShadow(worldPos: vec3<f32>, ndotl: f32) -> f32 {
  let lightPos = shadowUniforms.lightViewProjection * vec4<f32>(worldPos, 1.0);
  let ndc = lightPos.xyz / lightPos.w;
  let uv = vec2<f32>(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);

  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 || ndc.z < 0.0 || ndc.z > 1.0) {
    return 1.0;
  }

  // Slope-scaled bias
  let bias = max(0.0005 * (1.0 - ndotl), 0.0001);
  let depth = ndc.z - bias;
  let softness = shadowUniforms.shadowSoftness;

  if (softness <= 0.001) {
    return textureSampleCompareLevel(shadowTex, shadowSampler, uv, depth);
  }

  // PCF 5-tap pattern
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
fn fs_main(input: VSOut) -> @location(0) vec4<f32> {
  let n = normalize(input.normal);
  let l = normalize(uniforms.lightDir);
  let ndotl = max(dot(n, l), 0.0);
  
  let shadow = sampleShadow(input.worldPos, ndotl);
  
  let diffuse = ndotl * 0.5 + 0.5; // Half-Lambert
  let shading = uniforms.ambient + diffuse * uniforms.sunBrightness * shadow;
  
  return vec4<f32>(uniforms.color.rgb * shading * uniforms.sceneExposure, uniforms.color.a);
}
