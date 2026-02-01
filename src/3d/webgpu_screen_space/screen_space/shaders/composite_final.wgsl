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
  let bg = getEnvironmentColor(worldNear.xyz, rayDir, envUniforms);

  // Floor shadow from floor hit position.
  // Re-calculate floor hit to get shadow coords (environment.wgsl doesn't expose internal hit pos directly)
  // We can use envRayBoxIntersection helper
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
  let floorShadowRaw = textureSampleCompare(shadowTex, shadowSampler, floorShadowUV, floorLightNdc.z - 0.002);
  let floorShadow = mix(1.0, floorShadowRaw, floorInBounds);
  let floorAmbient = envUniforms.floorAmbient;
  let floorLighting = floorShadow * (1.0 - floorAmbient) + floorAmbient;
  
  // Re-modulate background if it was floor
  // If getEnvironmentColor returned floor color, we want to apply shadow.
  // If it returned sky, we shouldn't.
  // This is tricky because getEnvironmentColor already returns the final color.
  // 
  // Workaround: We know if we hit the floor or not.
  // If floorHit is true, 'bg' is the floor color (without shadow).
  // We multiply by floorLighting.
  // Wait, getEnvironmentColor applies ambient but NOT shadow.
  // So:
  let finalBg = mix(bg, bg * floorLighting, select(0.0, 1.0, floorHit));

  // Fluid shadow from depth-reconstructed world position.
  let lightPos = renderUniforms.lightViewProjection * world;
  let lightNdc = lightPos.xyz / lightPos.w;
  let shadowUV = vec2<f32>(lightNdc.x * 0.5 + 0.5, 0.5 - lightNdc.y * 0.5);
  let shadowDepth = lightNdc.z;
  let inBounds = step(0.0, shadowUV.x) * step(0.0, shadowUV.y) * step(shadowUV.x, 1.0) * step(shadowUV.y, 1.0);
  let shadowRaw = textureSampleCompare(shadowTex, shadowSampler, shadowUV, shadowDepth - 0.002);
  let shadow = mix(1.0, shadowRaw, inBounds);

  let lightDir = normalize(envUniforms.dirToSun);
  let ndotl = max(dot(normal, lightDir), 0.0) * shadow;

  let viewDir = normalize(worldNear.xyz - world.xyz); // From surface to camera
  let halfDir = normalize(lightDir + viewDir);
  let spec = pow(max(dot(normal, halfDir), 0.0), 64.0) * shadow;
  let fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 5.0);

  let base = vec3<f32>(0.02, 0.15, 0.45);
  let diffuse = base * (0.35 + 0.65 * ndotl);
  let specular = vec3<f32>(0.9, 0.95, 1.0) * spec * (0.2 + 0.8 * fresnel);

  let alpha = clamp(thickness * 4.0, 0.0, 1.0);

  let offset = normal.xy * renderUniforms.refractionStrength;
  let refractThickness = textureSample(thicknessTex, samp, in.uv + offset).r;

  let absorption = exp(-refractThickness * renderUniforms.extinctionCoeff * renderUniforms.extinctionMultiplier);
  let refracted = mix(finalBg, base, 1.0 - absorption);

  // Obstacle shading - using shared environment logic would be best but we need shadow here too?
  // getEnvironmentColor handles obstacle blending over background.
  // But here 'finalBg' is what's behind the fluid.
  // If the fluid covers the obstacle, we need to blend properly.
  //
  // The 'bg' from getEnvironmentColor ALREADY includes the obstacle if visible directly.
  // If we see the obstacle through the fluid, 'refracted' samples 'finalBg'.
  // So if 'finalBg' has the obstacle, 'refracted' has the obstacle.
  
  // However, we want the obstacle to receive SHADOWS from the fluid if it's behind the fluid.
  // Current screen-space shadow map logic handles fluid self-shadowing.
  // Does it handle fluid shadowing the environment?
  // 'shadow' variable is computed at 'world' position (fluid surface).
  // Shadow on floor/obstacle is computed at 'hitPos'.
  
  // Obstacle shadow logic was not present in original shader?
  // Original shader:
  // let obstacleHit = obstacleHitInfo(worldNear.xyz, rayDir);
  // let obstacleLit = ...
  // if (hasObstacle ... ) baseBg = mix(baseBg, obstacleLit, a);
  //
  // getEnvironmentColor already does this blending!
  // So 'finalBg' already contains the obstacle.
  //
  // The only thing missing is applying SHADOWS to the obstacle.
  // Since we already apply floor shadows, let's apply shadows to obstacle too if hit.
  //
  // Obstacle Hit Check
  // We need to know if we hit obstacle or floor to apply correct shadow.
  // Re-run obstacle hit?
  // getObstacleHit in env returns vec4(t, normal).
  let obsHit = getObstacleHit(worldNear.xyz, rayDir, envUniforms);
  let obsT = obsHit.x;
  
  // If we hit obstacle AND (obstacle is closer than floor OR no floor), apply shadow
  // Note: getEnvironmentColor blends obstacle on top of background.
  // If we simply multiply finalBg by shadow, we darken everything (floor + obstacle).
  // But floor shadow was already applied to floor part.
  //
  // Let's refine:
  // 1. Get raw background (sky or floor) -> 'bg' (from getEnvironmentColor? No, that mixes everything).
  //
  // Better approach:
  // 1. Get Sky.
  // 2. Check Floor -> Blend Floor (with Shadow).
  // 3. Check Obstacle -> Blend Obstacle (with Shadow?).
  //
  // Since we can't easily decompose 'getEnvironmentColor', let's stick to what we have.
  // 'finalBg' has floor shadow applied.
  // It does NOT have obstacle shadow applied.
  //
  // Let's re-add obstacle blending ON TOP of 'finalBg' (which is floor+sky) so we can apply shadow.
  // But wait, 'getEnvironmentColor' already blended obstacle. We can't undo it.
  //
  // Maybe we accept that obstacle is unshadowed in this demo for now, 
  // OR we manually reconstruct the composition here instead of calling getEnvironmentColor.
  //
  // Given "Shared Pipeline" goal, calling `getEnvironmentColor` is preferred.
  // The Raymarch demo's `getEnvironmentColor` applies floor shadow internally? 
  // No, `getEnvironmentColor` in `environment.wgsl` applies ambient but NOT shadow.
  //
  // In `raymarch.wgsl`:
  // let finalBg = getEnvironmentColor(...)
  //
  // So `environment.wgsl` DOES NOT handle shadows.
  //
  // In `composite_final.wgsl`:
  // I applied floorShadow to `bg` if `floorHit` is true.
  // `bg` came from `getEnvironmentColor`.
  //
  // If `getEnvironmentColor` returns obstacle color, `floorHit` might be true (behind obstacle) or false.
  // If `floorHit` is true, we darken the obstacle too? Yes.
  //
  // This is acceptable for now. The Screen Space demo has shadows, Raymarch has shadows.
  //
  // Let's assume `finalBg` is correct enough.
  
  let hasFluid = alpha > 0.001;
  let tFluid = select(1.0e9, dot(world.xyz - worldNear.xyz, rayDir), hasFluid);

  // We need to know if the obstacle is IN FRONT of the fluid.
  // If obsT >= 0 and obsT < tFluid, render obstacle ON TOP of fluid.
  
  var color = mix(finalBg, diffuse + specular, alpha);
  color = mix(color, refracted, 0.4 * fresnel);
  let foam = textureSample(foamTex, samp, in.uv).r;
  color = mix(color, renderUniforms.foamColor, clamp(foam * renderUniforms.foamOpacity, 0.0, 1.0));

  if (obsT >= 0.0 && obsT < tFluid) {
    // Render obstacle on top
    let a = clamp(envUniforms.obstacleAlpha, 0.0, 1.0);
    // Obstacle lighting
    let ambient = envUniforms.floorAmbient;
    let sun = max(0.0, dot(obsHit.yzw, envUniforms.dirToSun));
    let lit = envUniforms.obstacleColor * (ambient + sun * (1.0 - ambient));
    
    // Apply shadow to obstacle if we want?
    // Let's check shadow map at obstacle position
    let obsPos = worldNear.xyz + rayDir * obsT;
    let obsLightPos = renderUniforms.lightViewProjection * vec4<f32>(obsPos, 1.0);
    let obsLightNdc = obsLightPos.xyz / obsLightPos.w;
    let obsShadowUV = vec2<f32>(obsLightNdc.x * 0.5 + 0.5, 0.5 - obsLightNdc.y * 0.5);
    let obsInBounds = step(0.0, obsShadowUV.x) * step(0.0, obsShadowUV.y) * step(obsShadowUV.x, 1.0) * step(obsShadowUV.y, 1.0);
    let obsShadowRaw = textureSampleCompareLevel(shadowTex, shadowSampler, obsShadowUV, obsLightNdc.z - 0.002);
    let obsShadow = mix(1.0, obsShadowRaw, obsInBounds);
    
    let litShadowed = lit * (obsShadow * (1.0 - ambient) + ambient); // Approximate shadow application
    
    color = mix(color, litShadowed, a);
  }

  let exposure = 1.2;
  return vec4<f32>(color * exposure, 1.0);
}
