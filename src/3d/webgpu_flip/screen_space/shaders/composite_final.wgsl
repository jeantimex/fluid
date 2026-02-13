/**
 * Composite Shader (final screen-space shading)
 *
 * Beginner note: combines depth/thickness/normals/foam into final color.
 */

struct FullscreenOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

#include "../../../common/shaders/environment.wgsl"
#include "../../../common/shaders/shadow_common.wgsl"

struct RenderUniforms {
  inverseViewProjection: mat4x4<f32>,
  waterColor: vec3<f32>,
  pad0: f32,
  deepWaterColor: vec3<f32>,
  pad1: f32,
  foamColor: vec3<f32>,
  foamOpacity: f32,
  extinctionCoeff: vec3<f32>,
  extinctionMultiplier: f32,
  refractionStrength: f32,
  showFluidShadows: f32,
  pad2: f32,
  shadowParams: ShadowUniforms,
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
@group(0) @binding(3) var foamTex: texture_2d<f32>;
@group(0) @binding(4) var samp: sampler;
@group(0) @binding(5) var<uniform> renderUniforms: RenderUniforms;
@group(0) @binding(6) var<uniform> envUniforms: EnvironmentUniforms;
@group(0) @binding(7) var shadowTex: texture_2d<f32>;

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

  // Floor hit from environment to support debug visualization.
  let floorMin = envUniforms.floorCenter - 0.5 * envUniforms.floorSize;
  let floorMax = envUniforms.floorCenter + 0.5 * envUniforms.floorSize;
  let boxHit = envRayBoxIntersection(worldNear.xyz, rayDir, floorMin, floorMax);
  let floorHit = boxHit.y >= max(boxHit.x, 0.0);

  // Apply fluid shadow to floor
  let floorT = max(boxHit.x, 0.0);
  let floorHitPos = worldNear.xyz + rayDir * floorT;
  let shadowClip = renderUniforms.shadowParams.lightViewProjection * vec4<f32>(floorHitPos, 1.0);
  let shadowNdc = shadowClip.xy / shadowClip.w;
  let shadowUV = vec2<f32>(shadowNdc.x * 0.5 + 0.5, 1.0 - (shadowNdc.y * 0.5 + 0.5));
  let shadowVal = textureSample(shadowTex, samp, shadowUV).r;

  let lightDir = normalize(envUniforms.dirToSun);

  if (floorHit) {
    var shadowFactor = 1.0;

    // Fluid shadow from shadow texture
    let inBounds = shadowUV.x >= 0.0 && shadowUV.x <= 1.0 && shadowUV.y >= 0.0 && shadowUV.y <= 1.0;
    if (renderUniforms.showFluidShadows > 0.5 && inBounds && shadowVal > 0.0) {
      // Apply subtle shadow like raymarch demo
      // Very light shadows with high ambient floor
      let shadowAtten = exp(-shadowVal * 0.3);
      let ambientMin = 0.7; // High ambient = very subtle shadows
      shadowFactor = shadowAtten * (1.0 - ambientMin) + ambientMin;
    }

    // Obstacle shadow - cast ray from floor toward sun
    let obstacleShadowHit = getObstacleHit(floorHitPos, lightDir, envUniforms);
    if (obstacleShadowHit.x >= 0.0) {
      // Obstacle blocks light - apply shadow
      let obstacleAmbient = 0.5; // Obstacle shadow is a bit darker than fluid shadow
      shadowFactor = min(shadowFactor, obstacleAmbient);
    }

    bg = bg * shadowFactor;
  }

  let finalBg = bg;

  let base = renderUniforms.deepWaterColor;
  let shallow = renderUniforms.waterColor;

  let ndotl = max(dot(normal, lightDir), 0.0) * envUniforms.sunBrightness;

  let viewDir = normalize(worldNear.xyz - world.xyz); // From surface to camera
  let halfDir = normalize(lightDir + viewDir);
  let spec = pow(max(dot(normal, halfDir), 0.0), 64.0) * envUniforms.sunBrightness;
  let fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 5.0);

  let alpha = clamp(thickness * 4.0, 0.0, 1.0);

  let offset = normal.xy * renderUniforms.refractionStrength;
  let refractThickness = textureSample(thicknessTex, samp, in.uv + offset).r;

  // Beer-Lambert Law for absorption
  let absorption = exp(-refractThickness * renderUniforms.extinctionCoeff * renderUniforms.extinctionMultiplier);
  
  // Blend between shallow and deep color based on absorption
  let fluidColor = mix(base, shallow, absorption);
  
  let diffuse = fluidColor * (0.35 * envUniforms.floorAmbient + 0.65 * ndotl);
  let specular = vec3<f32>(0.9, 0.95, 1.0) * spec * (0.2 + 0.8 * fresnel);

  let refracted = mix(finalBg, fluidColor, 1.0 - absorption);

  // Obstacle shading
  let obsHit = getObstacleHit(worldNear.xyz, rayDir, envUniforms);
  let obsT = obsHit.x;
  
  let hasFluid = alpha > 0.001;
  let tFluid = select(1.0e9, dot(world.xyz - worldNear.xyz, rayDir), hasFluid);

  var color = mix(finalBg, diffuse + specular, alpha);
  color = mix(color, refracted, 0.4 * fresnel);
  let foam = textureSample(foamTex, samp, in.uv).r;
  let foamMask = clamp(foam * renderUniforms.foamOpacity, 0.0, 1.0);
  let foamDiffuse = renderUniforms.foamColor * (0.35 + 0.65 * ndotl);
  let foamSpec = vec3<f32>(1.0, 1.0, 1.0) * (0.12 + 0.88 * fresnel) * spec;
  let foamLit = foamDiffuse + foamSpec;
  color = mix(color, foamLit, foamMask);

  if (obsT >= 0.0 && obsT < tFluid) {
    // Render obstacle on top
    let a = clamp(envUniforms.obstacleAlpha, 0.0, 1.0);
    // Obstacle lighting
    let ambient = envUniforms.floorAmbient;
    let sun = max(0.0, dot(obsHit.yzw, envUniforms.dirToSun)) * envUniforms.sunBrightness;

    let litShadowed = envUniforms.obstacleColor * (ambient + sun);

    color = mix(color, litShadowed, a);
  }

  let exposure = envUniforms.sceneExposure;
  return vec4<f32>(color * exposure, 1.0);
}
