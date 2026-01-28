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

fn densityGradient(pos: vec3<f32>, eps: f32) -> vec3<f32> {
  let dx = sampleDensityRaw(pos + vec3<f32>(eps, 0.0, 0.0)) - sampleDensityRaw(pos - vec3<f32>(eps, 0.0, 0.0));
  let dy = sampleDensityRaw(pos + vec3<f32>(0.0, eps, 0.0)) - sampleDensityRaw(pos - vec3<f32>(0.0, eps, 0.0));
  let dz = sampleDensityRaw(pos + vec3<f32>(0.0, 0.0, eps)) - sampleDensityRaw(pos - vec3<f32>(0.0, 0.0, eps));
  return vec3<f32>(dx, dy, dz);
}

// =============================================================================
// Color & Environment Logic (Ported from Unity)
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

// PCG Random
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

fn calculateDensityAlongRay(rayPos: vec3<f32>, rayDir: vec3<f32>, maxDst: f32) -> f32 {
    let boundsMin = -0.5 * params.boundsSize;
    let boundsMax = 0.5 * params.boundsSize;
    let hit = rayBoxIntersection(rayPos, rayDir, boundsMin, boundsMax);
    
    // Check if ray intersects bounds
    if (hit.y <= max(hit.x, 0.0)) { return 0.0; }
    
    let tStart = max(hit.x, 0.0);
    let tEnd = min(hit.y, maxDst); 
    if (tStart >= tEnd) { return 0.0; }
    
    var opticalDepth = 0.0;
    // Use a larger step size for shadows to be cheaper
    let shadowStep = params.stepSize * 2.0; 
    var t = tStart;
    
    for (var i = 0; i < 64; i++) {
        if (t >= tEnd) { break; }
        let pos = rayPos + rayDir * t;
        let d = max(0.0, sampleDensityRaw(pos));
        opticalDepth += d * params.densityMultiplier * shadowStep;
        t += shadowStep;
    }
    return opticalDepth;
}

fn transmittance(opticalDepth: f32) -> vec3<f32> {
  return exp(-opticalDepth * params.extinctionCoefficients);
}

fn skyColor(dir: vec3<f32>) -> vec3<f32> {
  let t = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
  let top = vec3<f32>(0.45, 0.65, 0.95);
  let bottom = vec3<f32>(0.1, 0.12, 0.16);
  return mix(bottom, top, t);
}

fn sampleEnvironment(origin: vec3<f32>, dir: vec3<f32>) -> vec3<f32> {
  let floorY = -0.5 * params.boundsSize.y;
  
  if (abs(dir.y) > 0.0001) {
    let t = (floorY - origin.y) / dir.y;
    if (t > 0.0) {
      let hitPos = origin + dir * t;
      
      // Choose tileCol based on quadrant
      var tileCol = params.tileCol1;
      if (hitPos.x >= 0.0) {
        tileCol = params.tileCol2;
      }
      if (hitPos.z < 0.0) {
        if (hitPos.x < 0.0) {
           tileCol = params.tileCol3;
        } else {
           tileCol = params.tileCol4;
        }
      }

      // Checkerboard
      let tileCoord = floor(hitPos.xz * params.tileScale);
      let isDarkTile = modulo(tileCoord.x, 2.0) == modulo(tileCoord.y, 2.0);
      
      var offset = 0.0;
      if (isDarkTile) {
        offset = params.tileDarkOffset;
      }
      tileCol = tweakHsv(tileCol, vec3<f32>(0.0, 0.0, offset));

      // Random Variation
      var rngState = hashInt2(vec2<i32>(i32(tileCoord.x), i32(tileCoord.y)));
      let randomVariation = randomSNorm3(&rngState) * params.tileColVariation * 0.1;
      tileCol = tweakHsv(tileCol, randomVariation);
      
      // Shadow (from fluid)
      let shadowDepth = calculateDensityAlongRay(hitPos, params.dirToSun, 100.0);
      let shadowMap = transmittance(shadowDepth * 2.0); // * 2 to match Unity
      
      return tileCol * shadowMap;
    }
  }
  
  return skyColor(dir);
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  let ndc = in.uv * 2.0 - vec2<f32>(1.0);
  let tanFov = tan(0.5 * params.fovY);
  var rayDir = params.cameraForward + params.cameraRight * (ndc.x * params.aspect * tanFov) + params.cameraUp * (ndc.y * tanFov);
  rayDir = normalize(rayDir);

  let boundsMin = -0.5 * params.boundsSize;
  let boundsMax = 0.5 * params.boundsSize;
  let hit = rayBoxIntersection(params.viewPos, rayDir, boundsMin, boundsMax);

  // If ray misses box or is behind us
  if (hit.y <= max(hit.x, 0.0)) {
    let env = sampleEnvironment(params.viewPos, rayDir);
    return vec4<f32>(env, 1.0);
  }

  let tStart = max(hit.x, 0.0);
  let tEnd = hit.y;
  let maxSteps = u32(params.maxSteps + 0.5);

  var opticalDepth = 0.0;
  var hitPos = vec3<f32>(0.0);
  var hitFound = false;
  var t = tStart;

  for (var i = 0u; i < maxSteps; i = i + 1u) {
    if (t > tEnd) {
      break;
    }

    let pos = params.viewPos + rayDir * t;
    let sample = sampleDensityRaw(pos);
    if (!hitFound && sample > 0.0002) {
      hitFound = true;
      hitPos = pos;
    }
    let density = max(0.0, sample - 0.0002) * params.densityMultiplier;
    opticalDepth = opticalDepth + density * params.stepSize;

    t = t + params.stepSize;
  }

  if (!hitFound) {
    let bg = sampleEnvironment(params.viewPos, rayDir);
    return vec4<f32>(bg, 1.0);
  }

  opticalDepth = max(opticalDepth, 0.01);
  let alpha = 1.0 - exp(-opticalDepth * 6.0);
  let fluidColor = vec3<f32>(0.35, 0.75, 1.0);
  let bgColor = sampleEnvironment(params.viewPos, rayDir);
  var color = mix(bgColor, fluidColor, clamp(alpha, 0.0, 1.0));
  color = min(color + vec3<f32>(0.2), vec3<f32>(1.0));

  if (hitFound) {
    let grad = densityGradient(hitPos, params.stepSize);
    if (dot(grad, grad) > 0.0) {
      let normal = normalize(grad);
      let fresnel = pow(1.0 - clamp(dot(-rayDir, normal), 0.0, 1.0), 5.0);
      let refl = sampleEnvironment(hitPos, reflect(rayDir, normal));
      color = mix(color, refl, 0.35 * fresnel + 0.1);
    }
  }

  return vec4<f32>(color, 1.0);
}