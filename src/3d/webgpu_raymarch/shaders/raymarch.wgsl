// =============================================================================
// Raymarch Fragment Shader — Volume Rendered Fluid with Refraction
// =============================================================================
//
// Full-screen fragment shader that raymarches through a 3D density volume
// to render a transparent fluid with physically-based optical effects:
//
//   - **Beer–Lambert transmittance**: wavelength-dependent light absorption
//   - **Fresnel reflection/refraction**: Schlick-approximated via full
//     Fresnel equations, with configurable index of refraction
//   - **Multiple refraction bounces**: iterative surface finding + Snell's law
//   - **Floor with checkerboard tiles**: 4-quadrant colors, shadow mapping
//   - **Procedural sky**: gradient from horizon to zenith with sun highlight
//
// ## Rendering Pipeline
//
// 1. Construct a ray from the camera through the pixel
// 2. For each refraction bounce (up to `numRefractions`):
//    a. Find the next fluid surface along the ray (entry or exit)
//    b. Compute the surface normal from density gradients
//    c. Calculate Fresnel reflection/refraction split
//    d. Use a density heuristic to choose which ray to follow
//    e. Add the discarded ray's environmental contribution
//    f. Accumulate transmittance along the followed ray
// 3. After all bounces, sample the environment for the remaining ray
// 4. Apply exposure and output in linear color space
//    (the blit pass handles linear → sRGB conversion)
//
// ## Vertex Stage
//
// Uses the standard fullscreen triangle trick: 3 hardcoded vertices produce
// a triangle that covers the entire [-1, 1] NDC viewport. UV coordinates
// are derived from clip-space position.
// =============================================================================

// =============================================================================
// Uniform Parameters
// =============================================================================

/// All parameters passed from the CPU each frame.
/// Layout must match the uniform buffer written by RaymarchRenderer.render().
struct RaymarchParams {
  viewPos: vec3<f32>,                // 0-2
  pad0: f32,                         // 3
  cameraRight: vec3<f32>,            // 4-6
  pad1: f32,                         // 7
  cameraUp: vec3<f32>,               // 8-10
  pad2: f32,                         // 11
  cameraForward: vec3<f32>,          // 12-14
  pad3: f32,                         // 15
  minBounds: vec3<f32>,              // 16-18
  voxelsPerUnit: f32,                // 19
  maxBounds: vec3<f32>,              // 20-22
  floorY: f32,                       // 23
  densityOffset: f32,                // 24
  densityMultiplier: f32,            // 25
  stepSize: f32,                     // 26
  lightStepSize: f32,                // 27
  aspect: f32,                       // 28
  fovY: f32,                         // 29
  maxSteps: f32,                     // 30
  tileScale: f32,                    // 31
  tileDarkOffset: f32,               // 32
  globalBrightness: f32,             // 33
  globalSaturation: f32,             // 34
  pad_align2: f32,                   // 35
  tileCol1: vec3<f32>,               // 36-38
  pad6: f32,                         // 39
  tileCol2: vec3<f32>,               // 40-42
  pad7: f32,                         // 43
  tileCol3: vec3<f32>,               // 44-46
  pad8: f32,                         // 47
  tileCol4: vec3<f32>,               // 48-50
  pad9: f32,                         // 51
  tileColVariation: vec3<f32>,       // 52-54
  debugFloorMode: f32,               // 55
  dirToSun: vec3<f32>,               // 56-58
  pad10: f32,                        // 59
  extinctionCoefficients: vec3<f32>, // 60-62
  sunPower: f32,                     // 63
  fluidColor: vec3<f32>,             // 64-66
  pad12: f32,                        // 67
  skyColorHorizon: vec3<f32>,        // 68-70
  indexOfRefraction: f32,            // 71
  skyColorZenith: vec3<f32>,         // 72-74
  numRefractions: f32,               // 75
  skyColorGround: vec3<f32>,         // 76-78
  tileDarkFactor: f32,               // 79
  floorAmbient: f32,                 // 80
  sceneExposure: f32,                // 81
  floorSize: vec3<f32>,              // 82-84
  pad14: f32,                        // 85
  floorCenter: vec3<f32>,            // 86-88
  pad15: f32,                        // 89
  obstacleCenter: vec3<f32>,         // 90-92
  pad16: f32,                        // 93
  obstacleHalfSize: vec3<f32>,       // 94-96
  pad17: f32,                        // 97
  obstacleRotation: vec3<f32>,       // 98-100
  obstacleAlpha: f32,                // 101
  obstacleColor: vec3<f32>,          // 102-104
  pad18: f32,                        // 105
};

/// Shadow map uniforms (light-space projection + sampling params).
struct ShadowUniforms {
  lightViewProjection: mat4x4<f32>,
  shadowSoftness: f32,
  particleShadowRadius: f32,
  pad0: vec2<f32>,
};

// =============================================================================
// Bindings
// =============================================================================

/// 3D density texture produced by the splat pipeline.
@group(0) @binding(0) var densityTex: texture_3d<f32>;

/// Trilinear sampler with clamp-to-edge addressing.
@group(0) @binding(1) var densitySampler: sampler;

/// Uniform parameter buffer.
@group(0) @binding(2) var<uniform> params: RaymarchParams;

/// Particle shadow map (depth).
@group(0) @binding(3) var shadowTex: texture_depth_2d;

/// Comparison sampler for shadow map.
@group(0) @binding(4) var shadowSampler: sampler_comparison;

/// Shadow map uniforms.
@group(0) @binding(5) var<uniform> shadowUniforms: ShadowUniforms;

// =============================================================================
// Vertex Stage
// =============================================================================

