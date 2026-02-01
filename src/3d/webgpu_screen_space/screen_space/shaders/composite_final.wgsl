struct FullscreenOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

#include "../../../common/shaders/environment.wgsl"

struct RenderUniforms {
  inverseViewProjection: mat4x4<f32>,
  lightViewProjection: mat4x4<f32>,
  foamColor: vec3<f32>,
  foamOpacity: f32,
  extinctionCoeff: vec3<f32>,
  extinctionMultiplier: f32,
  refractionStrength: f32,
  pad0: f32,
  pad1: f32,
  pad2: f32,
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
@group(0) @binding(7) var<uniform> renderUniforms: RenderUniforms;
@group(0) @binding(8) var<uniform> envUniforms: EnvironmentUniforms;

@fragment
fn fs_main(in: FullscreenOut) -> @location(0) vec4<f32> {
  let thickness = textureSample(thicknessTex, samp, in.uv).r;
  let n = textureSample(normalTex, samp, in.uv).rgb * 2.0 - 1.0;
  let normal = normalize(n);

  let depth = textureSample(depthTex, samp, in.uv).r;
  let ndc = vec4<f32>(in.uv.x * 2.0 - 1.0, 1.0 - in.uv.y * 2.0, depth, 1.0);
  var world = renderUniforms.inverseViewProjection * ndc;
  world = world / world.w;

  // Compute camera ray from near/far plane unprojection.
  let ndcNear = vec4<f32>(in.uv.x * 2.0 - 1.0, 1.0 - in.uv.y * 2.0, 0.0, 1.0);
  var worldNear = renderUniforms.inverseViewProjection * ndcNear;
  worldNear = worldNear / worldNear.w;
  let ndcFar = vec4<f32>(in.uv.x * 2.0 - 1.0, 1.0 - in.uv.y * 2.0, 1.0, 1.0);
  var worldFar = renderUniforms.inverseViewProjection * ndcFar;
  worldFar = worldFar / worldFar.w;
  let rayDir = normalize(worldFar.xyz - worldNear.xyz);

  // Background using shared environment
  // We don't have camera pos explicitly, but worldNear is roughly it (on near plane)
  // For infinite sky/floor, origin matters. worldNear is correct.
  var bg = getEnvironmentColor(worldNear.xyz, rayDir, envUniforms);

  // Floor shadow from floor hit position.
  let floorMin = envUniforms.floorCenter - 0.5 * envUniforms.floorSize;
  let floorMax = envUniforms.floorCenter + 0.5 * envUniforms.floorSize;
  let boxHit = envRayBoxIntersection(worldNear.xyz, rayDir, floorMin, floorMax);
  let floorHit = boxHit.y >= max(boxHit.x, 0.0);
  let t = select(boxHit.x, 0.0, boxHit.x < 0.0);
  let hitPos = worldNear.xyz + rayDir * t;

  let floorLightPos = renderUniforms.lightViewProjection * vec4<f32>(hitPos, 1.0);
  let floorLightNdc = floorLightPos.xyz / floorLightPos.w;
  let floorShadowUV = vec2<f32>(floorLightNdc.x * 0.5 + 0.5, 0.5 - floorLightNdc.y * 0.5);
  let floorInBounds = step(0.0, floorShadowUV.x) * step(0.0, floorShadowUV.y) * step(floorShadowUV.x, 1.0) * step(floorShadowUV.y, 1.0);
  let floorShadowRaw = textureSampleCompareLevel(shadowTex, shadowSampler, floorShadowUV, floorLightNdc.z - 0.002);
  let floorShadow = mix(1.0, floorShadowRaw, floorInBounds);
  
  let floorAmbient = envUniforms.floorAmbient;
  let floorSunTerm = max(0.0, envUniforms.dirToSun.y) * envUniforms.sunBrightness;
  
  // Re-modulate background if it was floor
  if (floorHit) {
    // Recover tileCol and apply additive shadowed sun
    let totalLightBase = floorAmbient + floorSunTerm;
    let tileCol = bg / max(totalLightBase, 0.001);
    bg = tileCol * (floorAmbient + floorSunTerm * floorShadow);
  }
  let finalBg = bg;

  // Fluid shadow from depth-reconstructed world position.
  let lightPos = renderUniforms.lightViewProjection * world;
  let lightNdc = lightPos.xyz / lightPos.w;
  let shadowUV = vec2<f32>(lightNdc.x * 0.5 + 0.5, 0.5 - lightNdc.y * 0.5);
  let shadowDepth = lightNdc.z;
  let inBounds = step(0.0, shadowUV.x) * step(0.0, shadowUV.y) * step(shadowUV.x, 1.0) * step(shadowUV.y, 1.0);
  let shadowRaw = textureSampleCompareLevel(shadowTex, shadowSampler, shadowUV, shadowDepth - 0.002);
  let shadow = mix(1.0, shadowRaw, inBounds);

  let lightDir = normalize(envUniforms.dirToSun);
  let ndotl = max(dot(normal, lightDir), 0.0) * shadow * envUniforms.sunBrightness;

  let viewDir = normalize(worldNear.xyz - world.xyz); // From surface to camera
  let halfDir = normalize(lightDir + viewDir);
  let spec = pow(max(dot(normal, halfDir), 0.0), 64.0) * shadow * envUniforms.sunBrightness;
  let fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 5.0);

