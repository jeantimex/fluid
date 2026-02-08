import{p as K,w as fe,g as de,j as me,e as te,f as pe,m as ge,k as J,F as xe,S as Pe,P as ye,l as ve,n as be}from"./picking_system-DspAGaRc.js";import{e as we}from"./environment-ODazOT3W.js";import{s as Be,a as Se,b as Ue}from"./splat_resolve-CMJnQc1h.js";const De=`/**
 * Marching Cubes Compute Shader
 *
 * Beginner note:
 * This compute pass reads the 3D density texture and writes triangle vertices
 * into a GPU buffer. Each workgroup processes a brick of voxels.
 */

struct Params {
  densityAndMax: vec4<u32>, // xyz = densityMapSize, w = maxTriangles
  isoLevel: f32,
  voxelsPerUnit: f32,
  pad1: f32,
  pad2: f32,
  minBounds: vec3<f32>,
  pad3: f32,
  maxBounds: vec3<f32>,
  pad4: f32,
};

struct Vertex {
  position: vec3<f32>,
  normal: vec3<f32>,
};

@group(0) @binding(0) var densityTex: texture_3d<f32>;
@group(0) @binding(1) var densitySampler: sampler;
@group(0) @binding(2) var<uniform> params: Params;
@group(0) @binding(3) var<storage, read_write> vertices: array<Vertex>;
@group(0) @binding(4) var<storage, read_write> triangleCount: atomic<u32>;
@group(0) @binding(5) var<storage, read> lut: array<u32>;
@group(0) @binding(6) var<storage, read> offsets: array<u32>;
@group(0) @binding(7) var<storage, read> lengths: array<u32>;
@group(0) @binding(8) var<storage, read> edgeA: array<u32>;
@group(0) @binding(9) var<storage, read> edgeB: array<u32>;

fn coordToWorld(coord: vec3<i32>) -> vec3<f32> {
  let worldToVoxel = params.voxelsPerUnit;
  return params.minBounds + vec3<f32>(coord) / worldToVoxel;
}

fn sampleDensity(coord: vec3<i32>) -> f32 {
  let volumeSizeF = vec3<f32>(params.densityAndMax.xyz);
  let maxCoord = vec3<i32>(params.densityAndMax.xyz) - vec3<i32>(1);
  let isEdge = coord.x <= 0 || coord.y <= 0 || coord.z <= 0 ||
    coord.x >= maxCoord.x || coord.y >= maxCoord.y || coord.z >= maxCoord.z;
  if (isEdge) {
    return params.isoLevel;
  }
  let uvw = vec3<f32>(coord) / (volumeSizeF - vec3<f32>(1.0));
  return textureSampleLevel(densityTex, densitySampler, uvw, 0.0).r;
}

fn calculateNormal(coord: vec3<i32>) -> vec3<f32> {
  let dx = sampleDensity(coord + vec3<i32>(1, 0, 0)) - sampleDensity(coord - vec3<i32>(1, 0, 0));
  let dy = sampleDensity(coord + vec3<i32>(0, 1, 0)) - sampleDensity(coord - vec3<i32>(0, 1, 0));
  let dz = sampleDensity(coord + vec3<i32>(0, 0, 1)) - sampleDensity(coord - vec3<i32>(0, 0, 1));
  return normalize(-vec3<f32>(dx, dy, dz));
}

fn createVertex(coordA: vec3<i32>, coordB: vec3<i32>) -> Vertex {
  let posA = coordToWorld(coordA);
  let posB = coordToWorld(coordB);
  let densityA = sampleDensity(coordA);
  let densityB = sampleDensity(coordB);
  let denom = densityB - densityA;
  let t = select(0.5, (params.isoLevel - densityA) / denom, abs(denom) > 1e-6);
  let position = posA + t * (posB - posA);

  let normalA = calculateNormal(coordA);
  let normalB = calculateNormal(coordB);
  let normal = normalize(normalA + t * (normalB - normalA));

  var vertex: Vertex;
  vertex.position = position;
  vertex.normal = normal;
  return vertex;
}

@compute @workgroup_size(8, 8, 4)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let numCubes = params.densityAndMax.xyz - vec3<u32>(1u);
  if (id.x >= numCubes.x || id.y >= numCubes.y || id.z >= numCubes.z) {
    return;
  }

  let coord = vec3<i32>(id);
  var cornerCoords: array<vec3<i32>, 8>;
  cornerCoords[0] = coord + vec3<i32>(0, 0, 0);
  cornerCoords[1] = coord + vec3<i32>(1, 0, 0);
  cornerCoords[2] = coord + vec3<i32>(1, 0, 1);
  cornerCoords[3] = coord + vec3<i32>(0, 0, 1);
  cornerCoords[4] = coord + vec3<i32>(0, 1, 0);
  cornerCoords[5] = coord + vec3<i32>(1, 1, 0);
  cornerCoords[6] = coord + vec3<i32>(1, 1, 1);
  cornerCoords[7] = coord + vec3<i32>(0, 1, 1);

  var cubeConfig: u32 = 0u;
  for (var i: u32 = 0u; i < 8u; i = i + 1u) {
    if (sampleDensity(cornerCoords[i]) > params.isoLevel) {
      cubeConfig = cubeConfig | (1u << i);
    }
  }

  let numIndices = lengths[cubeConfig];
  if (numIndices == 0u) {
    return;
  }

  let numTriangles = numIndices / 3u;
  let baseTri = atomicAdd(&triangleCount, numTriangles);
  if (baseTri >= params.densityAndMax.w) {
    return;
  }
  let available = params.densityAndMax.w - baseTri;
  let clampedTriangles = min(numTriangles, available);
  let maxIndices = clampedTriangles * 3u;

  let offset = offsets[cubeConfig];
  var i: u32 = 0u;
  loop {
    if (i >= maxIndices) { break; }
    let v0 = lut[offset + i];
    let v1 = lut[offset + i + 1u];
    let v2 = lut[offset + i + 2u];

    let a0 = edgeA[v0];
    let b0 = edgeB[v0];
    let a1 = edgeA[v1];
    let b1 = edgeB[v1];
    let a2 = edgeA[v2];
    let b2 = edgeB[v2];

    let vertexA = createVertex(cornerCoords[a0], cornerCoords[b0]);
    let vertexB = createVertex(cornerCoords[a1], cornerCoords[b1]);
    let vertexC = createVertex(cornerCoords[a2], cornerCoords[b2]);

    let baseVertex = (baseTri * 3u) + i;
    vertices[baseVertex + 0u] = vertexC;
    vertices[baseVertex + 1u] = vertexB;
    vertices[baseVertex + 2u] = vertexA;

    i = i + 3u;
  }
}
`,ze=`/**
 * Render Args Compute Shader
 *
 * Beginner note: converts the triangle counter into a drawIndirect argument
 * buffer so the GPU can draw exactly the generated triangles.
 */

struct ArgsParams {
  maxTriangles: u32,
  _pad0: vec3<u32>,
};

@group(0) @binding(0) var<storage, read_write> triangleCount: atomic<u32>;
@group(0) @binding(1) var<storage, read_write> renderArgs: array<u32>;
@group(0) @binding(2) var<uniform> params: ArgsParams;

@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let triCount = min(atomicLoad(&triangleCount), params.maxTriangles);
  renderArgs[0] = triCount * 3u;
  renderArgs[1] = 1u;
  renderArgs[2] = 0u;
  renderArgs[3] = 0u;
}
`,Ce=`/**
 * Marching Cubes Draw Shader
 *
 * Beginner note: this is a classic vertex/fragment shader pair that
 * shades the triangle buffer generated by the marching cubes compute pass.
 */

struct Vertex {
  position: vec3<f32>,
  normal: vec3<f32>,
};

struct Uniforms {
  viewProjection: mat4x4<f32>,
  color: vec4<f32>,
  lightDir: vec3<f32>,
  ambient: f32,
  sceneExposure: f32,
  sunBrightness: f32,
};

#include "../../common/shaders/shadow_common.wgsl"

@group(0) @binding(0) var<storage, read> vertices: array<Vertex>;
@group(0) @binding(1) var<uniform> uniforms: Uniforms;
@group(0) @binding(2) var shadowTex: texture_depth_2d;
@group(0) @binding(3) var shadowSampler: sampler_comparison;
@group(0) @binding(4) var<uniform> shadowUniforms: ShadowUniforms;

struct VSOut {
  @builtin(position) position: vec4<f32>,
  @location(0) normal: vec3<f32>,
  @location(1) worldPos: vec3<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VSOut {
  let v = vertices[vertexIndex];
  var out: VSOut;
  out.position = uniforms.viewProjection * vec4<f32>(v.position, 1.0);
  out.normal = v.normal;
  out.worldPos = v.position;
  return out;
}

fn sampleShadow(worldPos: vec3<f32>, ndotl: f32) -> f32 {
  let lightPos = shadowUniforms.lightViewProjection * vec4<f32>(worldPos, 1.0);
  let ndc = lightPos.xyz / lightPos.w;
  let uv = vec2<f32>(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);

  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 || ndc.z < 0.0 || ndc.z > 1.0) {
    return 1.0;
  }

  // Slope-scaled bias
  let bias = max(0.0005 * (1.0 - ndotl), 0.0001);
  let depth = ndc.z - bias;
  let softness = shadowUniforms.shadowSoftness;

  if (softness <= 0.001) {
    return textureSampleCompareLevel(shadowTex, shadowSampler, uv, depth);
  }

  // PCF 5-tap pattern
  let texel = vec2<f32>(1.0 / 2048.0) * softness;
  var sum = 0.0;
  sum += textureSampleCompareLevel(shadowTex, shadowSampler, uv, depth);
  sum += textureSampleCompareLevel(shadowTex, shadowSampler, uv + vec2<f32>(texel.x, 0.0), depth);
  sum += textureSampleCompareLevel(shadowTex, shadowSampler, uv + vec2<f32>(-texel.x, 0.0), depth);
  sum += textureSampleCompareLevel(shadowTex, shadowSampler, uv + vec2<f32>(0.0, texel.y), depth);
  sum += textureSampleCompareLevel(shadowTex, shadowSampler, uv + vec2<f32>(0.0, -texel.y), depth);
  
  return sum * 0.2;
}

@fragment
fn fs_main(input: VSOut) -> @location(0) vec4<f32> {
  let n = normalize(input.normal);
  let l = normalize(uniforms.lightDir);
  let ndotl = max(dot(n, l), 0.0);
  
  let shadow = sampleShadow(input.worldPos, ndotl);
  
  let diffuse = ndotl * 0.5 + 0.5; // Half-Lambert
  let shading = uniforms.ambient + diffuse * uniforms.sunBrightness * shadow;
  
  return vec4<f32>(uniforms.color.rgb * shading * uniforms.sceneExposure, uniforms.color.a);
}
`,Te=`/**
 * ============================================================================
 * OBSTACLE FACE SHADER (Shadowed)
 * ============================================================================
 *
 * Pipeline Stage: Render pass (obstacle faces)
 * Entry Points: vs_main (vertex), fs_main (fragment)
 * Topology: triangle-list
 *
 * Purpose:
 * --------
 * Renders the obstacle box faces with half-Lambert shading identical to
 * the marching cubes surface shader. Each vertex carries a world-space
 * position, a face normal, and an RGBA colour.
 *
 * The uniform buffer shares the same layout as the marching cubes draw
 * shader (96 bytes): viewProjection (64) + surfaceColor (16, unused here)
 * + lightDir (12) + pad (4).
 * ============================================================================
 */

// Beginner note: this shader samples the shadow map to darken the obstacle.

#include "../../common/shaders/shadow_common.wgsl"

struct Uniforms {
  viewProjection: mat4x4<f32>,
  pad0: vec4<f32>,
  lightDir: vec3<f32>,
  ambient: f32,
  sceneExposure: f32,
  sunBrightness: f32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var shadowTex: texture_depth_2d;
@group(0) @binding(2) var shadowSampler: sampler_comparison;
@group(0) @binding(3) var<uniform> shadowUniforms: ShadowUniforms;

struct VertexIn {
  @location(0) pos: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) color: vec4<f32>,
};

struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) normal: vec3<f32>,
  @location(1) color: vec4<f32>,
  @location(2) worldPos: vec3<f32>,
};

@vertex
fn vs_main(input: VertexIn) -> VertexOut {
  var out: VertexOut;
  out.position = uniforms.viewProjection * vec4<f32>(input.pos, 1.0);
  out.normal = input.normal;
  out.color = input.color;
  out.worldPos = input.pos;
  return out;
}

fn sampleShadow(worldPos: vec3<f32>, ndotl: f32) -> f32 {
  let lightPos = shadowUniforms.lightViewProjection * vec4<f32>(worldPos, 1.0);
  let ndc = lightPos.xyz / lightPos.w;
  let uv = vec2<f32>(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);

  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 || ndc.z < 0.0 || ndc.z > 1.0) {
    return 1.0;
  }

  // Use larger bias for obstacle to prevent self-shadowing artifacts
  let bias = max(0.01 * (1.0 - ndotl), 0.005);
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

@fragment
fn fs_main(input: VertexOut) -> @location(0) vec4<f32> {
  let n = normalize(input.normal);
  let l = normalize(uniforms.lightDir);
  // Use standard diffuse lighting (matching environment.wgsl)
  let ndotl = max(dot(n, l), 0.0);
  let shadow = sampleShadow(input.worldPos, ndotl);
  let shading = uniforms.ambient + ndotl * uniforms.sunBrightness * shadow;
  return vec4<f32>(input.color.rgb * shading * uniforms.sceneExposure, input.color.a);
}
`,Ge=`// =============================================================================
// Background Shader
// =============================================================================
// Renders the shared environment (Sky + Floor) using a fullscreen triangle.

// Beginner note: this draws the sky/floor and samples the shadow map.

#include "../../common/shaders/environment.wgsl"
#include "../../common/shaders/shadow_common.wgsl"

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
`,Me=`#include "shadow_common.wgsl"

// Beginner note: renders mesh/obstacle geometry into the shadow depth map.

@group(0) @binding(0) var<uniform> uniforms: ShadowUniforms;

// --- MESH (Storage Buffer) ---
struct Vertex {
  position: vec3<f32>,
  normal: vec3<f32>,
};
@group(0) @binding(1) var<storage, read> meshVertices: array<Vertex>;

@vertex
fn vs_mesh(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4<f32> {
  let v = meshVertices[vertexIndex];
  return uniforms.lightViewProjection * vec4<f32>(v.position, 1.0);
}

// --- OBSTACLE (Vertex Buffer) ---
// We only need the position attribute
struct ObstacleInput {
  @location(0) position: vec3<f32>,
};

@vertex
fn vs_obstacle(in: ObstacleInput) -> @builtin(position) vec4<f32> {
  return uniforms.lightViewProjection * vec4<f32>(in.position, 1.0);
}
`,se=new Uint32Array([0,8,3,0,1,9,1,8,3,9,8,1,1,2,10,0,8,3,1,2,10,9,2,10,0,2,9,2,8,3,2,10,8,10,9,8,3,11,2,0,11,2,8,11,0,1,9,0,2,3,11,1,11,2,1,9,11,9,8,11,3,10,1,11,10,3,0,10,1,0,8,10,8,11,10,3,9,0,3,11,9,11,10,9,9,8,10,10,8,11,4,7,8,4,3,0,7,3,4,0,1,9,8,4,7,4,1,9,4,7,1,7,3,1,1,2,10,8,4,7,3,4,7,3,0,4,1,2,10,9,2,10,9,0,2,8,4,7,2,10,9,2,9,7,2,7,3,7,9,4,8,4,7,3,11,2,11,4,7,11,2,4,2,0,4,9,0,1,8,4,7,2,3,11,4,7,11,9,4,11,9,11,2,9,2,1,3,10,1,3,11,10,7,8,4,1,11,10,1,4,11,1,0,4,7,11,4,4,7,8,9,0,11,9,11,10,11,0,3,4,7,11,4,11,9,9,11,10,9,5,4,9,5,4,0,8,3,0,5,4,1,5,0,8,5,4,8,3,5,3,1,5,1,2,10,9,5,4,3,0,8,1,2,10,4,9,5,5,2,10,5,4,2,4,0,2,2,10,5,3,2,5,3,5,4,3,4,8,9,5,4,2,3,11,0,11,2,0,8,11,4,9,5,0,5,4,0,1,5,2,3,11,2,1,5,2,5,8,2,8,11,4,8,5,10,3,11,10,1,3,9,5,4,4,9,5,0,8,1,8,10,1,8,11,10,5,4,0,5,0,11,5,11,10,11,0,3,5,4,8,5,8,10,10,8,11,9,7,8,5,7,9,9,3,0,9,5,3,5,7,3,0,7,8,0,1,7,1,5,7,1,5,3,3,5,7,9,7,8,9,5,7,10,1,2,10,1,2,9,5,0,5,3,0,5,7,3,8,0,2,8,2,5,8,5,7,10,5,2,2,10,5,2,5,3,3,5,7,7,9,5,7,8,9,3,11,2,9,5,7,9,7,2,9,2,0,2,7,11,2,3,11,0,1,8,1,7,8,1,5,7,11,2,1,11,1,7,7,1,5,9,5,8,8,5,7,10,1,3,10,3,11,5,7,0,5,0,9,7,11,0,1,0,10,11,10,0,11,10,0,11,0,3,10,5,0,8,0,7,5,7,0,11,10,5,7,11,5,10,6,5,0,8,3,5,10,6,9,0,1,5,10,6,1,8,3,1,9,8,5,10,6,1,6,5,2,6,1,1,6,5,1,2,6,3,0,8,9,6,5,9,0,6,0,2,6,5,9,8,5,8,2,5,2,6,3,2,8,2,3,11,10,6,5,11,0,8,11,2,0,10,6,5,0,1,9,2,3,11,5,10,6,5,10,6,1,9,2,9,11,2,9,8,11,6,3,11,6,5,3,5,1,3,0,8,11,0,11,5,0,5,1,5,11,6,3,11,6,0,3,6,0,6,5,0,5,9,6,5,9,6,9,11,11,9,8,5,10,6,4,7,8,4,3,0,4,7,3,6,5,10,1,9,0,5,10,6,8,4,7,10,6,5,1,9,7,1,7,3,7,9,4,6,1,2,6,5,1,4,7,8,1,2,5,5,2,6,3,0,4,3,4,7,8,4,7,9,0,5,0,6,5,0,2,6,7,3,9,7,9,4,3,2,9,5,9,6,2,6,9,3,11,2,7,8,4,10,6,5,5,10,6,4,7,2,4,2,0,2,7,11,0,1,9,4,7,8,2,3,11,5,10,6,9,2,1,9,11,2,9,4,11,7,11,4,5,10,6,8,4,7,3,11,5,3,5,1,5,11,6,5,1,11,5,11,6,1,0,11,7,11,4,0,4,11,0,5,9,0,6,5,0,3,6,11,6,3,8,4,7,6,5,9,6,9,11,4,7,9,7,11,9,10,4,9,6,4,10,4,10,6,4,9,10,0,8,3,10,0,1,10,6,0,6,4,0,8,3,1,8,1,6,8,6,4,6,1,10,1,4,9,1,2,4,2,6,4,3,0,8,1,2,9,2,4,9,2,6,4,0,2,4,4,2,6,8,3,2,8,2,4,4,2,6,10,4,9,10,6,4,11,2,3,0,8,2,2,8,11,4,9,10,4,10,6,3,11,2,0,1,6,0,6,4,6,1,10,6,4,1,6,1,10,4,8,1,2,1,11,8,11,1,9,6,4,9,3,6,9,1,3,11,6,3,8,11,1,8,1,0,11,6,1,9,1,4,6,4,1,3,11,6,3,6,0,0,6,4,6,4,8,11,6,8,7,10,6,7,8,10,8,9,10,0,7,3,0,10,7,0,9,10,6,7,10,10,6,7,1,10,7,1,7,8,1,8,0,10,6,7,10,7,1,1,7,3,1,2,6,1,6,8,1,8,9,8,6,7,2,6,9,2,9,1,6,7,9,0,9,3,7,3,9,7,8,0,7,0,6,6,0,2,7,3,2,6,7,2,2,3,11,10,6,8,10,8,9,8,6,7,2,0,7,2,7,11,0,9,7,6,7,10,9,10,7,1,8,0,1,7,8,1,10,7,6,7,10,2,3,11,11,2,1,11,1,7,10,6,1,6,7,1,8,9,6,8,6,7,9,1,6,11,6,3,1,3,6,0,9,1,11,6,7,7,8,0,7,0,6,3,11,0,11,6,0,7,11,6,7,6,11,3,0,8,11,7,6,0,1,9,11,7,6,8,1,9,8,3,1,11,7,6,10,1,2,6,11,7,1,2,10,3,0,8,6,11,7,2,9,0,2,10,9,6,11,7,6,11,7,2,10,3,10,8,3,10,9,8,7,2,3,6,2,7,7,0,8,7,6,0,6,2,0,2,7,6,2,3,7,0,1,9,1,6,2,1,8,6,1,9,8,8,7,6,10,7,6,10,1,7,1,3,7,10,7,6,1,7,10,1,8,7,1,0,8,0,3,7,0,7,10,0,10,9,6,10,7,7,6,10,7,10,8,8,10,9,6,8,4,11,8,6,3,6,11,3,0,6,0,4,6,8,6,11,8,4,6,9,0,1,9,4,6,9,6,3,9,3,1,11,3,6,6,8,4,6,11,8,2,10,1,1,2,10,3,0,11,0,6,11,0,4,6,4,11,8,4,6,11,0,2,9,2,10,9,10,9,3,10,3,2,9,4,3,11,3,6,4,6,3,8,2,3,8,4,2,4,6,2,0,4,2,4,6,2,1,9,0,2,3,4,2,4,6,4,3,8,1,9,4,1,4,2,2,4,6,8,1,3,8,6,1,8,4,6,6,10,1,10,1,0,10,0,6,6,0,4,4,6,3,4,3,8,6,10,3,0,3,9,10,9,3,10,9,4,6,10,4,4,9,5,7,6,11,0,8,3,4,9,5,11,7,6,5,0,1,5,4,0,7,6,11,11,7,6,8,3,4,3,5,4,3,1,5,9,5,4,10,1,2,7,6,11,6,11,7,1,2,10,0,8,3,4,9,5,7,6,11,5,4,10,4,2,10,4,0,2,3,4,8,3,5,4,3,2,5,10,5,2,11,7,6,7,2,3,7,6,2,5,4,9,9,5,4,0,8,6,0,6,2,6,8,7,3,6,2,3,7,6,1,5,0,5,4,0,6,2,8,6,8,7,2,1,8,4,8,5,1,5,8,9,5,4,10,1,6,1,7,6,1,3,7,1,6,10,1,7,6,1,0,7,8,7,0,9,5,4,4,0,10,4,10,5,0,3,10,6,10,7,3,7,10,7,6,10,7,10,8,5,4,10,4,8,10,6,9,5,6,11,9,11,8,9,3,6,11,0,6,3,0,5,6,0,9,5,0,11,8,0,5,11,0,1,5,5,6,11,6,11,3,6,3,5,5,3,1,1,2,10,9,5,11,9,11,8,11,5,6,0,11,3,0,6,11,0,9,6,5,6,9,1,2,10,11,8,5,11,5,6,8,0,5,10,5,2,0,2,5,6,11,3,6,3,5,2,10,3,10,5,3,5,8,9,5,2,8,5,6,2,3,8,2,9,5,6,9,6,0,0,6,2,1,5,8,1,8,0,5,6,8,3,8,2,6,2,8,1,5,6,2,1,6,1,3,6,1,6,10,3,8,6,5,6,9,8,9,6,10,1,0,10,0,6,9,5,0,5,6,0,0,3,8,5,6,10,10,5,6,11,5,10,7,5,11,11,5,10,11,7,5,8,3,0,5,11,7,5,10,11,1,9,0,10,7,5,10,11,7,9,8,1,8,3,1,11,1,2,11,7,1,7,5,1,0,8,3,1,2,7,1,7,5,7,2,11,9,7,5,9,2,7,9,0,2,2,11,7,7,5,2,7,2,11,5,9,2,3,2,8,9,8,2,2,5,10,2,3,5,3,7,5,8,2,0,8,5,2,8,7,5,10,2,5,9,0,1,5,10,3,5,3,7,3,10,2,9,8,2,9,2,1,8,7,2,10,2,5,7,5,2,1,3,5,3,7,5,0,8,7,0,7,1,1,7,5,9,0,3,9,3,5,5,3,7,9,8,7,5,9,7,5,8,4,5,10,8,10,11,8,5,0,4,5,11,0,5,10,11,11,3,0,0,1,9,8,4,10,8,10,11,10,4,5,10,11,4,10,4,5,11,3,4,9,4,1,3,1,4,2,5,1,2,8,5,2,11,8,4,5,8,0,4,11,0,11,3,4,5,11,2,11,1,5,1,11,0,2,5,0,5,9,2,11,5,4,5,8,11,8,5,9,4,5,2,11,3,2,5,10,3,5,2,3,4,5,3,8,4,5,10,2,5,2,4,4,2,0,3,10,2,3,5,10,3,8,5,4,5,8,0,1,9,5,10,2,5,2,4,1,9,2,9,4,2,8,4,5,8,5,3,3,5,1,0,4,5,1,0,5,8,4,5,8,5,3,9,0,5,0,3,5,9,4,5,4,11,7,4,9,11,9,10,11,0,8,3,4,9,7,9,11,7,9,10,11,1,10,11,1,11,4,1,4,0,7,4,11,3,1,4,3,4,8,1,10,4,7,4,11,10,11,4,4,11,7,9,11,4,9,2,11,9,1,2,9,7,4,9,11,7,9,1,11,2,11,1,0,8,3,11,7,4,11,4,2,2,4,0,11,7,4,11,4,2,8,3,4,3,2,4,2,9,10,2,7,9,2,3,7,7,4,9,9,10,7,9,7,4,10,2,7,8,7,0,2,0,7,3,7,10,3,10,2,7,4,10,1,10,0,4,0,10,1,10,2,8,7,4,4,9,1,4,1,7,7,1,3,4,9,1,4,1,7,0,8,1,8,7,1,4,0,3,7,4,3,4,8,7,9,10,8,10,11,8,3,0,9,3,9,11,11,9,10,0,1,10,0,10,8,8,10,11,3,1,10,11,3,10,1,2,11,1,11,9,9,11,8,3,0,9,3,9,11,1,2,9,2,11,9,0,2,11,8,0,11,3,2,11,2,3,8,2,8,10,10,8,9,9,10,2,0,9,2,2,3,8,2,8,10,0,1,8,1,10,8,1,10,2,1,3,8,9,1,8,0,9,1,0,3,8]),re=new Uint32Array([0,0,3,6,12,15,21,27,36,39,45,51,60,66,75,84,90,93,99,105,114,120,129,138,150,156,165,174,186,195,207,219,228,231,237,243,252,258,267,276,288,294,303,312,324,333,345,357,366,372,381,390,396,405,417,429,438,447,459,471,480,492,507,522,528,531,537,543,552,558,567,576,588,594,603,612,624,633,645,657,666,672,681,690,702,711,723,735,750,759,771,783,798,810,825,840,852,858,867,876,888,897,909,915,924,933,945,957,972,984,999,1008,1014,1023,1035,1047,1056,1068,1083,1092,1098,1110,1125,1140,1152,1167,1173,1185,1188,1191,1197,1203,1212,1218,1227,1236,1248,1254,1263,1272,1284,1293,1305,1317,1326,1332,1341,1350,1362,1371,1383,1395,1410,1419,1425,1437,1446,1458,1467,1482,1488,1494,1503,1512,1524,1533,1545,1557,1572,1581,1593,1605,1620,1632,1647,1662,1674,1683,1695,1707,1716,1728,1743,1758,1770,1782,1791,1806,1812,1827,1839,1845,1848,1854,1863,1872,1884,1893,1905,1917,1932,1941,1953,1965,1980,1986,1995,2004,2010,2019,2031,2043,2058,2070,2085,2100,2106,2118,2127,2142,2154,2163,2169,2181,2184,2193,2205,2217,2232,2244,2259,2268,2280,2292,2307,2322,2328,2337,2349,2355,2358,2364,2373,2382,2388,2397,2409,2415,2418,2427,2433,2445,2448,2454,2457,2460]),ae=new Uint32Array([0,3,3,6,3,6,6,9,3,6,6,9,6,9,9,6,3,6,6,9,6,9,9,12,6,9,9,12,9,12,12,9,3,6,6,9,6,9,9,12,6,9,9,12,9,12,12,9,6,9,9,6,9,12,12,9,9,12,12,9,12,15,15,6,3,6,6,9,6,9,9,12,6,9,9,12,9,12,12,9,6,9,9,12,9,12,12,15,9,12,12,15,12,15,15,12,6,9,9,12,9,12,6,9,9,12,12,15,12,15,9,6,9,12,12,9,12,15,9,6,12,15,15,12,15,6,12,3,3,6,6,9,6,9,9,12,6,9,9,12,9,12,12,9,6,9,9,12,9,12,12,15,9,6,12,9,12,9,15,6,6,9,9,12,9,12,12,15,9,12,12,15,12,15,15,12,9,12,12,9,12,15,15,12,12,9,15,6,15,12,6,3,6,9,9,12,9,12,12,15,9,12,12,15,6,9,9,6,9,12,12,15,12,15,15,6,12,9,15,12,9,6,12,3,9,12,12,15,12,15,9,12,12,15,15,6,9,12,6,3,6,9,9,6,9,12,6,3,9,6,12,3,6,3,3,0]),ie=new Uint32Array([0,1,2,3,4,5,6,7,0,1,2,3]),ne=new Uint32Array([1,2,3,0,5,6,7,4,4,5,6,7]);class Ae{device;canvas;marchingPipeline;renderArgsPipeline;drawPipeline;facePipeline;backgroundPipeline;shadowMeshPipeline;shadowObstaclePipeline;wireframePipeline;sampler;shadowSampler;paramsBuffer;paramsData;paramsF32;paramsU32;renderUniformBuffer;envUniformBuffer;camUniformBuffer;shadowUniformBuffer;triangleBuffer;triangleCountBuffer;renderArgsBuffer;renderArgsParamsBuffer;triangleCountReadback;lutBuffer;offsetsBuffer;lengthsBuffer;edgeABuffer;edgeBBuffer;computeBindGroup;renderArgsBindGroup;drawBindGroup;faceBindGroup;backgroundBindGroup;shadowMeshBindGroup;shadowObstacleBindGroup;wireframeBindGroup;lineVertexBuffer;lineVertexData;wireframeVertexBuffer;wireframeVertexData;wireframeUniformBuffer;densityTextureSize={x:1,y:1,z:1};dispatchSize={x:1,y:1,z:1};mcWorkgroup={x:8,y:8,z:4};maxTriangles=1;depthTexture;depthWidth=0;depthHeight=0;shadowTexture;shadowMapSize=2048;resetCounterData=new Uint32Array([0]);constructor(e,t,r){this.device=e,this.canvas=t;const s=e.createShaderModule({code:De});this.marchingPipeline=e.createComputePipeline({layout:"auto",compute:{module:s,entryPoint:"main"}});const a=e.createShaderModule({code:ze});this.renderArgsPipeline=e.createComputePipeline({layout:"auto",compute:{module:a,entryPoint:"main"}});const i=K(Ce,{"../../common/shaders/shadow_common.wgsl":J}),o=e.createShaderModule({code:i});this.drawPipeline=e.createRenderPipeline({layout:"auto",vertex:{module:o,entryPoint:"vs_main"},fragment:{module:o,entryPoint:"fs_main",targets:[{format:r}]},primitive:{topology:"triangle-list",cullMode:"none"},depthStencil:{format:"depth24plus",depthWriteEnabled:!0,depthCompare:"less"}});const d=K(Te,{"../../common/shaders/shadow_common.wgsl":J}),n=e.createShaderModule({code:d});this.facePipeline=e.createRenderPipeline({layout:"auto",vertex:{module:n,entryPoint:"vs_main",buffers:[{arrayStride:40,attributes:[{shaderLocation:0,offset:0,format:"float32x3"},{shaderLocation:1,offset:12,format:"float32x3"},{shaderLocation:2,offset:24,format:"float32x4"}]}]},fragment:{module:n,entryPoint:"fs_main",targets:[{format:r,blend:{color:{srcFactor:"src-alpha",dstFactor:"one-minus-src-alpha",operation:"add"},alpha:{srcFactor:"one",dstFactor:"one-minus-src-alpha",operation:"add"}}}]},primitive:{topology:"triangle-list",cullMode:"back"},depthStencil:{format:"depth24plus",depthWriteEnabled:!1,depthCompare:"less"}});const m=K(Ge,{"../../common/shaders/environment.wgsl":we,"../../common/shaders/shadow_common.wgsl":J}),l=e.createShaderModule({code:m});this.backgroundPipeline=e.createRenderPipeline({layout:"auto",vertex:{module:l,entryPoint:"vs_main"},fragment:{module:l,entryPoint:"fs_main",targets:[{format:r}]},primitive:{topology:"triangle-list"},depthStencil:{format:"depth24plus",depthWriteEnabled:!1,depthCompare:"always"}});const h=K(Me,{"shadow_common.wgsl":J}),y=e.createShaderModule({code:h});this.shadowMeshPipeline=e.createRenderPipeline({layout:"auto",vertex:{module:y,entryPoint:"vs_mesh"},primitive:{topology:"triangle-list",cullMode:"none"},depthStencil:{format:"depth24plus",depthWriteEnabled:!0,depthCompare:"less"}}),this.shadowObstaclePipeline=e.createRenderPipeline({layout:"auto",vertex:{module:y,entryPoint:"vs_obstacle",buffers:[{arrayStride:40,attributes:[{shaderLocation:0,offset:0,format:"float32x3"}]}]},primitive:{topology:"triangle-list",cullMode:"back"},depthStencil:{format:"depth24plus",depthWriteEnabled:!0,depthCompare:"less"}});const P=384*6,v=Math.max(36,P)*10,b=168;this.lineVertexData=new Float32Array(v+b+64),this.lineVertexBuffer=e.createBuffer({size:this.lineVertexData.byteLength,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});const B=e.createShaderModule({code:fe});this.wireframePipeline=e.createRenderPipeline({layout:"auto",vertex:{module:B,entryPoint:"vs_main",buffers:[{arrayStride:28,attributes:[{shaderLocation:0,offset:0,format:"float32x3"},{shaderLocation:1,offset:12,format:"float32x4"}]}]},fragment:{module:B,entryPoint:"fs_main",targets:[{format:r}]},primitive:{topology:"line-list"},depthStencil:{format:"depth24plus",depthWriteEnabled:!0,depthCompare:"less"}}),this.wireframeUniformBuffer=e.createBuffer({size:64,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.wireframeVertexData=new Float32Array(168),this.wireframeVertexBuffer=e.createBuffer({size:this.wireframeVertexData.byteLength,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST}),this.sampler=e.createSampler({addressModeU:"clamp-to-edge",addressModeV:"clamp-to-edge",addressModeW:"clamp-to-edge",magFilter:"linear",minFilter:"linear"}),this.shadowSampler=e.createSampler({compare:"less",magFilter:"linear",minFilter:"linear"}),this.paramsData=new ArrayBuffer(64),this.paramsF32=new Float32Array(this.paramsData),this.paramsU32=new Uint32Array(this.paramsData),this.paramsBuffer=e.createBuffer({size:64,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.renderUniformBuffer=e.createBuffer({size:112,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.envUniformBuffer=e.createBuffer({size:240,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.camUniformBuffer=e.createBuffer({size:80,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.shadowUniformBuffer=e.createBuffer({size:96,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.lutBuffer=e.createBuffer({size:se.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),this.device.queue.writeBuffer(this.lutBuffer,0,se),this.offsetsBuffer=e.createBuffer({size:re.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),this.device.queue.writeBuffer(this.offsetsBuffer,0,re),this.lengthsBuffer=e.createBuffer({size:ae.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),this.device.queue.writeBuffer(this.lengthsBuffer,0,ae),this.edgeABuffer=e.createBuffer({size:ie.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),this.device.queue.writeBuffer(this.edgeABuffer,0,ie),this.edgeBBuffer=e.createBuffer({size:ne.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),this.device.queue.writeBuffer(this.edgeBBuffer,0,ne),this.shadowObstacleBindGroup=e.createBindGroup({layout:this.shadowObstaclePipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.shadowUniformBuffer}}]}),this.wireframeBindGroup=e.createBindGroup({layout:this.wireframePipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.wireframeUniformBuffer}}]})}recreate(e,t){this.densityTextureSize={...t};const r=Math.max(1,t.x-1),s=Math.max(1,t.y-1),a=Math.max(1,t.z-1),i=r*s*a,o=this.device.limits.maxStorageBufferBindingSize??268435456,d=this.device.limits.maxBufferSize??268435456,n=Math.min(o,d),m=32,l=Math.floor(n/m),h=Math.max(1,Math.floor(l/3));this.maxTriangles=Math.max(1,Math.min(i*5,h)),this.dispatchSize={x:Math.ceil(r/this.mcWorkgroup.x),y:Math.ceil(s/this.mcWorkgroup.y),z:Math.ceil(a/this.mcWorkgroup.z)},this.triangleBuffer&&this.triangleBuffer.destroy(),this.triangleCountBuffer&&this.triangleCountBuffer.destroy(),this.renderArgsBuffer&&this.renderArgsBuffer.destroy(),this.renderArgsParamsBuffer&&this.renderArgsParamsBuffer.destroy(),this.triangleCountReadback&&this.triangleCountReadback.destroy(),this.shadowTexture&&this.shadowTexture.destroy();const y=this.maxTriangles*3;this.triangleBuffer=this.device.createBuffer({size:y*m,usage:GPUBufferUsage.STORAGE}),this.triangleCountBuffer=this.device.createBuffer({size:4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC}),this.triangleCountReadback=this.device.createBuffer({size:4,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST}),this.renderArgsBuffer=this.device.createBuffer({size:16,usage:GPUBufferUsage.INDIRECT|GPUBufferUsage.STORAGE}),this.renderArgsParamsBuffer=this.device.createBuffer({size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});const P=new Uint32Array([this.maxTriangles,0,0,0]);this.device.queue.writeBuffer(this.renderArgsParamsBuffer,0,P),this.shadowTexture=this.device.createTexture({size:[this.shadowMapSize,this.shadowMapSize],format:"depth24plus",usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING}),this.computeBindGroup=this.device.createBindGroup({layout:this.marchingPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:e},{binding:1,resource:this.sampler},{binding:2,resource:{buffer:this.paramsBuffer}},{binding:3,resource:{buffer:this.triangleBuffer}},{binding:4,resource:{buffer:this.triangleCountBuffer}},{binding:5,resource:{buffer:this.lutBuffer}},{binding:6,resource:{buffer:this.offsetsBuffer}},{binding:7,resource:{buffer:this.lengthsBuffer}},{binding:8,resource:{buffer:this.edgeABuffer}},{binding:9,resource:{buffer:this.edgeBBuffer}}]}),this.renderArgsBindGroup=this.device.createBindGroup({layout:this.renderArgsPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.triangleCountBuffer}},{binding:1,resource:{buffer:this.renderArgsBuffer}},{binding:2,resource:{buffer:this.renderArgsParamsBuffer}}]}),this.drawBindGroup=this.device.createBindGroup({layout:this.drawPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.triangleBuffer}},{binding:1,resource:{buffer:this.renderUniformBuffer}},{binding:2,resource:this.shadowTexture.createView()},{binding:3,resource:this.shadowSampler},{binding:4,resource:{buffer:this.shadowUniformBuffer}}]}),this.faceBindGroup=this.device.createBindGroup({layout:this.facePipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.renderUniformBuffer}},{binding:1,resource:this.shadowTexture.createView()},{binding:2,resource:this.shadowSampler},{binding:3,resource:{buffer:this.shadowUniformBuffer}}]}),this.backgroundBindGroup=this.device.createBindGroup({layout:this.backgroundPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.envUniformBuffer}},{binding:1,resource:{buffer:this.camUniformBuffer}},{binding:2,resource:this.shadowTexture.createView()},{binding:3,resource:this.shadowSampler},{binding:4,resource:{buffer:this.shadowUniformBuffer}}]}),this.shadowMeshBindGroup=this.device.createBindGroup({layout:this.shadowMeshPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.shadowUniformBuffer}},{binding:1,resource:{buffer:this.triangleBuffer}}]})}buildObstacleGeometry(e){const t=e.obstacleShape??"box",r=e.obstacleColor??{r:1,g:0,b:0},s=e.obstacleAlpha??.8;if(t==="sphere"){const u=e.obstacleRadius??0;if(u<=0)return{faceCount:0,edgeCount:0};const g=e.obstacleCentre.x,z=e.obstacleCentre.y,T=e.obstacleCentre.z;let x=0;const _=(O,R)=>{this.lineVertexData[x++]=O[0],this.lineVertexData[x++]=O[1],this.lineVertexData[x++]=O[2],this.lineVertexData[x++]=R[0],this.lineVertexData[x++]=R[1],this.lineVertexData[x++]=R[2],this.lineVertexData[x++]=r.r,this.lineVertexData[x++]=r.g,this.lineVertexData[x++]=r.b,this.lineVertexData[x++]=s},F=16,G=24;for(let O=0;O<F;O++){const R=O/F,U=(O+1)/F,p=R*Math.PI,N=U*Math.PI;for(let H=0;H<G;H++){const oe=H/G,ue=(H+1)/G,j=oe*Math.PI*2,X=ue*Math.PI*2,$=[Math.sin(p)*Math.cos(j),Math.cos(p),Math.sin(p)*Math.sin(j)],he=[Math.sin(p)*Math.cos(X),Math.cos(p),Math.sin(p)*Math.sin(X)],le=[Math.sin(N)*Math.cos(j),Math.cos(N),Math.sin(N)*Math.sin(j)],ee=[Math.sin(N)*Math.cos(X),Math.cos(N),Math.sin(N)*Math.sin(X)],W=Z=>{const ce=Z;_([Z[0]*u+g,Z[1]*u+z,Z[2]*u+T],ce)};W($),W(ee),W(le),W($),W(he),W(ee)}}return{faceCount:F*G*6,edgeCount:0}}const a=e.obstacleSize.x*.5,i=e.obstacleSize.y*.5,o=e.obstacleSize.z*.5;if(a<=0||i<=0||o<=0)return{faceCount:0,edgeCount:0};const d=e.obstacleCentre.x,n=e.obstacleCentre.y+e.obstacleSize.y*.5,m=e.obstacleCentre.z,l=Math.PI/180,h=e.obstacleRotation.x*l,y=e.obstacleRotation.y*l,P=e.obstacleRotation.z*l,v=Math.cos(h),b=Math.sin(h),B=Math.cos(y),L=Math.sin(y),M=Math.cos(P),S=Math.sin(P),D=(u,g,z)=>{const T=g*v-z*b,x=g*b+z*v,_=u*B+x*L,F=-u*L+x*B,G=_*M-T*S,f=_*S+T*M;return[G+d,f+n,F+m]},C=[D(-a,-i,-o),D(+a,-i,-o),D(+a,+i,-o),D(-a,+i,-o),D(-a,-i,+o),D(+a,-i,+o),D(+a,+i,+o),D(-a,+i,+o)],A=(u,g,z)=>{const T=g*v-z*b,x=g*b+z*v,_=u*B+x*L,F=-u*L+x*B,G=_*M-T*S,f=_*S+T*M;return[G,f,F]},Y=[A(0,0,-1),A(0,0,1),A(-1,0,0),A(1,0,0),A(0,-1,0),A(0,1,0)];let c=0;const V=(u,g)=>{this.lineVertexData[c++]=u[0],this.lineVertexData[c++]=u[1],this.lineVertexData[c++]=u[2],this.lineVertexData[c++]=g[0],this.lineVertexData[c++]=g[1],this.lineVertexData[c++]=g[2],this.lineVertexData[c++]=r.r,this.lineVertexData[c++]=r.g,this.lineVertexData[c++]=r.b,this.lineVertexData[c++]=s},q=u=>{this.lineVertexData[c++]=u[0],this.lineVertexData[c++]=u[1],this.lineVertexData[c++]=u[2],this.lineVertexData[c++]=r.r,this.lineVertexData[c++]=r.g,this.lineVertexData[c++]=r.b,this.lineVertexData[c++]=s},w=[[0,2,1,0,3,2],[4,5,6,4,6,7],[0,4,7,0,7,3],[1,2,6,1,6,5],[0,1,5,0,5,4],[3,7,6,3,6,2]];for(let u=0;u<w.length;u++){const g=Y[u];for(const z of w[u])V(C[z],g)}const I=36,k=[[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];for(const[u,g]of k)q(C[u]),q(C[g]);return{faceCount:I,edgeCount:24}}buildBoundsWireframe(e){const t=e.boundsSize.x*.5,r=e.boundsSize.y*.5,s=e.boundsSize.z*.5,a=r-5,i=e.boundsWireframeColor??{r:1,g:1,b:1},o=[[-t,a-r,-s],[+t,a-r,-s],[+t,a+r,-s],[-t,a+r,-s],[-t,a-r,+s],[+t,a-r,+s],[+t,a+r,+s],[-t,a+r,+s]],d=[[0,1],[1,5],[5,4],[4,0],[3,2],[2,6],[6,7],[7,3],[0,3],[1,2],[5,6],[4,7]];let n=0;const m=l=>{const h=o[l];this.wireframeVertexData[n++]=h[0],this.wireframeVertexData[n++]=h[1],this.wireframeVertexData[n++]=h[2],this.wireframeVertexData[n++]=i.r,this.wireframeVertexData[n++]=i.g,this.wireframeVertexData[n++]=i.b,this.wireframeVertexData[n++]=1};for(const[l,h]of d)m(l),m(h);return d.length*2}render(e,t,r,s){if(!this.computeBindGroup)return;this.ensureDepthTexture(),this.paramsU32[0]=this.densityTextureSize.x,this.paramsU32[1]=this.densityTextureSize.y,this.paramsU32[2]=this.densityTextureSize.z,this.paramsU32[3]=this.maxTriangles,this.paramsF32[4]=s.isoLevel,this.paramsF32[5]=s.densityTextureRes/20;const a=s.boundsSize,i=a.x*.5,o=a.z*.5,d=-5;this.paramsF32[8]=-i,this.paramsF32[9]=d,this.paramsF32[10]=-o,this.paramsF32[12]=i,this.paramsF32[13]=d+a.y,this.paramsF32[14]=o,this.device.queue.writeBuffer(this.paramsBuffer,0,this.paramsData),this.device.queue.writeBuffer(this.triangleCountBuffer,0,this.resetCounterData);const n=e.beginComputePass();n.setPipeline(this.marchingPipeline),n.setBindGroup(0,this.computeBindGroup),n.dispatchWorkgroups(this.dispatchSize.x,this.dispatchSize.y,this.dispatchSize.z),n.end();const m=e.beginComputePass();m.setPipeline(this.renderArgsPipeline),m.setBindGroup(0,this.renderArgsBindGroup),m.dispatchWorkgroups(1),m.end();const l=s.boundsSize,h=s.floorSize,y=s.dirToSun,P=Math.max(l.x+l.z,h.x+h.z),v=P*.6,b={x:y.x*P,y:y.y*P,z:y.z*P},B=de(b,{x:0,y:0,z:0},{x:0,y:1,z:0}),L=me(-v,v,-v,v,.1,-P*3),M=te(L,B),S=new Float32Array(20);S.set(M),S[16]=s.shadowSoftness??1,S[17]=0,S[18]=0,S[19]=0,this.device.queue.writeBuffer(this.shadowUniformBuffer,0,S);const D=s.showObstacle!==!1,{faceCount:C,edgeCount:A}=D?this.buildObstacleGeometry(s):{faceCount:0,edgeCount:0},Y=C*10+A*7;Y>0&&this.device.queue.writeBuffer(this.lineVertexBuffer,0,this.lineVertexData.buffer,this.lineVertexData.byteOffset,Y*4);let c=0;s.showBoundsWireframe&&(c=this.buildBoundsWireframe(s),this.device.queue.writeBuffer(this.wireframeVertexBuffer,0,this.wireframeVertexData.buffer,this.wireframeVertexData.byteOffset,c*7*4));const V=e.beginRenderPass({colorAttachments:[],depthStencilAttachment:{view:this.shadowTexture.createView(),depthClearValue:1,depthLoadOp:"clear",depthStoreOp:"store"}});s.showFluidShadows&&(V.setPipeline(this.shadowMeshPipeline),V.setBindGroup(0,this.shadowMeshBindGroup),V.drawIndirect(this.renderArgsBuffer,0),C>0&&(V.setPipeline(this.shadowObstaclePipeline),V.setBindGroup(0,this.shadowObstacleBindGroup),V.setVertexBuffer(0,this.lineVertexBuffer,0),V.draw(C))),V.end();const q=new Float32Array(60);pe(q,0,s,s),this.device.queue.writeBuffer(this.envUniformBuffer,0,q);const w=r.viewMatrix,I={x:w[0],y:w[4],z:w[8]},k={x:w[1],y:w[5],z:w[9]},E={x:w[2],y:w[6],z:w[10]},u={x:-E.x,y:-E.y,z:-E.z},g=w[12],z=w[13],T=w[14],x=-(I.x*g+k.x*z+E.x*T),_=-(I.y*g+k.y*z+E.y*T),F=-(I.z*g+k.z*z+E.z*T),G=this.canvas.width/this.canvas.height,f=new Float32Array(20);f[0]=x,f[1]=_,f[2]=F,f[3]=0,f[4]=u.x,f[5]=u.y,f[6]=u.z,f[7]=0,f[8]=I.x,f[9]=I.y,f[10]=I.z,f[11]=0,f[12]=k.x,f[13]=k.y,f[14]=k.z,f[15]=0,f[16]=Math.PI/3,f[17]=G,this.device.queue.writeBuffer(this.camUniformBuffer,0,f);const O=ge(Math.PI/3,G,.1,200),R=te(O,r.viewMatrix),U=new Float32Array(28);U.set(R),U[16]=s.surfaceColor.r,U[17]=s.surfaceColor.g,U[18]=s.surfaceColor.b,U[19]=1,U[20]=s.dirToSun.x,U[21]=s.dirToSun.y,U[22]=s.dirToSun.z,U[23]=s.floorAmbient,U[24]=s.sceneExposure,U[25]=s.sunBrightness,this.device.queue.writeBuffer(this.renderUniformBuffer,0,U),s.showBoundsWireframe&&this.device.queue.writeBuffer(this.wireframeUniformBuffer,0,R.buffer,R.byteOffset,R.byteLength);const p=e.beginRenderPass({colorAttachments:[{view:t,clearValue:{r:.05,g:.05,b:.08,a:1},loadOp:"clear",storeOp:"store"}],depthStencilAttachment:{view:this.depthTexture.createView(),depthClearValue:1,depthLoadOp:"clear",depthStoreOp:"store"}});p.setPipeline(this.backgroundPipeline),p.setBindGroup(0,this.backgroundBindGroup),p.draw(3,1,0,0),p.setPipeline(this.drawPipeline),p.setBindGroup(0,this.drawBindGroup),p.drawIndirect(this.renderArgsBuffer,0),C>0&&(p.setPipeline(this.facePipeline),p.setBindGroup(0,this.faceBindGroup),p.setVertexBuffer(0,this.lineVertexBuffer,0),p.draw(C)),s.showBoundsWireframe&&c>0&&(p.setPipeline(this.wireframePipeline),p.setBindGroup(0,this.wireframeBindGroup),p.setVertexBuffer(0,this.wireframeVertexBuffer,0),p.draw(c)),p.end()}ensureDepthTexture(){const e=Math.max(1,this.canvas.width),t=Math.max(1,this.canvas.height);this.depthTexture&&e===this.depthWidth&&t===this.depthHeight||(this.depthTexture&&this.depthTexture.destroy(),this.depthTexture=this.device.createTexture({size:[e,t],format:"depth24plus",usage:GPUTextureUsage.RENDER_ATTACHMENT}),this.depthWidth=e,this.depthHeight=t)}}class Ve{device;clearPipeline;particlesPipeline;resolvePipeline;clearBindGroup;particlesBindGroup;resolveBindGroup;clearParamsBuffer;particlesParamsBuffer;resolveParamsBuffer;particlesParamsData;particlesParamsF32;particlesParamsU32;resolveParamsData;resolveParamsF32;resolveParamsU32;atomicDensityBuffer;densityTexture;_densityTextureView;densityTextureSize={x:1,y:1,z:1};densityWorkgroupSize={x:8,y:8,z:4};constructor(e){this.device=e;const t=e.createShaderModule({code:Be});this.clearPipeline=e.createComputePipeline({layout:"auto",compute:{module:t,entryPoint:"main"}}),this.clearParamsBuffer=e.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});const r=e.createShaderModule({code:Se});this.particlesPipeline=e.createComputePipeline({layout:"auto",compute:{module:r,entryPoint:"main"}}),this.particlesParamsData=new ArrayBuffer(64),this.particlesParamsF32=new Float32Array(this.particlesParamsData),this.particlesParamsU32=new Uint32Array(this.particlesParamsData),this.particlesParamsBuffer=e.createBuffer({size:64,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});const s=e.createShaderModule({code:Ue});this.resolvePipeline=e.createComputePipeline({layout:"auto",compute:{module:s,entryPoint:"main"}}),this.resolveParamsData=new ArrayBuffer(32),this.resolveParamsF32=new Float32Array(this.resolveParamsData),this.resolveParamsU32=new Uint32Array(this.resolveParamsData),this.resolveParamsBuffer=e.createBuffer({size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST})}get textureView(){return this._densityTextureView}get textureSize(){return this.densityTextureSize}recreate(e,t){this.densityTexture&&this.densityTexture.destroy(),this.createDensityTexture(e),this.createAtomicDensityBuffer(),this.createBindGroups(t)}dispatch(e,t,r){this.updateParams(t,r);const s=this.densityTextureSize.x*this.densityTextureSize.y*this.densityTextureSize.z,a=e.beginComputePass();a.setPipeline(this.clearPipeline),a.setBindGroup(0,this.clearBindGroup),a.dispatchWorkgroups(Math.ceil(s/256)),a.end();const i=e.beginComputePass();i.setPipeline(this.particlesPipeline),i.setBindGroup(0,this.particlesBindGroup),i.dispatchWorkgroups(Math.ceil(t/256)),i.end();const o=e.beginComputePass();o.setPipeline(this.resolvePipeline),o.setBindGroup(0,this.resolveBindGroup),o.dispatchWorkgroups(Math.ceil(this.densityTextureSize.x/this.densityWorkgroupSize.x),Math.ceil(this.densityTextureSize.y/this.densityWorkgroupSize.y),Math.ceil(this.densityTextureSize.z/this.densityWorkgroupSize.z)),o.end()}destroy(){this.densityTexture&&this.densityTexture.destroy(),this.atomicDensityBuffer&&this.atomicDensityBuffer.destroy()}createDensityTexture(e){const t=e.boundsSize,r=e.densityTextureRes/20,s=Math.max(1,Math.ceil(t.x*r)+1),a=Math.max(1,Math.ceil(t.y*r)+1),i=Math.max(1,Math.ceil(t.z*r)+1);this.densityTextureSize={x:s,y:a,z:i},this.densityTexture=this.device.createTexture({size:{width:s,height:a,depthOrArrayLayers:i},dimension:"3d",format:"rgba16float",usage:GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_SRC}),this._densityTextureView=this.densityTexture.createView({dimension:"3d"})}createAtomicDensityBuffer(){this.atomicDensityBuffer&&this.atomicDensityBuffer.destroy();const e=this.densityTextureSize.x*this.densityTextureSize.y*this.densityTextureSize.z;this.atomicDensityBuffer=this.device.createBuffer({size:e*4,usage:GPUBufferUsage.STORAGE})}createBindGroups(e){this.clearBindGroup=this.device.createBindGroup({layout:this.clearPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.atomicDensityBuffer}},{binding:1,resource:{buffer:this.clearParamsBuffer}}]}),this.particlesBindGroup=this.device.createBindGroup({layout:this.particlesPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:e}},{binding:1,resource:{buffer:this.atomicDensityBuffer}},{binding:2,resource:{buffer:this.particlesParamsBuffer}}]}),this.resolveBindGroup=this.device.createBindGroup({layout:this.resolvePipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.atomicDensityBuffer}},{binding:1,resource:this._densityTextureView},{binding:2,resource:{buffer:this.resolveParamsBuffer}}]})}updateParams(e,t){const r=t.smoothingRadius,s=15/(2*Math.PI*Math.pow(r,5)),a=1e3,i=this.densityTextureSize.x*this.densityTextureSize.y*this.densityTextureSize.z,o=new Uint32Array(4);o[0]=i,this.device.queue.writeBuffer(this.clearParamsBuffer,0,o);const d=t.boundsSize,n=d.x*.5,m=d.z*.5,l=-5,h=t.densityTextureRes/20;this.particlesParamsF32[0]=r,this.particlesParamsF32[1]=s,this.particlesParamsU32[2]=e,this.particlesParamsF32[3]=a,this.particlesParamsF32[4]=-n,this.particlesParamsF32[5]=l,this.particlesParamsF32[6]=-m,this.particlesParamsF32[7]=h,this.particlesParamsF32[8]=n,this.particlesParamsF32[9]=l+d.y,this.particlesParamsF32[10]=m,this.particlesParamsF32[11]=0,this.particlesParamsU32[12]=this.densityTextureSize.x,this.particlesParamsU32[13]=this.densityTextureSize.y,this.particlesParamsU32[14]=this.densityTextureSize.z,this.particlesParamsU32[15]=0,this.device.queue.writeBuffer(this.particlesParamsBuffer,0,this.particlesParamsData),this.resolveParamsF32[0]=a,this.resolveParamsF32[1]=0,this.resolveParamsF32[2]=0,this.resolveParamsF32[3]=0,this.resolveParamsU32[4]=this.densityTextureSize.x,this.resolveParamsU32[5]=this.densityTextureSize.y,this.resolveParamsU32[6]=this.densityTextureSize.z,this.resolveParamsU32[7]=0,this.device.queue.writeBuffer(this.resolveParamsBuffer,0,this.resolveParamsData)}}class _e{device;context;config;buffers;physics;grid;splatPipeline;renderer;pickingSystem;state;gridRes={x:0,y:0,z:0};gridTotalCells=0;isPicking=!1;interactionPos={x:0,y:0,z:0};physicsUniforms;gridUniforms;computeData=new Float32Array(8);integrateData=new Float32Array(24);hashParamsData=new Float32Array(8);sortParamsData=new Uint32Array(8);scanParamsDataL0=new Uint32Array(4);scanParamsDataL1=new Uint32Array(4);scanParamsDataL2=new Uint32Array(4);densityParamsData=new Float32Array(12);pressureParamsData=new Float32Array(16);viscosityParamsData=new Float32Array(12);constructor(e,t,r,s,a){this.device=e,this.context=t,this.config=s,this.physics=new xe(e),this.grid=new Pe(e),this.splatPipeline=new Ve(e),this.renderer=new Ae(e,r,a),this.pickingSystem=new ye(e),this.physicsUniforms={external:e.createBuffer({size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),density:e.createBuffer({size:48,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),pressure:e.createBuffer({size:64,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),viscosity:e.createBuffer({size:48,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),integrate:e.createBuffer({size:96,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST})},this.gridUniforms={hash:e.createBuffer({size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),sort:e.createBuffer({size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),scanL0:e.createBuffer({size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),scanL1:e.createBuffer({size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),scanL2:e.createBuffer({size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST})},this.reset()}get particleCount(){return this.buffers.particleCount}get simulationState(){return this.state}reset(){this.buffers&&this.buffers.destroy();const{boundsSize:e,smoothingRadius:t}=this.config;this.gridRes={x:Math.ceil(e.x/t),y:Math.ceil(e.y/t),z:Math.ceil(e.z/t)},this.gridTotalCells=this.gridRes.x*this.gridRes.y*this.gridRes.z;const r=ve(this.config);this.state=this.createStateFromSpawn(r),this.buffers=new be(this.device,r,{gridTotalCells:this.gridTotalCells}),this.physics.createBindGroups(this.buffers,this.physicsUniforms),this.grid.createBindGroups(this.buffers,this.gridUniforms),this.splatPipeline.recreate(this.config,this.buffers.predicted),this.renderer.recreate(this.splatPipeline.textureView,this.splatPipeline.textureSize),this.pickingSystem.createBindGroup(this.buffers.positions);const s=this.device.createCommandEncoder();this.splatPipeline.dispatch(s,this.buffers.particleCount,this.config),this.device.queue.submit([s.finish()])}createStateFromSpawn(e){return{positions:e.positions,predicted:new Float32Array(e.positions),velocities:e.velocities,densities:new Float32Array(e.count*2),keys:new Uint32Array(e.count),sortedKeys:new Uint32Array(e.count),indices:new Uint32Array(e.count),sortOffsets:new Uint32Array(e.count),spatialOffsets:new Uint32Array(e.count),positionsSorted:new Float32Array(e.count*4),predictedSorted:new Float32Array(e.count*4),velocitiesSorted:new Float32Array(e.count*4),count:e.count,input:{worldX:0,worldY:0,worldZ:0,pull:!1,push:!1}}}async step(e){const{config:t,buffers:r,device:s}=this,a=t.maxTimestepFPS?1/t.maxTimestepFPS:Number.POSITIVE_INFINITY,o=Math.min(e*t.timeScale,a)/t.iterationsPerFrame;this.updateUniforms(o);const d=s.createCommandEncoder();let n=!1;!this.isPicking&&this.state.input.rayOrigin&&this.state.input.rayDir&&(this.isPicking=!0,n=!0,this.pickingSystem.dispatch(d,this.state.input.rayOrigin,this.state.input.rayDir,t.smoothingRadius,r.particleCount));const m=d.beginComputePass();for(let h=0;h<t.iterationsPerFrame;h++)this.physics.step(m,this.grid,r.particleCount,this.gridTotalCells,t.viscosityStrength>0);m.end(),this.splatPipeline.dispatch(d,r.particleCount,t),s.queue.submit([d.finish()]),n&&this.pickingSystem.getResult().then(h=>{if(h&&h.hit){let y=h.hitPos.x,P=h.hitPos.y,v=h.hitPos.z;this.state.input.pull&&this.state.input.rayDir&&(y+=this.state.input.rayDir.x*.5,P+=this.state.input.rayDir.y*.5,v+=this.state.input.rayDir.z*.5),this.state.input.worldX=y,this.state.input.worldY=P,this.state.input.worldZ=v,this.state.input.isHoveringFluid=!0}else this.state.input.isHoveringFluid=!1;this.isPicking=!1});const l=.15;this.interactionPos.x+=(this.state.input.worldX-this.interactionPos.x)*l,this.interactionPos.y+=(this.state.input.worldY-this.interactionPos.y)*l,this.interactionPos.z+=(this.state.input.worldZ-this.interactionPos.z)*l}updateUniforms(e){const{config:t,state:r,buffers:s,device:a}=this;let i=0;r.input.push?i=-t.interactionStrength:r.input.pull&&(i=t.interactionStrength),this.computeData[0]=e,this.computeData[1]=t.gravity,this.computeData[2]=t.interactionRadius,this.computeData[3]=i,this.computeData[4]=this.interactionPos.x,this.computeData[5]=this.interactionPos.y,this.computeData[6]=this.interactionPos.z,this.computeData[7]=0,a.queue.writeBuffer(this.physicsUniforms.external,0,this.computeData),this.hashParamsData[0]=t.smoothingRadius,this.hashParamsData[1]=s.particleCount,this.hashParamsData[2]=-t.boundsSize.x*.5,this.hashParamsData[3]=-5,this.hashParamsData[4]=-t.boundsSize.z*.5,this.hashParamsData[5]=this.gridRes.x,this.hashParamsData[6]=this.gridRes.y,this.hashParamsData[7]=this.gridRes.z,a.queue.writeBuffer(this.gridUniforms.hash,0,this.hashParamsData),this.sortParamsData[0]=s.particleCount,this.sortParamsData[1]=this.gridTotalCells,a.queue.writeBuffer(this.gridUniforms.sort,0,this.sortParamsData);const o=Math.ceil((this.gridTotalCells+1)/512),d=Math.ceil(o/512);this.scanParamsDataL0[0]=this.gridTotalCells+1,this.scanParamsDataL1[0]=o,this.scanParamsDataL2[0]=d,a.queue.writeBuffer(this.gridUniforms.scanL0,0,this.scanParamsDataL0),a.queue.writeBuffer(this.gridUniforms.scanL1,0,this.scanParamsDataL1),a.queue.writeBuffer(this.gridUniforms.scanL2,0,this.scanParamsDataL2);const n=t.smoothingRadius,m=15/(2*Math.PI*Math.pow(n,5)),l=15/(Math.PI*Math.pow(n,6));this.densityParamsData[0]=n,this.densityParamsData[1]=m,this.densityParamsData[2]=l,this.densityParamsData[3]=s.particleCount,this.densityParamsData[4]=-t.boundsSize.x*.5,this.densityParamsData[5]=-5,this.densityParamsData[6]=-t.boundsSize.z*.5,this.densityParamsData[7]=0,this.densityParamsData[8]=this.gridRes.x,this.densityParamsData[9]=this.gridRes.y,this.densityParamsData[10]=this.gridRes.z,this.densityParamsData[11]=0,a.queue.writeBuffer(this.physicsUniforms.density,0,this.densityParamsData);const h=15/(Math.PI*Math.pow(n,5)),y=45/(Math.PI*Math.pow(n,6));this.pressureParamsData[0]=e,this.pressureParamsData[1]=t.targetDensity,this.pressureParamsData[2]=t.pressureMultiplier,this.pressureParamsData[3]=t.nearPressureMultiplier,this.pressureParamsData[4]=n,this.pressureParamsData[5]=h,this.pressureParamsData[6]=y,this.pressureParamsData[7]=s.particleCount,this.pressureParamsData[8]=-t.boundsSize.x*.5,this.pressureParamsData[9]=-5,this.pressureParamsData[10]=-t.boundsSize.z*.5,this.pressureParamsData[11]=0,this.pressureParamsData[12]=this.gridRes.x,this.pressureParamsData[13]=this.gridRes.y,this.pressureParamsData[14]=this.gridRes.z,this.pressureParamsData[15]=0,a.queue.writeBuffer(this.physicsUniforms.pressure,0,this.pressureParamsData);const P=315/(64*Math.PI*Math.pow(n,9));this.viscosityParamsData[0]=e,this.viscosityParamsData[1]=t.viscosityStrength,this.viscosityParamsData[2]=n,this.viscosityParamsData[3]=P,this.viscosityParamsData[4]=s.particleCount,this.viscosityParamsData[5]=-t.boundsSize.x*.5,this.viscosityParamsData[6]=-5,this.viscosityParamsData[7]=-t.boundsSize.z*.5,this.viscosityParamsData[8]=this.gridRes.x,this.viscosityParamsData[9]=this.gridRes.y,this.viscosityParamsData[10]=this.gridRes.z,this.viscosityParamsData[11]=0,a.queue.writeBuffer(this.physicsUniforms.viscosity,0,this.viscosityParamsData),this.integrateData[0]=e,this.integrateData[1]=t.collisionDamping;const b=(t.obstacleShape??"box")==="sphere",B=t.obstacleRadius??0,L=t.showObstacle!==!1&&(b?B>0:t.obstacleSize.x>0&&t.obstacleSize.y>0&&t.obstacleSize.z>0);this.integrateData[2]=L?1:0,this.integrateData[3]=b?1:0;const M=t.boundsSize,S=M.x*.5,D=M.z*.5,C=-5;this.integrateData[4]=-S,this.integrateData[5]=C,this.integrateData[6]=-D,this.integrateData[8]=S,this.integrateData[9]=C+M.y,this.integrateData[10]=D,this.integrateData[12]=t.obstacleCentre.x,this.integrateData[13]=b?t.obstacleCentre.y:t.obstacleCentre.y+t.obstacleSize.y*.5,this.integrateData[14]=t.obstacleCentre.z;const A=b?B:t.obstacleSize.x*.5,Y=b?B:t.obstacleSize.y*.5,c=b?B:t.obstacleSize.z*.5;this.integrateData[16]=A,this.integrateData[17]=Y,this.integrateData[18]=c,this.integrateData[20]=t.obstacleRotation.x,this.integrateData[21]=t.obstacleRotation.y,this.integrateData[22]=t.obstacleRotation.z,a.queue.writeBuffer(this.physicsUniforms.integrate,0,this.integrateData)}render(e){const t=this.device.createCommandEncoder();this.renderer.render(t,this.context.getCurrentTexture().createView(),e,this.config),this.device.queue.submit([t.finish()])}}export{_e as F};
