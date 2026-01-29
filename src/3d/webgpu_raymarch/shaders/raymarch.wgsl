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
  aspect: f32,
  fovY: f32,
  maxSteps: f32,
  tileScale: f32,
  tileDarkOffset: f32,
  pad4: f32,
  tileCol1: vec3<f32>,
  pad5: f32,
  tileCol2: vec3<f32>,
  pad6: f32,
  tileCol3: vec3<f32>,
  pad7: f32,
  tileCol4: vec3<f32>,
  pad8: f32,
  tileColVariation: vec3<f32>,
  pad9: f32,
  dirToSun: vec3<f32>,
  pad10: f32,
  extinctionCoefficients: vec3<f32>,
  pad11: f32,
  indexOfRefraction: f32,
  numRefractions: f32,
  pad12: vec2<f32>,
  floorSize: vec3<f32>,
  pad13: f32,
  floorCenter: vec3<f32>,
  pad14: f32,
};

@group(0) @binding(0) var densityTex: texture_3d<f32>;
@group(0) @binding(1) var densitySampler: sampler;
@group(0) @binding(2) var<uniform> params: RaymarchParams;

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
// Helper Functions
// =============================================================================

fn rayBoxIntersection(origin: vec3<f32>, dir: vec3<f32>, boundsMin: vec3<f32>, boundsMax: vec3<f32>) -> vec2<f32> {
  let invDir = 1.0 / dir;
  let t0 = (boundsMin - origin) * invDir;
  let t1 = (boundsMax - origin) * invDir;
  let tmin = max(max(min(t0.x, t1.x), min(t0.y, t1.y)), min(t0.z, t1.z));
  let tmax = min(min(max(t0.x, t1.x), max(t0.y, t1.y)), max(t0.z, t1.z));
  return vec2<f32>(tmin, tmax);
}

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
  let hit = rayBoxIntersection(pos, vec3<f32>(0.0, 0.0, 1.0), boundsMin, boundsMax);
  return (hit.x <= 0.0 && hit.y > 0.0) && sampleDensity(pos) > 0.0;
}

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

  // Smoothly flatten normals out at boundary edges
  let o = params.boundsSize * 0.5 - abs(pos);
  var faceWeight = min(o.x, min(o.y, o.z));
  let faceNormal = calculateClosestFaceNormal(params.boundsSize, pos);
  
  let smoothDst = 0.3;
  let smoothPow = 5.0;
  
  // smoothstep(edge0, edge1, x)
  let smoothFactor = smoothstep(0.0, smoothDst, faceWeight);
  let volFactor = pow(clamp(volumeNormal.y, 0.0, 1.0), smoothPow);
  
  faceWeight = (1.0 - smoothFactor) * (1.0 - volFactor);

  return normalize(mix(volumeNormal, faceNormal, faceWeight));
}

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
  let boundsDstInfo = rayBoxIntersection(origin, rayDir, boundsMin, boundsMax);
  
  // Random jitter
  let r = (randomValue(rngState) - 0.5) * params.stepSize * 0.4;
  
  var currentOrigin = origin;
  // If outside box, jump to box
  if (boundsDstInfo.x > 0.0) {
     currentOrigin = origin + rayDir * (boundsDstInfo.x + r);
  } else {
     // Inside box
     currentOrigin = origin + rayDir * r;
  }
  
  var hasExittedFluid = !isInsideFluid(origin);
  
  let stepSize = params.stepSize;
  var hasEnteredFluid = false;
  var lastPosInFluid = currentOrigin;
  
  // Max distance inside box
  let dstToTest = boundsDstInfo.y - 0.01; // TinyNudge
  
  var dst = 0.0;
  for (var i = 0u; i < 512u; i = i + 1u) { // Hard limit loop
    if (dst >= dstToTest) { break; }
    
    let isLastStep = (dst + stepSize) >= dstToTest;
    let samplePos = currentOrigin + rayDir * dst;
    let thickness = sampleDensity(samplePos) * params.densityMultiplier * stepSize;
    let insideFluid = thickness > 0.0;
    
    if (insideFluid) {
      hasEnteredFluid = true;
      lastPosInFluid = samplePos;
      if (dst <= maxDst) {
         info.densityAlongRay = info.densityAlongRay + thickness;
      }
    }
    
    if (!insideFluid) {
      hasExittedFluid = true;
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
    
    dst = dst + stepSize;
  }
  
  return info;
}

// =============================================================================
// Lighting & Environment
// =============================================================================

