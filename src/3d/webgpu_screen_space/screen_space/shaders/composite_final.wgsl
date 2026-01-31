struct FullscreenOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

struct Uniforms {
  inverseViewProjection: mat4x4<f32>,
  lightViewProjection: mat4x4<f32>,
  foamColor: vec3<f32>,
  foamOpacity: f32,
  extinctionCoeff: vec3<f32>,
  extinctionMultiplier: f32,
  dirToSun: vec3<f32>,
  refractionStrength: f32,
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

fn rayBoxIntersection(origin: vec3<f32>, dir: vec3<f32>, boundsMin: vec3<f32>, boundsMax: vec3<f32>) -> vec2<f32> {
  let invDir = 1.0 / dir;
  let t0 = (boundsMin - origin) * invDir;
  let t1 = (boundsMax - origin) * invDir;
  let tmin = max(max(min(t0.x, t1.x), min(t0.y, t1.y)), min(t0.z, t1.z));
  let tmax = min(min(max(t0.x, t1.x), max(t0.y, t1.y)), max(t0.z, t1.z));
  return vec2<f32>(tmin, tmax);
}

fn skyColor(dir: vec3<f32>, sunDir: vec3<f32>) -> vec3<f32> {
  let colGround = vec3<f32>(0.7, 0.7, 0.72);
  let colSkyHorizon = vec3<f32>(1.0, 1.0, 1.0);
  let colSkyZenith = vec3<f32>(0.08, 0.37, 0.73);
  let sun = pow(max(0.0, dot(dir, sunDir)), 500.0);
  let skyGradientT = pow(smoothstep(0.0, 0.4, dir.y), 0.35);
  let groundToSkyT = smoothstep(-0.01, 0.0, dir.y);
  let skyGradient = mix(colSkyHorizon, colSkyZenith, skyGradientT);
  var res = mix(colGround, skyGradient, groundToSkyT);
  if (dir.y >= -0.01) { res = res + sun; }
  return res;
}

@fragment
fn fs_main(in: FullscreenOut) -> @location(0) vec4<f32> {
  let thickness = textureSample(thicknessTex, samp, in.uv).r;
  let n = textureSample(normalTex, samp, in.uv).rgb * 2.0 - 1.0;
  let normal = normalize(n);

  let depth = textureSample(depthTex, samp, in.uv).r;
  let ndc = vec4<f32>(in.uv.x * 2.0 - 1.0, 1.0 - in.uv.y * 2.0, depth, 1.0);
  var world = uniforms.inverseViewProjection * ndc;
  world = world / world.w;

  // Compute camera ray from near/far plane unprojection.
  let ndcNear = vec4<f32>(in.uv.x * 2.0 - 1.0, 1.0 - in.uv.y * 2.0, 0.0, 1.0);
  var worldNear = uniforms.inverseViewProjection * ndcNear;
  worldNear = worldNear / worldNear.w;
  let ndcFar = vec4<f32>(in.uv.x * 2.0 - 1.0, 1.0 - in.uv.y * 2.0, 1.0, 1.0);
  var worldFar = uniforms.inverseViewProjection * ndcFar;
  worldFar = worldFar / worldFar.w;
  let rayDir = normalize(worldFar.xyz - worldNear.xyz);

  // Sky background + bounded floor slab (matching raymarch).
  let bg = skyColor(rayDir, uniforms.dirToSun);
  let floorCenter = vec3<f32>(0.0, -5.025, 0.0);
  let floorSize = vec3<f32>(80.0, 0.05, 80.0);
  let floorMin = floorCenter - 0.5 * floorSize;
  let floorMax = floorCenter + 0.5 * floorSize;
  let tileScale = 1.0;
  let tileDarkFactor = 0.5;
  let tileCol1 = vec3<f32>(126.0 / 255.0, 183.0 / 255.0, 231.0 / 255.0);
  let tileCol2 = vec3<f32>(210.0 / 255.0, 165.0 / 255.0, 240.0 / 255.0);
  let tileCol3 = vec3<f32>(153.0 / 255.0, 229.0 / 255.0, 199.0 / 255.0);
  let tileCol4 = vec3<f32>(237.0 / 255.0, 225.0 / 255.0, 167.0 / 255.0);

  let boxHit = rayBoxIntersection(worldNear.xyz, rayDir, floorMin, floorMax);
  let floorHit = boxHit.y >= max(boxHit.x, 0.0);
  let t = max(boxHit.x, 0.0);
  let hitPos = worldNear.xyz + rayDir * t;
  let tileCoord = floor(hitPos.xz * tileScale);
  let isDark = (i32(tileCoord.x) & 1) == (i32(tileCoord.y) & 1);
  var tileCol = tileCol1;
  if (hitPos.x >= 0.0) { tileCol = tileCol2; }
  if (hitPos.z < 0.0) {
    if (hitPos.x < 0.0) { tileCol = tileCol3; } else { tileCol = tileCol4; }
  }
  if (isDark) { tileCol = tileCol * tileDarkFactor; }

  // Floor shadow from floor hit position.
  let floorLightPos = uniforms.lightViewProjection * vec4<f32>(hitPos, 1.0);
  let floorLightNdc = floorLightPos.xyz / floorLightPos.w;
  let floorShadowUV = vec2<f32>(floorLightNdc.x * 0.5 + 0.5, 0.5 - floorLightNdc.y * 0.5);
  let floorInBounds = step(0.0, floorShadowUV.x) * step(0.0, floorShadowUV.y) * step(floorShadowUV.x, 1.0) * step(floorShadowUV.y, 1.0);
  let floorShadowRaw = textureSampleCompare(shadowTex, shadowSampler, floorShadowUV, floorLightNdc.z - 0.002);
  let floorShadow = mix(1.0, floorShadowRaw, floorInBounds);
  let floorAmbient = 0.15;
  let floorLighting = floorShadow * (1.0 - floorAmbient) + floorAmbient;
  let floorCol = mix(bg, tileCol * floorLighting, select(0.0, 1.0, floorHit));

  // Fluid shadow from depth-reconstructed world position.
  let lightPos = uniforms.lightViewProjection * world;
  let lightNdc = lightPos.xyz / lightPos.w;
  let shadowUV = vec2<f32>(lightNdc.x * 0.5 + 0.5, 0.5 - lightNdc.y * 0.5);
  let shadowDepth = lightNdc.z;
  let inBounds = step(0.0, shadowUV.x) * step(0.0, shadowUV.y) * step(shadowUV.x, 1.0) * step(shadowUV.y, 1.0);
  let shadowRaw = textureSampleCompare(shadowTex, shadowSampler, shadowUV, shadowDepth - 0.002);
  let shadow = mix(1.0, shadowRaw, inBounds);

  let lightDir = normalize(uniforms.dirToSun);
  let ndotl = max(dot(normal, lightDir), 0.0) * shadow;

  let viewDir = normalize(vec3<f32>(0.0, 0.0, 1.0));
  let halfDir = normalize(lightDir + viewDir);
  let spec = pow(max(dot(normal, halfDir), 0.0), 64.0) * shadow;
  let fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 5.0);

  let base = vec3<f32>(0.02, 0.15, 0.45);
  let diffuse = base * (0.35 + 0.65 * ndotl);
  let specular = vec3<f32>(0.9, 0.95, 1.0) * spec * (0.2 + 0.8 * fresnel);

  let alpha = clamp(thickness * 4.0, 0.0, 1.0);

  let offset = normal.xy * uniforms.refractionStrength;
  let refractThickness = textureSample(thicknessTex, samp, in.uv + offset).r;

  let absorption = exp(-refractThickness * uniforms.extinctionCoeff * uniforms.extinctionMultiplier);
  let refracted = mix(floorCol, base, 1.0 - absorption);

  var color = mix(floorCol, diffuse + specular, alpha);
  color = mix(color, refracted, 0.4 * fresnel);
  let foam = textureSample(foamTex, samp, in.uv).r;
  color = mix(color, uniforms.foamColor, clamp(foam * uniforms.foamOpacity, 0.0, 1.0));

  let exposure = 1.2;
  return vec4<f32>(color * exposure, 1.0);
}
