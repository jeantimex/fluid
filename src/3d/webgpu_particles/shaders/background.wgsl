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
  minBounds: vec3<f32>,
  pad0: f32,
  maxBounds: vec3<f32>,
  pad1: f32,
  densityOffset: f32,
  densityMultiplier: f32,
  lightStepSize: f32,
  shadowSoftness: f32,
  extinctionCoefficients: vec3<f32>,
  pad2: f32,
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
  
  // Remove exposure multiplication to match basic demo exactly
  return vec4<f32>(color, 1.0);
}

fn sampleDensityRaw(pos: vec3<f32>) -> f32 {
  let size = densityShadow.maxBounds - densityShadow.minBounds;
  let uvw = (pos - densityShadow.minBounds) / size;
  let epsilon = 0.0001;
  if (any(uvw >= vec3<f32>(1.0 - epsilon)) || any(uvw <= vec3<f32>(epsilon))) {
    return -densityShadow.densityOffset;
  }
  return textureSampleLevel(densityTex, densitySampler, uvw, 0.0).r - densityShadow.densityOffset;
}

fn sampleDensity(pos: vec3<f32>) -> f32 {
  let size = densityShadow.maxBounds - densityShadow.minBounds;
  let uvw = (pos - densityShadow.minBounds) / size;
  let epsilon = 0.0001;
  if (any(uvw >= vec3<f32>(1.0 - epsilon)) || any(uvw <= vec3<f32>(epsilon))) {
    return -densityShadow.densityOffset;
  }
  return textureSampleLevel(densityTex, densitySampler, uvw, 0.0).r - densityShadow.densityOffset;
}

fn calculateDensityForShadow(rayPos: vec3<f32>, rayDir: vec3<f32>, maxDst: f32) -> f32 {
  let hit = envRayBoxIntersection(rayPos, rayDir, densityShadow.minBounds, densityShadow.maxBounds);
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

    let tileCol = getTileColor(hitPos, params);

    let shadowDepth = calculateDensityForShadow(hitPos, params.dirToSun, 100.0);
    let shadowMap = transmittance(shadowDepth * 2.0);
    
    // Modulate by shadow map only, no additional ambient/sun factor for floor
    var finalColor = tileCol * shadowMap * params.globalBrightness;

    let gray = dot(finalColor, vec3<f32>(0.299, 0.587, 0.114));
    finalColor = vec3<f32>(gray) + (finalColor - vec3<f32>(gray)) * params.globalSaturation;

    bgCol = finalColor;
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
