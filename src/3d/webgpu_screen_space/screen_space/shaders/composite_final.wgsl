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

@group(0) @binding(0) var thicknessTex: texture_2d<f32>;
@group(0) @binding(1) var normalTex: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;

@fragment
fn fs_main(in: FullscreenOut) -> @location(0) vec4<f32> {
  let thickness = textureSample(thicknessTex, samp, in.uv).r;
  let n = textureSample(normalTex, samp, in.uv).rgb * 2.0 - 1.0;
  let normal = normalize(n);

  let lightDir = normalize(vec3<f32>(0.3, 0.8, 0.5));
  let ndotl = max(dot(normal, lightDir), 0.0);

  let base = vec3<f32>(0.2, 0.45, 0.7);
  let diffuse = base * (0.2 + 0.8 * ndotl);

  let viewDir = normalize(vec3<f32>(0.0, 0.0, 1.0));
  let halfDir = normalize(lightDir + viewDir);
  let spec = pow(max(dot(normal, halfDir), 0.0), 64.0);
  let fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 5.0);
  let specular = vec3<f32>(0.8, 0.9, 1.0) * spec * (0.2 + 0.8 * fresnel);
  let alpha = clamp(thickness * 2.0, 0.0, 1.0);
  let bg = vec3<f32>(0.03, 0.03, 0.05);
  let color = mix(bg, diffuse + specular, alpha);
  return vec4<f32>(color, 1.0);
}
