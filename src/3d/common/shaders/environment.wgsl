// =============================================================================
// Shared Environment Shader (Sky + Floor)
// =============================================================================

struct EnvironmentUniforms {
  dirToSun: vec3<f32>,
  floorAmbient: f32,
  
  skyColorHorizon: vec3<f32>,
  sunPower: f32,
  skyColorZenith: vec3<f32>,
  sceneExposure: f32,
  skyColorGround: vec3<f32>,
  debugFloorMode: f32,

  floorSize: vec3<f32>,
  tileScale: f32,
  floorCenter: vec3<f32>,
  tileDarkFactor: f32,

  tileCol1: vec3<f32>,
  sunBrightness: f32,
  tileCol2: vec3<f32>,
  globalBrightness: f32,
  tileCol3: vec3<f32>,
  globalSaturation: f32,
  tileCol4: vec3<f32>,
  pad3: f32,
  tileColVariation: vec3<f32>,
  pad4: f32,

  // Obstacle
  obstacleCenter: vec3<f32>,
  pad5: f32,
  obstacleHalfSize: vec3<f32>,
  pad6: f32,
  obstacleRotation: vec3<f32>,
  obstacleAlpha: f32,
  obstacleColor: vec3<f32>,
  pad7: f32,
};

// =============================================================================
// Helpers
// =============================================================================

fn envRayBoxIntersection(origin: vec3<f32>, dir: vec3<f32>, boundsMin: vec3<f32>, boundsMax: vec3<f32>) -> vec2<f32> {
  let invDir = 1.0 / dir;
  let t0 = (boundsMin - origin) * invDir;
  let t1 = (boundsMax - origin) * invDir;
  let tmin = max(max(min(t0.x, t1.x), min(t0.y, t1.y)), min(t0.z, t1.z));
  let tmax = min(min(max(t0.x, t1.x), max(t0.y, t1.y)), max(t0.z, t1.z));
  return vec2<f32>(tmin, tmax);
}

fn envRotateX(v: vec3<f32>, angle: f32) -> vec3<f32> {
  let c = cos(angle);
  let s = sin(angle);
  return vec3<f32>(v.x, v.y * c - v.z * s, v.y * s + v.z * c);
}

fn envRotateY(v: vec3<f32>, angle: f32) -> vec3<f32> {
  let c = cos(angle);
  let s = sin(angle);
  return vec3<f32>(v.x * c + v.z * s, v.y, -v.x * s + v.z * c);
}

fn envRotateZ(v: vec3<f32>, angle: f32) -> vec3<f32> {
  let c = cos(angle);
  let s = sin(angle);
  return vec3<f32>(v.x * c - v.y * s, v.x * s + v.y * c, v.z);
}

fn envRotateWorldToLocal(v: vec3<f32>, rotDeg: vec3<f32>) -> vec3<f32> {
  let rot = rotDeg * (3.14159265 / 180.0);
  var r = v;
  r = envRotateZ(r, -rot.z);
  r = envRotateY(r, -rot.y);
  r = envRotateX(r, -rot.x);
  return r;
}

fn envRotateLocalToWorld(v: vec3<f32>, rotDeg: vec3<f32>) -> vec3<f32> {
  let rot = rotDeg * (3.14159265 / 180.0);
  var r = v;
  r = envRotateX(r, rot.x);
  r = envRotateY(r, rot.y);
  r = envRotateZ(r, rot.z);
  return r;
}

// =============================================================================
// Color Utils
// =============================================================================

