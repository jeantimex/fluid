struct FullscreenOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

struct Uniforms {
  inverseViewProjection: mat4x4<f32>,
  lightViewProjection: mat4x4<f32>,
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
@group(0) @binding(2) var depthTex: texture_2d<f32>;
@group(0) @binding(3) var shadowTex: texture_depth_2d;
@group(0) @binding(4) var foamTex: texture_2d<f32>;
@group(0) @binding(5) var samp: sampler;
@group(0) @binding(6) var shadowSampler: sampler_comparison;
@group(0) @binding(7) var<uniform> uniforms: Uniforms;

@fragment
fn fs_main(in: FullscreenOut) -> @location(0) vec4<f32> {
  let thickness = textureSample(thicknessTex, samp, in.uv).r;
  let n = textureSample(normalTex, samp, in.uv).rgb * 2.0 - 1.0;
  let normal = normalize(n);

  let depth = textureSample(depthTex, samp, in.uv).r;
  let ndc = vec4<f32>(in.uv.x * 2.0 - 1.0, 1.0 - in.uv.y * 2.0, depth, 1.0);
  var world = uniforms.inverseViewProjection * ndc;
  world = world / world.w;

  // Background + floor (checkerboard), matching raymarch palette.
  let bg = vec3<f32>(0.03, 0.05, 0.08);
  let floorY = -5.025;
  let tileScale = 1.0;
  let tileDarkFactor = 0.5;
  let tileCol1 = vec3<f32>(126.0 / 255.0, 183.0 / 255.0, 231.0 / 255.0);
  let tileCol2 = vec3<f32>(210.0 / 255.0, 165.0 / 255.0, 240.0 / 255.0);
  let tileCol3 = vec3<f32>(153.0 / 255.0, 229.0 / 255.0, 199.0 / 255.0);
  let tileCol4 = vec3<f32>(237.0 / 255.0, 225.0 / 255.0, 167.0 / 255.0);

  // Ray from camera through pixel to find floor intersection.
  let ndcFar = vec4<f32>(in.uv.x * 2.0 - 1.0, 1.0 - in.uv.y * 2.0, 1.0, 1.0);
  var worldFar = uniforms.inverseViewProjection * ndcFar;
  worldFar = worldFar / worldFar.w;
  let rayDir = normalize(worldFar.xyz - world.xyz);

  let denom = rayDir.y;
  let t = (floorY - world.y) / denom;
  let hit = select(0.0, 1.0, t > 0.0);
  let hitPos = world.xyz + rayDir * t;
  let tileCoord = floor(hitPos.xz * tileScale);
  let isDark = (i32(tileCoord.x) & 1) == (i32(tileCoord.y) & 1);
  var tileCol = tileCol1;
  if (hitPos.x >= 0.0) { tileCol = tileCol2; }
  if (hitPos.z < 0.0) {
    if (hitPos.x < 0.0) { tileCol = tileCol3; } else { tileCol = tileCol4; }
  }
  if (isDark) { tileCol = tileCol * tileDarkFactor; }
  let floorCol = mix(bg, tileCol, hit);

  let lightPos = uniforms.lightViewProjection * world;
  let lightNdc = lightPos.xyz / lightPos.w;
  let shadowUV = vec2<f32>(lightNdc.x * 0.5 + 0.5, 0.5 - lightNdc.y * 0.5);
  let shadowDepth = lightNdc.z;
  let inBounds = step(0.0, shadowUV.x) * step(0.0, shadowUV.y) * step(shadowUV.x, 1.0) * step(shadowUV.y, 1.0);
  let shadowRaw = textureSampleCompare(shadowTex, shadowSampler, shadowUV, shadowDepth - 0.002);
  let shadow = mix(1.0, shadowRaw, inBounds);

  let lightDir = normalize(vec3<f32>(0.3, 0.8, 0.5));
  let ndotl = max(dot(normal, lightDir), 0.0) * shadow;

  let viewDir = normalize(vec3<f32>(0.0, 0.0, 1.0));
  let halfDir = normalize(lightDir + viewDir);
  let spec = pow(max(dot(normal, halfDir), 0.0), 64.0) * shadow;
  let fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 5.0);

  let base = vec3<f32>(0.08, 0.32, 0.18);
  let diffuse = base * (0.35 + 0.65 * ndotl);
  let specular = vec3<f32>(0.8, 0.9, 1.0) * spec * (0.2 + 0.8 * fresnel);

  let alpha = clamp(thickness * 4.0, 0.0, 1.0);

  let refractionStrength = 0.12;
  let offset = normal.xy * refractionStrength;
  let refractThickness = textureSample(thicknessTex, samp, in.uv + offset).r;

  let absorption = exp(-refractThickness * 2.0);
  let refracted = mix(floorCol, base, 1.0 - absorption);

  var color = mix(floorCol, diffuse + specular, alpha);
  color = mix(color, refracted, 0.4 * fresnel);
  let foam = textureSample(foamTex, samp, in.uv).r;
  color = mix(color, vec3<f32>(0.95, 0.98, 1.0), clamp(foam * 2.0, 0.0, 1.0));

  return vec4<f32>(color, 1.0);
}
