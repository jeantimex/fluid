struct ModelUniforms {
  viewProj: mat4x4<f32>,
  model: mat4x4<f32>,
  lightDir: vec3<f32>,
  pad0: f32,
  lightViewProjection: mat4x4<f32>,
};

@group(0) @binding(0) var<uniform> uniforms: ModelUniforms;
@group(0) @binding(1) var baseColorTex: texture_2d<f32>;
@group(0) @binding(2) var baseColorSampler: sampler;
@group(0) @binding(3) var shadowTex: texture_depth_2d;
@group(0) @binding(4) var shadowSampler: sampler_comparison;

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

fn sampleShadow(worldPos: vec3<f32>, ndotl: f32) -> f32 {
  let lightPos = uniforms.lightViewProjection * vec4<f32>(worldPos, 1.0);
  let ndc = lightPos.xyz / lightPos.w;
  let uv = vec2<f32>(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);

  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 || ndc.z < 0.0 || ndc.z > 1.0) {
    return 1.0;
  }

  let bias = max(0.005 * (1.0 - ndotl), 0.0005);
  let depth = ndc.z - bias;
  return textureSampleCompareLevel(shadowTex, shadowSampler, uv, depth);
}

@fragment
fn fs_main(input: VSOut) -> @location(0) vec4<f32> {
  let base = textureSample(baseColorTex, baseColorSampler, input.uv).rgb;
  let ndotl = max(dot(normalize(input.normal), normalize(uniforms.lightDir)), 0.0);
  let shadow = sampleShadow(input.worldPos, ndotl);
  let ambient = 0.3;
  let lit = base * (ambient + ndotl * shadow * (1.0 - ambient));
  return vec4<f32>(lit, 1.0);
}