/// Vertex-to-fragment interpolants.
struct VSOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

/// Fullscreen triangle vertex shader.
/// Three hardcoded vertices at (-1,-1), (3,-1), (-1,3) cover the entire viewport.
/// UVs are derived to map [0,1]² over the visible portion.
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
// Ray–Box Intersection
// =============================================================================

/// Computes entry (tmin) and exit (tmax) distances for a ray vs. AABB.
/// Returns vec2(tmin, tmax). If tmin > tmax, the ray misses the box.
/// Uses the slab method with component-wise min/max.
fn rayBoxIntersection(origin: vec3<f32>, dir: vec3<f32>, boundsMin: vec3<f32>, boundsMax: vec3<f32>) -> vec2<f32> {
  let invDir = 1.0 / dir;
  let t0 = (boundsMin - origin) * invDir;
  let t1 = (boundsMax - origin) * invDir;
  let tmin = max(max(min(t0.x, t1.x), min(t0.y, t1.y)), min(t0.z, t1.z));
  let tmax = min(min(max(t0.x, t1.x), max(t0.y, t1.y)), max(t0.z, t1.z));
  return vec2<f32>(tmin, tmax);
}

fn rotateX(v: vec3<f32>, angle: f32) -> vec3<f32> {
  let c = cos(angle);
  let s = sin(angle);
  return vec3<f32>(v.x, v.y * c - v.z * s, v.y * s + v.z * c);
}

fn rotateY(v: vec3<f32>, angle: f32) -> vec3<f32> {
  let c = cos(angle);
  let s = sin(angle);
  return vec3<f32>(v.x * c + v.z * s, v.y, -v.x * s + v.z * c);
}

fn rotateZ(v: vec3<f32>, angle: f32) -> vec3<f32> {
  let c = cos(angle);
  let s = sin(angle);
  return vec3<f32>(v.x * c - v.y * s, v.x * s + v.y * c, v.z);
}

fn toRadians(v: vec3<f32>) -> vec3<f32> {
  return v * (3.14159265 / 180.0);
}

fn rotateLocalToWorld(v: vec3<f32>, rot: vec3<f32>) -> vec3<f32> {
  var r = v;
  r = rotateX(r, rot.x);
  r = rotateY(r, rot.y);
  r = rotateZ(r, rot.z);
  return r;
}

fn rotateWorldToLocal(v: vec3<f32>, rot: vec3<f32>) -> vec3<f32> {
  var r = v;
  r = rotateZ(r, -rot.z);
  r = rotateY(r, -rot.y);
  r = rotateX(r, -rot.x);
  return r;
}

struct ObstacleHit {
  tEntry: f32,
  tExit: f32,
  normal: vec3<f32>,
  hit: bool,
};

fn obstacleFaceNormal(localPos: vec3<f32>) -> vec3<f32> {
  let dist = params.obstacleHalfSize - abs(localPos);
  if (dist.x < dist.y && dist.x < dist.z) {
    return vec3<f32>(sign(localPos.x), 0.0, 0.0);
  } else if (dist.y < dist.z) {
    return vec3<f32>(0.0, sign(localPos.y), 0.0);
  }
  return vec3<f32>(0.0, 0.0, sign(localPos.z));
}

/// Returns obstacle hit info for the OBB, or hit=false if no hit.
fn obstacleHitInfo(origin: vec3<f32>, dir: vec3<f32>) -> ObstacleHit {
  var res: ObstacleHit;
  res.hit = false;
  res.tEntry = -1.0;
  res.tExit = -1.0;
  res.normal = vec3<f32>(0.0);
  if (any(params.obstacleHalfSize <= vec3<f32>(0.0))) { return res; }
  let rot = toRadians(params.obstacleRotation);
  let localOrigin = rotateWorldToLocal(origin - params.obstacleCenter, rot);
  let localDir = rotateWorldToLocal(dir, rot);
  let obstacleMin = -params.obstacleHalfSize;
  let obstacleMax = params.obstacleHalfSize;
  let hit = rayBoxIntersection(localOrigin, localDir, obstacleMin, obstacleMax);
  if (hit.y < max(hit.x, 0.0)) { return res; }
  let tEntry = select(hit.x, 0.0, hit.x < 0.0);
  let localHitPos = localOrigin + localDir * tEntry;
  let localNormal = obstacleFaceNormal(localHitPos);
  res.tEntry = tEntry;
  res.tExit = hit.y;
  res.normal = normalize(rotateLocalToWorld(localNormal, rot));
  res.hit = true;
  return res;
}

// =============================================================================
// Density Sampling
// =============================================================================

/// Samples the density texture at a world position WITHOUT boundary clamping.
/// Converts world coords to UVW [0,1]³ and subtracts the density offset.
/// Negative results indicate the point is below the iso-surface (outside fluid).
fn sampleDensityRaw(pos: vec3<f32>) -> f32 {
  let volumeSizeF = vec3<f32>(textureDimensions(densityTex, 0));
  let worldToVoxel = params.voxelsPerUnit;
  let uvw = (pos - params.minBounds) * worldToVoxel / (volumeSizeF - vec3<f32>(1.0));
  return textureSampleLevel(densityTex, densitySampler, uvw, 0.0).r - params.densityOffset;
}

/// Samples the density texture with boundary clamping.
/// Returns -densityOffset for positions at or beyond the volume edges,
/// preventing edge artifacts where the texture wraps or clamps.
fn sampleDensity(pos: vec3<f32>) -> f32 {
  let volumeSizeF = vec3<f32>(textureDimensions(densityTex, 0));
  let worldToVoxel = params.voxelsPerUnit;
  let uvw = (pos - params.minBounds) * worldToVoxel / (volumeSizeF - vec3<f32>(1.0));
  let epsilon = 0.0001;
  if (any(uvw >= vec3<f32>(1.0 - epsilon)) || any(uvw <= vec3<f32>(epsilon))) {
    return -params.densityOffset;
  }
  return textureSampleLevel(densityTex, densitySampler, uvw, 0.0).r - params.densityOffset;
}