  let base = vec3<f32>(0.02, 0.15, 0.45);
  let diffuse = base * (0.35 * floorAmbient + 0.65 * ndotl);
  let specular = vec3<f32>(0.9, 0.95, 1.0) * spec * (0.2 + 0.8 * fresnel);

  let alpha = clamp(thickness * 4.0, 0.0, 1.0);

  let offset = normal.xy * renderUniforms.refractionStrength;
  let refractThickness = textureSample(thicknessTex, samp, in.uv + offset).r;

  let absorption = exp(-refractThickness * renderUniforms.extinctionCoeff * renderUniforms.extinctionMultiplier);
  let refracted = mix(finalBg, base, 1.0 - absorption);

  // Obstacle shading
  let obsHit = getObstacleHit(worldNear.xyz, rayDir, envUniforms);
  let obsT = obsHit.x;
  
  let hasFluid = alpha > 0.001;
  let tFluid = select(1.0e9, dot(world.xyz - worldNear.xyz, rayDir), hasFluid);

  var color = mix(finalBg, diffuse + specular, alpha);
  color = mix(color, refracted, 0.4 * fresnel);
  let foam = textureSample(foamTex, samp, in.uv).r;
  color = mix(color, renderUniforms.foamColor, clamp(foam * renderUniforms.foamOpacity, 0.0, 1.0));

  if (obsT >= 0.0 && obsT < tFluid) {
    // Render obstacle on top
    let a = clamp(envUniforms.obstacleAlpha, 0.0, 1.0);
    // Obstacle lighting
    let ambient = envUniforms.floorAmbient;
    let sun = max(0.0, dot(obsHit.yzw, envUniforms.dirToSun)) * envUniforms.sunBrightness;
    
    // Apply shadow to obstacle
    let obsPos = worldNear.xyz + rayDir * obsT;
    let obsLightPos = renderUniforms.lightViewProjection * vec4<f32>(obsPos, 1.0);
    let obsLightNdc = obsLightPos.xyz / obsLightPos.w;
    let obsShadowUV = vec2<f32>(obsLightNdc.x * 0.5 + 0.5, 0.5 - obsLightNdc.y * 0.5);
    let obsInBounds = step(0.0, obsShadowUV.x) * step(0.0, obsShadowUV.y) * step(obsShadowUV.x, 1.0) * step(obsShadowUV.y, 1.0);
    let obsShadowRaw = textureSampleCompareLevel(shadowTex, shadowSampler, obsShadowUV, obsLightNdc.z - 0.002);
    let obsShadow = mix(1.0, obsShadowRaw, obsInBounds);
    
    let litShadowed = envUniforms.obstacleColor * (ambient + sun * obsShadow);
    
    color = mix(color, litShadowed, a);
  }

  let exposure = envUniforms.sceneExposure;
  return vec4<f32>(color * exposure, 1.0);
}
