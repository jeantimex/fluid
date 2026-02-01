// =============================================================================
// Raymarch Fragment Shader — Volume Rendered Fluid with Refraction
// =============================================================================

#include "../../common/shaders/environment.wgsl"

// =============================================================================
// Uniform Parameters
// =============================================================================

/// Render-specific parameters (Camera, Volume, Optics)
struct RaymarchParams {
  viewPos: vec3<f32>,
  pad0: f32,
  cameraRight: vec3<f32>,
  pad1: f32,
  cameraUp: vec3<f32>,
  pad2: f32,
  cameraForward: vec3<f32>,
  pad3: f32,
  boundsSize: vec3<f32>,
  densityOffset: f32,
  densityMultiplier: f32,
  stepSize: f32,
  lightStepSize: f32,
  aspect: f32,
  fovY: f32,
  maxSteps: f32,
  indexOfRefraction: f32,
  numRefractions: f32,
  extinctionCoefficients: vec3<f32>,
  pad4: f32,
};

// =============================================================================
// Bindings
// =============================================================================

@group(0) @binding(0) var densityTex: texture_3d<f32>;
@group(0) @binding(1) var densitySampler: sampler;
@group(0) @binding(2) var<uniform> params: RaymarchParams;
@group(0) @binding(3) var<uniform> env: EnvironmentUniforms;

// =============================================================================
// Vertex Stage
// =============================================================================

struct VSOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VSOut {
  var positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(3.0, -1.0),
    vec2<f32>(-1.0, 3.0)
  );

  let pos = positions[vertexIndex];
  var out: VSOut;
  out.position = vec4<f32>(pos, 0.0, 1.0);
  out.uv = pos * 0.5 + vec2<f32>(0.5);
  return out;
}

// =============================================================================
// Density Sampling
// =============================================================================

fn sampleDensityRaw(pos: vec3<f32>) -> f32 {
  let uvw = (pos + 0.5 * params.boundsSize) / params.boundsSize;
  return textureSampleLevel(densityTex, densitySampler, uvw, 0.0).r - params.densityOffset;
}

fn sampleDensity(pos: vec3<f32>) -> f32 {
  let uvw = (pos + 0.5 * params.boundsSize) / params.boundsSize;
  let epsilon = 0.0001;
  if (any(uvw >= vec3<f32>(1.0 - epsilon)) || any(uvw <= vec3<f32>(epsilon))) {
    return -params.densityOffset;
  }
  return textureSampleLevel(densityTex, densitySampler, uvw, 0.0).r - params.densityOffset;
}

fn isInsideFluid(pos: vec3<f32>) -> bool {
  let boundsMin = -0.5 * params.boundsSize;
  let boundsMax = 0.5 * params.boundsSize;
  let hit = envRayBoxIntersection(pos, vec3<f32>(0.0, 0.0, 1.0), boundsMin, boundsMax);
  return (hit.x <= 0.0 && hit.y > 0.0) && sampleDensity(pos) > 0.0;
}

// =============================================================================
// Normal Estimation
// =============================================================================

fn calculateClosestFaceNormal(boxSize: vec3<f32>, p: vec3<f32>) -> vec3<f32> {
  let halfSize = boxSize * 0.5;
  let o = halfSize - abs(p); 
  if (o.x < o.y && o.x < o.z) {
    return vec3<f32>(sign(p.x), 0.0, 0.0);
  } else if (o.y < o.z) {
    return vec3<f32>(0.0, sign(p.y), 0.0);
  } else {
    return vec3<f32>(0.0, 0.0, sign(p.z));
  }
}

fn calculateNormal(pos: vec3<f32>) -> vec3<f32> {
  let s = 0.1;
  let offsetX = vec3<f32>(s, 0.0, 0.0);
  let offsetY = vec3<f32>(0.0, s, 0.0);
  let offsetZ = vec3<f32>(0.0, 0.0, s);

  let dx = sampleDensity(pos - offsetX) - sampleDensity(pos + offsetX);
  let dy = sampleDensity(pos - offsetY) - sampleDensity(pos + offsetY);
  let dz = sampleDensity(pos - offsetZ) - sampleDensity(pos + offsetZ);

  let volumeNormal = normalize(vec3<f32>(dx, dy, dz));

  let o = params.boundsSize * 0.5 - abs(pos); 
  var faceWeight = min(o.x, min(o.y, o.z));    
  let faceNormal = calculateClosestFaceNormal(params.boundsSize, pos);

  let smoothDst = 0.3;  
  let smoothPow = 5.0;  

  let smoothFactor = smoothstep(0.0, smoothDst, faceWeight);
  let volFactor = pow(clamp(volumeNormal.y, 0.0, 1.0), smoothPow);

  faceWeight = (1.0 - smoothFactor) * (1.0 - volFactor);

  return normalize(mix(volumeNormal, faceNormal, faceWeight));
}

