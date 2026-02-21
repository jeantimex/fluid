import{p as K,w as ae,m as ne,e as ee,f as re,g as oe,j as le,k as Q,F as ce,S as ue,P as de,l as he,n as fe}from"./picking_system-B3C-PV4U.js";import{e as pe}from"./environment-ODazOT3W.js";import{s as me,a as Pe,b as ge}from"./splat_resolve-CMJnQc1h.js";const ye=`/**
 * ============================================================================
 * PARTICLE BILLBOARD SHADER
 * ============================================================================
 *
 * Pipeline Stage: Render pass (final visualization)
 * Entry Points: vs_main (vertex), fs_main (fragment)
 *
 * Purpose:
 * --------
 * Renders fluid particles as camera-facing circular billboards with
 * velocity-based coloring. Uses modern GPU techniques for efficiency.
 *
 * Key Techniques Used:
 * --------------------
 *
 * 1. VERTEX PULLING (Programmable Vertex Fetch)
 *    Instead of using vertex buffers with position attributes, we:
 *    - Draw with draw(6, instanceCount)  ← 6 vertices, N instances
 *    - Use vertex_index (0-5) to determine quad corner
 *    - Fetch particle data from storage buffers using instance_index
 *
 *    Benefits:
 *    - No CPU/GPU vertex buffer sync needed
 *    - Particle data already in storage buffers from simulation
 *    - More flexible (can do arbitrary lookups)
 *
 * 2. BILLBOARD RENDERING
 *    Particles always face the camera (view-aligned quads).
 *    Instead of computing billboard orientation on CPU, we:
 *    - Project particle center to clip space
 *    - Offset in clip space (automatically screen-aligned)
 *
 *        Camera view:
 *        ┌─────────────────┐
 *        │    ┌───┐        │
 *        │    │ ● │ ←──── Particle always faces camera
 *        │    └───┘        │
 *        └─────────────────┘
 *
 * 3. CIRCLE IMPOSTOR (Pixel-level sphere rendering)
 *    Instead of rendering actual sphere geometry (expensive), we:
 *    - Render a quad
 *    - In fragment shader, discard pixels outside unit circle
 *    - Result looks like a sphere from any angle
 *
 *        Quad with circle impostor:
 *        ┌─────────────────┐
 *        │   ╭─────────╮   │  ← Discarded corners
 *        │ ╭─┤         ├─╮ │
 *        │ │ │    ●    │ │ │  ← Rendered circle
 *        │ ╰─┤         ├─╯ │
 *        │   ╰─────────╯   │
 *        └─────────────────┘
 *
 * 4. INDIRECT DRAWING (GPU-driven rendering)
 *    The number of particles to render comes from GPU buffer (culling result),
 *    not from CPU. Combined with visibleIndices lookup, only visible
 *    particles are processed.
 *
 * 5. VELOCITY-BASED COLORING
 *    Particle color is determined by speed (velocity magnitude):
 *    - Slow particles: Cool colors (blue)
 *    - Fast particles: Warm colors (red/white)
 *    - Uses a lookup table (gradient array) for smooth transitions
 *
 * Quad Vertex Layout:
 * -------------------
 *   vertex_index:  0     1     2     3     4     5
 *   quadPos:     (-1,-1)(1,-1)(-1,1)(-1,1)(1,-1)(1,1)
 *
 *        2,3───────5
 *         │ ╲      │
 *         │   ╲    │
 *         │     ╲  │
 *         │       ╲│
 *        0─────────1,4
 *
 *   Two triangles: (0,1,2) and (3,4,5)
 *
 * ============================================================================
 */

// Beginner note: instance_index selects which particle to draw from visibleIndices.

/**
 * Render Uniforms Buffer
 *
 * Memory Layout (16-byte aligned):
 * Offset  Size  Field
 * ------  ----  -----
 *   0     64    viewProjection     - Combined View × Projection matrix
 *  64      8    canvasSize         - Canvas dimensions in pixels (width, height)
 *  72      4    particleRadius     - Visual radius of particles in pixels
 *  76      4    velocityDisplayMax - Speed at which color is fully saturated
 *  80      4    sceneExposure      - Exposure multiplier
 *  84      4    ambient            - Ambient lighting factor
 *  88      4    sunBrightness      - Sun intensity multiplier
 *  92      4    pad0               - Padding
 *  96     12    lightDir           - Directional light (world space)
 * 108      4    pad1               - Padding
 * ------
 * Total: 80 bytes
 */
struct Uniforms {
  viewProjection: mat4x4<f32>,
  canvasSize: vec2<f32>,
  particleRadius: f32,
  velocityDisplayMax: f32,
  sceneExposure: f32,
  ambient: f32,
  sunBrightness: f32,
  pad0: f32,
  lightDir: vec3<f32>,
  pad1: f32,
};

// ============================================================================
// BUFFER BINDINGS
// ============================================================================
// Group 0: Particle render pass
//
//   Binding 0: positions[]       - Particle positions (world space)
//   Binding 1: velocities[]      - Particle velocities (for coloring)
//   Binding 2: uniforms          - Render parameters
//   Binding 3: gradient[]        - Color lookup table (vec4, RGBA)
//              Indexed by normalized speed [0, 1] → [0, gradient.length-1]
//   Binding 4: visibleIndices[]  - From culling pass
//              Maps instance_index → actual particle index
//   Binding 5: shadowTex         - Shadow map depth texture
//   Binding 6: shadowSampler     - Comparison sampler for shadow map
//   Binding 7: shadowUniforms    - Light view-projection + softness
// ============================================================================

@group(0) @binding(0) var<storage, read> positions: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read> velocities: array<vec4<f32>>;
@group(0) @binding(2) var<uniform> uniforms: Uniforms;
@group(0) @binding(3) var<storage, read> gradient: array<vec4<f32>>;
@group(0) @binding(4) var<storage, read> visibleIndices: array<u32>;
@group(0) @binding(5) var shadowTex: texture_depth_2d;
@group(0) @binding(6) var shadowSampler: sampler_comparison;

#include "../../common/shaders/shadow_common.wgsl"

@group(0) @binding(7) var<uniform> shadowUniforms: ShadowUniforms;

/**
 * Vertex Shader Output / Fragment Shader Input
 *
 * @builtin(position) - Clip space position (required for rasterization)
 * @location(0) uv    - Quad UV coordinates [-1, 1] for circle test
 * @location(1) color - Velocity-based color (RGB)
 */
struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) color: vec3<f32>,
  @location(2) worldPos: vec3<f32>,
};

/**
 * Vertex Shader
 *
 * Generates billboard quads for each visible particle.
 *
 * Input:
 *   vertexIndex   - Which vertex of the quad (0-5)
 *   instanceIndex - Which visible particle (maps through visibleIndices)
 *
 * Output:
 *   Clip-space position for rasterization
 *   UV coordinates for circle impostor
 *   Velocity-based color
 */
@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instanceIndex: u32) -> VertexOutput {

  // ========================================================================
  // INDIRECT LOOKUP
  // ========================================================================
  // instanceIndex is NOT the particle index directly!
  // It's an index into the compacted visible list from culling.
  //
  // Example:
  //   All particles: [0, 1, 2, 3, 4, 5, 6, 7]
  //   Visible:       [2, 5, 7]
  //   visibleIndices = [2, 5, 7]
  //
  //   instanceIndex=0 → visibleIndices[0]=2 → particle 2
  //   instanceIndex=1 → visibleIndices[1]=5 → particle 5
  //   instanceIndex=2 → visibleIndices[2]=7 → particle 7
  let index = visibleIndices[instanceIndex];

  // Fetch particle data from storage buffers
  let pos = positions[index].xyz;
  let vel = velocities[index].xyz;

  // ========================================================================
  // QUAD VERTEX GENERATION
  // ========================================================================
  // Generate quad corner position based on vertex index.
  // Two triangles form the quad:
  //   Triangle 1: vertices 0, 1, 2
  //   Triangle 2: vertices 3, 4, 5
  //
  //        (-1,1)───────(1,1)
  //           2,3─────────5
  //            │ ╲       │
  //            │   ╲     │   Winding: Counter-clockwise
  //            │     ╲   │
  //            │       ╲ │
  //           0─────────1,4
  //        (-1,-1)     (1,-1)
  //
  // quadPos values are in range [-1, 1], used as both:
  //   1. Offset direction for billboard expansion
  //   2. UV coordinates for circle impostor test
  var quadPos = vec2<f32>(0.0, 0.0);
  switch (vertexIndex) {
    case 0u: { quadPos = vec2<f32>(-1.0, -1.0); }  // Bottom-left
    case 1u: { quadPos = vec2<f32>( 1.0, -1.0); }  // Bottom-right
    case 2u: { quadPos = vec2<f32>(-1.0,  1.0); }  // Top-left
    case 3u: { quadPos = vec2<f32>(-1.0,  1.0); }  // Top-left (shared)
    case 4u: { quadPos = vec2<f32>( 1.0, -1.0); }  // Bottom-right (shared)
    case 5u: { quadPos = vec2<f32>( 1.0,  1.0); }  // Top-right
    default: { quadPos = vec2<f32>(0.0, 0.0); }
  }

  // ========================================================================
  // PROJECT PARTICLE CENTER TO CLIP SPACE
  // ========================================================================
  // clipPos = ViewProjection × (pos, 1)
  // After perspective divide (by w), this becomes NDC position
  let clipPos = uniforms.viewProjection * vec4<f32>(pos, 1.0);

  // ========================================================================
  // BILLBOARD SIZE CALCULATION
  // ========================================================================
  // We want particles to have a fixed pixel size on screen, but still
  // shrink with distance (perspective effect).
  //
  // radiusNdc converts pixel size to NDC:
  //   NDC range is [-1, 1] = 2 units total
  //   Canvas has canvasSize pixels
  //   So 1 pixel = 2 / canvasSize NDC units
  //   particleRadius pixels = particleRadius × 2 / canvasSize NDC units
  //
  // The perspective correction (multiply by clipPos.w) is applied when
  // we add the offset in clip space. This makes particles shrink with
  // distance while maintaining consistent screen-space size at a
  // reference distance.
  let radiusNdc = vec2<f32>(
    uniforms.particleRadius / uniforms.canvasSize.x * 2.0,
    uniforms.particleRadius / uniforms.canvasSize.y * 2.0
  );

  // ========================================================================
  // APPLY BILLBOARD OFFSET
  // ========================================================================
  // Offset is applied in CLIP SPACE (before perspective divide).
  //
  // Why multiply by clipPos.w?
  //   After perspective divide: finalPos.xy = clipPos.xy / clipPos.w
  //   If we add offset in clip space: finalPos.xy = (clipPos.xy + offset) / clipPos.w
  //   For offset to result in radiusNdc screen movement:
  //     offset / clipPos.w = radiusNdc × quadPos
  //     offset = radiusNdc × quadPos × clipPos.w
  //
  // This keeps the quad screen-aligned (always facing camera) and
  // properly sized regardless of particle distance.
  let offset = quadPos * radiusNdc * clipPos.w;

  // Build output
  var out: VertexOutput;

  // Final position: particle center + billboard offset
  // Only X and Y are offset; Z stays at particle depth
  out.position = clipPos + vec4<f32>(offset, 0.0, 0.0);

  // Pass UV coordinates for fragment shader circle test
  // quadPos is in [-1, 1], so distance from center is length(quadPos)
  out.uv = quadPos;
  out.worldPos = pos;

  // ========================================================================
  // VELOCITY-BASED COLOR
  // ========================================================================
  // Map particle speed to a color from the gradient lookup table.
  //
  // speed = |velocity|
  // t = clamp(speed / maxSpeed, 0, 1)
  // colorIndex = t × (gradientLength - 1)
  //
  // Typical gradient: Blue (slow) → Cyan → Green → Yellow → Red (fast)
  let speed = length(vel);
  let t = saturate(speed / uniforms.velocityDisplayMax);
  let colorIndex = u32(t * f32(arrayLength(&gradient) - 1u));
  out.color = gradient[colorIndex].rgb;

  return out;
}

fn sampleShadow(worldPos: vec3<f32>) -> f32 {
  let lightPos = shadowUniforms.lightViewProjection * vec4<f32>(worldPos, 1.0);
  let ndc = lightPos.xyz / lightPos.w;
  let uv = vec2<f32>(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);

  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 || ndc.z < 0.0 || ndc.z > 1.0) {
    return 1.0;
  }

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

/**
 * Fragment Shader
 *
 * Renders particles as circles using the impostor technique.
 * Pixels outside the unit circle are discarded, creating
 * a circular appearance from square quads.
 *
 * Input:
 *   in.uv    - Coordinates in [-1, 1], center is (0, 0)
 *   in.color - Velocity-based color from vertex shader
 *
 * Output:
 *   RGBA color (alpha = 1.0 for opaque particles)
 */
@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
  // ========================================================================
  // CIRCLE IMPOSTOR TEST
  // ========================================================================
  // The UV coordinates range from -1 to 1.
  // The unit circle has radius 1, so points with |uv| > 1 are outside.
  //
  // Visualization:
  //   ┌───────────────┐
  //   │╲   discard   ╱│
  //   │  ╲─────────╱  │
  //   │   │ keep  │   │  length(uv) ≤ 1: rendered
  //   │  ╱─────────╲  │  length(uv) > 1: discarded
  //   │╱   discard   ╲│
  //   └───────────────┘
  //
  // This creates smooth circular particles without needing actual
  // circle geometry or textures.
  let d = length(in.uv);
  if (d > 1.0) {
    discard;  // Don't write to color or depth buffer
  }

  // Return opaque colored pixel
  // Alpha = 1.0 (fully opaque)
  let shadow = sampleShadow(in.worldPos);
  let lighting = uniforms.ambient + uniforms.sunBrightness * shadow;
  return vec4<f32>(in.color * lighting * uniforms.sceneExposure, 1.0);
}
`,we=`/**
 * ==========================================================================
 * OBSTACLE FACE SHADER (Shadowed)
 * ==========================================================================
 */

// Beginner note: this is a standard vertex/fragment shader that also samples
// the shadow map to darken the obstacle where fluid blocks the light.

struct Uniforms {
  viewProjection: mat4x4<f32>,
  canvasSize: vec2<f32>,
  particleRadius: f32,
  velocityDisplayMax: f32,
  sceneExposure: f32,
  ambient: f32,
  sunBrightness: f32,
  pad0: f32,
  lightDir: vec3<f32>,
  pad1: f32,
};

struct ShadowUniforms {
  lightViewProjection: mat4x4<f32>,
  shadowSoftness: f32,
  particleShadowRadius: f32,
  pad0: vec2<f32>,
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
  let ndotl = max(dot(n, l), 0.0);
  let shadow = sampleShadow(input.worldPos, ndotl);
  // Use standard diffuse lighting (matching environment.wgsl) instead of half-lambert
  let shading = uniforms.ambient + ndotl * uniforms.sunBrightness * shadow;
  return vec4<f32>(input.color.rgb * shading * uniforms.sceneExposure, input.color.a);
}
`,xe=`#include "shadow_common.wgsl"

// Beginner note: this renders particles into the shadow map (depth only).

@group(0) @binding(0) var<uniform> uniforms: ShadowUniforms;

// --- PARTICLES (Storage Buffer) ---
@group(0) @binding(1) var<storage, read> positions: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> visibleIndices: array<u32>;

struct ParticleOutput {
  @builtin(position) position: vec4<f32>,
};

@vertex
fn vs_particles(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instanceIndex: u32) -> ParticleOutput {
  let particleIndex = visibleIndices[instanceIndex];
  let pos = positions[particleIndex].xyz;
  let clipPos = uniforms.lightViewProjection * vec4<f32>(pos, 1.0);

  var quadPos = vec2<f32>(0.0, 0.0);
  switch (vertexIndex) {
    case 0u: { quadPos = vec2<f32>(-1.0, -1.0); }
    case 1u: { quadPos = vec2<f32>( 1.0, -1.0); }
    case 2u: { quadPos = vec2<f32>(-1.0,  1.0); }
    case 3u: { quadPos = vec2<f32>(-1.0,  1.0); }
    case 4u: { quadPos = vec2<f32>( 1.0, -1.0); }
    case 5u: { quadPos = vec2<f32>( 1.0,  1.0); }
    default: { quadPos = vec2<f32>(0.0, 0.0); }
  }

  let offset = quadPos * uniforms.particleShadowRadius;

  var out: ParticleOutput;
  out.position = clipPos + vec4<f32>(offset, 0.0, 0.0);
  return out;
}

// --- OBSTACLE (Vertex Buffer) ---
struct ObstacleInput {
  @location(0) position: vec3<f32>,
};

@vertex
fn vs_obstacle(in: ObstacleInput) -> @builtin(position) vec4<f32> {
  return uniforms.lightViewProjection * vec4<f32>(in.position, 1.0);
}
`,ve=`// =============================================================================
// Background Shader
// =============================================================================
// Renders the shared environment (Sky + Floor) using a fullscreen triangle.

// Beginner note: this pass ignores particles and draws only sky/floor.

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

#include "../../common/shaders/shadow_common.wgsl"

@group(0) @binding(5) var shadowTex: texture_depth_2d;
@group(0) @binding(6) var shadowSampler: sampler_comparison;
@group(0) @binding(7) var<uniform> shadowUniforms: ShadowUniforms;

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

fn sampleShadowMap(worldPos: vec3<f32>) -> f32 {
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

    // Volume-based shadow (transmittance)
    let shadowDepth = calculateDensityForShadow(hitPos, params.dirToSun, 100.0);
    let volumeShadow = transmittance(shadowDepth * 2.0);
    
    // 2D Shadow Map (particles + obstacle)
    let shadow2D = sampleShadowMap(hitPos);
    
    let ambient = clamp(params.floorAmbient, 0.0, 1.0);
    let sun = max(0.0, params.dirToSun.y) * params.sunBrightness;
    
    // Combine both shadows: Ambient + Sun * Shadow2D * VolumeShadow
    var finalColor = tileCol * (ambient + sun * shadow2D * volumeShadow) * params.globalBrightness;

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
    let worldPos = origin + dir * obsT;
    let a = clamp(params.obstacleAlpha, 0.0, 1.0);
    let ambient = params.floorAmbient;
    let sun = max(0.0, dot(obsNormal, params.dirToSun)) * params.sunBrightness;
    
    // Obstacle also receives shadows
    let shadow = sampleShadowMap(worldPos);
    let lit = params.obstacleColor * (ambient + sun * shadow);
    
    return mix(bgCol, lit, a);
  }

  return bgCol;
}
`,be=`/**
 * ============================================================================
 * GPU FRUSTUM CULLING SHADER
 * ============================================================================
 *
 * Pipeline Stage: Pre-render (After physics, before particle rendering)
 * Entry Point: main
 * Workgroup Size: 256 threads
 *
 * Purpose:
 * --------
 * Determines which particles are visible to the camera and builds a compact
 * list of visible particle indices. This dramatically reduces rendering cost
 * by skipping off-screen particles.
 *
 * Performance Impact:
 * -------------------
 * Without culling: All N particles rendered, even if 80% are off-screen
 * With culling: Only visible particles rendered
 *
 * Typical scenarios:
 *   - Zoomed in: Maybe 10-20% visible → 5-10x faster rendering
 *   - Looking at corner: Maybe 30% visible → 3x faster rendering
 *   - Full view: ~100% visible → minimal overhead from culling pass
 *
 * Indirect Rendering:
 * -------------------
 * The culling result feeds into WebGPU's indirect draw mechanism:
 *
 *   CPU: encoder.drawIndirect(indirectBuffer, 0)
 *   GPU: Reads draw parameters FROM GPU buffer (not from CPU)
 *
 * This eliminates the CPU-GPU roundtrip that would be needed to read
 * the visible count back to CPU.
 *
 *     Traditional approach (slow):
 *     ┌─────┐                    ┌─────┐
 *     │ CPU │ ←── read count ─── │ GPU │  (sync stall!)
 *     │     │ ──── draw(N) ────→ │     │
 *     └─────┘                    └─────┘
 *
 *     Indirect approach (fast):
 *     ┌─────┐                    ┌─────┐
 *     │ CPU │ ── drawIndirect ─→ │ GPU │  (no readback!)
 *     └─────┘                    │     │
 *                                │ uses │
 *                                │count │
 *                                │from  │
 *                                │buffer│
 *                                └─────┘
 *
 * Frustum Culling in Clip Space:
 * ------------------------------
 * After multiplying by ViewProjection matrix, a point is in clip space.
 * In WebGPU clip space:
 *
 *   X ∈ [-w, +w]  (left to right)
 *   Y ∈ [-w, +w]  (bottom to top)
 *   Z ∈ [0, +w]   (near to far) ← Note: WebGPU uses [0,1] not [-1,1]
 *
 * A point is visible if ALL these conditions are true:
 *   -w ≤ x ≤ +w  AND  -w ≤ y ≤ +w  AND  0 ≤ z ≤ w
 *
 * We expand the bounds by particle radius to prevent particles from
 * popping in/out at frustum edges (the center might be outside but
 * the particle's visual extent overlaps the frustum).
 *
 * Output:
 * -------
 *   visibleIndices[]: Compact list of visible particle indices
 *   indirectArgs.instanceCount: Number of visible particles
 *
 *   Example:
 *     All particles: [0, 1, 2, 3, 4, 5, 6, 7]
 *     Visible:       [0, 2, 5, 7]  (4 particles visible)
 *
 *     indirectArgs = {
 *       vertexCount: 6,        // 6 vertices per particle (quad)
 *       instanceCount: 4,      // 4 particles to draw
 *       firstVertex: 0,
 *       firstInstance: 0
 *     }
 *
 * ============================================================================
 */

// Beginner note: outputs visibleIndices[] and updates indirectArgs.instanceCount.

/**
 * Culling Parameters Uniform Buffer
 *
 * Memory Layout (16-byte aligned, mat4 is 64 bytes):
 * Offset  Size  Field
 * ------  ----  -----
 *   0     64    viewProjection  - Combined view × projection matrix
 *  64      4    radius          - Particle radius for frustum expansion
 *  68      4    particleCount   - Total number of particles
 *  72      8    pad0            - Padding for 16-byte alignment
 * ------
 * Total: 80 bytes
 */
struct CullParams {
  viewProjection: mat4x4<f32>,
  radius: f32,
  particleCount: u32,
  pad0: vec2<f32>,
};

/**
 * Indirect Draw Arguments Structure
 *
 * Matches WebGPU's GPUDrawIndirectArgs layout:
 *   struct GPUDrawIndirectArgs {
 *     vertexCount: u32,    // Vertices per instance (6 for quad)
 *     instanceCount: u32,  // Number of instances to draw
 *     firstVertex: u32,    // Starting vertex index
 *     firstInstance: u32,  // Starting instance index
 *   }
 *
 * instanceCount is atomic because multiple threads increment it
 * concurrently as they discover visible particles.
 */
struct IndirectArgs {
  vertexCount: u32,
  instanceCount: atomic<u32>,
  firstVertex: u32,
  firstInstance: u32,
};

// ============================================================================
// BUFFER BINDINGS
// ============================================================================
// Group 0: Culling compute pass
//
//   Binding 0: positions[]      - Particle positions (world space)
//   Binding 1: visibleIndices[] - Output: compact list of visible indices
//              Pre-allocated to particleCount (worst case all visible)
//   Binding 2: indirectArgs     - Output: draw parameters for rendering
//              instanceCount is atomically incremented for each visible particle
//   Binding 3: params           - Culling parameters (matrix, radius, count)
// ============================================================================

@group(0) @binding(0) var<storage, read> positions: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> visibleIndices: array<u32>;
@group(0) @binding(2) var<storage, read_write> indirectArgs: IndirectArgs;
@group(0) @binding(3) var<uniform> params: CullParams;

/**
 * Main Culling Compute Kernel
 *
 * Tests each particle against the view frustum and builds a list of
 * visible particle indices.
 *
 * Dispatch: ceil(particleCount / 256) workgroups
 *
 * IMPORTANT: Before dispatching, the CPU must reset indirectArgs:
 *   indirectArgs.instanceCount = 0  (will be atomically incremented)
 *   indirectArgs.vertexCount = 6    (6 vertices per particle quad)
 *   indirectArgs.firstVertex = 0
 *   indirectArgs.firstInstance = 0
 */
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let index = id.x;

  // Bounds check
  if (index >= params.particleCount) {
    return;
  }

  // Get particle's world-space position
  let pos = positions[index].xyz;

  // ========================================================================
  // TRANSFORM TO CLIP SPACE
  // ========================================================================
  // clipPos = ViewProjection × worldPos
  //
  // After this transformation:
  //   clipPos.x, clipPos.y, clipPos.z are in homogeneous clip coordinates
  //   clipPos.w is the homogeneous divisor (perspective depth)
  //
  // For points in front of the camera: clipPos.w > 0
  // For points behind the camera: clipPos.w < 0 (automatically culled)
  let clipPos = params.viewProjection * vec4<f32>(pos, 1.0);

  // ========================================================================
  // FRUSTUM TEST IN CLIP SPACE
  // ========================================================================
  // WebGPU uses a specific clip space convention:
  //   X: [-w, +w] maps to screen left to right
  //   Y: [-w, +w] maps to screen bottom to top
  //   Z: [0, +w]  maps to near plane to far plane (depth)
  //
  // A point is visible if:
  //   -w ≤ x ≤ +w  AND  -w ≤ y ≤ +w  AND  0 ≤ z ≤ w
  //
  // We expand bounds by particle radius to prevent popping.
  // This is an approximation (true expansion would be view-dependent),
  // but works well in practice.
  let r = params.radius;

  // Visibility check with radius expansion:
  //   X: from (-w - r) to (+w + r)
  //   Y: from (-w - r) to (+w + r)
  //   Z: from (-r) to (+w + r)  ← Near plane can be slightly negative for radius
  //
  // Note: If clipPos.w < 0 (behind camera), these checks will fail
  // because the inequalities reverse for negative w.

  if (clipPos.x >= -clipPos.w - r && clipPos.x <= clipPos.w + r &&
      clipPos.y >= -clipPos.w - r && clipPos.y <= clipPos.w + r &&
      clipPos.z >= -r && clipPos.z <= clipPos.w + r) {

      // ====================================================================
      // PARTICLE IS VISIBLE - Add to output list
      // ====================================================================
      // Atomically reserve a slot in the visibleIndices array.
      // atomicAdd returns the OLD value (before increment), which becomes
      // our unique write position.
      //
      // Even if many threads pass the visibility test simultaneously,
      // each gets a unique slot due to atomic operation.
      let slot = atomicAdd(&indirectArgs.instanceCount, 1u);

      // Store this particle's index at the reserved slot
      // The render shader will read from visibleIndices[instance_index]
      // to get the actual particle data
      visibleIndices[slot] = index;
  }
  // If not visible, this particle is simply not added to the list
  // (it's as if it doesn't exist for rendering purposes)
}
`;function Se(H,e){const s=[...H].sort((a,n)=>a.t-n.t),t=new Array(e);for(let a=0;a<e;a+=1){const n=e===1?0:a/(e-1);let i=s[0],r=s[s.length-1];for(let u=0;u<s.length-1;u+=1){const b=s[u],P=s[u+1];if(n>=b.t&&n<=P.t){i=b,r=P;break}}const d=r.t-i.t||1,o=(n-i.t)/d,y=i.r+(r.r-i.r)*o,h=i.g+(r.g-i.g)*o,c=i.b+(r.b-i.b)*o;t[a]={r:y,g:h,b:c}}return t}class Be{device;particlePipeline;facePipeline;backgroundPipeline;shadowParticlePipeline;shadowObstaclePipeline;wireframePipeline;cullPipeline;uniformBuffer;gradientBuffer;envUniformBuffer;camUniformBuffer;shadowUniformBuffer;particleBindGroup;faceBindGroup;backgroundBindGroup;shadowParticleBindGroup;shadowObstacleBindGroup;wireframeBindGroup;cullBindGroup;lineVertexBuffer;lineVertexData;wireframeVertexBuffer;wireframeVertexData;wireframeUniformBuffer;canvas;depthTexture;depthWidth=0;depthHeight=0;shadowTexture;shadowMapSize=2048;shadowSampler;densitySampler;densityUniformBuffer;lastObstacleParams="";lastWireframeParams="";lastEnvParams="";lastFaceCount=0;lastWireframeVertexCount=0;constructor(e,s,t,a){this.device=e,this.canvas=s,this.uniformBuffer=e.createBuffer({size:112,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.envUniformBuffer=e.createBuffer({size:240,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.camUniformBuffer=e.createBuffer({size:80,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.densityUniformBuffer=e.createBuffer({size:64,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.shadowUniformBuffer=e.createBuffer({size:96,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});const n=Se(a.colorKeys,a.gradientResolution),i=new Float32Array(a.gradientResolution*4);for(let f=0;f<n.length;f++)i[f*4]=n[f].r,i[f*4+1]=n[f].g,i[f*4+2]=n[f].b,i[f*4+3]=1;this.gradientBuffer=e.createBuffer({size:i.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST,mappedAtCreation:!0}),new Float32Array(this.gradientBuffer.getMappedRange()).set(i),this.gradientBuffer.unmap();const r=K(ye,{"../../common/shaders/shadow_common.wgsl":Q}),d=e.createShaderModule({code:r});this.particlePipeline=e.createRenderPipeline({layout:"auto",vertex:{module:d,entryPoint:"vs_main"},fragment:{module:d,entryPoint:"fs_main",targets:[{format:t}]},primitive:{topology:"triangle-list"},depthStencil:{format:"depth24plus",depthWriteEnabled:!0,depthCompare:"less"}});const o=K(we,{"../../common/shaders/shadow_common.wgsl":Q}),y=e.createShaderModule({code:o});this.facePipeline=e.createRenderPipeline({layout:"auto",vertex:{module:y,entryPoint:"vs_main",buffers:[{arrayStride:40,attributes:[{shaderLocation:0,offset:0,format:"float32x3"},{shaderLocation:1,offset:12,format:"float32x3"},{shaderLocation:2,offset:24,format:"float32x4"}]}]},fragment:{module:y,entryPoint:"fs_main",targets:[{format:t,blend:{color:{srcFactor:"src-alpha",dstFactor:"one-minus-src-alpha",operation:"add"},alpha:{srcFactor:"one",dstFactor:"one-minus-src-alpha",operation:"add"}}}]},primitive:{topology:"triangle-list",cullMode:"back"},depthStencil:{format:"depth24plus",depthWriteEnabled:!1,depthCompare:"less"}});const h=K(ve,{"../../common/shaders/environment.wgsl":pe,"../../common/shaders/shadow_common.wgsl":Q}),c=e.createShaderModule({code:h});this.backgroundPipeline=e.createRenderPipeline({layout:"auto",vertex:{module:c,entryPoint:"vs_main"},fragment:{module:c,entryPoint:"fs_main",targets:[{format:t}]},primitive:{topology:"triangle-list"},depthStencil:{format:"depth24plus",depthWriteEnabled:!1,depthCompare:"always"}});const u=K(xe,{"shadow_common.wgsl":Q}),b=e.createShaderModule({code:u});this.shadowParticlePipeline=e.createRenderPipeline({layout:"auto",vertex:{module:b,entryPoint:"vs_particles"},primitive:{topology:"triangle-list",cullMode:"none"},depthStencil:{format:"depth24plus",depthWriteEnabled:!0,depthCompare:"less"}}),this.shadowObstaclePipeline=e.createRenderPipeline({layout:"auto",vertex:{module:b,entryPoint:"vs_obstacle",buffers:[{arrayStride:40,attributes:[{shaderLocation:0,offset:0,format:"float32x3"}]}]},primitive:{topology:"triangle-list",cullMode:"back"},depthStencil:{format:"depth24plus",depthWriteEnabled:!0,depthCompare:"less"}});const P=e.createShaderModule({code:be});this.cullPipeline=e.createComputePipeline({layout:"auto",compute:{module:P,entryPoint:"main"}});const m=e.createShaderModule({code:ae});this.wireframePipeline=e.createRenderPipeline({layout:"auto",vertex:{module:m,entryPoint:"vs_main",buffers:[{arrayStride:28,attributes:[{shaderLocation:0,offset:0,format:"float32x3"},{shaderLocation:1,offset:12,format:"float32x4"}]}]},fragment:{module:m,entryPoint:"fs_main",targets:[{format:t}]},primitive:{topology:"line-list"},depthStencil:{format:"depth24plus",depthWriteEnabled:!0,depthCompare:"less"}}),this.wireframeUniformBuffer=e.createBuffer({size:64,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.wireframeVertexData=new Float32Array(168),this.wireframeVertexBuffer=e.createBuffer({size:this.wireframeVertexData.byteLength,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});const x=384*6,z=Math.max(36,x)*10;this.lineVertexData=new Float32Array(z),this.lineVertexBuffer=e.createBuffer({size:this.lineVertexData.byteLength,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST}),this.shadowTexture=this.device.createTexture({size:[this.shadowMapSize,this.shadowMapSize],format:"depth24plus",usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING}),this.shadowSampler=this.device.createSampler({compare:"less",magFilter:"linear",minFilter:"linear"}),this.faceBindGroup=e.createBindGroup({layout:this.facePipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.uniformBuffer}},{binding:1,resource:this.shadowTexture.createView()},{binding:2,resource:this.shadowSampler},{binding:3,resource:{buffer:this.shadowUniformBuffer}}]}),this.shadowObstacleBindGroup=e.createBindGroup({layout:this.shadowObstaclePipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.shadowUniformBuffer}}]}),this.wireframeBindGroup=e.createBindGroup({layout:this.wireframePipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.wireframeUniformBuffer}}]}),this.densitySampler=this.device.createSampler({addressModeU:"clamp-to-edge",addressModeV:"clamp-to-edge",addressModeW:"clamp-to-edge",magFilter:"linear",minFilter:"linear"}),this.resize()}resize(){const e=this.canvas.width,s=this.canvas.height;this.depthTexture&&e===this.depthWidth&&s===this.depthHeight||(this.depthTexture&&this.depthTexture.destroy(),this.depthTexture=this.device.createTexture({size:[e,s],format:"depth24plus",usage:GPUTextureUsage.RENDER_ATTACHMENT}),this.depthWidth=e,this.depthHeight=s)}createBindGroup(e,s,t){this.particleBindGroup=this.device.createBindGroup({layout:this.particlePipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:e.positions}},{binding:1,resource:{buffer:e.velocities}},{binding:2,resource:{buffer:this.uniformBuffer}},{binding:3,resource:{buffer:this.gradientBuffer}},{binding:4,resource:{buffer:e.visibleIndices}},{binding:5,resource:this.shadowTexture.createView()},{binding:6,resource:this.shadowSampler},{binding:7,resource:{buffer:this.shadowUniformBuffer}}]}),this.shadowParticleBindGroup=this.device.createBindGroup({layout:this.shadowParticlePipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.shadowUniformBuffer}},{binding:1,resource:{buffer:e.positions}},{binding:2,resource:{buffer:e.visibleIndices}}]}),this.cullBindGroup=this.device.createBindGroup({layout:this.cullPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:e.positions}},{binding:1,resource:{buffer:e.visibleIndices}},{binding:2,resource:{buffer:e.indirectDraw}},{binding:3,resource:{buffer:t}}]}),this.backgroundBindGroup=this.device.createBindGroup({layout:this.backgroundPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.envUniformBuffer}},{binding:1,resource:{buffer:this.camUniformBuffer}},{binding:2,resource:s},{binding:3,resource:this.densitySampler},{binding:4,resource:{buffer:this.densityUniformBuffer}},{binding:5,resource:this.shadowTexture.createView()},{binding:6,resource:this.shadowSampler},{binding:7,resource:{buffer:this.shadowUniformBuffer}}]})}buildObstacleGeometry(e){const s=e.obstacleShape??"box",t=e.obstacleColor??{r:1,g:0,b:0},a=e.obstacleAlpha??.8;if(s==="sphere"){const p=e.obstacleRadius??0;if(p<=0)return{faceCount:0};const S=e.obstacleCentre.x,T=e.obstacleCentre.y,M=e.obstacleCentre.z;let g=0;const U=(A,E)=>{this.lineVertexData[g++]=A[0],this.lineVertexData[g++]=A[1],this.lineVertexData[g++]=A[2],this.lineVertexData[g++]=E[0],this.lineVertexData[g++]=E[1],this.lineVertexData[g++]=E[2],this.lineVertexData[g++]=t.r,this.lineVertexData[g++]=t.g,this.lineVertexData[g++]=t.b,this.lineVertexData[g++]=a},D=16,V=24;for(let A=0;A<D;A++){const E=A/D,te=(A+1)/D,F=E*Math.PI,C=te*Math.PI;for(let k=0;k<V;k++){const X=k/V,W=(k+1)/V,_=X*Math.PI*2,L=W*Math.PI*2,R=[Math.sin(F)*Math.cos(_),Math.cos(F),Math.sin(F)*Math.sin(_)],v=[Math.sin(F)*Math.cos(L),Math.cos(F),Math.sin(F)*Math.sin(L)],G=[Math.sin(C)*Math.cos(_),Math.cos(C),Math.sin(C)*Math.sin(_)],se=[Math.sin(C)*Math.cos(L),Math.cos(C),Math.sin(C)*Math.sin(L)],Y=Z=>{const ie=Z;U([Z[0]*p+S,Z[1]*p+T,Z[2]*p+M],ie)};Y(R),Y(se),Y(G),Y(R),Y(v),Y(se)}}return{faceCount:D*V*6}}const n=e.obstacleSize.x*.5,i=e.obstacleSize.y*.5,r=e.obstacleSize.z*.5;if(n<=0||i<=0||r<=0)return{faceCount:0};const d=e.obstacleCentre.x,o=e.obstacleCentre.y+e.obstacleSize.y*.5,y=e.obstacleCentre.z,h=Math.PI/180,c=e.obstacleRotation.x*h,u=e.obstacleRotation.y*h,b=e.obstacleRotation.z*h,P=Math.cos(c),m=Math.sin(c),x=Math.cos(u),z=Math.sin(u),f=Math.cos(b),I=Math.sin(b),B=(p,S,T)=>{const M=S*P-T*m,g=S*m+T*P,U=p*x+g*z,D=-p*z+g*x,V=U*f-M*I,$=U*I+M*f;return[V+d,$+o,D+y]},N=[B(-n,-i,-r),B(+n,-i,-r),B(+n,+i,-r),B(-n,+i,-r),B(-n,-i,+r),B(+n,-i,+r),B(+n,+i,+r),B(-n,+i,+r)],O=(p,S,T)=>{const M=S*P-T*m,g=S*m+T*P,U=p*x+g*z,D=-p*z+g*x,V=U*f-M*I,$=U*I+M*f;return[V,$,D]},j=[O(0,0,-1),O(0,0,1),O(-1,0,0),O(1,0,0),O(0,-1,0),O(0,1,0)];let l=0;const w=(p,S)=>{this.lineVertexData[l++]=p[0],this.lineVertexData[l++]=p[1],this.lineVertexData[l++]=p[2],this.lineVertexData[l++]=S[0],this.lineVertexData[l++]=S[1],this.lineVertexData[l++]=S[2],this.lineVertexData[l++]=t.r,this.lineVertexData[l++]=t.g,this.lineVertexData[l++]=t.b,this.lineVertexData[l++]=a},q=[[0,2,1,0,3,2],[4,5,6,4,6,7],[0,4,7,0,7,3],[1,2,6,1,6,5],[0,1,5,0,5,4],[3,7,6,3,6,2]];for(let p=0;p<q.length;p++){const S=j[p];for(const T of q[p])w(N[T],S)}return{faceCount:36}}buildBoundsWireframe(e){const s=e.boundsSize.x*.5,t=e.boundsSize.y*.5,a=e.boundsSize.z*.5,n=t-5,i=e.boundsWireframeColor??{r:1,g:1,b:1},r=[[-s,n-t,-a],[+s,n-t,-a],[+s,n+t,-a],[-s,n+t,-a],[-s,n-t,+a],[+s,n-t,+a],[+s,n+t,+a],[-s,n+t,+a]],d=[[0,1],[1,5],[5,4],[4,0],[3,2],[2,6],[6,7],[7,3],[0,3],[1,2],[5,6],[4,7]];let o=0;const y=h=>{const c=r[h];this.wireframeVertexData[o++]=c[0],this.wireframeVertexData[o++]=c[1],this.wireframeVertexData[o++]=c[2],this.wireframeVertexData[o++]=i.r,this.wireframeVertexData[o++]=i.g,this.wireframeVertexData[o++]=i.b,this.wireframeVertexData[o++]=1};for(const[h,c]of d)y(h),y(c);return d.length*2}render(e,s,t,a,n){const i=t.obstacleColor??{r:1,g:0,b:0},r=t.obstacleAlpha??.8,d=e.beginComputePass();d.setPipeline(this.cullPipeline),d.setBindGroup(0,this.cullBindGroup),d.dispatchWorkgroups(Math.ceil(a.particleCount/256)),d.end();const o=this.canvas.width/this.canvas.height,y=ne(Math.PI/3,o,.1,100),h=ee(y,n),c=window.devicePixelRatio||1,u=new Float32Array(28);u.set(h),u[16]=this.canvas.width,u[17]=this.canvas.height,u[18]=t.particleRadius*c,u[19]=t.velocityDisplayMax,u[20]=t.sceneExposure,u[21]=t.floorAmbient,u[22]=t.sunBrightness,u[23]=0,u[24]=t.dirToSun.x,u[25]=t.dirToSun.y,u[26]=t.dirToSun.z,u[27]=0,this.device.queue.writeBuffer(this.uniformBuffer,0,u);const b=`${t.globalBrightness}-${t.globalSaturation}-${t.floorAmbient}-${t.sunBrightness}-${t.dirToSun.x}-${t.dirToSun.y}-${t.dirToSun.z}-${i.r}-${i.g}-${i.b}-${r}-${t.tileCol1.r}-${t.tileCol1.g}-${t.tileCol1.b}-${t.tileCol2.r}-${t.tileCol2.g}-${t.tileCol2.b}-${t.tileCol3.r}-${t.tileCol3.g}-${t.tileCol3.b}-${t.tileCol4.r}-${t.tileCol4.g}-${t.tileCol4.b}-${t.skyColorHorizon.r}-${t.skyColorHorizon.g}-${t.skyColorHorizon.b}-${t.skyColorZenith.r}-${t.skyColorZenith.g}-${t.skyColorZenith.b}-${t.skyColorGround.r}-${t.skyColorGround.g}-${t.skyColorGround.b}`;if(b!==this.lastEnvParams){const G=new Float32Array(60);re(G,0,t,t),this.device.queue.writeBuffer(this.envUniformBuffer,0,G),this.lastEnvParams=b}const P={x:n[0],y:n[4],z:n[8]},m={x:n[1],y:n[5],z:n[9]},x={x:n[2],y:n[6],z:n[10]},z={x:-x.x,y:-x.y,z:-x.z},f=n[12],I=n[13],B=n[14],N=-(P.x*f+m.x*I+x.x*B),O=-(P.y*f+m.y*I+x.y*B),j=-(P.z*f+m.z*I+x.z*B),l=new Float32Array(20);l[0]=N,l[1]=O,l[2]=j,l[3]=0,l[4]=z.x,l[5]=z.y,l[6]=z.z,l[7]=0,l[8]=P.x,l[9]=P.y,l[10]=P.z,l[11]=0,l[12]=m.x,l[13]=m.y,l[14]=m.z,l[15]=0,l[16]=Math.PI/3,l[17]=o,this.device.queue.writeBuffer(this.camUniformBuffer,0,l);const w=new Float32Array(16),q=t.boundsSize,J=q.x*.5,p=q.z*.5,S=-5;w[0]=-J,w[1]=S,w[2]=-p,w[3]=0,w[4]=J,w[5]=S+q.y,w[6]=p,w[7]=0,w[8]=t.densityOffset,w[9]=t.densityMultiplier,w[10]=t.lightStepSize,w[11]=t.shadowSoftness,w[12]=t.extinctionCoefficients.x,w[13]=t.extinctionCoefficients.y,w[14]=t.extinctionCoefficients.z,w[15]=0,this.device.queue.writeBuffer(this.densityUniformBuffer,0,w);const T=t.boundsSize,M=t.floorSize,g=t.dirToSun,U=Math.max(T.x+T.z,M.x+M.z),D=U*.6,V={x:g.x*U,y:g.y*U,z:g.z*U},$=oe(V,{x:0,y:0,z:0},{x:0,y:1,z:0}),A=le(-D,D,-D,D,.1,-U*3),E=ee(A,$),F=Math.max(.001,t.smoothingRadius)/D,C=new Float32Array(20);C.set(E),C[16]=t.shadowSoftness??1,C[17]=F,C[18]=0,C[19]=0,this.device.queue.writeBuffer(this.shadowUniformBuffer,0,C);const k=t.showObstacle!==!1,X=`${k}-${t.obstacleShape}-${t.obstacleSize.x}-${t.obstacleSize.y}-${t.obstacleSize.z}-${t.obstacleCentre.x}-${t.obstacleCentre.y}-${t.obstacleCentre.z}-${t.obstacleRotation.x}-${t.obstacleRotation.y}-${t.obstacleRotation.z}-${t.obstacleRadius}-${i.r}-${i.g}-${i.b}-${r}`;if(X!==this.lastObstacleParams){const{faceCount:G}=k?this.buildObstacleGeometry(t):{faceCount:0};this.lastFaceCount=G,G>0&&this.device.queue.writeBuffer(this.lineVertexBuffer,0,this.lineVertexData.buffer,this.lineVertexData.byteOffset,G*10*4),this.lastObstacleParams=X}const W=this.lastFaceCount,_=`${t.showBoundsWireframe}-${t.boundsSize.x}-${t.boundsSize.y}-${t.boundsSize.z}-${t.boundsWireframeColor.r}-${t.boundsWireframeColor.g}-${t.boundsWireframeColor.b}`;if(_!==this.lastWireframeParams){let G=0;t.showBoundsWireframe&&(G=this.buildBoundsWireframe(t),this.device.queue.writeBuffer(this.wireframeVertexBuffer,0,this.wireframeVertexData.buffer,this.wireframeVertexData.byteOffset,G*7*4)),this.lastWireframeVertexCount=G,this.lastWireframeParams=_}const L=this.lastWireframeVertexCount;t.showBoundsWireframe&&L>0&&this.device.queue.writeBuffer(this.wireframeUniformBuffer,0,h.buffer,h.byteOffset,h.byteLength);const R=e.beginRenderPass({colorAttachments:[],depthStencilAttachment:{view:this.shadowTexture.createView(),depthClearValue:1,depthLoadOp:"clear",depthStoreOp:"store"}});R.setPipeline(this.shadowParticlePipeline),R.setBindGroup(0,this.shadowParticleBindGroup),t.showFluidShadows&&R.drawIndirect(a.indirectDraw,0),W>0&&(R.setPipeline(this.shadowObstaclePipeline),R.setBindGroup(0,this.shadowObstacleBindGroup),R.setVertexBuffer(0,this.lineVertexBuffer,0),R.draw(W)),R.end();const v=e.beginRenderPass({colorAttachments:[{view:s,clearValue:{r:.05,g:.05,b:.08,a:1},loadOp:"clear",storeOp:"store"}],depthStencilAttachment:{view:this.depthTexture.createView(),depthClearValue:1,depthLoadOp:"clear",depthStoreOp:"store"}});v.setPipeline(this.backgroundPipeline),v.setBindGroup(0,this.backgroundBindGroup),v.draw(3,1,0,0),v.setPipeline(this.particlePipeline),v.setBindGroup(0,this.particleBindGroup),v.drawIndirect(a.indirectDraw,0),W>0&&(v.setPipeline(this.facePipeline),v.setBindGroup(0,this.faceBindGroup),v.setVertexBuffer(0,this.lineVertexBuffer,0),v.draw(W)),t.showBoundsWireframe&&L>0&&(v.setPipeline(this.wireframePipeline),v.setBindGroup(0,this.wireframeBindGroup),v.setVertexBuffer(0,this.wireframeVertexBuffer,0),v.draw(L)),v.end()}}class De{device;clearPipeline;particlesPipeline;resolvePipeline;clearBindGroup;particlesBindGroup;resolveBindGroup;clearParamsBuffer;particlesParamsBuffer;resolveParamsBuffer;particlesParamsData;particlesParamsF32;particlesParamsU32;resolveParamsData;resolveParamsF32;resolveParamsU32;atomicDensityBuffer;densityTexture;_densityTextureView;densityTextureSize={x:1,y:1,z:1};densityWorkgroupSize={x:8,y:8,z:4};constructor(e){this.device=e;const s=e.createShaderModule({code:me});this.clearPipeline=e.createComputePipeline({layout:"auto",compute:{module:s,entryPoint:"main"}}),this.clearParamsBuffer=e.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});const t=e.createShaderModule({code:Pe});this.particlesPipeline=e.createComputePipeline({layout:"auto",compute:{module:t,entryPoint:"main"}}),this.particlesParamsData=new ArrayBuffer(64),this.particlesParamsF32=new Float32Array(this.particlesParamsData),this.particlesParamsU32=new Uint32Array(this.particlesParamsData),this.particlesParamsBuffer=e.createBuffer({size:64,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});const a=e.createShaderModule({code:ge});this.resolvePipeline=e.createComputePipeline({layout:"auto",compute:{module:a,entryPoint:"main"}}),this.resolveParamsData=new ArrayBuffer(32),this.resolveParamsF32=new Float32Array(this.resolveParamsData),this.resolveParamsU32=new Uint32Array(this.resolveParamsData),this.resolveParamsBuffer=e.createBuffer({size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST})}get textureView(){return this._densityTextureView}recreate(e,s){this.densityTexture&&this.densityTexture.destroy(),this.createDensityTexture(e),this.createAtomicDensityBuffer(),this.createBindGroups(s)}dispatch(e,s,t){this.updateParams(s,t);const a=this.densityTextureSize.x*this.densityTextureSize.y*this.densityTextureSize.z,n=e.beginComputePass();n.setPipeline(this.clearPipeline),n.setBindGroup(0,this.clearBindGroup),n.dispatchWorkgroups(Math.ceil(a/256)),n.end();const i=e.beginComputePass();i.setPipeline(this.particlesPipeline),i.setBindGroup(0,this.particlesBindGroup),i.dispatchWorkgroups(Math.ceil(s/256)),i.end();const r=e.beginComputePass();r.setPipeline(this.resolvePipeline),r.setBindGroup(0,this.resolveBindGroup),r.dispatchWorkgroups(Math.ceil(this.densityTextureSize.x/this.densityWorkgroupSize.x),Math.ceil(this.densityTextureSize.y/this.densityWorkgroupSize.y),Math.ceil(this.densityTextureSize.z/this.densityWorkgroupSize.z)),r.end()}destroy(){this.densityTexture&&this.densityTexture.destroy(),this.atomicDensityBuffer&&this.atomicDensityBuffer.destroy()}createDensityTexture(e){const s=e.boundsSize,t=Math.max(s.x,s.y,s.z),a=Math.max(1,Math.round(e.densityTextureRes)),n=Math.max(1,Math.round(s.x/t*a)),i=Math.max(1,Math.round(s.y/t*a)),r=Math.max(1,Math.round(s.z/t*a));this.densityTextureSize={x:n,y:i,z:r},this.densityTexture=this.device.createTexture({size:{width:n,height:i,depthOrArrayLayers:r},dimension:"3d",format:"rgba16float",usage:GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_SRC}),this._densityTextureView=this.densityTexture.createView({dimension:"3d"})}createAtomicDensityBuffer(){this.atomicDensityBuffer&&this.atomicDensityBuffer.destroy();const e=this.densityTextureSize.x*this.densityTextureSize.y*this.densityTextureSize.z;this.atomicDensityBuffer=this.device.createBuffer({size:e*4,usage:GPUBufferUsage.STORAGE})}createBindGroups(e){this.clearBindGroup=this.device.createBindGroup({layout:this.clearPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.atomicDensityBuffer}},{binding:1,resource:{buffer:this.clearParamsBuffer}}]}),this.particlesBindGroup=this.device.createBindGroup({layout:this.particlesPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:e}},{binding:1,resource:{buffer:this.atomicDensityBuffer}},{binding:2,resource:{buffer:this.particlesParamsBuffer}}]}),this.resolveBindGroup=this.device.createBindGroup({layout:this.resolvePipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.atomicDensityBuffer}},{binding:1,resource:this._densityTextureView},{binding:2,resource:{buffer:this.resolveParamsBuffer}}]})}updateParams(e,s){const t=s.smoothingRadius,a=15/(2*Math.PI*Math.pow(t,5)),n=1e3,i=this.densityTextureSize.x*this.densityTextureSize.y*this.densityTextureSize.z,r=s.boundsSize,d=r.x*.5,o=r.z*.5,y=-5,h=s.densityTextureRes/Math.max(r.x,r.y,r.z),c=new Uint32Array(4);c[0]=i,this.device.queue.writeBuffer(this.clearParamsBuffer,0,c),this.particlesParamsF32[0]=t,this.particlesParamsF32[1]=a,this.particlesParamsU32[2]=e,this.particlesParamsF32[3]=n,this.particlesParamsF32[4]=-d,this.particlesParamsF32[5]=y,this.particlesParamsF32[6]=-o,this.particlesParamsF32[7]=h,this.particlesParamsF32[8]=d,this.particlesParamsF32[9]=y+r.y,this.particlesParamsF32[10]=o,this.particlesParamsF32[11]=0,this.particlesParamsU32[12]=this.densityTextureSize.x,this.particlesParamsU32[13]=this.densityTextureSize.y,this.particlesParamsU32[14]=this.densityTextureSize.z,this.particlesParamsU32[15]=0,this.device.queue.writeBuffer(this.particlesParamsBuffer,0,this.particlesParamsData),this.resolveParamsF32[0]=n,this.resolveParamsF32[1]=0,this.resolveParamsF32[2]=0,this.resolveParamsF32[3]=0,this.resolveParamsU32[4]=this.densityTextureSize.x,this.resolveParamsU32[5]=this.densityTextureSize.y,this.resolveParamsU32[6]=this.densityTextureSize.z,this.resolveParamsU32[7]=0,this.device.queue.writeBuffer(this.resolveParamsBuffer,0,this.resolveParamsData)}}class Te{device;context;config;buffers;physics;grid;renderer;splatPipeline;pickingSystem;state;gridRes={x:0,y:0,z:0};gridTotalCells=0;isPicking=!1;interactionPos={x:0,y:0,z:0};physicsUniforms;gridUniforms;cullUniformBuffer;computeData=new Float32Array(8);integrateData=new Float32Array(24);hashParamsData=new Float32Array(8);sortParamsData=new Uint32Array(8);scanParamsDataL0=new Uint32Array(4);scanParamsDataL1=new Uint32Array(4);scanParamsDataL2=new Uint32Array(4);densityParamsData=new Float32Array(12);pressureParamsData=new Float32Array(16);viscosityParamsData=new Float32Array(12);cullParamsData=new Float32Array(20);indirectArgs=new Uint32Array([6,0,0,0]);constructor(e,s,t,a,n,i=!1,r=!1){this.device=e,this.context=s,this.config=a,this.physics=new ce(e,r),this.grid=new ue(e,i),this.renderer=new Be(e,t,n,a),this.splatPipeline=new De(e),this.pickingSystem=new de(e),this.physicsUniforms={external:e.createBuffer({size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),density:e.createBuffer({size:48,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),pressure:e.createBuffer({size:64,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),viscosity:e.createBuffer({size:48,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),integrate:e.createBuffer({size:96,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST})},this.gridUniforms={hash:e.createBuffer({size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),sort:e.createBuffer({size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),scanL0:e.createBuffer({size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),scanL1:e.createBuffer({size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),scanL2:e.createBuffer({size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST})},this.cullUniformBuffer=e.createBuffer({size:80,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.reset()}get particleCount(){return this.buffers.particleCount}get simulationState(){return this.state}reset(){this.buffers&&this.buffers.destroy();const{boundsSize:e,smoothingRadius:s}=this.config;this.gridRes={x:Math.ceil(e.x/s),y:Math.ceil(e.y/s),z:Math.ceil(e.z/s)},this.gridTotalCells=this.gridRes.x*this.gridRes.y*this.gridRes.z;const t=he(this.config);this.state=this.createStateFromSpawn(t),this.buffers=new fe(this.device,t,{gridTotalCells:this.gridTotalCells}),this.physics.createBindGroups(this.buffers,this.physicsUniforms),this.grid.createBindGroups(this.buffers,this.gridUniforms),this.splatPipeline.recreate(this.config,this.buffers.predicted),this.pickingSystem.createBindGroup(this.buffers.positions),this.renderer.createBindGroup(this.buffers,this.splatPipeline.textureView,this.cullUniformBuffer);const a=this.device.createCommandEncoder();this.splatPipeline.dispatch(a,this.buffers.particleCount,this.config),this.device.queue.submit([a.finish()])}createStateFromSpawn(e){return{positions:e.positions,predicted:new Float32Array(e.positions),velocities:e.velocities,densities:new Float32Array(e.count*2),keys:new Uint32Array(e.count),sortedKeys:new Uint32Array(e.count),indices:new Uint32Array(e.count),sortOffsets:new Uint32Array(e.count),spatialOffsets:new Uint32Array(e.count),positionsSorted:new Float32Array(e.count*4),predictedSorted:new Float32Array(e.count*4),velocitiesSorted:new Float32Array(e.count*4),count:e.count,input:{worldX:0,worldY:0,worldZ:0,pull:!1,push:!1}}}async step(e){const{config:s,buffers:t,device:a}=this,n=s.maxTimestepFPS?1/s.maxTimestepFPS:Number.POSITIVE_INFINITY,r=Math.min(e*s.timeScale,n)/s.iterationsPerFrame;this.updateUniforms(r);const d=a.createCommandEncoder();let o=!1;!this.isPicking&&this.state.input.rayOrigin&&this.state.input.rayDir&&(this.isPicking=!0,o=!0,this.pickingSystem.dispatch(d,this.state.input.rayOrigin,this.state.input.rayDir,s.smoothingRadius,t.particleCount));const y=d.beginComputePass();for(let c=0;c<s.iterationsPerFrame;c++)this.physics.step(y,this.grid,t.particleCount,this.gridTotalCells,s.viscosityStrength>0,c===0);y.end(),s.showFluidShadows&&this.splatPipeline.dispatch(d,t.particleCount,s),a.queue.submit([d.finish()]),o&&this.pickingSystem.getResult().then(c=>{if(c&&c.hit){let u=c.hitPos.x,b=c.hitPos.y,P=c.hitPos.z;this.state.input.pull&&this.state.input.rayDir&&(u+=this.state.input.rayDir.x*.5,b+=this.state.input.rayDir.y*.5,P+=this.state.input.rayDir.z*.5),this.state.input.worldX=u,this.state.input.worldY=b,this.state.input.worldZ=P,this.state.input.isHoveringFluid=!0}else this.state.input.isHoveringFluid=!1;this.isPicking=!1});const h=.15;this.interactionPos.x+=(this.state.input.worldX-this.interactionPos.x)*h,this.interactionPos.y+=(this.state.input.worldY-this.interactionPos.y)*h,this.interactionPos.z+=(this.state.input.worldZ-this.interactionPos.z)*h}updateUniforms(e){const{config:s,state:t,buffers:a,device:n}=this;let i=0;t.input.push?i=-s.interactionStrength:t.input.pull&&(i=s.interactionStrength),this.computeData[0]=e,this.computeData[1]=s.gravity,this.computeData[2]=s.interactionRadius,this.computeData[3]=i,this.computeData[4]=this.interactionPos.x,this.computeData[5]=this.interactionPos.y,this.computeData[6]=this.interactionPos.z,this.computeData[7]=0,n.queue.writeBuffer(this.physicsUniforms.external,0,this.computeData),this.hashParamsData[0]=s.smoothingRadius,this.hashParamsData[1]=a.particleCount,this.hashParamsData[2]=-s.boundsSize.x*.5,this.hashParamsData[3]=-5,this.hashParamsData[4]=-s.boundsSize.z*.5,this.hashParamsData[5]=this.gridRes.x,this.hashParamsData[6]=this.gridRes.y,this.hashParamsData[7]=this.gridRes.z,n.queue.writeBuffer(this.gridUniforms.hash,0,this.hashParamsData),this.sortParamsData[0]=a.particleCount,this.sortParamsData[1]=this.gridTotalCells,n.queue.writeBuffer(this.gridUniforms.sort,0,this.sortParamsData);const r=Math.ceil((this.gridTotalCells+1)/512),d=Math.ceil(r/512);this.scanParamsDataL0[0]=this.gridTotalCells+1,this.scanParamsDataL1[0]=r,this.scanParamsDataL2[0]=d,n.queue.writeBuffer(this.gridUniforms.scanL0,0,this.scanParamsDataL0),n.queue.writeBuffer(this.gridUniforms.scanL1,0,this.scanParamsDataL1),n.queue.writeBuffer(this.gridUniforms.scanL2,0,this.scanParamsDataL2);const o=s.smoothingRadius,y=15/(2*Math.PI*Math.pow(o,5)),h=15/(Math.PI*Math.pow(o,6));this.densityParamsData[0]=o,this.densityParamsData[1]=y,this.densityParamsData[2]=h,this.densityParamsData[3]=a.particleCount,this.densityParamsData[4]=-s.boundsSize.x*.5,this.densityParamsData[5]=-5,this.densityParamsData[6]=-s.boundsSize.z*.5,this.densityParamsData[7]=0,this.densityParamsData[8]=this.gridRes.x,this.densityParamsData[9]=this.gridRes.y,this.densityParamsData[10]=this.gridRes.z,this.densityParamsData[11]=0,n.queue.writeBuffer(this.physicsUniforms.density,0,this.densityParamsData);const c=15/(Math.PI*Math.pow(o,5)),u=45/(Math.PI*Math.pow(o,6));this.pressureParamsData[0]=e,this.pressureParamsData[1]=s.targetDensity,this.pressureParamsData[2]=s.pressureMultiplier,this.pressureParamsData[3]=s.nearPressureMultiplier,this.pressureParamsData[4]=o,this.pressureParamsData[5]=c,this.pressureParamsData[6]=u,this.pressureParamsData[7]=a.particleCount,this.pressureParamsData[8]=-s.boundsSize.x*.5,this.pressureParamsData[9]=-5,this.pressureParamsData[10]=-s.boundsSize.z*.5,this.pressureParamsData[11]=0,this.pressureParamsData[12]=this.gridRes.x,this.pressureParamsData[13]=this.gridRes.y,this.pressureParamsData[14]=this.gridRes.z,this.pressureParamsData[15]=0,n.queue.writeBuffer(this.physicsUniforms.pressure,0,this.pressureParamsData);const b=315/(64*Math.PI*Math.pow(o,9));this.viscosityParamsData[0]=e,this.viscosityParamsData[1]=s.viscosityStrength,this.viscosityParamsData[2]=o,this.viscosityParamsData[3]=b,this.viscosityParamsData[4]=a.particleCount,this.viscosityParamsData[5]=-s.boundsSize.x*.5,this.viscosityParamsData[6]=-5,this.viscosityParamsData[7]=-s.boundsSize.z*.5,this.viscosityParamsData[8]=this.gridRes.x,this.viscosityParamsData[9]=this.gridRes.y,this.viscosityParamsData[10]=this.gridRes.z,this.viscosityParamsData[11]=0,n.queue.writeBuffer(this.physicsUniforms.viscosity,0,this.viscosityParamsData),this.integrateData[0]=e,this.integrateData[1]=s.collisionDamping;const m=(s.obstacleShape??"box")==="sphere",x=s.obstacleRadius??0,z=s.showObstacle!==!1&&(m?x>0:s.obstacleSize.x>0&&s.obstacleSize.y>0&&s.obstacleSize.z>0);this.integrateData[2]=z?1:0,this.integrateData[3]=m?1:0;const f=s.boundsSize,I=f.x*.5,B=f.z*.5,N=-5;this.integrateData[4]=-I,this.integrateData[5]=N,this.integrateData[6]=-B,this.integrateData[8]=I,this.integrateData[9]=N+f.y,this.integrateData[10]=B,this.integrateData[12]=s.obstacleCentre.x,this.integrateData[13]=m?s.obstacleCentre.y:s.obstacleCentre.y+s.obstacleSize.y*.5,this.integrateData[14]=s.obstacleCentre.z;const O=m?x:s.obstacleSize.x*.5,j=m?x:s.obstacleSize.y*.5,l=m?x:s.obstacleSize.z*.5;this.integrateData[16]=O,this.integrateData[17]=j,this.integrateData[18]=l,this.integrateData[20]=s.obstacleRotation.x,this.integrateData[21]=s.obstacleRotation.y,this.integrateData[22]=s.obstacleRotation.z,n.queue.writeBuffer(this.physicsUniforms.integrate,0,this.integrateData)}render(e){const{device:s,buffers:t,config:a}=this;this.renderer.resize();const n=s.createCommandEncoder();this.device.queue.writeBuffer(t.indirectDraw,0,this.indirectArgs);const i=this.context.canvas.width/this.context.canvas.height,r=ne(Math.PI/3,i,.1,100),d=ee(r,e);this.cullParamsData.set(d),this.cullParamsData[16]=a.particleRadius,new Uint32Array(this.cullParamsData.buffer)[17]=t.particleCount,this.device.queue.writeBuffer(this.cullUniformBuffer,0,this.cullParamsData),this.renderer.render(n,this.context.getCurrentTexture().createView(),this.config,this.buffers,e),this.device.queue.submit([n.finish()])}}export{Te as F};