/// Returns true if the position is inside the simulation bounds AND
/// the density at that point is positive (above the iso-surface).
fn isInsideFluid(pos: vec3<f32>) -> bool {
  let hit = rayBoxIntersection(pos, vec3<f32>(0.0, 0.0, 1.0), params.minBounds, params.maxBounds);
  return (hit.x <= 0.0 && hit.y > 0.0) && sampleDensity(pos) > 0.0;
}

// =============================================================================
// Normal Estimation
// =============================================================================

/// Returns the outward-facing normal of the closest AABB face to point `p`.
/// Used to blend volume normals with box-face normals at edges.
fn calculateClosestFaceNormal(p: vec3<f32>) -> vec3<f32> {
  let minDiff = p - params.minBounds;
  let maxDiff = params.maxBounds - p;
  
  var minD = minDiff.x;
  var normal = vec3<f32>(-1.0, 0.0, 0.0);
  
  if (minDiff.y < minD) { minD = minDiff.y; normal = vec3<f32>(0.0, -1.0, 0.0); }
  if (minDiff.z < minD) { minD = minDiff.z; normal = vec3<f32>(0.0, 0.0, -1.0); }
  if (maxDiff.x < minD) { minD = maxDiff.x; normal = vec3<f32>(1.0, 0.0, 0.0); }
  if (maxDiff.y < minD) { minD = maxDiff.y; normal = vec3<f32>(0.0, 1.0, 0.0); }
  if (maxDiff.z < minD) { minD = maxDiff.z; normal = vec3<f32>(0.0, 0.0, 1.0); }
  
  return normal;
}

/// Estimates the fluid surface normal at `pos` using central differences
/// on the density field, then blends with the nearest box-face normal
/// near the simulation boundary to avoid edge artifacts.
///
/// The blending uses smoothstep on the distance-to-face, weighted by the
/// vertical component of the volume normal, so that flat (horizontal)
/// surfaces near walls get more face-normal influence.
fn calculateNormal(pos: vec3<f32>) -> vec3<f32> {
  // Central differences with step size 0.1
  let s = 0.1;
  let offsetX = vec3<f32>(s, 0.0, 0.0);
  let offsetY = vec3<f32>(0.0, s, 0.0);
  let offsetZ = vec3<f32>(0.0, 0.0, s);

  let dx = sampleDensity(pos - offsetX) - sampleDensity(pos + offsetX);
  let dy = sampleDensity(pos - offsetY) - sampleDensity(pos + offsetY);
  let dz = sampleDensity(pos - offsetZ) - sampleDensity(pos + offsetZ);

  let volumeNormal = normalize(vec3<f32>(dx, dy, dz));

  // Smoothly blend toward face normal near the simulation boundary
  let minDiff = pos - params.minBounds;
  let maxDiff = params.maxBounds - pos;
  var faceWeight = min(min(min(minDiff.x, minDiff.y), minDiff.z), min(min(maxDiff.x, maxDiff.y), maxDiff.z));
  let faceNormal = calculateClosestFaceNormal(pos);

  let smoothDst = 0.3;  // Distance over which blending occurs
  let smoothPow = 5.0;  // Power curve for vertical normal weighting

  // smoothstep: 0 at boundary, 1 beyond smoothDst
  let smoothFactor = smoothstep(0.0, smoothDst, faceWeight);
  // Upward-facing surfaces get less face-normal blending
  let volFactor = pow(clamp(volumeNormal.y, 0.0, 1.0), smoothPow);

  faceWeight = (1.0 - smoothFactor) * (1.0 - volFactor);

  return normalize(mix(volumeNormal, faceNormal, faceWeight));
}

// =============================================================================
// Surface Finding
// =============================================================================

/// Result of a surface search along a ray.
struct SurfaceInfo {
  pos: vec3<f32>,              // Position of the found surface
  densityAlongRay: f32,        // Accumulated optical thickness along the ray
  foundSurface: bool,          // Whether a surface transition was detected
};