// =============================================================================
// Surface Finding
// =============================================================================

struct SurfaceInfo {
  pos: vec3<f32>,
  densityAlongRay: f32,
  foundSurface: bool,
};

fn findNextSurface(origin: vec3<f32>, rayDir: vec3<f32>, findNextFluidEntryPoint: bool, rngState: ptr<function, u32>, maxDst: f32) -> SurfaceInfo {
  var info: SurfaceInfo;
  info.densityAlongRay = 0.0;
  info.foundSurface = false;

  if (dot(rayDir, rayDir) < 0.5) { return info; }

  let boundsMin = -0.5 * params.boundsSize;
  let boundsMax = 0.5 * params.boundsSize;
  let boundsDstInfo = envRayBoxIntersection(origin, rayDir, boundsMin, boundsMax);

  let r = (envRandomValue(rngState) - 0.5) * params.stepSize * 0.4;

  var currentOrigin = origin;
  if (boundsDstInfo.x > 0.0) {
    currentOrigin = origin + rayDir * (boundsDstInfo.x + r);
  } else {
    currentOrigin = origin + rayDir * r;
  }

  var hasExittedFluid = !isInsideFluid(origin);

  let stepSize = params.stepSize;
  var hasEnteredFluid = false;
  var lastPosInFluid = currentOrigin;

  let dstToTest = boundsDstInfo.y - 0.01;
  const COARSE_MULTIPLIER = 4.0;
  const FINE_RETURN_THRESHOLD = 3u;  

  var useCoarseStep = true;
  var prevDst = 0.0;
  var consecutiveEmpty = 0u;

  var dst = 0.0;
  for (var i = 0u; i < 512u; i = i + 1u) {
    if (dst >= dstToTest) { break; }

    let currentStep = select(stepSize, stepSize * COARSE_MULTIPLIER, useCoarseStep);
    let isLastStep = (dst + currentStep) >= dstToTest;
    let samplePos = currentOrigin + rayDir * dst;
    let thickness = sampleDensity(samplePos) * params.densityMultiplier * currentStep;
    let insideFluid = thickness > 0.0;

    if (useCoarseStep && insideFluid) {
      dst = prevDst;
      useCoarseStep = false;
      consecutiveEmpty = 0u;
      continue;
    }

    if (insideFluid) {
      hasEnteredFluid = true;
      lastPosInFluid = samplePos;
      consecutiveEmpty = 0u;
      if (dst <= maxDst) {
         info.densityAlongRay = info.densityAlongRay + thickness;
      }
    }

    if (!insideFluid) {
      hasExittedFluid = true;
      consecutiveEmpty++;
      if (!useCoarseStep && consecutiveEmpty >= FINE_RETURN_THRESHOLD && !hasEnteredFluid) {
        useCoarseStep = true;
      }
    }

    var found = false;
    if (findNextFluidEntryPoint) {
      found = insideFluid && hasExittedFluid;
    } else {
      found = hasEnteredFluid && (!insideFluid || isLastStep);
    }

    if (found) {
      info.pos = lastPosInFluid;
      info.foundSurface = true;
      break;
    }

    prevDst = dst;
    dst = dst + currentStep;
  }

  return info;
}

// =============================================================================
// Lighting & Shadows
// =============================================================================