fn envRgbToHsv(rgb: vec3<f32>) -> vec3<f32> {
  let K = vec4<f32>(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  let p = select(vec4<f32>(rgb.gb, K.xy), vec4<f32>(rgb.bg, K.wz), rgb.g < rgb.b);
  let q = select(vec4<f32>(rgb.r, p.yzx), vec4<f32>(p.xyw, rgb.r), rgb.r < p.x);
  let d = q.x - min(q.w, q.y);
  let e = 1.0e-10;
  return vec3<f32>(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

fn envHsvToRgb(hsv: vec3<f32>) -> vec3<f32> {
  let K = vec4<f32>(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  let p = abs(fract(hsv.xxx + K.xyz) * 6.0 - K.www);
  return hsv.z * mix(K.xxx, clamp(p - K.xxx, vec3<f32>(0.0), vec3<f32>(1.0)), hsv.y);
}

fn envTweakHsv(colRGB: vec3<f32>, shift: vec3<f32>) -> vec3<f32> {
  let hsv = envRgbToHsv(colRGB);
  return clamp(envHsvToRgb(hsv + shift), vec3<f32>(0.0), vec3<f32>(1.0));
}

fn envHashInt2(v: vec2<i32>) -> u32 {
  return u32(v.x) * 5023u + u32(v.y) * 96456u;
}

fn envRandomValue(state: ptr<function, u32>) -> f32 {
  *state = *state * 747796405u + 2891336453u;
  let word = ((*state >> ((*state >> 28u) + 4u)) ^ *state) * 277803737u;
  let res = (word >> 22u) ^ word;
  return f32(res) / 4294967295.0;
}

fn envRandomSNorm3(state: ptr<function, u32>) -> vec3<f32> {
  return vec3<f32>(
    envRandomValue(state) * 2.0 - 1.0,
    envRandomValue(state) * 2.0 - 1.0,
    envRandomValue(state) * 2.0 - 1.0
  );
}

fn envSrgbToLinear(col: vec3<f32>) -> vec3<f32> {
  let lo = col / 12.92;
  let hi = pow((col + vec3<f32>(0.055)) / 1.055, vec3<f32>(2.4));
  return select(hi, lo, col <= vec3<f32>(0.04045));
}

fn envModulo(x: f32, y: f32) -> f32 {
  return x - y * floor(x / y);
}

fn envLinearToSrgb(color: vec3<f32>) -> vec3<f32> {
  return pow(color, vec3<f32>(1.0 / 2.2));
}

fn getTileColor(hitPos: vec3<f32>, params: EnvironmentUniforms) -> vec3<f32> {
  // Rotate tile coordinates by 270 degrees (matching Unity/basic scene)
  let rotatedPos = vec2<f32>(-hitPos.z, hitPos.x);

  // Select base color based on quadrant
  var tileCol: vec3<f32>;
  if (rotatedPos.x < 0.0) {
    tileCol = params.tileCol1;
  } else {
    tileCol = params.tileCol2;
  }
  if (rotatedPos.y < 0.0) {
    if (rotatedPos.x < 0.0) {
      tileCol = params.tileCol3;
    } else {
      tileCol = params.tileCol4;
    }
  }

  // Apply gamma correction (linear to sRGB)
  tileCol = envLinearToSrgb(tileCol);

  // Calculate tile coordinates
  let tileCoord = floor(rotatedPos * params.tileScale);

  // Apply HSV variation per tile (multiply by 0.1 like Unity)
  if (any(params.tileColVariation != vec3<f32>(0.0))) {
    var rngState = envHashInt2(vec2<i32>(i32(tileCoord.x), i32(tileCoord.y)));
    let randomVariation = envRandomSNorm3(&rngState) * params.tileColVariation * 0.1;
    tileCol = envTweakHsv(tileCol, randomVariation);
  }

  // Checkerboard pattern
  let isDarkTile = envModulo(tileCoord.x, 2.0) == envModulo(tileCoord.y, 2.0);
  if (isDarkTile) {
    tileCol = envTweakHsv(tileCol, vec3<f32>(0.0, 0.0, params.tileDarkFactor));
  }
  
  return tileCol;
}

// =============================================================================
// Sampling
// =============================================================================

fn getSkyColor(dir: vec3<f32>, params: EnvironmentUniforms) -> vec3<f32> {
  // Sun disc
  let sun = pow(max(0.0, dot(dir, params.dirToSun)), params.sunPower);
  
  // Sky gradient
  let skyGradientT = pow(smoothstep(0.0, 0.4, dir.y), 0.35);
  let groundToSkyT = smoothstep(-0.01, 0.0, dir.y);
  let skyGradient = mix(params.skyColorHorizon, params.skyColorZenith, skyGradientT);

  var res = mix(params.skyColorGround, skyGradient, groundToSkyT);
  if (dir.y >= -0.01) {
    res = res + sun * params.sunBrightness;
  }
  return res;
}

fn getObstacleHit(origin: vec3<f32>, dir: vec3<f32>, params: EnvironmentUniforms) -> vec4<f32> {
  // Returns (t, normalX, normalY, normalZ)
  // t < 0 if no hit
  
  if (any(params.obstacleHalfSize <= vec3<f32>(0.0))) { return vec4<f32>(-1.0, 0.0, 0.0, 0.0); }
  
  let localOrigin = envRotateWorldToLocal(origin - params.obstacleCenter, params.obstacleRotation);
  let localDir = envRotateWorldToLocal(dir, params.obstacleRotation);
  
  let hit = envRayBoxIntersection(localOrigin, localDir, -params.obstacleHalfSize, params.obstacleHalfSize);
  
  if (hit.y < max(hit.x, 0.0)) { return vec4<f32>(-1.0, 0.0, 0.0, 0.0); }
  
  let tEntry = select(hit.x, 0.0, hit.x < 0.0);
  let localHitPos = localOrigin + localDir * tEntry;
  
  // Face normal
  let dist = params.obstacleHalfSize - abs(localHitPos);
  var localNormal = vec3<f32>(0.0, 0.0, 1.0);
  if (dist.x < dist.y && dist.x < dist.z) {
    localNormal = vec3<f32>(sign(localHitPos.x), 0.0, 0.0);
  } else if (dist.y < dist.z) {
    localNormal = vec3<f32>(0.0, sign(localHitPos.y), 0.0);
  } else {
    localNormal = vec3<f32>(0.0, 0.0, sign(localHitPos.z));
  }
  
  let worldNormal = normalize(envRotateLocalToWorld(localNormal, params.obstacleRotation));
  
  return vec4<f32>(tEntry, worldNormal.x, worldNormal.y, worldNormal.z);
}

// Sample environment without shadows
fn getEnvironmentColor(origin: vec3<f32>, dir: vec3<f32>, params: EnvironmentUniforms) -> vec3<f32> {
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

    if (params.debugFloorMode >= 0.5) {
        if (params.debugFloorMode >= 1.5) {
             var debugTileCol = params.tileCol1;
             if (hitPos.x >= 0.0) { debugTileCol = params.tileCol2; }
             if (hitPos.z < 0.0) {
               if (hitPos.x < 0.0) { debugTileCol = params.tileCol3; }
               else { debugTileCol = params.tileCol4; }
             }
             bgCol = envLinearToSrgb(debugTileCol);
        } else {
             bgCol = vec3<f32>(1.0, 0.0, 0.0);
        }
    } else {
        let tileCol = getTileColor(hitPos, params);
        
        let ambient = clamp(params.floorAmbient, 0.0, 1.0);
        let sun = max(0.0, params.dirToSun.y) * params.sunBrightness;
        
        var finalColor = tileCol * (ambient + sun) * params.globalBrightness;

        let gray = dot(finalColor, vec3<f32>(0.299, 0.587, 0.114));
        finalColor = vec3<f32>(gray) + (finalColor - vec3<f32>(gray)) * params.globalSaturation;

        bgCol = finalColor;
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
