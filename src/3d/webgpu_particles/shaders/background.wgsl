// =============================================================================
// Background Shader
// =============================================================================
// Renders the shared environment (Sky + Floor) using a fullscreen triangle.

#include "../../common/shaders/environment.wgsl"

// The shared environment.wgsl expects a 'uniforms' variable of type EnvironmentUniforms
// We bind it at group 0, binding 0
@group(0) @binding(0) var<uniform> uniforms: EnvironmentUniforms;

@group(0) @binding(2) var densityTex: texture_3d<f32>;
@group(0) @binding(3) var densitySampler: sampler;

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

struct DensityShadowUniforms {
  boundsSize: vec3<f32>,
  densityOffset: f32,
  densityMultiplier: f32,
  lightStepSize: f32,
  shadowSoftness: f32,
  pad0: f32,
  extinctionCoefficients: vec3<f32>,
  pad1: f32,
};

@group(0) @binding(4) var<uniform> densityShadow: DensityShadowUniforms;

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
  // Compute ray direction for this pixel
  // UV is [0,1], convert to NDC [-1,1]
  let ndc = in.uv * 2.0 - vec2<f32>(1.0);
  
  // Aspect ratio correction is baked into the camera basis vectors in some setups,
  // but here we construct the ray manually from the basis vectors.
  let tanFov = tan(0.5 * camera.fovY);
  
  // Ray direction: forward + right*x + up*y
  let dir = normalize(
    camera.cameraForward + 
    camera.cameraRight * (ndc.x * camera.aspect * tanFov) + 
    camera.cameraUp * (ndc.y * tanFov)
  );

  // Sample the shared environment (with shadow on floor)
  let color = getEnvironmentColorShadowed(camera.cameraPos, dir, uniforms);
  
  // Apply exposure (linear -> sRGB will happen in canvas presentation if configured, 
  // but usually we want to keep it linear here if we are doing post-processing.
  // For this simple demo, we output directly to swapchain which is sRGB-ish).
  
  let exposedColor = color * uniforms.sceneExposure;
  
  return vec4<f32>(exposedColor, 1.0);
}

fn sampleDensityRaw(pos: vec3<f32>) -> f32 {
  let uvw = (pos + 0.5 * densityShadow.boundsSize) / densityShadow.boundsSize;
  let epsilon = 0.0001;
  if (any(uvw >= vec3<f32>(1.0 - epsilon)) || any(uvw <= vec3<f32>(epsilon))) {
    return -densityShadow.densityOffset;
  }
  return textureSampleLevel(densityTex, densitySampler, uvw, 0.0).r - densityShadow.densityOffset;
}

fn sampleDensity(pos: vec3<f32>) -> f32 {
  let uvw = (pos + 0.5 * densityShadow.boundsSize) / densityShadow.boundsSize;
  let epsilon = 0.0001;
  if (any(uvw >= vec3<f32>(1.0 - epsilon)) || any(uvw <= vec3<f32>(epsilon))) {
    return -densityShadow.densityOffset;
  }
  return textureSampleLevel(densityTex, densitySampler, uvw, 0.0).r - densityShadow.densityOffset;
}

fn calculateDensityForShadow(rayPos: vec3<f32>, rayDir: vec3<f32>, maxDst: f32) -> f32 {
  let boundsMin = -0.5 * densityShadow.boundsSize;
  let boundsMax = 0.5 * densityShadow.boundsSize;
  let hit = envRayBoxIntersection(rayPos, rayDir, boundsMin, boundsMax);
  if (hit.y <= max(hit.x, 0.0)) { return 0.0; }

  let tStart = max(hit.x, 0.0);
  let tEnd = min(hit.y, maxDst);
  if (tStart >= tEnd) { return 0.0; }

  var opticalDepth = 0.0;
  let shadowStep = densityShadow.lightStepSize * (2.0 + densityShadow.shadowSoftness);
  var t = tStart;

  for (var i = 0; i < 32; i++) {
    if (t >= tEnd) { break; }
    let pos = rayPos + rayDir * t;
    let d = max(0.0, sampleDensityRaw(pos));
    opticalDepth = opticalDepth + d * densityShadow.densityMultiplier * shadowStep;
    if (opticalDepth > 3.0) { break; }
    t = t + shadowStep;
  }
  return opticalDepth;
}