fn rgbToHsv(rgb: vec3<f32>) -> vec3<f32> {
  let K = vec4<f32>(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  let p = select(vec4<f32>(rgb.gb, K.xy), vec4<f32>(rgb.bg, K.wz), rgb.g < rgb.b);
  let q = select(vec4<f32>(p.xyw, rgb.r), vec4<f32>(rgb.r, p.yzx), rgb.r < p.x);

  let d = q.x - min(q.w, q.y);
  let e = 1.0e-10;
  return vec3<f32>(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

fn hsvToRgb(hsv: vec3<f32>) -> vec3<f32> {
  let K = vec4<f32>(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  let p = abs(fract(hsv.xxx + K.xyz) * 6.0 - K.www);
  return hsv.z * mix(K.xxx, clamp(p - K.xxx, vec3<f32>(0.0), vec3<f32>(1.0)), hsv.y);
}

fn tweakHsv(colRGB: vec3<f32>, shift: vec3<f32>) -> vec3<f32> {
  let hsv = rgbToHsv(colRGB);
  return clamp(hsvToRgb(hsv + shift), vec3<f32>(0.0), vec3<f32>(1.0));
}

fn hashInt2(v: vec2<i32>) -> u32 {
  return u32(v.x) * 5023u + u32(v.y) * 96456u;
}

fn nextRandom(state: ptr<function, u32>) -> u32 {
  *state = *state * 747796405u + 2891336453u;
  let word = ((*state >> ((*state >> 28u) + 4u)) ^ *state) * 277803737u;
  return (word >> 22u) ^ word;
}

fn randomValue(state: ptr<function, u32>) -> f32 {
  return f32(nextRandom(state)) / 4294967295.0;
}

fn randomSNorm3(state: ptr<function, u32>) -> vec3<f32> {
  return vec3<f32>(
    randomValue(state) * 2.0 - 1.0,
    randomValue(state) * 2.0 - 1.0,
    randomValue(state) * 2.0 - 1.0
  );
}

fn modulo(x: f32, y: f32) -> f32 {
  return x - y * floor(x / y);
}

fn calculateDensityForShadow(rayPos: vec3<f32>, rayDir: vec3<f32>, maxDst: f32) -> f32 {
    let boundsMin = -0.5 * params.boundsSize;
    let boundsMax = 0.5 * params.boundsSize;
    let hit = rayBoxIntersection(rayPos, rayDir, boundsMin, boundsMax);
    if (hit.y <= max(hit.x, 0.0)) { return 0.0; }
    
    let tStart = max(hit.x, 0.0);
    let tEnd = min(hit.y, maxDst); 
    if (tStart >= tEnd) { return 0.0; }
    
    var opticalDepth = 0.0;
    let shadowStep = params.stepSize * 2.0; 
    var t = tStart;
    
    for (var i = 0; i < 64; i++) {
        if (t >= tEnd) { break; }
        let pos = rayPos + rayDir * t;
        let d = max(0.0, sampleDensityRaw(pos));
        opticalDepth = opticalDepth + d * params.densityMultiplier * shadowStep;
        t = t + shadowStep;
    }
    return opticalDepth;
}

fn transmittance(opticalDepth: f32) -> vec3<f32> {
  return exp(-opticalDepth * params.extinctionCoefficients);
}

fn skyColor(dir: vec3<f32>) -> vec3<f32> {
  let colGround = vec3<f32>(0.35, 0.3, 0.35) * 0.53;
  let colSkyHorizon = vec3<f32>(1.0, 1.0, 1.0);
  let colSkyZenith = vec3<f32>(0.08, 0.37, 0.73);

  let sun = pow(max(0.0, dot(dir, params.dirToSun)), 500.0);
  let skyGradientT = pow(smoothstep(0.0, 0.4, dir.y), 0.35);
  let groundToSkyT = smoothstep(-0.01, 0.0, dir.y);
  let skyGradient = mix(colSkyHorizon, colSkyZenith, skyGradientT);

  var res = mix(colGround, skyGradient, groundToSkyT);
  if (dir.y >= -0.01) {
    res = res + sun;
  }
  return res;
}

fn sampleEnvironment(origin: vec3<f32>, dir: vec3<f32>) -> vec3<f32> {
  let floorMin = params.floorCenter - 0.5 * params.floorSize;
  let floorMax = params.floorCenter + 0.5 * params.floorSize;
  let hit = rayBoxIntersection(origin, dir, floorMin, floorMax);
  
  if (hit.y >= max(hit.x, 0.0)) {
    let t = select(hit.x, 0.0, hit.x < 0.0);
    let hitPos = origin + dir * t;
    
    // Choose tileCol based on quadrant
    var tileCol = params.tileCol1;
    if (hitPos.x >= 0.0) { tileCol = params.tileCol2; }
    if (hitPos.z < 0.0) {
      if (hitPos.x < 0.0) { tileCol = params.tileCol3; }
      else { tileCol = params.tileCol4; }
    }

    let tileCoord = floor(hitPos.xz * params.tileScale);
    let isDarkTile = modulo(tileCoord.x, 2.0) == modulo(tileCoord.y, 2.0);
    
    var offset = 0.0;
    if (isDarkTile) { offset = params.tileDarkOffset; }
    tileCol = tweakHsv(tileCol, vec3<f32>(0.0, 0.0, offset));

    var rngState = hashInt2(vec2<i32>(i32(tileCoord.x), i32(tileCoord.y)));
    let randomVariation = randomSNorm3(&rngState) * params.tileColVariation * 0.1;
    tileCol = tweakHsv(tileCol, randomVariation);
    
    let shadowDepth = calculateDensityForShadow(hitPos, params.dirToSun, 100.0);
    let shadowMap = transmittance(shadowDepth * 2.0);
    
    return tileCol * shadowMap;
  }
  
  return skyColor(dir);
}

// =============================================================================
// Refraction / Reflection
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
    
    if (sinSqrAngleOfRefraction >= 1.0) { return 1.0; } // Total internal reflection

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
  let hit = rayBoxIntersection(rayPos, rayDir, boundsMin, boundsMax);
  if (hit.y <= max(hit.x, 0.0)) { return 0.0; }

  let tStart = max(hit.x, 0.0);
  let tEnd = min(hit.y, 2.0);
  var density = 0.0;
  let shortStep = (tEnd - tStart) / 4.0;

  for (var i = 0; i < 4; i++) {
    let t = tStart + (f32(i) + 0.5) * shortStep;
    density += max(0.0, sampleDensityRaw(rayPos + rayDir * t));
  }
  return density * params.densityMultiplier * shortStep;
}

// =============================================================================
// Main
// =============================================================================

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  let ndc = in.uv * 2.0 - vec2<f32>(1.0);
  let tanFov = tan(0.5 * params.fovY);
  var rayDir = normalize(params.cameraForward + params.cameraRight * (ndc.x * params.aspect * tanFov) + params.cameraUp * (ndc.y * tanFov));
  var rayPos = params.viewPos;
  
  // Seed random
  var rngState = hashInt2(vec2<i32>(i32(in.uv.x * 5000.0), i32(in.uv.y * 5000.0)));

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
     
     // Note: passing 1000.0 as maxDst for now
     let surfaceInfo = findNextSurface(rayPos, rayDir, searchForNextFluidEntryPoint, &rngState, 1000.0);
     
     if (!surfaceInfo.foundSurface) {
        break;
     }
     
     totalTransmittance = totalTransmittance * transmittance(surfaceInfo.densityAlongRay);
     
     // Check if we hit floor? Unity checks `surfaceInfo.pos.y < -boundsSize.y / 2 + 0.05`
     if (surfaceInfo.pos.y < -params.boundsSize.y * 0.5 + 0.05) {
        break;
     }
     
     var normal = calculateNormal(surfaceInfo.pos);
     if (dot(normal, rayDir) > 0.0) {
        normal = -normal;
     }
     
     let iorA = select(iorFluid, iorAir, !travellingThroughFluid); // if travelling through fluid, iorA = fluid
     let iorB = select(iorAir, iorFluid, !travellingThroughFluid); // target
     
     // If we are currently IN fluid, iorA is fluid, iorB is air.
     // But wait, `travellingThroughFluid` is true if we ARE in fluid.
     // So iorA should be iorFluid.
     // Correct: select(falseVal, trueVal, condition) in WGSL?
     // select(f, t, cond) -> if cond is true, returns t.
     
     // Unity:
     // float iorA = travellingThroughFluid ? indexOfRefraction : iorAir;
     // float iorB = travellingThroughFluid ? iorAir : indexOfRefraction;
     
     let response = calculateReflectionAndRefraction(rayDir, normal, select(iorAir, iorFluid, travellingThroughFluid), select(iorFluid, iorAir, travellingThroughFluid));
     
     // Approximate densities for heuristic
     let densityRefract = calculateDensityForRefraction(surfaceInfo.pos, response.refractDir, densityStepSize);
     let densityReflect = calculateDensityForRefraction(surfaceInfo.pos, response.reflectDir, densityStepSize);
     
     let traceRefractedRay = (densityRefract * response.refractWeight) > (densityReflect * response.reflectWeight);
     
     // Update state for next iteration
     travellingThroughFluid = (traceRefractedRay != travellingThroughFluid);
     
     if (traceRefractedRay) {
        // Add reflection contribution immediately (heuristic)
        let reflectLight = sampleEnvironment(surfaceInfo.pos, response.reflectDir);
        let reflectTrans = transmittance(densityReflect);
        totalLight = totalLight + reflectLight * totalTransmittance * reflectTrans * response.reflectWeight;
        
        // Continue with refraction
        rayPos = surfaceInfo.pos;
        rayDir = response.refractDir;
        totalTransmittance = totalTransmittance * response.refractWeight;
     } else {
        // Add refraction contribution
        let refractLight = sampleEnvironment(surfaceInfo.pos, response.refractDir);
        let refractTrans = transmittance(densityRefract);
        totalLight = totalLight + refractLight * totalTransmittance * refractTrans * response.refractWeight;
        
        // Continue with reflection
        rayPos = surfaceInfo.pos;
        rayDir = response.reflectDir;
        totalTransmittance = totalTransmittance * response.reflectWeight;
     }
  }
  
  // Approximate remaining path
  let densityRemainder = calculateDensityForShadow(rayPos, rayDir, 1000.0);
  let finalBg = sampleEnvironment(rayPos, rayDir);
  totalLight = totalLight + finalBg * totalTransmittance * transmittance(densityRemainder);
  
  // Gamma correction (Linear -> sRGB)
  let correctedColor = pow(totalLight, vec3<f32>(1.0 / 2.2));
  
  return vec4<f32>(correctedColor, 1.0);
}
