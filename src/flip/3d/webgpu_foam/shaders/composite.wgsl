// =============================================================================
// COMPOSITE SHADING PASS
// =============================================================================
//
// This fullscreen pass produces the final rendered image by combining:
// - Fluid surface/particles (from G-buffer data)
// - Shadow mapping (directional light shadows)
// - Ambient occlusion (from AO pass)
// - Procedural floor with checkerboard tiles
// - Procedural sky gradient with sun
// =============================================================================

struct Uniforms {
  inverseViewMatrix: mat4x4<f32>,
  lightProjectionViewMatrix: mat4x4<f32>,
  resolution: vec2<f32>,
  fov: f32,
  shadowResolution: f32,
  cameraPos: vec3<f32>,
  _pad0: f32,
  dirToSun: vec3<f32>,
  floorY: f32,
  skyColorHorizon: vec3<f32>,
  sunPower: f32,
  skyColorZenith: vec3<f32>,
  sunBrightness: f32,
  skyColorGround: vec3<f32>,
  floorSize: f32,
  tileCol1: vec3<f32>,
  tileScale: f32,
  tileCol2: vec3<f32>,
  tileDarkFactor: f32,
  tileCol3: vec3<f32>,
  _pad1: f32,
  tileCol4: vec3<f32>,
  _pad2: f32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var gBufferTex: texture_2d<f32>;
@group(0) @binding(2) var occlusionTex: texture_2d<f32>;
@group(0) @binding(3) var shadowTex: texture_depth_2d;
@group(0) @binding(4) var linearSamp: sampler;
@group(0) @binding(5) var shadowSamp: sampler_comparison;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  var pos = array<vec2<f32>, 4>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(1.0, -1.0),
    vec2<f32>(-1.0, 1.0),
    vec2<f32>(1.0, 1.0)
  );
  var out: VertexOutput;
  out.position = vec4<f32>(pos[vertexIndex], 0.0, 1.0);
  out.uv = vec2<f32>(pos[vertexIndex].x * 0.5 + 0.5, 0.5 - pos[vertexIndex].y * 0.5);
  return out;
}

fn hsvToRGB(c: vec3<f32>) -> vec3<f32> {
  let K = vec4<f32>(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  let p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, vec3<f32>(0.0), vec3<f32>(1.0)), c.y);
}