fn calculateDensityForShadow(rayPos: vec3<f32>, rayDir: vec3<f32>, maxDst: f32) -> f32 {
    let boundsMin = -0.5 * params.boundsSize;
    let boundsMax = 0.5 * params.boundsSize;
    let hit = envRayBoxIntersection(rayPos, rayDir, boundsMin, boundsMax);
    if (hit.y <= max(hit.x, 0.0)) { return 0.0; }

    let tStart = max(hit.x, 0.0);
    let tEnd = min(hit.y, maxDst);
    if (tStart >= tEnd) { return 0.0; }

    var opticalDepth = 0.0;
    let shadowStep = params.lightStepSize * 2.0; 
    var t = tStart;

    for (var i = 0; i < 32; i++) {
        if (t >= tEnd) { break; }
        let pos = rayPos + rayDir * t;
        let d = max(0.0, sampleDensityRaw(pos));
        opticalDepth = opticalDepth + d * params.densityMultiplier * shadowStep;
        if (opticalDepth > 3.0) { break; } 
        t = t + shadowStep;
    }
    return opticalDepth;
}

fn transmittance(opticalDepth: f32) -> vec3<f32> {
  return exp(-opticalDepth * params.extinctionCoefficients);
}

// =============================================================================
// Fresnel Reflection & Refraction (Snell's Law)
// =============================================================================

struct LightResponse {
    reflectDir: vec3<f32>,
    refractDir: vec3<f32>,
    reflectWeight: f32,
    refractWeight: f32,
};

fn calculateReflectance(inDir: vec3<f32>, normal: vec3<f32>, iorA: f32, iorB: f32) -> f32 {
    let refractRatio = iorA / iorB;
    let cosAngleIn = -dot(inDir, normal);
    let sinSqrAngleOfRefraction = refractRatio * refractRatio * (1.0 - cosAngleIn * cosAngleIn);

    if (sinSqrAngleOfRefraction >= 1.0) { return 1.0; }

    let cosAngleOfRefraction = sqrt(1.0 - sinSqrAngleOfRefraction);
    var rPerp = (iorA * cosAngleIn - iorB * cosAngleOfRefraction) / (iorA * cosAngleIn + iorB * cosAngleOfRefraction);
    rPerp = rPerp * rPerp;
    var rPara = (iorB * cosAngleIn - iorA * cosAngleOfRefraction) / (iorB * cosAngleIn + iorA * cosAngleOfRefraction);
    rPara = rPara * rPara;
    return (rPerp + rPara) * 0.5;
}

fn refract(inDir: vec3<f32>, normal: vec3<f32>, iorA: f32, iorB: f32) -> vec3<f32> {
    let refractRatio = iorA / iorB;
    let cosAngleIn = -dot(inDir, normal);
    let sinSqrAngleOfRefraction = refractRatio * refractRatio * (1.0 - cosAngleIn * cosAngleIn);

    if (sinSqrAngleOfRefraction > 1.0) { return vec3<f32>(0.0); }

    return refractRatio * inDir + (refractRatio * cosAngleIn - sqrt(1.0 - sinSqrAngleOfRefraction)) * normal;
}

fn calculateReflectionAndRefraction(inDir: vec3<f32>, normal: vec3<f32>, iorA: f32, iorB: f32) -> LightResponse {
    var res: LightResponse;
    res.reflectWeight = calculateReflectance(inDir, normal, iorA, iorB);
    res.refractWeight = 1.0 - res.reflectWeight;
    res.reflectDir = reflect(inDir, normal);
    res.refractDir = refract(inDir, normal, iorA, iorB);
    return res;
}

fn calculateDensityForRefraction(rayPos: vec3<f32>, rayDir: vec3<f32>, stepSize: f32) -> f32 {
  let boundsMin = -0.5 * params.boundsSize;
  let boundsMax = 0.5 * params.boundsSize;
  let hit = envRayBoxIntersection(rayPos, rayDir, boundsMin, boundsMax);
  if (hit.y <= max(hit.x, 0.0)) { return 0.0; }

  let tStart = max(hit.x, 0.0);
  let tEnd = min(hit.y, 2.0); 
  var density = 0.0;
  let shortStep = (tEnd - tStart) / 2.0;

  for (var i = 0; i < 2; i++) {
    let t = tStart + (f32(i) + 0.5) * shortStep;
    density += max(0.0, sampleDensityRaw(rayPos + rayDir * t));
  }
  return density * params.densityMultiplier * shortStep;
}

