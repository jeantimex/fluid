struct ModelUniforms {
  viewProj: mat4x4<f32>,
  model: mat4x4<f32>,
  lightDir: vec3<f32>,
  pad0: f32,
};

struct ShadowUniforms {
  lightViewProjection: mat4x4<f32>,
  shadowSoftness: f32,
  pad0: vec3<f32>,
};

@group(0) @binding(0) var<uniform> uniforms: ModelUniforms;
@group(0) @binding(1) var baseColorTex: texture_2d<f32>;
@group(0) @binding(2) var baseColorSampler: sampler;
@group(0) @binding(3) var shadowTex: texture_depth_2d;
@group(0) @binding(4) var shadowSampler: sampler_comparison;
@group(0) @binding(5) var<uniform> shadowUniforms: ShadowUniforms;
@group(0) @binding(6) var occluderShadowTex: texture_depth_2d;

struct VSIn {
  @location(0) position: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) uv: vec2<f32>,
};

struct VSOut {
  @builtin(position) position: vec4<f32>,
  @location(0) normal: vec3<f32>,
  @location(1) uv: vec2<f32>,
  @location(2) worldPos: vec3<f32>,
};

@vertex
fn vs_main(input: VSIn) -> VSOut {
  let worldPos = uniforms.model * vec4<f32>(input.position, 1.0);
  let worldNormal = normalize((uniforms.model * vec4<f32>(input.normal, 0.0)).xyz);

  var out: VSOut;
  out.position = uniforms.viewProj * worldPos;
  out.normal = worldNormal;
  out.uv = input.uv;
  out.worldPos = worldPos.xyz;
  return out;
}

fn sampleShadowMap(shadowMap: texture_depth_2d, worldPos: vec3<f32>, ndotl: f32) -> f32 {
  let lightPos = shadowUniforms.lightViewProjection * vec4<f32>(worldPos, 1.0);
  let ndc = lightPos.xyz / lightPos.w;
  let uv = vec2<f32>(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);

  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 || ndc.z < 0.0 || ndc.z > 1.0) {
    return 1.0;
  }

  // Slope-scaled bias
  let bias = max(0.005 * (1.0 - ndotl), 0.0005);
  let depth = ndc.z - bias;
  let softness = shadowUniforms.shadowSoftness;

  if (softness <= 0.001) {
    return textureSampleCompareLevel(shadowMap, shadowSampler, uv, depth);
  }

  let texel = vec2<f32>(1.0 / 2048.0) * softness;
  var sum = 0.0;
  sum += textureSampleCompareLevel(shadowMap, shadowSampler, uv, depth);
  sum += textureSampleCompareLevel(shadowMap, shadowSampler, uv + vec2<f32>(texel.x, 0.0), depth);
  sum += textureSampleCompareLevel(shadowMap, shadowSampler, uv + vec2<f32>(-texel.x, 0.0), depth);
  sum += textureSampleCompareLevel(shadowMap, shadowSampler, uv + vec2<f32>(0.0, texel.y), depth);
  sum += textureSampleCompareLevel(shadowMap, shadowSampler, uv + vec2<f32>(0.0, -texel.y), depth);
  
  return sum * 0.2;
}

@fragment
fn fs_main(input: VSOut) -> @location(0) vec4<f32> {
  let base = textureSample(baseColorTex, baseColorSampler, input.uv).rgb;
  let ndotl = max(dot(normalize(input.normal), normalize(uniforms.lightDir)), 0.0);
  
  // Sample shadows
  let particleShadow = sampleShadowMap(shadowTex, input.worldPos, ndotl);
  let occluderShadow = sampleShadowMap(occluderShadowTex, input.worldPos, ndotl);
  let shadow = min(particleShadow, occluderShadow);

  let ambient = 0.2;
  let lit = base * (ambient + ndotl * shadow * (1.0 - ambient));
  return vec4<f32>(lit, 1.0);
}