fn rgbToHsv(rgb: vec3<f32>) -> vec3<f32> {
  let K = vec4<f32>(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  let p = select(vec4<f32>(rgb.gb, K.xy), vec4<f32>(rgb.bg, K.wz), rgb.g < rgb.b);
  let q = select(vec4<f32>(rgb.r, p.yzx), vec4<f32>(p.xyw, rgb.r), rgb.r < p.x);
  let d = q.x - min(q.w, q.y);
  let e = 1.0e-10;
  return vec3<f32>(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

fn tweakHsv(col: vec3<f32>, shift: vec3<f32>) -> vec3<f32> {
  return clamp(hsvToRGB(rgbToHsv(col) + shift), vec3<f32>(0.0), vec3<f32>(1.0));
}

fn modulo(x: f32, y: f32) -> f32 { return x - y * floor(x / y); }

fn linearToSrgb(c: vec3<f32>) -> vec3<f32> { return pow(c, vec3<f32>(1.0 / 2.2)); }

fn hashInt2(v: vec2<i32>) -> u32 { return u32(v.x) * 5023u + u32(v.y) * 96456u; }

fn randomValue(state: ptr<function, u32>) -> f32 {
  *state = *state * 747796405u + 2891336453u;
  let word = ((*state >> ((*state >> 28u) + 4u)) ^ *state) * 277803737u;
  return f32((word >> 22u) ^ word) / 4294967295.0;
}

fn randomSNorm3(state: ptr<function, u32>) -> vec3<f32> {
  return vec3<f32>(
    randomValue(state) * 2.0 - 1.0,
    randomValue(state) * 2.0 - 1.0,
    randomValue(state) * 2.0 - 1.0
  );
}

fn getSkyColor(dir: vec3<f32>) -> vec3<f32> {
  let sun = pow(max(0.0, dot(dir, uniforms.dirToSun)), uniforms.sunPower);
  let skyGradientT = pow(smoothstep(0.0, 0.4, dir.y), 0.35);
  let groundToSkyT = smoothstep(-0.01, 0.0, dir.y);
  let skyGradient = mix(uniforms.skyColorHorizon, uniforms.skyColorZenith, skyGradientT);
  var res = mix(uniforms.skyColorGround, skyGradient, groundToSkyT);
  if (dir.y >= -0.01) { res += sun * uniforms.sunBrightness; }
  return res;
}

fn rayPlaneIntersect(ro: vec3<f32>, rd: vec3<f32>, planeY: f32) -> f32 {
  if (abs(rd.y) < 0.0001) { return -1.0; }
  let t = (planeY - ro.y) / rd.y;
  return select(-1.0, t, t > 0.0);
}

fn sampleShadowPCF(worldPos: vec3<f32>) -> f32 {
  var lightSpacePos = uniforms.lightProjectionViewMatrix * vec4<f32>(worldPos, 1.0);
  lightSpacePos = lightSpacePos / lightSpacePos.w;
  let lightCoords = vec2<f32>(lightSpacePos.x * 0.5 + 0.5, 0.5 - lightSpacePos.y * 0.5);
  let lightDepth = lightSpacePos.z;

  var shadow = 0.0;
  let texelSize = 1.0 / uniforms.shadowResolution;
  for (var x = -1; x <= 1; x++) {
    for (var y = -1; y <= 1; y++) {
      let offset = vec2<f32>(f32(x), f32(y)) * texelSize;
      let sampleCoord = lightCoords + offset;
      shadow += textureSampleCompare(shadowTex, shadowSamp, sampleCoord, lightDepth - 0.002);
    }
  }
  shadow = shadow / 9.0;

  let inBounds = lightCoords.x >= 0.0 && lightCoords.x <= 1.0 &&
                 lightCoords.y >= 0.0 && lightCoords.y <= 1.0 &&
                 lightDepth >= 0.0 && lightDepth <= 1.0;
  return select(1.0, shadow, inBounds);
}

fn getBackgroundTileColor(hitPos: vec3<f32>, shadow: f32) -> vec3<f32> {
  let rotatedPos = vec2<f32>(-hitPos.z, hitPos.x);
  var tileCol: vec3<f32>;
  if (rotatedPos.x < 0.0) { tileCol = uniforms.tileCol1; }
  else { tileCol = uniforms.tileCol2; }
  if (rotatedPos.y < 0.0) {
    if (rotatedPos.x < 0.0) { tileCol = uniforms.tileCol3; }
    else { tileCol = uniforms.tileCol4; }
  }

  tileCol = linearToSrgb(tileCol);
  let tileCoord = floor(rotatedPos * uniforms.tileScale);

  var rngState = hashInt2(vec2<i32>(i32(tileCoord.x), i32(tileCoord.y)));
  let rv = randomSNorm3(&rngState) * vec3<f32>(0.2, 0.0, 0.73) * 0.1;
  tileCol = tweakHsv(tileCol, rv);

  let isDarkTile = modulo(tileCoord.x, 2.0) == modulo(tileCoord.y, 2.0);
  if (isDarkTile) {
    tileCol = tweakHsv(tileCol, vec3<f32>(0.0, 0.0, uniforms.tileDarkFactor));
  }

  let ambient = 0.4;
  let shadowFactor = ambient + (1.0 - ambient) * shadow;
  return tileCol * shadowFactor;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
  let data = textureSample(gBufferTex, linearSamp, in.uv);
  let occlusion = textureSample(occlusionTex, linearSamp, in.uv).r;

  let speed = data.b;
  let viewSpaceZ = data.a;

  // Reconstruct normal
  let nx = data.r;
  let ny = data.g;
  let nz = sqrt(max(0.0, 1.0 - nx * nx - ny * ny));
  let viewNormal = vec3<f32>(nx, ny, nz);

  // Reconstruct camera ray
  let tanHalfFov = tan(uniforms.fov / 2.0);
  let viewRay = vec3<f32>(
    (in.uv.x * 2.0 - 1.0) * tanHalfFov * uniforms.resolution.x / uniforms.resolution.y,
    (1.0 - 2.0 * in.uv.y) * tanHalfFov,
    -1.0
  );
  let rayDirNorm = normalize((uniforms.inverseViewMatrix * vec4<f32>(viewRay, 0.0)).xyz);

  // 1. Direct Background shadow (Always sample to keep control flow uniform)
  let directT = rayPlaneIntersect(uniforms.cameraPos, rayDirNorm, uniforms.floorY);
  let directHitPos = uniforms.cameraPos + rayDirNorm * max(0.0, directT);
  let directShadow = sampleShadowPCF(directHitPos);

  // 2. Refracted shadow (Always sample to keep control flow uniform)
  // Use dummy worldPos and worldNormal if background
  let viewSpacePos = viewRay * max(-viewSpaceZ, 0.01);
  let worldSpacePos = (uniforms.inverseViewMatrix * vec4<f32>(viewSpacePos, 1.0)).xyz;
  let worldNormal = normalize((uniforms.inverseViewMatrix * vec4<f32>(viewNormal, 0.0)).xyz);
  let viewDir = normalize(worldSpacePos - uniforms.cameraPos);

  let refractEta = 1.0 / 1.33;
  let refractDir = refract(viewDir, worldNormal, refractEta);
  let refractT = rayPlaneIntersect(worldSpacePos, refractDir, uniforms.floorY);
  let refractHitPos = worldSpacePos + refractDir * max(0.0, refractT);
  let refractShadow = sampleShadowPCF(refractHitPos);

  // --- Final Selection and Shading ---

  let isBackground = speed < -0.5 || viewSpaceZ > -0.01;

  if (isBackground) {
    if (directT > 0.0 && abs(directHitPos.x) < uniforms.floorSize * 0.5 && abs(directHitPos.z) < uniforms.floorSize * 0.5) {
      return vec4<f32>(getBackgroundTileColor(directHitPos, directShadow), 1.0);
    }
    return vec4<f32>(getSkyColor(rayDirNorm), 1.0);
  }

  // Water Shading logic
  // Refracted color
  var refractedColor = getSkyColor(refractDir);
  if (refractT > 0.0 && abs(refractHitPos.x) < uniforms.floorSize * 0.5 && abs(refractHitPos.z) < uniforms.floorSize * 0.5) {
    refractedColor = getBackgroundTileColor(refractHitPos, refractShadow);
  }

  // Beer's Law (Absorption)
  let thickness = max(0.0, worldSpacePos.y - uniforms.floorY);
  let absorbColor = vec3<f32>(1.5, 0.5, 0.2);
  let transmittance = exp(-absorbColor * thickness * 0.5);
  refractedColor *= transmittance;

  // Fresnel & Reflection
  let F0 = 0.02;
  let fresnel = F0 + (1.0 - F0) * pow(1.0 - max(0.0, dot(-viewDir, worldNormal)), 5.0);
  let reflectDir = reflect(viewDir, worldNormal);
  let reflectionColor = getSkyColor(reflectDir);

  // Specular Highlights
  let h = normalize(-viewDir + uniforms.dirToSun);
  let specular = pow(max(0.0, dot(worldNormal, h)), 100.0) * uniforms.sunBrightness * 2.0;

  // Combine
  let ambient = 1.0 - min(occlusion * 0.5, 0.8);
  var waterColor = mix(refractedColor, reflectionColor, fresnel);
  waterColor += specular;
  waterColor *= ambient;

  // Speed tint
  let speedTint = hsvToRGB(vec3<f32>(max(0.6 - speed * 0.002, 0.55), 0.4, 1.0));
  waterColor = mix(waterColor, waterColor * speedTint, 0.2);

  return vec4<f32>(waterColor, 1.0);
}