/// Marches along a ray to find the next fluid surface (entry or exit).
///
/// ## Parameters
/// - `origin`: ray start position
/// - `rayDir`: normalized ray direction
/// - `findNextFluidEntryPoint`: if true, searches for re-entry into fluid;
///    if false, searches for the exit (fluid → air transition)
/// - `rngState`: random state for jittering the start position
/// - `maxDst`: maximum distance for density accumulation (for transmittance)
///
/// ## Algorithm
///
/// Steps along the ray at `stepSize` intervals. Tracks whether the ray has
/// entered and exited the fluid. A "surface" is found when:
///   - Entry mode: the ray was outside fluid and enters it
///   - Exit mode: the ray was inside fluid and leaves it (or hits the boundary)
///
/// Random jitter (±20% of stepSize) is applied to the starting position to
/// reduce banding artifacts from uniform sampling.
fn findNextSurface(origin: vec3<f32>, rayDir: vec3<f32>, findNextFluidEntryPoint: bool, rngState: ptr<function, u32>, maxDst: f32) -> SurfaceInfo {
  var info: SurfaceInfo;
  info.densityAlongRay = 0.0;
  info.foundSurface = false;

  // Degenerate ray check
  if (dot(rayDir, rayDir) < 0.5) { return info; }

  let boundsDstInfo = rayBoxIntersection(origin, rayDir, params.minBounds, params.maxBounds);

  // Random jitter to reduce banding (±20% of step size)
  let r = (randomValue(rngState) - 0.5) * params.stepSize * 0.2;

  var currentOrigin = origin;
  if (boundsDstInfo.x > 0.0) {
    // Outside box: jump to the box entry point (with jitter)
    currentOrigin = origin + rayDir * (boundsDstInfo.x + r);
  } else {
    // Inside box: start from current position (with jitter)
    currentOrigin = origin + rayDir * r;
  }

  var hasExittedFluid = !isInsideFluid(origin);

  let stepSize = params.stepSize;
  var hasEnteredFluid = false;
  var lastPosInFluid = currentOrigin;

  // Maximum distance to test inside the box (with tiny nudge to avoid edge cases)
  let dstToTest = boundsDstInfo.y - 0.01;

  // Adaptive stepping: skip empty space at coarse resolution
  const COARSE_MULTIPLIER = 4.0;
  const FINE_RETURN_THRESHOLD = 3u;  // consecutive empty samples before going coarse

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

    // If coarse stepping found density, back up and refine
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
      // Accumulate optical thickness for transmittance calculation
      if (dst <= maxDst) {
         info.densityAlongRay = info.densityAlongRay + thickness;
      }
    }

    if (!insideFluid) {
      hasExittedFluid = true;
      consecutiveEmpty++;
      // After enough empty samples in fine mode, switch back to coarse
      if (!useCoarseStep && consecutiveEmpty >= FINE_RETURN_THRESHOLD && !hasEnteredFluid) {
        useCoarseStep = true;
      }
    }

    // Determine if we found the desired surface transition
    var found = false;
    if (findNextFluidEntryPoint) {
      // Looking for re-entry: fluid must have been exited, now we're back in
      found = insideFluid && hasExittedFluid;
    } else {
      // Looking for exit: entered fluid and now left it (or at boundary)
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
// Color Space & Random Utilities
// =============================================================================

/// Converts RGB [0,1] to HSV [0,1] using the standard hexagonal model.
fn rgbToHsv(rgb: vec3<f32>) -> vec3<f32> {
  let K = vec4<f32>(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  let p = select(vec4<f32>(rgb.gb, K.xy), vec4<f32>(rgb.bg, K.wz), rgb.g < rgb.b);
  // Fixed: swapped arguments to match corrected select logic
  let q = select(vec4<f32>(rgb.r, p.yzx), vec4<f32>(p.xyw, rgb.r), rgb.r < p.x);

  let d = q.x - min(q.w, q.y);
  let e = 1.0e-10;
  return vec3<f32>(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

/// Converts HSV [0,1] to RGB [0,1].
fn hsvToRgb(hsv: vec3<f32>) -> vec3<f32> {
  let K = vec4<f32>(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  let p = abs(fract(hsv.xxx + K.xyz) * 6.0 - K.www);
  return hsv.z * mix(K.xxx, clamp(p - K.xxx, vec3<f32>(0.0), vec3<f32>(1.0)), hsv.y);
}

/// Applies an HSV shift to an RGB color (for per-tile color variation).
fn tweakHsv(colRGB: vec3<f32>, shift: vec3<f32>) -> vec3<f32> {
  let hsv = rgbToHsv(colRGB);
  return clamp(hsvToRgb(hsv + shift), vec3<f32>(0.0), vec3<f32>(1.0));
}

/// Converts sRGB [0,1] to linear [0,1] using the piecewise IEC 61966-2-1 EOTF.
fn srgbToLinear(col: vec3<f32>) -> vec3<f32> {
  let lo = col / 12.92;
  let hi = pow((col + vec3<f32>(0.055)) / 1.055, vec3<f32>(2.4));
  return select(hi, lo, col <= vec3<f32>(0.04045));
}

/// Hashes a 2D integer coordinate to a u32 seed for random number generation.
fn hashInt2(v: vec2<i32>) -> u32 {
  return u32(v.x) * 5023u + u32(v.y) * 96456u;
}

/// PCG-style PRNG: advances the state and returns a pseudo-random u32.
fn nextRandom(state: ptr<function, u32>) -> u32 {
  *state = *state * 747796405u + 2891336453u;
  let word = ((*state >> ((*state >> 28u) + 4u)) ^ *state) * 277803737u;
  return (word >> 22u) ^ word;
}

/// Returns a uniform random float in [0, 1].
fn randomValue(state: ptr<function, u32>) -> f32 {
  return f32(nextRandom(state)) / 4294967295.0;
}

/// Returns a random vec3 with each component in [−1, 1] (signed normalized).
fn randomSNorm3(state: ptr<function, u32>) -> vec3<f32> {
  return vec3<f32>(
    randomValue(state) * 2.0 - 1.0,
    randomValue(state) * 2.0 - 1.0,
    randomValue(state) * 2.0 - 1.0
  );
}

/// Positive modulo: always returns a non-negative result (unlike WGSL %).
fn modulo(x: f32, y: f32) -> f32 {
  return x - y * floor(x / y);
}

// =============================================================================
// Lighting & Shadows
// =============================================================================

/// Accumulates optical depth along a ray through the density volume.
/// Used for shadow rays (sun direction) and refraction density heuristics.
///
/// Steps at `lightStepSize * 2` intervals for performance, with an early
/// exit when optical depth exceeds 3.0 (fully opaque for practical purposes).
fn calculateDensityForShadow(rayPos: vec3<f32>, rayDir: vec3<f32>, maxDst: f32) -> f32 {
    let hit = rayBoxIntersection(rayPos, rayDir, params.minBounds, params.maxBounds);
    if (hit.y <= max(hit.x, 0.0)) { return 0.0; }

    let tStart = max(hit.x, 0.0);
    let tEnd = min(hit.y, maxDst);
    if (tStart >= tEnd) { return 0.0; }

    var opticalDepth = 0.0;
    let shadowStep = params.lightStepSize * 2.0; // Coarser steps for performance
    var t = tStart;

    for (var i = 0; i < 32; i++) {
        if (t >= tEnd) { break; }
        let pos = rayPos + rayDir * t;
        let d = max(0.0, sampleDensityRaw(pos));
        opticalDepth = opticalDepth + d * params.densityMultiplier * shadowStep;
        if (opticalDepth > 3.0) { break; } // Early exit: effectively fully opaque
        t = t + shadowStep;
    }
    return opticalDepth;
}

/// Computes Beer–Lambert transmittance from optical depth.
/// T = exp(−τ × σ) where σ is the per-channel extinction coefficient.
/// Higher extinction → more absorption → darker color for that channel.
fn transmittance(opticalDepth: f32) -> vec3<f32> {
  let T = exp(-opticalDepth * params.extinctionCoefficients);
  let tintStrength = clamp(opticalDepth * 0.15, 0.0, 1.0);
  let tint = mix(vec3<f32>(1.0), params.fluidColor, tintStrength);
  return T * tint;
}

/// Samples the particle shadow map at a world position.
fn sampleShadow(worldPos: vec3<f32>, ndotl: f32) -> f32 {
  let lightPos = shadowUniforms.lightViewProjection * vec4<f32>(worldPos, 1.0);
  let ndc = lightPos.xyz / lightPos.w;
  let uv = vec2<f32>(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);

  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 || ndc.z < 0.0 || ndc.z > 1.0) {
    return 1.0;
  }

  let bias = max(0.0005 * (1.0 - ndotl), 0.0001);
  let depth = ndc.z - bias;
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

// =============================================================================
// Environment Sampling (Sky + Floor)
// =============================================================================

/// Generates a procedural sky color for a given ray direction.
///
/// Three zones blended together:
///   1. Ground (y < 0): dark brownish-gray
///   2. Horizon (y ≈ 0): white
///   3. Zenith (y → 1): deep blue
///
/// A sharp sun highlight is added using pow(dot(dir, sunDir), 500).
fn skyColor(dir: vec3<f32>) -> vec3<f32> {
  // Sun disc (dynamic sun power)
  let sun = pow(max(0.0, dot(dir, params.dirToSun)), params.sunPower);
  // Sky gradient: smoothstep from horizon to zenith
  let skyGradientT = pow(smoothstep(0.0, 0.4, dir.y), 0.35);
  // Ground-to-sky transition at the horizon
  let groundToSkyT = smoothstep(-0.01, 0.0, dir.y);
  let skyGradient = mix(params.skyColorHorizon, params.skyColorZenith, skyGradientT);

  var res = mix(params.skyColorGround, skyGradient, groundToSkyT);
  if (dir.y >= -0.01) {
    res = res + sun; // Add sun only above the horizon
  }
  return res;
}

/// Samples the scene environment (floor or sky) for a given ray.
///
/// First tests for intersection with the floor slab AABB. If hit:
///   1. Determine floor quadrant → select tile color
///   2. Apply checkerboard pattern (dark/light alternation)
///   3. Optionally apply per-tile HSV variation for visual richness
///   4. Compute shadow from the fluid volume (density toward sun)
///   5. Apply ambient + shadow lighting
///
/// If the floor is missed, falls back to the procedural sky.
///
/// Debug modes:
///   - mode 1: solid red (floor hit visualization)
///   - mode 2: flat quadrant colors (no checkerboard)
fn sampleEnvironment(origin: vec3<f32>, dir: vec3<f32>) -> vec3<f32> {
  // Check floor intersection using ray-plane intersection (matching basic demo)
  var floorT = -1.0;
  if (abs(dir.y) > 0.0001) {
    let t = (params.floorY - origin.y) / dir.y;
    if (t > 0.0) { floorT = t; }
  }
  
  let hasFloorHit = floorT > 0.0;

  var bgCol: vec3<f32>;
  if (hasFloorHit) {
    // Ray hits the floor — compute the hit position
    let hitPos = origin + dir * floorT;

    // Check if within floor bounds
    let halfSize = params.floorSize.x * 0.5;
    if (abs(hitPos.x) < halfSize && abs(hitPos.z) < halfSize) {

    // --- Debug mode 2: flat quadrant colors (no checkerboard) ---
    if (params.debugFloorMode >= 1.5) {
      var debugTileCol = params.tileCol1;
      if (hitPos.x >= 0.0) { debugTileCol = params.tileCol2; }
      if (hitPos.z < 0.0) {
        if (hitPos.x < 0.0) { debugTileCol = params.tileCol3; }
        else { debugTileCol = params.tileCol4; }
      }
      bgCol = srgbToLinear(debugTileCol);
    }

    // --- Debug mode 1: solid red ---
    if (params.debugFloorMode >= 0.5 && params.debugFloorMode < 1.5) {
      bgCol = vec3<f32>(1.0, 0.0, 0.0);
    }

    // --- Normal rendering: checkerboard tiles ---
    if (params.debugFloorMode < 0.5) {
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

      // NO gamma correction here because tileCol is already linear and 
      // the blit pass converts the final linear output to sRGB.

      // Calculate tile coordinates
      let tileCoord = floor(rotatedPos * params.tileScale);

      // Apply HSV variation per tile (multiply by 0.1 like Unity)
      if (any(params.tileColVariation != vec3<f32>(0.0))) {
        var rngState = hashInt2(vec2<i32>(i32(tileCoord.x), i32(tileCoord.y)));
        let randomVariation = randomSNorm3(&rngState) * params.tileColVariation * 0.1;
        tileCol = tweakHsv(tileCol, randomVariation);
      }

      // Checkerboard pattern
      let isDarkTile = modulo(tileCoord.x, 2.0) == modulo(tileCoord.y, 2.0);
      if (isDarkTile) {
        tileCol = tweakHsv(tileCol, vec3<f32>(0.0, 0.0, params.tileDarkFactor));
      }

      // Shadow Map modulation
      let shadowDepth = calculateDensityForShadow(hitPos, params.dirToSun, 100.0);
      let shadowMap = transmittance(shadowDepth * 2.0);
      let ndotl = max(dot(vec3<f32>(0.0, 1.0, 0.0), params.dirToSun), 0.0);
      let shadowScene = sampleShadow(hitPos, ndotl);
      
      // lighting = Combine shadows with ambient to ensure tiles are never pitch black
      let ambient = clamp(params.floorAmbient, 0.0, 1.0);
      let lighting = shadowMap * shadowScene * (1.0 - ambient) + ambient;

      // Color adjustments
      var finalColor = tileCol * lighting * params.globalBrightness;

      let gray = dot(finalColor, vec3<f32>(0.299, 0.587, 0.114));
      finalColor = vec3<f32>(gray) + (finalColor - vec3<f32>(gray)) * params.globalSaturation;

      bgCol = finalColor;
    }
    } else {
      bgCol = skyColor(dir);
    }
  } else {
    // No floor hit — return sky color
    bgCol = skyColor(dir);
  }

  // Test ray against obstacle AABB (if enabled)
  let obstacleHit = obstacleHitInfo(origin, dir);
  let hasObstacleHit = obstacleHit.hit;
  let obstacleT = obstacleHit.tEntry;

  // If the obstacle is the closest hit, alpha-blend it over the background
  if (hasObstacleHit && (!hasFloorHit || obstacleT < floorT)) {
    let a = clamp(params.obstacleAlpha, 0.0, 1.0);
    let ambient = clamp(params.floorAmbient, 0.0, 1.0);
    let sun = max(0.0, dot(obstacleHit.normal, params.dirToSun));
    let shadow = sampleShadow(origin + dir * obstacleT, sun);
    let lit = params.obstacleColor * (ambient + sun * (1.0 - ambient) * shadow);
    return mix(bgCol, lit, a);
  }

  return bgCol;
}

// =============================================================================
// Fresnel Reflection & Refraction (Snell's Law)
// =============================================================================

/// Result of the reflection/refraction calculation at a surface.
struct LightResponse {
    reflectDir: vec3<f32>,     // Reflected ray direction
    refractDir: vec3<f32>,     // Refracted ray direction (zero if TIR)
    reflectWeight: f32,        // Fresnel reflectance [0, 1]
    refractWeight: f32,        // 1 − reflectWeight
};

/// Computes the Fresnel reflectance using the exact Fresnel equations.
///
/// For unpolarized light, reflectance = (R_perp + R_para) / 2 where:
///   R_perp = ((n₁ cos θᵢ − n₂ cos θₜ) / (n₁ cos θᵢ + n₂ cos θₜ))²
///   R_para = ((n₂ cos θᵢ − n₁ cos θₜ) / (n₂ cos θᵢ + n₁ cos θₜ))²
///
/// Returns 1.0 for total internal reflection (sin²θₜ ≥ 1).
fn calculateReflectance(inDir: vec3<f32>, normal: vec3<f32>, iorA: f32, iorB: f32) -> f32 {
    let refractRatio = iorA / iorB;
    let cosAngleIn = -dot(inDir, normal);
    let sinSqrAngleOfRefraction = refractRatio * refractRatio * (1.0 - cosAngleIn * cosAngleIn);

    // Total internal reflection: no refracted ray exists
    if (sinSqrAngleOfRefraction >= 1.0) { return 1.0; }

    let cosAngleOfRefraction = sqrt(1.0 - sinSqrAngleOfRefraction);

    // Perpendicular polarization component
    var rPerp = (iorA * cosAngleIn - iorB * cosAngleOfRefraction) / (iorA * cosAngleIn + iorB * cosAngleOfRefraction);
    rPerp = rPerp * rPerp;

    // Parallel polarization component
    var rPara = (iorB * cosAngleIn - iorA * cosAngleOfRefraction) / (iorB * cosAngleIn + iorA * cosAngleOfRefraction);
    rPara = rPara * rPara;

    // Average for unpolarized light
    return (rPerp + rPara) * 0.5;
}

/// Computes the refracted direction via Snell's law.
/// Returns (0,0,0) for total internal reflection.
fn refract(inDir: vec3<f32>, normal: vec3<f32>, iorA: f32, iorB: f32) -> vec3<f32> {
    let refractRatio = iorA / iorB;
    let cosAngleIn = -dot(inDir, normal);
    let sinSqrAngleOfRefraction = refractRatio * refractRatio * (1.0 - cosAngleIn * cosAngleIn);

    if (sinSqrAngleOfRefraction > 1.0) { return vec3<f32>(0.0); }

    return refractRatio * inDir + (refractRatio * cosAngleIn - sqrt(1.0 - sinSqrAngleOfRefraction)) * normal;
}

/// Computes both reflection and refraction directions with Fresnel weights.
fn calculateReflectionAndRefraction(inDir: vec3<f32>, normal: vec3<f32>, iorA: f32, iorB: f32) -> LightResponse {
    var res: LightResponse;
    res.reflectWeight = calculateReflectance(inDir, normal, iorA, iorB);
    res.refractWeight = 1.0 - res.reflectWeight;
    res.reflectDir = reflect(inDir, normal);
    res.refractDir = refract(inDir, normal, iorA, iorB);
    return res;
}

/// Quick density probe along a ray to estimate optical depth.
/// Used as a heuristic to choose between tracing the reflected or refracted ray.
/// Takes only 2 short samples for speed.
fn calculateDensityForRefraction(rayPos: vec3<f32>, rayDir: vec3<f32>, stepSize: f32) -> f32 {
  let hit = rayBoxIntersection(rayPos, rayDir, params.minBounds, params.maxBounds);
  if (hit.y <= max(hit.x, 0.0)) { return 0.0; }

  let tStart = max(hit.x, 0.0);
  let tEnd = min(hit.y, 2.0); // Only probe a short distance
  var density = 0.0;
  let shortStep = (tEnd - tStart) / 2.0;

  // Two samples centered in each half of the probe distance
  for (var i = 0; i < 2; i++) {
    let t = tStart + (f32(i) + 0.5) * shortStep;
    density += max(0.0, sampleDensityRaw(rayPos + rayDir * t));
  }
  return density * params.densityMultiplier * shortStep;
}

// =============================================================================
// Main Fragment Shader
// =============================================================================

/// Output structure for the fragment shader with color and depth.
struct FSOutput {
  @location(0) color: vec4<f32>,
  @builtin(frag_depth) depth: f32,
}

/// Per-pixel raymarching with iterative refraction.
///
/// ## Algorithm Overview
///
/// 1. Construct a perspective ray from the camera through this pixel
/// 2. Seed a per-pixel PRNG for jitter
/// 3. For each refraction bounce (up to numRefractions):
///    a. Find the next fluid surface (entry or exit)
///    b. Accumulate Beer–Lambert transmittance from density along the ray
///    c. Compute the surface normal via density gradient
///    d. Calculate Fresnel reflection/refraction split
///    e. Use a density heuristic to decide which ray to trace next:
///       - Probe density along both directions
///       - Follow the ray with higher (density × Fresnel weight)
///    f. Add the discarded ray's environment contribution immediately
///    g. Continue marching along the chosen ray
/// 4. After all bounces, add the final environment sample
/// 5. Apply exposure and return the linear-space color
@fragment
fn fs_main(in: VSOut) -> FSOutput {
  var output: FSOutput;
  // Convert UV [0,1]² to NDC [-1,1]²
  let ndc = in.uv * 2.0 - vec2<f32>(1.0);

  // Construct perspective ray direction from camera basis vectors
  let tanFov = tan(0.5 * params.fovY);
  var rayDir = normalize(params.cameraForward + params.cameraRight * (ndc.x * params.aspect * tanFov) + params.cameraUp * (ndc.y * tanFov));
  var rayPos = params.viewPos;

  // Per-pixel random seed (based on UV position)
  var rngState = hashInt2(vec2<i32>(i32(in.uv.x * 5000.0), i32(in.uv.y * 5000.0)));

  // Check if the camera is already inside the fluid
  var travellingThroughFluid = isInsideFluid(rayPos);

  // Accumulated light and transmittance across all bounces
  var totalTransmittance = vec3<f32>(1.0); // Starts fully transparent
  var totalLight = vec3<f32>(0.0);         // Accumulated radiance
  var hitFluid = false;
  var firstHitDist = -1.0; // Distance to first fluid surface hit (for depth output)

  let iorAir = 1.0;
  let iorFluid = params.indexOfRefraction;

  // -------------------------------------------------------------------------
  // Iterative Refraction Loop
  // -------------------------------------------------------------------------

  for (var i = 0; i < i32(params.numRefractions); i = i + 1) {
     // Early exit if transmittance is negligible (fully opaque)
     if (all(totalTransmittance < vec3<f32>(0.01))) {
        break;
     }

     // Increase step size for later bounces (less precision needed)
     let densityStepSize = params.stepSize * f32(i + 1);

     // Determine search mode: looking for fluid entry or exit?
     let searchForNextFluidEntryPoint = !travellingThroughFluid;

     // Find the next fluid surface along the current ray
     let obstacleHit = obstacleHitInfo(rayPos, rayDir);
     let hasObstacleHit = obstacleHit.hit;
     let surfaceInfo = findNextSurface(rayPos, rayDir, searchForNextFluidEntryPoint, &rngState, 1000.0);

     // If we're in air and the obstacle is closer than the next fluid surface,
     // alpha-blend the obstacle and continue marching behind it.
     if (!travellingThroughFluid && hasObstacleHit) {
        let obstacleT = obstacleHit.tEntry;
        if (!surfaceInfo.foundSurface) {
          let a = clamp(params.obstacleAlpha, 0.0, 1.0);
          let ambient = clamp(params.floorAmbient, 0.0, 1.0);
          let sun = max(0.0, dot(obstacleHit.normal, params.dirToSun));
          let obsPos = rayPos + rayDir * obstacleT;
          let shadow = sampleShadow(obsPos, sun);
          let lit = params.obstacleColor * (ambient + sun * (1.0 - ambient) * shadow);
          totalLight = totalLight + lit * totalTransmittance * a;
          totalTransmittance = totalTransmittance * (1.0 - a);
          // Move ray past the obstacle to avoid repeated hits
          let exitT = max(obstacleHit.tExit, obstacleT);
          rayPos = rayPos + rayDir * (exitT + 0.001);
          continue;
        }
        let surfaceT = dot(surfaceInfo.pos - rayPos, rayDir);
        if (obstacleT < surfaceT) {
          let a = clamp(params.obstacleAlpha, 0.0, 1.0);
          let ambient = clamp(params.floorAmbient, 0.0, 1.0);
          let sun = max(0.0, dot(obstacleHit.normal, params.dirToSun));
          let obsPos = rayPos + rayDir * obstacleT;
          let shadow = sampleShadow(obsPos, sun);
          let lit = params.obstacleColor * (ambient + sun * (1.0 - ambient) * shadow);
          totalLight = totalLight + lit * totalTransmittance * a;
          totalTransmittance = totalTransmittance * (1.0 - a);
          let exitT = max(obstacleHit.tExit, obstacleT);
          rayPos = rayPos + rayDir * (exitT + 0.001);
          continue;
        }
     }

     if (!surfaceInfo.foundSurface) {
        break; // No more surfaces — exit loop and sample environment
     }

     // Record first hit distance for depth output
     if (!hitFluid) {
       firstHitDist = length(surfaceInfo.pos - params.viewPos);
     }
     hitFluid = true;

     // Accumulate Beer–Lambert transmittance from density traversed
     totalTransmittance = totalTransmittance * transmittance(surfaceInfo.densityAlongRay);

     // If we hit the bottom of the container, stop refracting
     if (surfaceInfo.pos.y < params.minBounds.y + 0.05) {
        break;
     }

     // Compute surface normal from density gradient (central differences)
     var normal = calculateNormal(surfaceInfo.pos);
     // Ensure normal faces against the incoming ray
     if (dot(normal, rayDir) > 0.0) {
        normal = -normal;
     }

     // Determine IOR pair based on current medium:
     //   Travelling through fluid: iorA = fluid, iorB = air (exiting)
     //   Travelling through air:   iorA = air,   iorB = fluid (entering)
     // WGSL select(falseVal, trueVal, condition):
     let response = calculateReflectionAndRefraction(rayDir, normal, select(iorAir, iorFluid, travellingThroughFluid), select(iorFluid, iorAir, travellingThroughFluid));

     // Sun shadowing from obstacle/particles (shadow map) applied to surface lighting only.
     let ndotl = max(dot(normal, params.dirToSun), 0.0);
     let shadow = sampleShadow(surfaceInfo.pos, ndotl);
     let surfaceLighting = clamp(params.floorAmbient, 0.0, 1.0) + ndotl * shadow * (1.0 - clamp(params.floorAmbient, 0.0, 1.0));

     // --- Heuristic: which ray to trace? ---
     // Probe density along both directions to estimate which path
     // contributes more visible light (weighted by Fresnel coefficient).
     let densityRefract = calculateDensityForRefraction(surfaceInfo.pos, response.refractDir, densityStepSize);
     let densityReflect = calculateDensityForRefraction(surfaceInfo.pos, response.reflectDir, densityStepSize);

     let traceRefractedRay = (densityRefract * response.refractWeight) > (densityReflect * response.reflectWeight);

     // Toggle medium: if refracting, we cross the surface boundary
     travellingThroughFluid = (traceRefractedRay != travellingThroughFluid);

     if (traceRefractedRay) {
        // --- Follow refraction, add reflection contribution now ---
        let reflectLight = sampleEnvironment(surfaceInfo.pos, response.reflectDir) * surfaceLighting;
        let reflectTrans = transmittance(densityReflect);
        totalLight = totalLight + reflectLight * totalTransmittance * reflectTrans * response.reflectWeight;

        // Continue ray along refracted direction
        rayPos = surfaceInfo.pos;
        rayDir = response.refractDir;
        totalTransmittance = totalTransmittance * response.refractWeight;
     } else {
        // --- Follow reflection, add refraction contribution now ---
        let refractLight = sampleEnvironment(surfaceInfo.pos, response.refractDir) * surfaceLighting;
        let refractTrans = transmittance(densityRefract);
        totalLight = totalLight + refractLight * totalTransmittance * refractTrans * response.refractWeight;

        // Continue ray along reflected direction
        rayPos = surfaceInfo.pos;
        rayDir = response.reflectDir;
        totalTransmittance = totalTransmittance * response.reflectWeight;
     }
  }

  // -------------------------------------------------------------------------
  // Final Environment Sample
  // -------------------------------------------------------------------------

  // After all refraction bounces, sample the environment for the remaining ray
  // and apply the remaining transmittance through any fluid still in the path.
  let densityRemainder = calculateDensityForShadow(rayPos, rayDir, 1000.0);
  let finalBg = sampleEnvironment(rayPos, rayDir);
  totalLight = totalLight + finalBg * totalTransmittance * transmittance(densityRemainder);

  if (hitFluid) {
    let tint = mix(vec3<f32>(1.0), params.fluidColor, 0.5);
    totalLight = totalLight * tint;
  }

  // Apply exposure and output (linear space — blit pass handles sRGB conversion)
  let exposure = max(params.sceneExposure, 0.0);
  output.color = vec4<f32>(totalLight * exposure, 1.0);

  // Convert world-space hit distance to NDC depth [0, 1]
  // WebGPU uses reversed-Z by convention, but we use standard depth:
  // depth = far * (distance - near) / (distance * (far - near))
  // This gives 0 at near plane, 1 at far plane
  let near = 0.1;
  let far = 200.0;
  if (firstHitDist > 0.0) {
    // Clamp distance to valid range
    let d = clamp(firstHitDist, near, far);
    // Standard perspective depth formula for [0, 1] range
    output.depth = far * (d - near) / (d * (far - near));
  } else {
    // No hit - output far plane depth
    output.depth = 1.0;
  }

  return output;
}
