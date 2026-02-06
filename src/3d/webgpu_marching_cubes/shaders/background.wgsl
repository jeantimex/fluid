// =============================================================================
// Background Shader
// =============================================================================
// Renders the shared environment (Sky + Floor) using a fullscreen triangle.

#include "../../common/shaders/environment.wgsl"

struct ShadowUniforms {
  lightViewProjection: mat4x4<f32>,
  shadowSoftness: f32,
  pad0: vec3<f32>,
};

@group(0) @binding(0) var<uniform> uniforms: EnvironmentUniforms;
@group(0) @binding(2) var shadowTex: texture_depth_2d;
@group(0) @binding(3) var shadowSampler: sampler_comparison;
@group(0) @binding(4) var<uniform> shadowUniforms: ShadowUniforms;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

// Fullscreen triangle vertex shader
@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  var positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(3.0, -1.0),
    vec2<f32>(-1.0, 3.0)
  );

  let pos = positions[vertexIndex];
  var out: VertexOutput;
  out.position = vec4<f32>(pos, 0.0, 1.0);
  out.uv = pos * 0.5 + vec2<f32>(0.5);
  return out;
}

struct FragmentUniforms {
  cameraPos: vec3<f32>,
  pad0: f32,
  cameraForward: vec3<f32>,
  pad1: f32,
  cameraRight: vec3<f32>,
  pad2: f32,
  cameraUp: vec3<f32>,
  pad3: f32,
  fovY: f32,
  aspect: f32,
  pad4: vec2<f32>,
};

@group(0) @binding(1) var<uniform> camera: FragmentUniforms;

fn sampleShadow(worldPos: vec3<f32>) -> f32 {
  let lightPos = shadowUniforms.lightViewProjection * vec4<f32>(worldPos, 1.0);
  let ndc = lightPos.xyz / lightPos.w;
  let uv = vec2<f32>(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);

  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 || ndc.z < 0.0 || ndc.z > 1.0) {
    return 1.0;
  }

  // Fixed bias for floor
  let depth = ndc.z - 0.0005;
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

fn getShadowedEnv(origin: vec3<f32>, dir: vec3<f32>) -> vec3<f32> {
  let floorMin = uniforms.floorCenter - 0.5 * uniforms.floorSize;
  let floorMax = uniforms.floorCenter + 0.5 * uniforms.floorSize;
  let floorHit = envRayBoxIntersection(origin, dir, floorMin, floorMax);
  
  // y > max(x, 0) means intersection occurred and exit > entry
  let hasFloorHit = floorHit.y >= max(floorHit.x, 0.0);
  let floorT = select(floorHit.x, 0.0, floorHit.x < 0.0);

  var bgCol: vec3<f32>;
  var hitPos: vec3<f32>;

  if (hasFloorHit) {
    hitPos = origin + dir * floorT;
    
    if (uniforms.debugFloorMode >= 0.5) {
        // Debug modes
        if (uniforms.debugFloorMode >= 1.5) {
             var debugTileCol = uniforms.tileCol1;
             if (hitPos.x >= 0.0) { debugTileCol = uniforms.tileCol2; }
             if (hitPos.z < 0.0) {
               if (hitPos.x < 0.0) { debugTileCol = uniforms.tileCol3; }
               else { debugTileCol = uniforms.tileCol4; }
             }
             bgCol = envLinearToSrgb(debugTileCol);
        } else {
             bgCol = vec3<f32>(1.0, 0.0, 0.0);
        }
    } else {
        let tileCol = getTileColor(hitPos, uniforms);

        // Apply Shadow
        let shadow = sampleShadow(hitPos);
        
        let ambient = clamp(uniforms.floorAmbient, 0.0, 1.0);
        let sun = max(0.0, uniforms.dirToSun.y) * uniforms.sunBrightness;
        
        // Lighting = Ambient + Sun * Shadow
        let lighting = ambient + sun * shadow;
        var finalColor = tileCol * lighting * uniforms.globalBrightness;

        let gray = dot(finalColor, vec3<f32>(0.299, 0.587, 0.114));
        finalColor = vec3<f32>(gray) + (finalColor - vec3<f32>(gray)) * uniforms.globalSaturation;

        bgCol = finalColor;
    }
  } else {
    bgCol = getSkyColor(dir, uniforms);
  }

  // 2. Check Obstacle (blend over background)
  let obs = getObstacleHit(origin, dir, uniforms);
  let obsT = obs.x;
  let obsNormal = obs.yzw;

  if (obsT >= 0.0 && (!hasFloorHit || obsT < floorT)) {
    let a = clamp(uniforms.obstacleAlpha, 0.0, 1.0);
    let ambient = uniforms.floorAmbient;
    let sun = max(0.0, dot(obsNormal, uniforms.dirToSun)) * uniforms.sunBrightness;
    let shadow = sampleShadow(origin + dir * obsT);
    let lit = uniforms.obstacleColor * (ambient + sun * shadow);
    return mix(bgCol, lit, a);
  }

  return bgCol;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
  // Compute ray direction for this pixel
  let ndc = in.uv * 2.0 - vec2<f32>(1.0);
  let tanFov = tan(0.5 * camera.fovY);
  
  let dir = normalize(
    camera.cameraForward + 
    camera.cameraRight * (ndc.x * camera.aspect * tanFov) + 
    camera.cameraUp * (ndc.y * tanFov)
  );

  let color = getShadowedEnv(camera.cameraPos, dir);
  let exposedColor = color * uniforms.sceneExposure;
  
  return vec4<f32>(exposedColor, 1.0);
}