// =============================================================================
// Main Fragment Shader
// =============================================================================

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  let ndc = in.uv * 2.0 - vec2<f32>(1.0);
  let tanFov = tan(0.5 * params.fovY);
  var rayDir = normalize(params.cameraForward + params.cameraRight * (ndc.x * params.aspect * tanFov) + params.cameraUp * (ndc.y * tanFov));
  var rayPos = params.viewPos;

  var rngState = envHashInt2(vec2<i32>(i32(in.uv.x * 5000.0), i32(in.uv.y * 5000.0)));
  var travellingThroughFluid = isInsideFluid(rayPos);

  var totalTransmittance = vec3<f32>(1.0); 
  var totalLight = vec3<f32>(0.0);         

  let iorAir = 1.0;
  let iorFluid = params.indexOfRefraction;

  for (var i = 0; i < i32(params.numRefractions); i = i + 1) {
     if (all(totalTransmittance < vec3<f32>(0.01))) {
        break;
     }

     let densityStepSize = params.stepSize * f32(i + 1);
     let searchForNextFluidEntryPoint = !travellingThroughFluid;

     let obstacleHit = getObstacleHit(rayPos, rayDir, env);
     let hasObstacleHit = obstacleHit.x >= 0.0;
     let surfaceInfo = findNextSurface(rayPos, rayDir, searchForNextFluidEntryPoint, &rngState, 1000.0);

     if (!travellingThroughFluid && hasObstacleHit) {
        let obstacleT = obstacleHit.x;
        let surfaceT = select(1.0e9, dot(surfaceInfo.pos - rayPos, rayDir), surfaceInfo.foundSurface);
        
        if (obstacleT < surfaceT) {
          // Obstacle shading using environment logic
          let ambient = env.floorAmbient;
          let obsNormal = obstacleHit.yzw;
          let sun = max(0.0, dot(obsNormal, env.dirToSun)) * env.sunBrightness;
          let lit = env.obstacleColor * (ambient + sun);
          
          let a = clamp(env.obstacleAlpha, 0.0, 1.0);
          totalLight = totalLight + lit * totalTransmittance * a;
          totalTransmittance = totalTransmittance * (1.0 - a);
          
          // Ray marches "through" transparent obstacle - crude approx, just continue
          rayPos = rayPos + rayDir * (obstacleT + 0.1);
          continue;
        }
     }

     if (!surfaceInfo.foundSurface) {
        break; 
     }

     totalTransmittance = totalTransmittance * transmittance(surfaceInfo.densityAlongRay);

     if (surfaceInfo.pos.y < -params.boundsSize.y * 0.5 + 0.05) {
        break;
     }

     var normal = calculateNormal(surfaceInfo.pos);
     if (dot(normal, rayDir) > 0.0) {
        normal = -normal;
     }

     let response = calculateReflectionAndRefraction(rayDir, normal, select(iorAir, iorFluid, travellingThroughFluid), select(iorFluid, iorAir, travellingThroughFluid));

     let densityRefract = calculateDensityForRefraction(surfaceInfo.pos, response.refractDir, densityStepSize);
     let densityReflect = calculateDensityForRefraction(surfaceInfo.pos, response.reflectDir, densityStepSize);

     let traceRefractedRay = (densityRefract * response.refractWeight) > (densityReflect * response.reflectWeight);

     travellingThroughFluid = (traceRefractedRay != travellingThroughFluid);

     if (traceRefractedRay) {
        let reflectLight = getEnvironmentColor(surfaceInfo.pos, response.reflectDir, env);
        let reflectTrans = transmittance(densityReflect);
        totalLight = totalLight + reflectLight * totalTransmittance * reflectTrans * response.reflectWeight;

        rayPos = surfaceInfo.pos;
        rayDir = response.refractDir;
        totalTransmittance = totalTransmittance * response.refractWeight;
     } else {
        let refractLight = getEnvironmentColor(surfaceInfo.pos, response.refractDir, env);
        let refractTrans = transmittance(densityRefract);
        totalLight = totalLight + refractLight * totalTransmittance * refractTrans * response.refractWeight;

        rayPos = surfaceInfo.pos;
        rayDir = response.reflectDir;
        totalTransmittance = totalTransmittance * response.reflectWeight;
     }
  }

  let densityRemainder = calculateDensityForShadow(rayPos, rayDir, 1000.0);
  
  // Use shared environment sampling
  let finalBg = getEnvironmentColor(rayPos, rayDir, env);
  
  totalLight = totalLight + finalBg * totalTransmittance * transmittance(densityRemainder);

  let exposure = max(env.sceneExposure, 0.0);
  return vec4<f32>(totalLight * exposure, 1.0);
}
