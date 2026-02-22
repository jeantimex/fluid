import{p as k,w as V,k as M,F as E,S as L,P as H,l as N,n as _}from"./picking_system-B3C-PV4U.js";import{s as q,a as W,b as Y}from"./splat_resolve-DUdQ_TmB.js";const Z=`// =============================================================================
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
//
// Beginner note: every pixel casts a ray through the density texture and
// accumulates color/opacity as it marches through the volume.
//   - **Procedural sky**: gradient from horizon to zenith with sun highlight
//
// ## Rendering Pipeline
//
// 1. Construct a ray from the camera through the pixel
// 2. For each refraction bounce (up to \`numRefractions\`):
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
  vpuX: f32,                         // 19
  maxBounds: vec3<f32>,              // 20-22
  vpuY: f32,                         // 23
  densityOffset: f32,                // 24
  densityMultiplier: f32,            // 25
  stepSize: f32,                     // 26
  vpuZ: f32,                         // 27
  aspect: f32,                       // 28
  fovY: f32,                         // 29
  maxSteps: f32,                     // 30
  tileScale: f32,                    // 31
  tileDarkOffset: f32,               // 32
  globalBrightness: f32,             // 33
  globalSaturation: f32,             // 34
  lightStepSize: f32,                // 35
  tileCol1: vec3<f32>,               // 36-38
  pad6: f32,                         // 39
  tileCol2: vec3<f32>,               // 40-42
  pad7: f32,                         // 43
  tileCol3: vec3<f32>,               // 44-46
  pad8: f32,                         // 47
  tileCol4: vec3<f32>,               // 48-50
  pad9: f32,                         // 51
  tileColVariation: vec3<f32>,       // 52-54
  pad11: f32,                        // 55
  dirToSun: vec3<f32>,               // 56-58
  pad10: f32,                        // 59
  extinctionCoefficients: vec3<f32>, // 60-62
  sunPower: f32,                     // 63
  floorY: f32,                       // 64
  indexOfRefraction: f32,            // 65
  numRefractions: f32,               // 66
  tileDarkFactor: f32,               // 67
  skyColorHorizon: vec3<f32>,        // 68-70
  floorAmbient: f32,                 // 71
  skyColorZenith: vec3<f32>,         // 72-74
  sceneExposure: f32,                // 75
  skyColorGround: vec3<f32>,         // 76-78
  pad12: f32,                        // 79
  floorSize: vec3<f32>,              // 80-82
  pad14: f32,                        // 83
  floorCenter: vec3<f32>,            // 84-86
  pad15: f32,                        // 87
  obstacleCenter: vec3<f32>,         // 88-90
  pad16: f32,                        // 91
  obstacleHalfSize: vec3<f32>,       // 92-94
  pad17: f32,                        // 95
  obstacleRotation: vec3<f32>,       // 96-98
  obstacleAlpha: f32,                // 99
  obstacleColor: vec3<f32>,          // 100-102
  shadowSoftness: f32,               // 103
  showFluidShadows: f32,             // 104
  obstacleShape: f32,                // 105
  pad19: f32,                        // 106
  pad20: f32,                        // 107
  pad21: vec4<f32>,                  // 108-111
  pad22: vec4<f32>,                  // 112-115
  pad23: vec4<f32>,                  // 116-119
  pad24: vec4<f32>,                  // 120-123
};


// =============================================================================
// Bindings
// =============================================================================

/// 3D density texture produced by the splat pipeline.
@group(0) @binding(0) var densityTex: texture_3d<f32>;

/// Trilinear sampler with clamp-to-edge addressing.
@group(0) @binding(1) var densitySampler: sampler;

#include "../../common/shaders/shadow_common.wgsl"

/// Uniform parameter buffer.
@group(0) @binding(2) var<uniform> params: RaymarchParams;

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

fn raySphereIntersection(origin: vec3<f32>, dir: vec3<f32>, center: vec3<f32>, radius: f32) -> vec2<f32> {
  let oc = origin - center;
  let b = dot(oc, dir);
  let c = dot(oc, oc) - radius * radius;
  let h = b * b - c;
  if (h < 0.0) {
    return vec2<f32>(1e9, -1e9);
  }
  let s = sqrt(h);
  return vec2<f32>(-b - s, -b + s);
}

/// Returns obstacle hit info for the OBB, or hit=false if no hit.
fn obstacleHitInfo(origin: vec3<f32>, dir: vec3<f32>) -> ObstacleHit {
  var res: ObstacleHit;
  res.hit = false;
  res.tEntry = -1.0;
  res.tExit = -1.0;
  res.normal = vec3<f32>(0.0);
  if (any(params.obstacleHalfSize <= vec3<f32>(0.0))) { return res; }

  if (params.obstacleShape > 0.5) {
    let radius = params.obstacleHalfSize.x;
    if (radius <= 0.0) { return res; }
    let hit = raySphereIntersection(origin, dir, params.obstacleCenter, radius);
    if (hit.y < max(hit.x, 0.0)) { return res; }
    let tEntry = select(hit.x, 0.0, hit.x < 0.0);
    let hitPos = origin + dir * tEntry;
    res.tEntry = tEntry;
    res.tExit = hit.y;
    res.normal = normalize(hitPos - params.obstacleCenter);
    res.hit = true;
    return res;
  }

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
  let worldToVoxel = vec3<f32>(params.vpuX, params.vpuY, params.vpuZ);
  let uvw = (pos - params.minBounds) * worldToVoxel / (volumeSizeF - vec3<f32>(1.0));
  return textureSampleLevel(densityTex, densitySampler, uvw, 0.0).r - params.densityOffset;
}

/// Samples the density texture with boundary clamping.
/// Returns -densityOffset for positions at or beyond the volume edges,
/// preventing edge artifacts where the texture wraps or clamps.
fn sampleDensity(pos: vec3<f32>) -> f32 {
  let volumeSizeF = vec3<f32>(textureDimensions(densityTex, 0));
  let worldToVoxel = vec3<f32>(params.vpuX, params.vpuY, params.vpuZ);
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

/// Returns the outward-facing normal of the closest AABB face to point \`p\`.
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

/// Estimates the fluid surface normal at \`pos\` using central differences
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

  let worldToVoxel = vec3<f32>(params.vpuX, params.vpuY, params.vpuZ);
  let volumeNormal = normalize(vec3<f32>(dx * worldToVoxel.x, dy * worldToVoxel.y, dz * worldToVoxel.z));

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
/// - \`origin\`: ray start position
/// - \`rayDir\`: normalized ray direction
/// - \`findNextFluidEntryPoint\`: if true, searches for re-entry into fluid;
///    if false, searches for the exit (fluid → air transition)
/// - \`rngState\`: random state for jittering the start position
/// - \`maxDst\`: maximum distance for density accumulation (for transmittance)
///
/// ## Algorithm
///
/// Steps along the ray at \`stepSize\` intervals. Tracks whether the ray has
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

fn envLinearToSrgb(color: vec3<f32>) -> vec3<f32> {
  return pow(color, vec3<f32>(1.0 / 2.2));
}

fn getTileColor(hitPos: vec3<f32>, params: RaymarchParams) -> vec3<f32> {
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
    var rngState = hashInt2(vec2<i32>(i32(tileCoord.x), i32(tileCoord.y)));
    let randomVariation = randomSNorm3(&rngState) * params.tileColVariation * 0.1;
    tileCol = tweakHsv(tileCol, randomVariation);
  }

  // Checkerboard pattern
  let isDarkTile = modulo(tileCoord.x, 2.0) == modulo(tileCoord.y, 2.0);
  if (isDarkTile) {
    tileCol = tweakHsv(tileCol, vec3<f32>(0.0, 0.0, params.tileDarkFactor));
  }
  
  return tileCol;
}

// =============================================================================
// Lighting & Shadows
// =============================================================================

/// Accumulates optical depth along a ray through the density volume.
/// Used for shadow rays (sun direction) and refraction density heuristics.
///
/// Steps at \`lightStepSize * 2\` intervals for performance, with an early
/// exit when optical depth exceeds 3.0 (fully opaque for practical purposes).
fn calculateDensityForShadow(rayPos: vec3<f32>, rayDir: vec3<f32>, maxDst: f32) -> f32 {
    let hit = rayBoxIntersection(rayPos, rayDir, params.minBounds, params.maxBounds);
    if (hit.y <= max(hit.x, 0.0)) { return 0.0; }

    let tStart = max(hit.x, 0.0);
    let tEnd = min(hit.y, maxDst);
    if (tStart >= tEnd) { return 0.0; }

    var opticalDepth = 0.0;
    let shadowStep = params.lightStepSize * (2.0 + params.shadowSoftness); 
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
  return exp(-opticalDepth * params.extinctionCoefficients);
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

      let tileCol = getTileColor(hitPos, params);

      var lighting = 1.0;
      if (params.showFluidShadows > 0.5) {
        // Volumetric shadow modulation
        let shadowDepth = calculateDensityForShadow(hitPos, params.dirToSun, 100.0);
        let shadowVol = transmittance(shadowDepth * 2.0);

        // Obstacle shadow
        var shadowScene = 1.0;
        let obsShadowHit = obstacleHitInfo(hitPos + params.dirToSun * 0.01, params.dirToSun);
        if (obsShadowHit.hit) {
          shadowScene = 0.2;
        }

        // lighting = Combine shadows with ambient to ensure tiles are never pitch black
        let ambient = clamp(params.floorAmbient, 0.0, 1.0);
        lighting = shadowVol.x * shadowScene * (1.0 - ambient) + ambient;
      }

      // Color adjustments
      var finalColor = tileCol * lighting * params.globalBrightness;

      let gray = dot(finalColor, vec3<f32>(0.299, 0.587, 0.114));
      finalColor = vec3<f32>(gray) + (finalColor - vec3<f32>(gray)) * params.globalSaturation;

      bgCol = finalColor;
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
    let hitPos = origin + dir * obstacleT;
    let a = clamp(params.obstacleAlpha, 0.0, 1.0);
    let ambient = clamp(params.floorAmbient, 0.0, 1.0);
    let sun = max(0.0, dot(obstacleHit.normal, params.dirToSun));

    var shadowFinal = 1.0;
    if (params.showFluidShadows > 0.5) {
      // Volumetric shadow
      let shadowDepth = calculateDensityForShadow(hitPos, params.dirToSun, 100.0);
      shadowFinal = transmittance(shadowDepth * 2.0).x;
    }

    let lit = params.obstacleColor * (ambient + sun * (1.0 - ambient) * shadowFinal);
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

          // Volumetric shadow
          let shadowDepth = calculateDensityForShadow(obsPos, params.dirToSun, 100.0);
          var shadowFinal = 1.0;
          if (params.showFluidShadows > 0.5) {
            shadowFinal = transmittance(shadowDepth * 2.0).x;
          }

          let lit = params.obstacleColor * (ambient + sun * (1.0 - ambient) * shadowFinal);
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

          // Volumetric shadow
          let shadowDepth2 = calculateDensityForShadow(obsPos, params.dirToSun, 100.0);
          var shadowFinal2 = 1.0;
          if (params.showFluidShadows > 0.5) {
            shadowFinal2 = transmittance(shadowDepth2 * 2.0).x;
          }

          let lit = params.obstacleColor * (ambient + sun * (1.0 - ambient) * shadowFinal2);
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

     // Indicies of refraction
     let iorA = select(iorAir, iorFluid, travellingThroughFluid);
     let iorB = select(iorFluid, iorAir, travellingThroughFluid);

     // Calculate reflection and refraction, and choose which path to follow
     let response = calculateReflectionAndRefraction(rayDir, normal, iorA, iorB);

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
        var reflectLight = sampleEnvironment(surfaceInfo.pos, response.reflectDir);
        let reflectTrans = transmittance(densityReflect);
        
        // Add obstacle shadow to reflected light if follow air ray
        if (!travellingThroughFluid && params.showFluidShadows > 0.5) {
           let obsShadow = obstacleHitInfo(surfaceInfo.pos + params.dirToSun * 0.01, params.dirToSun);
           if (obsShadow.hit) { reflectLight = reflectLight * 0.2; }
        }

        totalLight = totalLight + reflectLight * totalTransmittance * reflectTrans * response.reflectWeight;

        // Continue ray along refracted direction
        rayPos = surfaceInfo.pos;
        rayDir = response.refractDir;
        totalTransmittance = totalTransmittance * response.refractWeight;
     } else {
        // --- Follow reflection, add refraction contribution now ---
        var refractLight = sampleEnvironment(surfaceInfo.pos, response.refractDir);
        let refractTrans = transmittance(densityRefract);

        // Add obstacle shadow to refracted light if follow air ray
        if (!travellingThroughFluid && params.showFluidShadows > 0.5) {
           let obsShadow = obstacleHitInfo(surfaceInfo.pos + params.dirToSun * 0.01, params.dirToSun);
           if (obsShadow.hit) { refractLight = refractLight * 0.2; }
        }

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
  var finalBg = sampleEnvironment(rayPos, rayDir);
  
  // Final shadow check for air-path rays
  if (!travellingThroughFluid && params.showFluidShadows > 0.5) {
     let finalShadow = obstacleHitInfo(rayPos + params.dirToSun * 0.01, params.dirToSun);
     if (finalShadow.hit) { finalBg = finalBg * 0.2; }
  }

  totalLight = totalLight + finalBg * totalTransmittance * transmittance(densityRemainder);

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
`,X=`// =============================================================================
// Blit Shader — Full-Screen Upscale
// =============================================================================
//
// Samples the half-resolution offscreen texture produced by the raymarch pass
// and writes it to the full-resolution swap chain.
//
// Vertex stage: generates a single oversized triangle that covers the entire
// viewport using the standard "fullscreen triangle" trick (vertex indices 0–2
// produce clip-space positions that fully cover the [-1, 1] NDC range).
//
// Fragment stage: samples the offscreen texture with bilinear filtering
//
// Beginner note: this is a simple post-process pass (copy + color conversion).
// and outputs directly to the swap chain. This keeps the color path
// consistent with the particle renderer (no extra conversion here).
// =============================================================================

/// Half-resolution offscreen texture from the raymarch pass.
@group(0) @binding(0) var blitTexture: texture_2d<f32>;

/// Bilinear sampler for smooth upscaling.
@group(0) @binding(1) var blitSampler: sampler;

/// Vertex-to-fragment interpolants.
struct VSOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

/// Generates a full-screen triangle from 3 vertex indices.
/// Vertex 0 → (-1, -1), Vertex 1 → (3, -1), Vertex 2 → (-1, 3)
/// UV coordinates map [0,1]² over the visible portion.
@vertex fn vs_main(@builtin(vertex_index) i: u32) -> VSOut {
  // Fullscreen triangle: 3 vertices cover the entire screen
  let x = f32(i32(i) / 2) * 4.0 - 1.0;
  let y = f32(i32(i) % 2) * 4.0 - 1.0;
  var out: VSOut;
  out.position = vec4<f32>(x, y, 0.0, 1.0);
  out.uv = vec2<f32>((x + 1.0) * 0.5, (1.0 - y) * 0.5);
  return out;
}

/// Samples the offscreen texture and outputs it directly.
@fragment fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  let color = textureSample(blitTexture, blitSampler, in.uv);
  return color;
}
`;class j{device;canvas;format;pipeline;uniformBuffer;sampler;bindGroup;uniformData=new Float32Array(124);blitPipeline;blitBindGroup;blitSampler;offscreenTexture;offscreenTextureView;offscreenDepthTexture;offscreenWidth=0;offscreenHeight=0;wireframePipeline;wireframeBindGroup;wireframeUniformBuffer;wireframeVertexBuffer;wireframeVertexData;constructor(t,n,r){this.device=t,this.canvas=n,this.format=r;const e=k(Z,{"../../common/shaders/shadow_common.wgsl":M}),a=t.createShaderModule({code:e});this.pipeline=t.createRenderPipeline({layout:"auto",vertex:{module:a,entryPoint:"vs_main"},fragment:{module:a,entryPoint:"fs_main",targets:[{format:r}]},primitive:{topology:"triangle-list",cullMode:"none"},depthStencil:{format:"depth24plus",depthWriteEnabled:!0,depthCompare:"always"}});const i=t.createShaderModule({code:X});this.blitPipeline=t.createRenderPipeline({layout:"auto",vertex:{module:i,entryPoint:"vs_main"},fragment:{module:i,entryPoint:"fs_main",targets:[{format:r}]},primitive:{topology:"triangle-list",cullMode:"none"}}),this.blitSampler=t.createSampler({magFilter:"linear",minFilter:"linear"}),this.uniformBuffer=this.device.createBuffer({size:this.uniformData.byteLength,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.sampler=t.createSampler({addressModeU:"clamp-to-edge",addressModeV:"clamp-to-edge",addressModeW:"clamp-to-edge",magFilter:"linear",minFilter:"linear"});const s=t.createShaderModule({code:V});this.wireframePipeline=t.createRenderPipeline({layout:"auto",vertex:{module:s,entryPoint:"vs_main",buffers:[{arrayStride:28,attributes:[{shaderLocation:0,offset:0,format:"float32x3"},{shaderLocation:1,offset:12,format:"float32x4"}]}]},fragment:{module:s,entryPoint:"fs_main",targets:[{format:r}]},primitive:{topology:"line-list"},depthStencil:{format:"depth24plus",depthWriteEnabled:!0,depthCompare:"less"}}),this.wireframeUniformBuffer=t.createBuffer({size:96,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.wireframeVertexData=new Float32Array(168),this.wireframeVertexBuffer=t.createBuffer({size:this.wireframeVertexData.byteLength,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST}),this.wireframeBindGroup=t.createBindGroup({layout:this.wireframePipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.wireframeUniformBuffer}}]})}createBindGroup(t){this.bindGroup=this.device.createBindGroup({layout:this.pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:t},{binding:1,resource:this.sampler},{binding:2,resource:{buffer:this.uniformBuffer}}]})}ensureOffscreenTexture(t,n,r){const e=Math.max(1,Math.floor(t*r)),a=Math.max(1,Math.floor(n*r));e===this.offscreenWidth&&a===this.offscreenHeight||(this.offscreenTexture&&this.offscreenTexture.destroy(),this.offscreenDepthTexture&&this.offscreenDepthTexture.destroy(),this.offscreenWidth=e,this.offscreenHeight=a,this.offscreenTexture=this.device.createTexture({size:{width:e,height:a},format:this.format,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING}),this.offscreenTextureView=this.offscreenTexture.createView(),this.offscreenDepthTexture=this.device.createTexture({size:{width:e,height:a},format:"depth24plus",usage:GPUTextureUsage.RENDER_ATTACHMENT}),this.blitBindGroup=this.device.createBindGroup({layout:this.blitPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:this.offscreenTextureView},{binding:1,resource:this.blitSampler}]}))}buildBoundsWireframe(t,n){const r=n.x*.5,e=n.y*.5,a=n.z*.5,i=e-5,s=t.boundsWireframeColor??{r:1,g:1,b:1},o=[[-r,i-e,-a],[+r,i-e,-a],[+r,i+e,-a],[-r,i+e,-a],[-r,i-e,+a],[+r,i-e,+a],[+r,i+e,+a],[-r,i+e,+a]],l=[[0,1],[1,5],[5,4],[4,0],[3,2],[2,6],[6,7],[7,3],[0,3],[1,2],[5,6],[4,7]];let f=0;const u=h=>{const c=o[h];this.wireframeVertexData[f++]=c[0],this.wireframeVertexData[f++]=c[1],this.wireframeVertexData[f++]=c[2],this.wireframeVertexData[f++]=s.r,this.wireframeVertexData[f++]=s.g,this.wireframeVertexData[f++]=s.b,this.wireframeVertexData[f++]=1};for(const[h,c]of l)u(h),u(c);return 24}render(t,n,r,e,a,i){const s=i??e.boundsSize;this.ensureOffscreenTexture(this.canvas.width,this.canvas.height,e.renderScale);const o=r.basis,l=r.position,f=this.canvas.width/this.canvas.height,u=Math.PI/3;this.uniformData[0]=l.x,this.uniformData[1]=l.y,this.uniformData[2]=l.z,this.uniformData[3]=0,this.uniformData[4]=o.right.x,this.uniformData[5]=o.right.y,this.uniformData[6]=o.right.z,this.uniformData[7]=0,this.uniformData[8]=o.up.x,this.uniformData[9]=o.up.y,this.uniformData[10]=o.up.z,this.uniformData[11]=0,this.uniformData[12]=o.forward.x,this.uniformData[13]=o.forward.y,this.uniformData[14]=o.forward.z,this.uniformData[15]=0;const h=s.x*.5,c=s.z*.5,m=-5,g=(a.x-1)/s.x,d=(a.y-1)/s.y,v=(a.z-1)/s.z;this.uniformData[16]=-h,this.uniformData[17]=m,this.uniformData[18]=-c,this.uniformData[19]=g,this.uniformData[20]=h,this.uniformData[21]=m+s.y,this.uniformData[22]=c,this.uniformData[23]=d,this.uniformData[24]=e.densityOffset,this.uniformData[25]=e.densityMultiplier/1e3,this.uniformData[26]=e.stepSize,this.uniformData[27]=v,this.uniformData[28]=f,this.uniformData[29]=u,this.uniformData[30]=e.maxSteps,this.uniformData[31]=e.tileScale,this.uniformData[32]=e.tileDarkOffset,this.uniformData[33]=e.globalBrightness,this.uniformData[34]=e.globalSaturation,this.uniformData[35]=e.lightStepSize,this.uniformData[36]=e.tileCol1.r,this.uniformData[37]=e.tileCol1.g,this.uniformData[38]=e.tileCol1.b,this.uniformData[39]=0,this.uniformData[40]=e.tileCol2.r,this.uniformData[41]=e.tileCol2.g,this.uniformData[42]=e.tileCol2.b,this.uniformData[43]=0,this.uniformData[44]=e.tileCol3.r,this.uniformData[45]=e.tileCol3.g,this.uniformData[46]=e.tileCol3.b,this.uniformData[47]=0,this.uniformData[48]=e.tileCol4.r,this.uniformData[49]=e.tileCol4.g,this.uniformData[50]=e.tileCol4.b,this.uniformData[51]=0,this.uniformData[52]=e.tileColVariation.x,this.uniformData[53]=e.tileColVariation.y,this.uniformData[54]=e.tileColVariation.z,this.uniformData[55]=0,this.uniformData[56]=e.dirToSun.x,this.uniformData[57]=e.dirToSun.y,this.uniformData[58]=e.dirToSun.z,this.uniformData[59]=0,this.uniformData[60]=e.extinctionCoefficients.x,this.uniformData[61]=e.extinctionCoefficients.y,this.uniformData[62]=e.extinctionCoefficients.z,this.uniformData[63]=e.sunPower,this.uniformData[64]=e.floorCenter.y+e.floorSize.y*.5,this.uniformData[65]=e.indexOfRefraction,this.uniformData[66]=e.numRefractions,this.uniformData[67]=e.tileDarkFactor,this.uniformData[68]=e.skyColorHorizon.r,this.uniformData[69]=e.skyColorHorizon.g,this.uniformData[70]=e.skyColorHorizon.b,this.uniformData[71]=e.floorAmbient,this.uniformData[72]=e.skyColorZenith.r,this.uniformData[73]=e.skyColorZenith.g,this.uniformData[74]=e.skyColorZenith.b,this.uniformData[75]=e.sceneExposure,this.uniformData[76]=e.skyColorGround.r,this.uniformData[77]=e.skyColorGround.g,this.uniformData[78]=e.skyColorGround.b,this.uniformData[79]=0,this.uniformData[80]=e.floorSize.x,this.uniformData[81]=e.floorSize.y,this.uniformData[82]=e.floorSize.z,this.uniformData[83]=0,this.uniformData[84]=e.floorCenter.x,this.uniformData[85]=e.floorCenter.y,this.uniformData[86]=e.floorCenter.z,this.uniformData[87]=0;const x=e.showObstacle!==!1,p=(e.obstacleShape??"box")==="sphere",D=e.obstacleRadius??0;this.uniformData[88]=e.obstacleCentre.x,this.uniformData[89]=p?e.obstacleCentre.y:e.obstacleCentre.y+e.obstacleSize.y*.5,this.uniformData[90]=e.obstacleCentre.z,this.uniformData[91]=0,this.uniformData[92]=x?p?D:e.obstacleSize.x*.5:0,this.uniformData[93]=x?p?D:e.obstacleSize.y*.5:0,this.uniformData[94]=x?p?D:e.obstacleSize.z*.5:0,this.uniformData[95]=0,this.uniformData[96]=e.obstacleRotation.x,this.uniformData[97]=e.obstacleRotation.y,this.uniformData[98]=e.obstacleRotation.z,this.uniformData[99]=x?e.obstacleAlpha:0,this.uniformData[100]=e.obstacleColor.r,this.uniformData[101]=e.obstacleColor.g,this.uniformData[102]=e.obstacleColor.b,this.uniformData[103]=e.shadowSoftness,this.uniformData[104]=e.showFluidShadows?1:0,this.uniformData[105]=p?1:0,this.uniformData[106]=0,this.uniformData[107]=0,this.device.queue.writeBuffer(this.uniformBuffer,0,this.uniformData);const y=t.beginRenderPass({colorAttachments:[{view:this.offscreenTextureView,loadOp:"clear",storeOp:"store",clearValue:{r:.03,g:.05,b:.08,a:1}}],depthStencilAttachment:{view:this.offscreenDepthTexture.createView(),depthClearValue:1,depthLoadOp:"clear",depthStoreOp:"store"}});if(y.setViewport(0,0,this.offscreenWidth,this.offscreenHeight,0,1),y.setPipeline(this.pipeline),y.setBindGroup(0,this.bindGroup),y.draw(3,1,0,0),y.end(),e.showBoundsWireframe){const z=this.buildBoundsWireframe(e,s);this.device.queue.writeBuffer(this.wireframeVertexBuffer,0,this.wireframeVertexData.buffer,0,z*7*4);const F=r.viewMatrix,P=new Float32Array(16),A=Math.tan(u*.5),O=.1,R=200;P[0]=1/(f*A),P[5]=1/A,P[10]=-R/(R-O),P[11]=-1,P[14]=-20/(R-O);const I=new Float32Array(16);for(let B=0;B<4;B++)for(let T=0;T<4;T++){let G=0;for(let C=0;C<4;C++)G+=P[B+C*4]*F[C+T*4];I[B+T*4]=G}this.device.queue.writeBuffer(this.wireframeUniformBuffer,0,I);const S=t.beginRenderPass({colorAttachments:[{view:this.offscreenTextureView,loadOp:"load",storeOp:"store"}],depthStencilAttachment:{view:this.offscreenDepthTexture.createView(),depthLoadOp:"load",depthStoreOp:"store"}});S.setViewport(0,0,this.offscreenWidth,this.offscreenHeight,0,1),S.setPipeline(this.wireframePipeline),S.setBindGroup(0,this.wireframeBindGroup),S.setVertexBuffer(0,this.wireframeVertexBuffer,0),S.draw(z),S.end()}const b=t.beginRenderPass({colorAttachments:[{view:n,loadOp:"clear",storeOp:"store",clearValue:{r:.03,g:.05,b:.08,a:1}}]});b.setPipeline(this.blitPipeline),b.setBindGroup(0,this.blitBindGroup),b.draw(3,1,0,0),b.end()}}class K{device;clearPipeline;particlesPipeline;resolvePipeline;clearBindGroup;particlesBindGroup;resolveBindGroup;clearParamsBuffer;particlesParamsBuffer;resolveParamsBuffer;particlesParamsData;particlesParamsF32;particlesParamsU32;resolveParamsData;resolveParamsF32;resolveParamsU32;atomicDensityBuffer;densityTexture;_densityTextureView;densityTextureSize={x:1,y:1,z:1};densityWorkgroupSize={x:8,y:8,z:4};constructor(t){this.device=t;const n=t.createShaderModule({code:q});this.clearPipeline=t.createComputePipeline({layout:"auto",compute:{module:n,entryPoint:"main"}}),this.clearParamsBuffer=t.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});const r=t.createShaderModule({code:W});this.particlesPipeline=t.createComputePipeline({layout:"auto",compute:{module:r,entryPoint:"main"}}),this.particlesParamsData=new ArrayBuffer(64),this.particlesParamsF32=new Float32Array(this.particlesParamsData),this.particlesParamsU32=new Uint32Array(this.particlesParamsData),this.particlesParamsBuffer=t.createBuffer({size:64,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});const e=t.createShaderModule({code:Y});this.resolvePipeline=t.createComputePipeline({layout:"auto",compute:{module:e,entryPoint:"main"}}),this.resolveParamsData=new ArrayBuffer(32),this.resolveParamsF32=new Float32Array(this.resolveParamsData),this.resolveParamsU32=new Uint32Array(this.resolveParamsData),this.resolveParamsBuffer=t.createBuffer({size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST})}get textureView(){return this._densityTextureView}get textureSize(){return this.densityTextureSize}recreate(t,n){this.densityTexture&&this.densityTexture.destroy(),this.createDensityTexture(t),this.createAtomicDensityBuffer(),this.createBindGroups(n)}dispatch(t,n,r,e){this.updateParams(n,r,e);const a=this.densityTextureSize.x*this.densityTextureSize.y*this.densityTextureSize.z,i=t.beginComputePass();i.setPipeline(this.clearPipeline),i.setBindGroup(0,this.clearBindGroup),i.dispatchWorkgroups(Math.ceil(a/256)),i.end();const s=t.beginComputePass();s.setPipeline(this.particlesPipeline),s.setBindGroup(0,this.particlesBindGroup),s.dispatchWorkgroups(Math.ceil(n/256)),s.end();const o=t.beginComputePass();o.setPipeline(this.resolvePipeline),o.setBindGroup(0,this.resolveBindGroup),o.dispatchWorkgroups(Math.ceil(this.densityTextureSize.x/this.densityWorkgroupSize.x),Math.ceil(this.densityTextureSize.y/this.densityWorkgroupSize.y),Math.ceil(this.densityTextureSize.z/this.densityWorkgroupSize.z)),o.end()}destroy(){this.densityTexture&&this.densityTexture.destroy(),this.atomicDensityBuffer&&this.atomicDensityBuffer.destroy()}createDensityTexture(t){const n=t.boundsSize,r=Math.max(n.x,n.y,n.z),e=Math.max(1,Math.round(t.densityTextureRes)),a=Math.max(1,Math.round(n.x/r*e))+1,i=Math.max(1,Math.round(n.y/r*e))+1,s=Math.max(1,Math.round(n.z/r*e))+1;this.densityTextureSize={x:a,y:i,z:s},this.densityTexture=this.device.createTexture({size:{width:a,height:i,depthOrArrayLayers:s},dimension:"3d",format:"rgba16float",usage:GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_SRC}),this._densityTextureView=this.densityTexture.createView({dimension:"3d"})}createAtomicDensityBuffer(){this.atomicDensityBuffer&&this.atomicDensityBuffer.destroy();const t=this.densityTextureSize.x*this.densityTextureSize.y*this.densityTextureSize.z;this.atomicDensityBuffer=this.device.createBuffer({size:t*4,usage:GPUBufferUsage.STORAGE})}createBindGroups(t){this.clearBindGroup=this.device.createBindGroup({layout:this.clearPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.atomicDensityBuffer}},{binding:1,resource:{buffer:this.clearParamsBuffer}}]}),this.particlesBindGroup=this.device.createBindGroup({layout:this.particlesPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:t}},{binding:1,resource:{buffer:this.atomicDensityBuffer}},{binding:2,resource:{buffer:this.particlesParamsBuffer}}]}),this.resolveBindGroup=this.device.createBindGroup({layout:this.resolvePipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.atomicDensityBuffer}},{binding:1,resource:this._densityTextureView},{binding:2,resource:{buffer:this.resolveParamsBuffer}}]})}updateParams(t,n,r){const e=r??n.boundsSize,a=n.smoothingRadius,i=15/(2*Math.PI*Math.pow(a,5)),s=1e3,o=this.densityTextureSize.x*this.densityTextureSize.y*this.densityTextureSize.z,l=new Uint32Array(4);l[0]=o,this.device.queue.writeBuffer(this.clearParamsBuffer,0,l);const f=e.x*.5,u=e.z*.5,h=-5,c=(this.densityTextureSize.x-1)/e.x,m=(this.densityTextureSize.y-1)/e.y,g=(this.densityTextureSize.z-1)/e.z;this.particlesParamsF32[0]=a,this.particlesParamsF32[1]=i,this.particlesParamsU32[2]=t,this.particlesParamsF32[3]=s,this.particlesParamsF32[4]=-f,this.particlesParamsF32[5]=h,this.particlesParamsF32[6]=-u,this.particlesParamsF32[7]=c,this.particlesParamsF32[8]=f,this.particlesParamsF32[9]=h+e.y,this.particlesParamsF32[10]=u,this.particlesParamsF32[11]=m,this.particlesParamsU32[12]=this.densityTextureSize.x,this.particlesParamsU32[13]=this.densityTextureSize.y,this.particlesParamsU32[14]=this.densityTextureSize.z,this.particlesParamsF32[15]=g,this.device.queue.writeBuffer(this.particlesParamsBuffer,0,this.particlesParamsData),this.resolveParamsF32[0]=s,this.resolveParamsF32[1]=0,this.resolveParamsF32[2]=0,this.resolveParamsF32[3]=0,this.resolveParamsU32[4]=this.densityTextureSize.x,this.resolveParamsU32[5]=this.densityTextureSize.y,this.resolveParamsU32[6]=this.densityTextureSize.z,this.resolveParamsU32[7]=0,this.device.queue.writeBuffer(this.resolveParamsBuffer,0,this.resolveParamsData)}}class ${device;context;config;buffers;physics;grid;splatPipeline;renderer;pickingSystem;state;gridRes={x:0,y:0,z:0};gridTotalCells=0;isPicking=!1;interactionPos={x:0,y:0,z:0};smoothBoundsSize={x:0,y:0,z:0};physicsUniforms;gridUniforms;computeData=new Float32Array(8);integrateData=new Float32Array(24);hashParamsData=new Float32Array(8);sortParamsData=new Uint32Array(8);scanParamsDataL0=new Uint32Array(4);scanParamsDataL1=new Uint32Array(4);scanParamsDataL2=new Uint32Array(4);densityParamsData=new Float32Array(12);pressureParamsData=new Float32Array(16);viscosityParamsData=new Float32Array(12);constructor(t,n,r,e,a,i=!1,s=!1){this.device=t,this.context=n,this.config=e,this.physics=new E(t,s),this.grid=new L(t,i),this.splatPipeline=new K(t),this.renderer=new j(t,r,a),this.pickingSystem=new H(t),this.physicsUniforms={external:t.createBuffer({size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),density:t.createBuffer({size:48,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),pressure:t.createBuffer({size:64,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),viscosity:t.createBuffer({size:48,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),integrate:t.createBuffer({size:96,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST})},this.gridUniforms={hash:t.createBuffer({size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),sort:t.createBuffer({size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),scanL0:t.createBuffer({size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),scanL1:t.createBuffer({size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),scanL2:t.createBuffer({size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST})},this.reset()}get particleCount(){return this.buffers.particleCount}get simulationState(){return this.state}reset(){this.buffers&&this.buffers.destroy();const{boundsSize:t,smoothingRadius:n}=this.config;this.smoothBoundsSize.x=t.x,this.smoothBoundsSize.y=t.y,this.smoothBoundsSize.z=t.z;const r=50;this.gridRes={x:Math.ceil(Math.max(t.x,r)/n),y:Math.ceil(Math.max(t.y,r)/n),z:Math.ceil(Math.max(t.z,r)/n)},this.gridTotalCells=this.gridRes.x*this.gridRes.y*this.gridRes.z;const e=N(this.config);this.state=this.createStateFromSpawn(e),this.buffers=new _(this.device,e,{gridTotalCells:this.gridTotalCells}),this.physics.createBindGroups(this.buffers,this.physicsUniforms),this.grid.createBindGroups(this.buffers,this.gridUniforms),this.splatPipeline.recreate(this.config,this.buffers.predicted),this.renderer.createBindGroup(this.splatPipeline.textureView),this.pickingSystem.createBindGroup(this.buffers.positions);const a=this.device.createCommandEncoder();this.splatPipeline.dispatch(a,this.buffers.particleCount,this.config),this.device.queue.submit([a.finish()])}createStateFromSpawn(t){return{positions:t.positions,predicted:new Float32Array(t.positions),velocities:t.velocities,densities:new Float32Array(t.count*2),keys:new Uint32Array(t.count),sortedKeys:new Uint32Array(t.count),indices:new Uint32Array(t.count),sortOffsets:new Uint32Array(t.count),spatialOffsets:new Uint32Array(t.count),positionsSorted:new Float32Array(t.count*4),predictedSorted:new Float32Array(t.count*4),velocitiesSorted:new Float32Array(t.count*4),count:t.count,input:{worldX:0,worldY:0,worldZ:0,pull:!1,push:!1}}}async step(t){const{config:n,buffers:r,device:e}=this,a=.1;this.smoothBoundsSize.x+=(n.boundsSize.x-this.smoothBoundsSize.x)*a,this.smoothBoundsSize.y+=(n.boundsSize.y-this.smoothBoundsSize.y)*a,this.smoothBoundsSize.z+=(n.boundsSize.z-this.smoothBoundsSize.z)*a;const i=n.maxTimestepFPS?1/n.maxTimestepFPS:Number.POSITIVE_INFINITY,o=Math.min(t*n.timeScale,i)/n.iterationsPerFrame;this.updateUniforms(o);const l=e.createCommandEncoder();let f=!1;!this.isPicking&&this.state.input.rayOrigin&&this.state.input.rayDir&&(this.isPicking=!0,f=!0,this.pickingSystem.dispatch(l,this.state.input.rayOrigin,this.state.input.rayDir,n.smoothingRadius,r.particleCount));const u=l.beginComputePass();for(let c=0;c<n.iterationsPerFrame;c++)this.physics.step(u,this.grid,r.particleCount,this.gridTotalCells,n.viscosityStrength>0);u.end(),this.splatPipeline.dispatch(l,r.particleCount,n,this.smoothBoundsSize),e.queue.submit([l.finish()]),f&&this.pickingSystem.getResult().then(c=>{if(c&&c.hit){let m=c.hitPos.x,g=c.hitPos.y,d=c.hitPos.z;this.state.input.pull&&this.state.input.rayDir&&(m+=this.state.input.rayDir.x*.5,g+=this.state.input.rayDir.y*.5,d+=this.state.input.rayDir.z*.5),this.state.input.worldX=m,this.state.input.worldY=g,this.state.input.worldZ=d,this.state.input.isHoveringFluid=!0}else this.state.input.isHoveringFluid=!1;this.isPicking=!1});const h=.15;this.interactionPos.x+=(this.state.input.worldX-this.interactionPos.x)*h,this.interactionPos.y+=(this.state.input.worldY-this.interactionPos.y)*h,this.interactionPos.z+=(this.state.input.worldZ-this.interactionPos.z)*h}updateUniforms(t){const{config:n,state:r,buffers:e,device:a}=this;let i=0;r.input.push?i=-n.interactionStrength:r.input.pull&&(i=n.interactionStrength),this.computeData[0]=t,this.computeData[1]=n.gravity,this.computeData[2]=n.interactionRadius,this.computeData[3]=i,this.computeData[4]=this.interactionPos.x,this.computeData[5]=this.interactionPos.y,this.computeData[6]=this.interactionPos.z,this.computeData[7]=0,a.queue.writeBuffer(this.physicsUniforms.external,0,this.computeData),this.hashParamsData[0]=n.smoothingRadius,this.hashParamsData[1]=e.particleCount,this.hashParamsData[2]=-this.smoothBoundsSize.x*.5,this.hashParamsData[3]=-5,this.hashParamsData[4]=-this.smoothBoundsSize.z*.5,this.hashParamsData[5]=this.gridRes.x,this.hashParamsData[6]=this.gridRes.y,this.hashParamsData[7]=this.gridRes.z,a.queue.writeBuffer(this.gridUniforms.hash,0,this.hashParamsData),this.sortParamsData[0]=e.particleCount,this.sortParamsData[1]=this.gridTotalCells,a.queue.writeBuffer(this.gridUniforms.sort,0,this.sortParamsData);const s=Math.ceil((this.gridTotalCells+1)/512),o=Math.ceil(s/512);this.scanParamsDataL0[0]=this.gridTotalCells+1,this.scanParamsDataL1[0]=s,this.scanParamsDataL2[0]=o,a.queue.writeBuffer(this.gridUniforms.scanL0,0,this.scanParamsDataL0),a.queue.writeBuffer(this.gridUniforms.scanL1,0,this.scanParamsDataL1),a.queue.writeBuffer(this.gridUniforms.scanL2,0,this.scanParamsDataL2);const l=n.smoothingRadius,f=15/(2*Math.PI*Math.pow(l,5)),u=15/(Math.PI*Math.pow(l,6));this.densityParamsData[0]=l,this.densityParamsData[1]=f,this.densityParamsData[2]=u,this.densityParamsData[3]=e.particleCount,this.densityParamsData[4]=-this.smoothBoundsSize.x*.5,this.densityParamsData[5]=-5,this.densityParamsData[6]=-this.smoothBoundsSize.z*.5,this.densityParamsData[7]=0,this.densityParamsData[8]=this.gridRes.x,this.densityParamsData[9]=this.gridRes.y,this.densityParamsData[10]=this.gridRes.z,this.densityParamsData[11]=0,a.queue.writeBuffer(this.physicsUniforms.density,0,this.densityParamsData);const h=15/(Math.PI*Math.pow(l,5)),c=45/(Math.PI*Math.pow(l,6));this.pressureParamsData[0]=t,this.pressureParamsData[1]=n.targetDensity,this.pressureParamsData[2]=n.pressureMultiplier,this.pressureParamsData[3]=n.nearPressureMultiplier,this.pressureParamsData[4]=l,this.pressureParamsData[5]=h,this.pressureParamsData[6]=c,this.pressureParamsData[7]=e.particleCount,this.pressureParamsData[8]=-this.smoothBoundsSize.x*.5,this.pressureParamsData[9]=-5,this.pressureParamsData[10]=-this.smoothBoundsSize.z*.5,this.pressureParamsData[11]=0,this.pressureParamsData[12]=this.gridRes.x,this.pressureParamsData[13]=this.gridRes.y,this.pressureParamsData[14]=this.gridRes.z,this.pressureParamsData[15]=0,a.queue.writeBuffer(this.physicsUniforms.pressure,0,this.pressureParamsData);const m=315/(64*Math.PI*Math.pow(l,9));this.viscosityParamsData[0]=t,this.viscosityParamsData[1]=n.viscosityStrength,this.viscosityParamsData[2]=l,this.viscosityParamsData[3]=m,this.viscosityParamsData[4]=e.particleCount,this.viscosityParamsData[5]=-this.smoothBoundsSize.x*.5,this.viscosityParamsData[6]=-5,this.viscosityParamsData[7]=-this.smoothBoundsSize.z*.5,this.viscosityParamsData[8]=this.gridRes.x,this.viscosityParamsData[9]=this.gridRes.y,this.viscosityParamsData[10]=this.gridRes.z,this.viscosityParamsData[11]=0,a.queue.writeBuffer(this.physicsUniforms.viscosity,0,this.viscosityParamsData),this.integrateData[0]=t,this.integrateData[1]=n.collisionDamping;const d=(n.obstacleShape??"box")==="sphere",v=n.obstacleRadius??0,x=n.showObstacle!==!1&&(d?v>0:n.obstacleSize.x>0&&n.obstacleSize.y>0&&n.obstacleSize.z>0);this.integrateData[2]=x?1:0,this.integrateData[3]=d?1:0;const w=this.smoothBoundsSize,p=w.x*.5,D=w.z*.5,y=-5;this.integrateData[4]=-p,this.integrateData[5]=y,this.integrateData[6]=-D,this.integrateData[8]=p,this.integrateData[9]=y+w.y,this.integrateData[10]=D,this.integrateData[12]=n.obstacleCentre.x,this.integrateData[13]=d?n.obstacleCentre.y:n.obstacleCentre.y+n.obstacleSize.y*.5,this.integrateData[14]=n.obstacleCentre.z;const b=d?v:n.obstacleSize.x*.5,z=d?v:n.obstacleSize.y*.5,F=d?v:n.obstacleSize.z*.5;this.integrateData[16]=b,this.integrateData[17]=z,this.integrateData[18]=F,this.integrateData[20]=n.obstacleRotation.x,this.integrateData[21]=n.obstacleRotation.y,this.integrateData[22]=n.obstacleRotation.z,a.queue.writeBuffer(this.physicsUniforms.integrate,0,this.integrateData)}render(t){const n=this.device.createCommandEncoder();this.renderer.render(n,this.context.getCurrentTexture().createView(),t,this.config,this.splatPipeline.textureSize,this.smoothBoundsSize),this.device.queue.submit([n.finish()])}}export{$ as F};