fn transmittance(opticalDepth: f32) -> vec3<f32> {
  return exp(-opticalDepth * densityShadow.extinctionCoefficients);
}

fn getEnvironmentColorShadowed(origin: vec3<f32>, dir: vec3<f32>, params: EnvironmentUniforms) -> vec3<f32> {
  // 1. Check Floor
  let floorMin = params.floorCenter - 0.5 * params.floorSize;
  let floorMax = params.floorCenter + 0.5 * params.floorSize;
  let floorHit = envRayBoxIntersection(origin, dir, floorMin, floorMax);
  let hasFloorHit = floorHit.y >= max(floorHit.x, 0.0);
  let floorT = select(floorHit.x, 0.0, floorHit.x < 0.0);

  var bgCol: vec3<f32>;
  var hitPos: vec3<f32>;

  if (hasFloorHit) {
    hitPos = origin + dir * floorT;

    // Debug Modes (Shadow/Density first)
    if (params.debugFloorMode >= 3.5) {
      let dens = max(0.0, sampleDensityRaw(hitPos));
      let densVis = dens / (1.0 + dens);
      let shadowDepth = calculateDensityForShadow(hitPos, params.dirToSun, 100.0);
      let depthVis = min(1.0, shadowDepth * 0.05);
      return vec3<f32>(max(densVis, depthVis));
    }

    if (params.debugFloorMode >= 2.5) {
      let shadowDepth = calculateDensityForShadow(hitPos, params.dirToSun, 100.0);
      let shadowMap = transmittance(shadowDepth * 2.0);
      return shadowMap;
    }

    if (params.debugFloorMode >= 1.5) {
      var debugTileCol = params.tileCol1;
      if (hitPos.x >= 0.0) { debugTileCol = params.tileCol2; }
      if (hitPos.z < 0.0) {
        if (hitPos.x < 0.0) { debugTileCol = params.tileCol3; }
        else { debugTileCol = params.tileCol4; }
      }
      bgCol = envSrgbToLinear(debugTileCol);
    } else if (params.debugFloorMode >= 0.5) {
      bgCol = vec3<f32>(1.0, 0.0, 0.0);
    } else {
      var tileCol = params.tileCol1;
      if (hitPos.x >= 0.0) { tileCol = params.tileCol2; }
      if (hitPos.z < 0.0) {
        if (hitPos.x < 0.0) { tileCol = params.tileCol3; }
        else { tileCol = params.tileCol4; }
      }

      let tileCoord = floor(hitPos.xz * params.tileScale);
      let isDarkTile = envModulo(tileCoord.x, 2.0) == envModulo(tileCoord.y, 2.0);

      if (isDarkTile) {
        tileCol = tileCol * params.tileDarkFactor;
      }

      if (any(params.tileColVariation != vec3<f32>(0.0))) {
        var rngState = envHashInt2(vec2<i32>(i32(tileCoord.x), i32(tileCoord.y)));
        let randomVariation = envRandomSNorm3(&rngState) * params.tileColVariation * 0.1;
        tileCol = envTweakHsv(tileCol, randomVariation);
      }

      let shadowDepth = calculateDensityForShadow(hitPos, params.dirToSun, 100.0);
      let shadowMap = transmittance(shadowDepth * 2.0);
      let ambient = clamp(params.floorAmbient, 0.0, 1.0);
      let lighting = shadowMap * (1.0 - ambient) + ambient;
      bgCol = tileCol * lighting;
    }
  } else {
    bgCol = getSkyColor(dir, params);
  }

  // 2. Check Obstacle (blend over background)
  let obs = getObstacleHit(origin, dir, params);
  let obsT = obs.x;
  let obsNormal = obs.yzw;

  if (obsT >= 0.0 && (!hasFloorHit || obsT < floorT)) {
    let a = clamp(params.obstacleAlpha, 0.0, 1.0);
    let ambient = params.floorAmbient;
    let sun = max(0.0, dot(obsNormal, params.dirToSun)) * params.sunBrightness;
    let lit = params.obstacleColor * (ambient + sun);
    return mix(bgCol, lit, a);
  }

  return bgCol;
}
