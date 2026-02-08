import{p as Z,w as ae,m as te,e as J,f as re,g as oe,j as le,k as K,F as ce,S as ue,P as de,l as he,n as fe}from"./picking_system-DspAGaRc.js";import{e as pe}from"./environment-ODazOT3W.js";import{s as me,a as ge,b as Pe}from"./splat_resolve-CMJnQc1h.js";const ye=`/**
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
`;function Se(Y,e){const t=[...Y].sort((s,i)=>s.t-i.t),n=new Array(e);for(let s=0;s<e;s+=1){const i=e===1?0:s/(e-1);let a=t[0],r=t[t.length-1];for(let m=0;m<t.length-1;m+=1){const P=t[m],y=t[m+1];if(i>=P.t&&i<=y.t){a=P,r=y;break}}const d=r.t-a.t||1,o=(i-a.t)/d,w=a.r+(r.r-a.r)*o,l=a.g+(r.g-a.g)*o,u=a.b+(r.b-a.b)*o;n[s]={r:w,g:l,b:u}}return n}class Be{device;particlePipeline;facePipeline;backgroundPipeline;shadowParticlePipeline;shadowObstaclePipeline;wireframePipeline;cullPipeline;uniformBuffer;gradientBuffer;envUniformBuffer;camUniformBuffer;shadowUniformBuffer;particleBindGroup;faceBindGroup;backgroundBindGroup;shadowParticleBindGroup;shadowObstacleBindGroup;wireframeBindGroup;cullBindGroup;lineVertexBuffer;lineVertexData;wireframeVertexBuffer;wireframeVertexData;wireframeUniformBuffer;canvas;depthTexture;depthWidth=0;depthHeight=0;shadowTexture;shadowMapSize=2048;shadowSampler;densitySampler;densityUniformBuffer;constructor(e,t,n,s){this.device=e,this.canvas=t,this.uniformBuffer=e.createBuffer({size:112,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.envUniformBuffer=e.createBuffer({size:240,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.camUniformBuffer=e.createBuffer({size:80,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.densityUniformBuffer=e.createBuffer({size:64,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.shadowUniformBuffer=e.createBuffer({size:96,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});const i=Se(s.colorKeys,s.gradientResolution),a=new Float32Array(s.gradientResolution*4);for(let h=0;h<i.length;h++)a[h*4]=i[h].r,a[h*4+1]=i[h].g,a[h*4+2]=i[h].b,a[h*4+3]=1;this.gradientBuffer=e.createBuffer({size:a.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST,mappedAtCreation:!0}),new Float32Array(this.gradientBuffer.getMappedRange()).set(a),this.gradientBuffer.unmap();const r=Z(ye,{"../../common/shaders/shadow_common.wgsl":K}),d=e.createShaderModule({code:r});this.particlePipeline=e.createRenderPipeline({layout:"auto",vertex:{module:d,entryPoint:"vs_main"},fragment:{module:d,entryPoint:"fs_main",targets:[{format:n}]},primitive:{topology:"triangle-list"},depthStencil:{format:"depth24plus",depthWriteEnabled:!0,depthCompare:"less"}});const o=Z(we,{"../../common/shaders/shadow_common.wgsl":K}),w=e.createShaderModule({code:o});this.facePipeline=e.createRenderPipeline({layout:"auto",vertex:{module:w,entryPoint:"vs_main",buffers:[{arrayStride:40,attributes:[{shaderLocation:0,offset:0,format:"float32x3"},{shaderLocation:1,offset:12,format:"float32x3"},{shaderLocation:2,offset:24,format:"float32x4"}]}]},fragment:{module:w,entryPoint:"fs_main",targets:[{format:n,blend:{color:{srcFactor:"src-alpha",dstFactor:"one-minus-src-alpha",operation:"add"},alpha:{srcFactor:"one",dstFactor:"one-minus-src-alpha",operation:"add"}}}]},primitive:{topology:"triangle-list",cullMode:"back"},depthStencil:{format:"depth24plus",depthWriteEnabled:!1,depthCompare:"less"}});const l=Z(ve,{"../../common/shaders/environment.wgsl":pe,"../../common/shaders/shadow_common.wgsl":K}),u=e.createShaderModule({code:l});this.backgroundPipeline=e.createRenderPipeline({layout:"auto",vertex:{module:u,entryPoint:"vs_main"},fragment:{module:u,entryPoint:"fs_main",targets:[{format:n}]},primitive:{topology:"triangle-list"},depthStencil:{format:"depth24plus",depthWriteEnabled:!1,depthCompare:"always"}});const m=Z(xe,{"shadow_common.wgsl":K}),P=e.createShaderModule({code:m});this.shadowParticlePipeline=e.createRenderPipeline({layout:"auto",vertex:{module:P,entryPoint:"vs_particles"},primitive:{topology:"triangle-list",cullMode:"none"},depthStencil:{format:"depth24plus",depthWriteEnabled:!0,depthCompare:"less"}}),this.shadowObstaclePipeline=e.createRenderPipeline({layout:"auto",vertex:{module:P,entryPoint:"vs_obstacle",buffers:[{arrayStride:40,attributes:[{shaderLocation:0,offset:0,format:"float32x3"}]}]},primitive:{topology:"triangle-list",cullMode:"back"},depthStencil:{format:"depth24plus",depthWriteEnabled:!0,depthCompare:"less"}});const y=e.createShaderModule({code:be});this.cullPipeline=e.createComputePipeline({layout:"auto",compute:{module:y,entryPoint:"main"}});const x=e.createShaderModule({code:ae});this.wireframePipeline=e.createRenderPipeline({layout:"auto",vertex:{module:x,entryPoint:"vs_main",buffers:[{arrayStride:28,attributes:[{shaderLocation:0,offset:0,format:"float32x3"},{shaderLocation:1,offset:12,format:"float32x4"}]}]},fragment:{module:x,entryPoint:"fs_main",targets:[{format:n}]},primitive:{topology:"line-list"},depthStencil:{format:"depth24plus",depthWriteEnabled:!0,depthCompare:"less"}}),this.wireframeUniformBuffer=e.createBuffer({size:64,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.wireframeVertexData=new Float32Array(168),this.wireframeVertexBuffer=e.createBuffer({size:this.wireframeVertexData.byteLength,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});const B=384*6,T=Math.max(36,B)*10;this.lineVertexData=new Float32Array(T),this.lineVertexBuffer=e.createBuffer({size:this.lineVertexData.byteLength,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST}),this.shadowTexture=this.device.createTexture({size:[this.shadowMapSize,this.shadowMapSize],format:"depth24plus",usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING}),this.shadowSampler=this.device.createSampler({compare:"less",magFilter:"linear",minFilter:"linear"}),this.faceBindGroup=e.createBindGroup({layout:this.facePipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.uniformBuffer}},{binding:1,resource:this.shadowTexture.createView()},{binding:2,resource:this.shadowSampler},{binding:3,resource:{buffer:this.shadowUniformBuffer}}]}),this.shadowObstacleBindGroup=e.createBindGroup({layout:this.shadowObstaclePipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.shadowUniformBuffer}}]}),this.wireframeBindGroup=e.createBindGroup({layout:this.wireframePipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.wireframeUniformBuffer}}]}),this.densitySampler=this.device.createSampler({addressModeU:"clamp-to-edge",addressModeV:"clamp-to-edge",addressModeW:"clamp-to-edge",magFilter:"linear",minFilter:"linear"}),this.resize()}resize(){const e=this.canvas.width,t=this.canvas.height;this.depthTexture&&e===this.depthWidth&&t===this.depthHeight||(this.depthTexture&&this.depthTexture.destroy(),this.depthTexture=this.device.createTexture({size:[e,t],format:"depth24plus",usage:GPUTextureUsage.RENDER_ATTACHMENT}),this.depthWidth=e,this.depthHeight=t)}createBindGroup(e,t,n){this.particleBindGroup=this.device.createBindGroup({layout:this.particlePipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:e.positions}},{binding:1,resource:{buffer:e.velocities}},{binding:2,resource:{buffer:this.uniformBuffer}},{binding:3,resource:{buffer:this.gradientBuffer}},{binding:4,resource:{buffer:e.visibleIndices}},{binding:5,resource:this.shadowTexture.createView()},{binding:6,resource:this.shadowSampler},{binding:7,resource:{buffer:this.shadowUniformBuffer}}]}),this.shadowParticleBindGroup=this.device.createBindGroup({layout:this.shadowParticlePipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.shadowUniformBuffer}},{binding:1,resource:{buffer:e.positions}},{binding:2,resource:{buffer:e.visibleIndices}}]}),this.cullBindGroup=this.device.createBindGroup({layout:this.cullPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:e.positions}},{binding:1,resource:{buffer:e.visibleIndices}},{binding:2,resource:{buffer:e.indirectDraw}},{binding:3,resource:{buffer:n}}]}),this.backgroundBindGroup=this.device.createBindGroup({layout:this.backgroundPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.envUniformBuffer}},{binding:1,resource:{buffer:this.camUniformBuffer}},{binding:2,resource:t},{binding:3,resource:this.densitySampler},{binding:4,resource:{buffer:this.densityUniformBuffer}},{binding:5,resource:this.shadowTexture.createView()},{binding:6,resource:this.shadowSampler},{binding:7,resource:{buffer:this.shadowUniformBuffer}}]})}buildObstacleGeometry(e){const t=e.obstacleShape??"box",n=e.obstacleColor??{r:1,g:0,b:0},s=e.obstacleAlpha??.8;if(t==="sphere"){const f=e.obstacleRadius??0;if(f<=0)return{faceCount:0};const S=e.obstacleCentre.x,U=e.obstacleCentre.y,C=e.obstacleCentre.z;let p=0;const M=(V,E)=>{this.lineVertexData[p++]=V[0],this.lineVertexData[p++]=V[1],this.lineVertexData[p++]=V[2],this.lineVertexData[p++]=E[0],this.lineVertexData[p++]=E[1],this.lineVertexData[p++]=E[2],this.lineVertexData[p++]=n.r,this.lineVertexData[p++]=n.g,this.lineVertexData[p++]=n.b,this.lineVertexData[p++]=s},G=16,I=24;for(let V=0;V<G;V++){const E=V/G,F=(V+1)/G,L=E*Math.PI,z=F*Math.PI;for(let A=0;A<I;A++){const R=A/I,v=(A+1)/I,j=R*Math.PI*2,H=v*Math.PI*2,$=[Math.sin(L)*Math.cos(j),Math.cos(L),Math.sin(L)*Math.sin(j)],ne=[Math.sin(L)*Math.cos(H),Math.cos(L),Math.sin(L)*Math.sin(H)],ie=[Math.sin(z)*Math.cos(j),Math.cos(z),Math.sin(z)*Math.sin(j)],ee=[Math.sin(z)*Math.cos(H),Math.cos(z),Math.sin(z)*Math.sin(H)],k=X=>{const se=X;M([X[0]*f+S,X[1]*f+U,X[2]*f+C],se)};k($),k(ee),k(ie),k($),k(ne),k(ee)}}return{faceCount:G*I*6}}const i=e.obstacleSize.x*.5,a=e.obstacleSize.y*.5,r=e.obstacleSize.z*.5;if(i<=0||a<=0||r<=0)return{faceCount:0};const d=e.obstacleCentre.x,o=e.obstacleCentre.y+e.obstacleSize.y*.5,w=e.obstacleCentre.z,l=Math.PI/180,u=e.obstacleRotation.x*l,m=e.obstacleRotation.y*l,P=e.obstacleRotation.z*l,y=Math.cos(u),x=Math.sin(u),B=Math.cos(m),T=Math.sin(m),h=Math.cos(P),O=Math.sin(P),D=(f,S,U)=>{const C=S*y-U*x,p=S*x+U*y,M=f*B+p*T,G=-f*T+p*B,I=M*h-C*O,N=M*O+C*h;return[I+d,N+o,G+w]},_=[D(-i,-a,-r),D(+i,-a,-r),D(+i,+a,-r),D(-i,+a,-r),D(-i,-a,+r),D(+i,-a,+r),D(+i,+a,+r),D(-i,+a,+r)],c=(f,S,U)=>{const C=S*y-U*x,p=S*x+U*y,M=f*B+p*T,G=-f*T+p*B,I=M*h-C*O,N=M*O+C*h;return[I,N,G]},g=[c(0,0,-1),c(0,0,1),c(-1,0,0),c(1,0,0),c(0,-1,0),c(0,1,0)];let b=0;const W=(f,S)=>{this.lineVertexData[b++]=f[0],this.lineVertexData[b++]=f[1],this.lineVertexData[b++]=f[2],this.lineVertexData[b++]=S[0],this.lineVertexData[b++]=S[1],this.lineVertexData[b++]=S[2],this.lineVertexData[b++]=n.r,this.lineVertexData[b++]=n.g,this.lineVertexData[b++]=n.b,this.lineVertexData[b++]=s},q=[[0,2,1,0,3,2],[4,5,6,4,6,7],[0,4,7,0,7,3],[1,2,6,1,6,5],[0,1,5,0,5,4],[3,7,6,3,6,2]];for(let f=0;f<q.length;f++){const S=g[f];for(const U of q[f])W(_[U],S)}return{faceCount:36}}buildBoundsWireframe(e){const t=e.boundsSize.x*.5,n=e.boundsSize.y*.5,s=e.boundsSize.z*.5,i=n-5,a=e.boundsWireframeColor??{r:1,g:1,b:1},r=[[-t,i-n,-s],[+t,i-n,-s],[+t,i+n,-s],[-t,i+n,-s],[-t,i-n,+s],[+t,i-n,+s],[+t,i+n,+s],[-t,i+n,+s]],d=[[0,1],[1,5],[5,4],[4,0],[3,2],[2,6],[6,7],[7,3],[0,3],[1,2],[5,6],[4,7]];let o=0;const w=l=>{const u=r[l];this.wireframeVertexData[o++]=u[0],this.wireframeVertexData[o++]=u[1],this.wireframeVertexData[o++]=u[2],this.wireframeVertexData[o++]=a.r,this.wireframeVertexData[o++]=a.g,this.wireframeVertexData[o++]=a.b,this.wireframeVertexData[o++]=1};for(const[l,u]of d)w(l),w(u);return d.length*2}render(e,t,n,s,i){const a=e.beginComputePass();a.setPipeline(this.cullPipeline),a.setBindGroup(0,this.cullBindGroup),a.dispatchWorkgroups(Math.ceil(s.particleCount/256)),a.end();const r=this.canvas.width/this.canvas.height,d=te(Math.PI/3,r,.1,100),o=J(d,i),w=window.devicePixelRatio||1,l=new Float32Array(28);l.set(o),l[16]=this.canvas.width,l[17]=this.canvas.height,l[18]=n.particleRadius*w,l[19]=n.velocityDisplayMax,l[20]=n.sceneExposure,l[21]=n.floorAmbient,l[22]=n.sunBrightness,l[23]=0,l[24]=n.dirToSun.x,l[25]=n.dirToSun.y,l[26]=n.dirToSun.z,l[27]=0,this.device.queue.writeBuffer(this.uniformBuffer,0,l);const u=new Float32Array(60);re(u,0,n,n),this.device.queue.writeBuffer(this.envUniformBuffer,0,u);const m={x:i[0],y:i[4],z:i[8]},P={x:i[1],y:i[5],z:i[9]},y={x:i[2],y:i[6],z:i[10]},x={x:-y.x,y:-y.y,z:-y.z},B=i[12],T=i[13],h=i[14],O=-(m.x*B+P.x*T+y.x*h),D=-(m.y*B+P.y*T+y.y*h),_=-(m.z*B+P.z*T+y.z*h),c=new Float32Array(20);c[0]=O,c[1]=D,c[2]=_,c[3]=0,c[4]=x.x,c[5]=x.y,c[6]=x.z,c[7]=0,c[8]=m.x,c[9]=m.y,c[10]=m.z,c[11]=0,c[12]=P.x,c[13]=P.y,c[14]=P.z,c[15]=0,c[16]=Math.PI/3,c[17]=r,this.device.queue.writeBuffer(this.camUniformBuffer,0,c);const g=new Float32Array(16),b=n.boundsSize,W=b.x*.5,q=b.z*.5,Q=-5;g[0]=-W,g[1]=Q,g[2]=-q,g[3]=0,g[4]=W,g[5]=Q+b.y,g[6]=q,g[7]=0,g[8]=n.densityOffset,g[9]=n.densityMultiplier,g[10]=n.lightStepSize,g[11]=n.shadowSoftness,g[12]=n.extinctionCoefficients.x,g[13]=n.extinctionCoefficients.y,g[14]=n.extinctionCoefficients.z,g[15]=0,this.device.queue.writeBuffer(this.densityUniformBuffer,0,g);const f=n.boundsSize,S=n.floorSize,U=n.dirToSun,C=Math.max(f.x+f.z,S.x+S.z),p=C*.6,M={x:U.x*C,y:U.y*C,z:U.z*C},G=oe(M,{x:0,y:0,z:0},{x:0,y:1,z:0}),I=le(-p,p,-p,p,.1,-C*3),N=J(I,G),E=Math.max(.001,n.smoothingRadius)/p,F=new Float32Array(20);F.set(N),F[16]=n.shadowSoftness??1,F[17]=E,F[18]=0,F[19]=0,this.device.queue.writeBuffer(this.shadowUniformBuffer,0,F);const L=n.showObstacle!==!1,{faceCount:z}=L?this.buildObstacleGeometry(n):{faceCount:0};z>0&&this.device.queue.writeBuffer(this.lineVertexBuffer,0,this.lineVertexData.buffer,this.lineVertexData.byteOffset,z*10*4);let A=0;n.showBoundsWireframe&&(A=this.buildBoundsWireframe(n),this.device.queue.writeBuffer(this.wireframeVertexBuffer,0,this.wireframeVertexData.buffer,this.wireframeVertexData.byteOffset,A*7*4),this.device.queue.writeBuffer(this.wireframeUniformBuffer,0,o.buffer,o.byteOffset,o.byteLength));const R=e.beginRenderPass({colorAttachments:[],depthStencilAttachment:{view:this.shadowTexture.createView(),depthClearValue:1,depthLoadOp:"clear",depthStoreOp:"store"}});R.setPipeline(this.shadowParticlePipeline),R.setBindGroup(0,this.shadowParticleBindGroup),n.showFluidShadows&&R.drawIndirect(s.indirectDraw,0),z>0&&(R.setPipeline(this.shadowObstaclePipeline),R.setBindGroup(0,this.shadowObstacleBindGroup),R.setVertexBuffer(0,this.lineVertexBuffer,0),R.draw(z)),R.end();const v=e.beginRenderPass({colorAttachments:[{view:t,clearValue:{r:.05,g:.05,b:.08,a:1},loadOp:"clear",storeOp:"store"}],depthStencilAttachment:{view:this.depthTexture.createView(),depthClearValue:1,depthLoadOp:"clear",depthStoreOp:"store"}});v.setPipeline(this.backgroundPipeline),v.setBindGroup(0,this.backgroundBindGroup),v.draw(3,1,0,0),v.setPipeline(this.particlePipeline),v.setBindGroup(0,this.particleBindGroup),v.drawIndirect(s.indirectDraw,0),z>0&&(v.setPipeline(this.facePipeline),v.setBindGroup(0,this.faceBindGroup),v.setVertexBuffer(0,this.lineVertexBuffer,0),v.draw(z)),n.showBoundsWireframe&&A>0&&(v.setPipeline(this.wireframePipeline),v.setBindGroup(0,this.wireframeBindGroup),v.setVertexBuffer(0,this.wireframeVertexBuffer,0),v.draw(A)),v.end()}}class De{device;clearPipeline;particlesPipeline;resolvePipeline;clearBindGroup;particlesBindGroup;resolveBindGroup;clearParamsBuffer;particlesParamsBuffer;resolveParamsBuffer;particlesParamsData;particlesParamsF32;particlesParamsU32;resolveParamsData;resolveParamsF32;resolveParamsU32;atomicDensityBuffer;densityTexture;_densityTextureView;densityTextureSize={x:1,y:1,z:1};densityWorkgroupSize={x:8,y:8,z:4};constructor(e){this.device=e;const t=e.createShaderModule({code:me});this.clearPipeline=e.createComputePipeline({layout:"auto",compute:{module:t,entryPoint:"main"}}),this.clearParamsBuffer=e.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});const n=e.createShaderModule({code:ge});this.particlesPipeline=e.createComputePipeline({layout:"auto",compute:{module:n,entryPoint:"main"}}),this.particlesParamsData=new ArrayBuffer(64),this.particlesParamsF32=new Float32Array(this.particlesParamsData),this.particlesParamsU32=new Uint32Array(this.particlesParamsData),this.particlesParamsBuffer=e.createBuffer({size:64,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});const s=e.createShaderModule({code:Pe});this.resolvePipeline=e.createComputePipeline({layout:"auto",compute:{module:s,entryPoint:"main"}}),this.resolveParamsData=new ArrayBuffer(32),this.resolveParamsF32=new Float32Array(this.resolveParamsData),this.resolveParamsU32=new Uint32Array(this.resolveParamsData),this.resolveParamsBuffer=e.createBuffer({size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST})}get textureView(){return this._densityTextureView}recreate(e,t){this.densityTexture&&this.densityTexture.destroy(),this.createDensityTexture(e),this.createAtomicDensityBuffer(),this.createBindGroups(t)}dispatch(e,t,n){this.updateParams(t,n);const s=this.densityTextureSize.x*this.densityTextureSize.y*this.densityTextureSize.z,i=e.beginComputePass();i.setPipeline(this.clearPipeline),i.setBindGroup(0,this.clearBindGroup),i.dispatchWorkgroups(Math.ceil(s/256)),i.end();const a=e.beginComputePass();a.setPipeline(this.particlesPipeline),a.setBindGroup(0,this.particlesBindGroup),a.dispatchWorkgroups(Math.ceil(t/256)),a.end();const r=e.beginComputePass();r.setPipeline(this.resolvePipeline),r.setBindGroup(0,this.resolveBindGroup),r.dispatchWorkgroups(Math.ceil(this.densityTextureSize.x/this.densityWorkgroupSize.x),Math.ceil(this.densityTextureSize.y/this.densityWorkgroupSize.y),Math.ceil(this.densityTextureSize.z/this.densityWorkgroupSize.z)),r.end()}destroy(){this.densityTexture&&this.densityTexture.destroy(),this.atomicDensityBuffer&&this.atomicDensityBuffer.destroy()}createDensityTexture(e){const t=e.boundsSize,n=Math.max(t.x,t.y,t.z),s=Math.max(1,Math.round(e.densityTextureRes)),i=Math.max(1,Math.round(t.x/n*s)),a=Math.max(1,Math.round(t.y/n*s)),r=Math.max(1,Math.round(t.z/n*s));this.densityTextureSize={x:i,y:a,z:r},this.densityTexture=this.device.createTexture({size:{width:i,height:a,depthOrArrayLayers:r},dimension:"3d",format:"rgba16float",usage:GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_SRC}),this._densityTextureView=this.densityTexture.createView({dimension:"3d"})}createAtomicDensityBuffer(){this.atomicDensityBuffer&&this.atomicDensityBuffer.destroy();const e=this.densityTextureSize.x*this.densityTextureSize.y*this.densityTextureSize.z;this.atomicDensityBuffer=this.device.createBuffer({size:e*4,usage:GPUBufferUsage.STORAGE})}createBindGroups(e){this.clearBindGroup=this.device.createBindGroup({layout:this.clearPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.atomicDensityBuffer}},{binding:1,resource:{buffer:this.clearParamsBuffer}}]}),this.particlesBindGroup=this.device.createBindGroup({layout:this.particlesPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:e}},{binding:1,resource:{buffer:this.atomicDensityBuffer}},{binding:2,resource:{buffer:this.particlesParamsBuffer}}]}),this.resolveBindGroup=this.device.createBindGroup({layout:this.resolvePipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.atomicDensityBuffer}},{binding:1,resource:this._densityTextureView},{binding:2,resource:{buffer:this.resolveParamsBuffer}}]})}updateParams(e,t){const n=t.smoothingRadius,s=15/(2*Math.PI*Math.pow(n,5)),i=1e3,a=this.densityTextureSize.x*this.densityTextureSize.y*this.densityTextureSize.z,r=t.boundsSize,d=r.x*.5,o=r.z*.5,w=-5,l=new Uint32Array(4);l[0]=a,this.device.queue.writeBuffer(this.clearParamsBuffer,0,l),this.particlesParamsF32[0]=n,this.particlesParamsF32[1]=s,this.particlesParamsU32[2]=e,this.particlesParamsF32[3]=i,this.particlesParamsF32[4]=-d,this.particlesParamsF32[5]=w,this.particlesParamsF32[6]=-o,this.particlesParamsF32[7]=0,this.particlesParamsF32[8]=d,this.particlesParamsF32[9]=w+r.y,this.particlesParamsF32[10]=o,this.particlesParamsF32[11]=0,this.particlesParamsU32[12]=this.densityTextureSize.x,this.particlesParamsU32[13]=this.densityTextureSize.y,this.particlesParamsU32[14]=this.densityTextureSize.z,this.particlesParamsU32[15]=0,this.device.queue.writeBuffer(this.particlesParamsBuffer,0,this.particlesParamsData),this.resolveParamsF32[0]=i,this.resolveParamsF32[1]=0,this.resolveParamsF32[2]=0,this.resolveParamsF32[3]=0,this.resolveParamsU32[4]=this.densityTextureSize.x,this.resolveParamsU32[5]=this.densityTextureSize.y,this.resolveParamsU32[6]=this.densityTextureSize.z,this.resolveParamsU32[7]=0,this.device.queue.writeBuffer(this.resolveParamsBuffer,0,this.resolveParamsData)}}class Te{device;context;config;buffers;physics;grid;renderer;splatPipeline;pickingSystem;state;gridRes={x:0,y:0,z:0};gridTotalCells=0;isPicking=!1;interactionPos={x:0,y:0,z:0};physicsUniforms;gridUniforms;cullUniformBuffer;computeData=new Float32Array(8);integrateData=new Float32Array(24);hashParamsData=new Float32Array(8);sortParamsData=new Uint32Array(8);scanParamsDataL0=new Uint32Array(4);scanParamsDataL1=new Uint32Array(4);scanParamsDataL2=new Uint32Array(4);densityParamsData=new Float32Array(12);pressureParamsData=new Float32Array(16);viscosityParamsData=new Float32Array(12);cullParamsData=new Float32Array(20);indirectArgs=new Uint32Array([6,0,0,0]);constructor(e,t,n,s,i){this.device=e,this.context=t,this.config=s,this.physics=new ce(e),this.grid=new ue(e),this.renderer=new Be(e,n,i,s),this.splatPipeline=new De(e),this.pickingSystem=new de(e),this.physicsUniforms={external:e.createBuffer({size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),density:e.createBuffer({size:48,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),pressure:e.createBuffer({size:64,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),viscosity:e.createBuffer({size:48,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),integrate:e.createBuffer({size:96,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST})},this.gridUniforms={hash:e.createBuffer({size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),sort:e.createBuffer({size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),scanL0:e.createBuffer({size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),scanL1:e.createBuffer({size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),scanL2:e.createBuffer({size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST})},this.cullUniformBuffer=e.createBuffer({size:80,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.reset()}get particleCount(){return this.buffers.particleCount}get simulationState(){return this.state}reset(){this.buffers&&this.buffers.destroy();const{boundsSize:e,smoothingRadius:t}=this.config;this.gridRes={x:Math.ceil(e.x/t),y:Math.ceil(e.y/t),z:Math.ceil(e.z/t)},this.gridTotalCells=this.gridRes.x*this.gridRes.y*this.gridRes.z;const n=he(this.config);this.state=this.createStateFromSpawn(n),this.buffers=new fe(this.device,n,{gridTotalCells:this.gridTotalCells}),this.physics.createBindGroups(this.buffers,this.physicsUniforms),this.grid.createBindGroups(this.buffers,this.gridUniforms),this.splatPipeline.recreate(this.config,this.buffers.predicted),this.pickingSystem.createBindGroup(this.buffers.positions),this.renderer.createBindGroup(this.buffers,this.splatPipeline.textureView,this.cullUniformBuffer);const s=this.device.createCommandEncoder();this.splatPipeline.dispatch(s,this.buffers.particleCount,this.config),this.device.queue.submit([s.finish()])}createStateFromSpawn(e){return{positions:e.positions,predicted:new Float32Array(e.positions),velocities:e.velocities,densities:new Float32Array(e.count*2),keys:new Uint32Array(e.count),sortedKeys:new Uint32Array(e.count),indices:new Uint32Array(e.count),sortOffsets:new Uint32Array(e.count),spatialOffsets:new Uint32Array(e.count),positionsSorted:new Float32Array(e.count*4),predictedSorted:new Float32Array(e.count*4),velocitiesSorted:new Float32Array(e.count*4),count:e.count,input:{worldX:0,worldY:0,worldZ:0,pull:!1,push:!1}}}async step(e){const{config:t,buffers:n,device:s}=this,i=t.maxTimestepFPS?1/t.maxTimestepFPS:Number.POSITIVE_INFINITY,r=Math.min(e*t.timeScale,i)/t.iterationsPerFrame;this.updateUniforms(r);const d=s.createCommandEncoder();let o=!1;!this.isPicking&&this.state.input.rayOrigin&&this.state.input.rayDir&&(this.isPicking=!0,o=!0,this.pickingSystem.dispatch(d,this.state.input.rayOrigin,this.state.input.rayDir,t.smoothingRadius,n.particleCount));const w=d.beginComputePass();for(let u=0;u<t.iterationsPerFrame;u++)this.physics.step(w,this.grid,n.particleCount,this.gridTotalCells,t.viscosityStrength>0);w.end(),this.splatPipeline.dispatch(d,n.particleCount,t),s.queue.submit([d.finish()]),o&&this.pickingSystem.getResult().then(u=>{if(u&&u.hit){let m=u.hitPos.x,P=u.hitPos.y,y=u.hitPos.z;this.state.input.pull&&this.state.input.rayDir&&(m+=this.state.input.rayDir.x*.5,P+=this.state.input.rayDir.y*.5,y+=this.state.input.rayDir.z*.5),this.state.input.worldX=m,this.state.input.worldY=P,this.state.input.worldZ=y,this.state.input.isHoveringFluid=!0}else this.state.input.isHoveringFluid=!1;this.isPicking=!1});const l=.15;this.interactionPos.x+=(this.state.input.worldX-this.interactionPos.x)*l,this.interactionPos.y+=(this.state.input.worldY-this.interactionPos.y)*l,this.interactionPos.z+=(this.state.input.worldZ-this.interactionPos.z)*l}updateUniforms(e){const{config:t,state:n,buffers:s,device:i}=this;let a=0;n.input.push?a=-t.interactionStrength:n.input.pull&&(a=t.interactionStrength),this.computeData[0]=e,this.computeData[1]=t.gravity,this.computeData[2]=t.interactionRadius,this.computeData[3]=a,this.computeData[4]=this.interactionPos.x,this.computeData[5]=this.interactionPos.y,this.computeData[6]=this.interactionPos.z,this.computeData[7]=0,i.queue.writeBuffer(this.physicsUniforms.external,0,this.computeData),this.hashParamsData[0]=t.smoothingRadius,this.hashParamsData[1]=s.particleCount,this.hashParamsData[2]=-t.boundsSize.x*.5,this.hashParamsData[3]=-5,this.hashParamsData[4]=-t.boundsSize.z*.5,this.hashParamsData[5]=this.gridRes.x,this.hashParamsData[6]=this.gridRes.y,this.hashParamsData[7]=this.gridRes.z,i.queue.writeBuffer(this.gridUniforms.hash,0,this.hashParamsData),this.sortParamsData[0]=s.particleCount,this.sortParamsData[1]=this.gridTotalCells,i.queue.writeBuffer(this.gridUniforms.sort,0,this.sortParamsData);const r=Math.ceil((this.gridTotalCells+1)/512),d=Math.ceil(r/512);this.scanParamsDataL0[0]=this.gridTotalCells+1,this.scanParamsDataL1[0]=r,this.scanParamsDataL2[0]=d,i.queue.writeBuffer(this.gridUniforms.scanL0,0,this.scanParamsDataL0),i.queue.writeBuffer(this.gridUniforms.scanL1,0,this.scanParamsDataL1),i.queue.writeBuffer(this.gridUniforms.scanL2,0,this.scanParamsDataL2);const o=t.smoothingRadius,w=15/(2*Math.PI*Math.pow(o,5)),l=15/(Math.PI*Math.pow(o,6));this.densityParamsData[0]=o,this.densityParamsData[1]=w,this.densityParamsData[2]=l,this.densityParamsData[3]=s.particleCount,this.densityParamsData[4]=-t.boundsSize.x*.5,this.densityParamsData[5]=-5,this.densityParamsData[6]=-t.boundsSize.z*.5,this.densityParamsData[7]=0,this.densityParamsData[8]=this.gridRes.x,this.densityParamsData[9]=this.gridRes.y,this.densityParamsData[10]=this.gridRes.z,this.densityParamsData[11]=0,i.queue.writeBuffer(this.physicsUniforms.density,0,this.densityParamsData);const u=15/(Math.PI*Math.pow(o,5)),m=45/(Math.PI*Math.pow(o,6));this.pressureParamsData[0]=e,this.pressureParamsData[1]=t.targetDensity,this.pressureParamsData[2]=t.pressureMultiplier,this.pressureParamsData[3]=t.nearPressureMultiplier,this.pressureParamsData[4]=o,this.pressureParamsData[5]=u,this.pressureParamsData[6]=m,this.pressureParamsData[7]=s.particleCount,this.pressureParamsData[8]=-t.boundsSize.x*.5,this.pressureParamsData[9]=-5,this.pressureParamsData[10]=-t.boundsSize.z*.5,this.pressureParamsData[11]=0,this.pressureParamsData[12]=this.gridRes.x,this.pressureParamsData[13]=this.gridRes.y,this.pressureParamsData[14]=this.gridRes.z,this.pressureParamsData[15]=0,i.queue.writeBuffer(this.physicsUniforms.pressure,0,this.pressureParamsData);const P=315/(64*Math.PI*Math.pow(o,9));this.viscosityParamsData[0]=e,this.viscosityParamsData[1]=t.viscosityStrength,this.viscosityParamsData[2]=o,this.viscosityParamsData[3]=P,this.viscosityParamsData[4]=s.particleCount,this.viscosityParamsData[5]=-t.boundsSize.x*.5,this.viscosityParamsData[6]=-5,this.viscosityParamsData[7]=-t.boundsSize.z*.5,this.viscosityParamsData[8]=this.gridRes.x,this.viscosityParamsData[9]=this.gridRes.y,this.viscosityParamsData[10]=this.gridRes.z,this.viscosityParamsData[11]=0,i.queue.writeBuffer(this.physicsUniforms.viscosity,0,this.viscosityParamsData),this.integrateData[0]=e,this.integrateData[1]=t.collisionDamping;const x=(t.obstacleShape??"box")==="sphere",B=t.obstacleRadius??0,T=t.showObstacle!==!1&&(x?B>0:t.obstacleSize.x>0&&t.obstacleSize.y>0&&t.obstacleSize.z>0);this.integrateData[2]=T?1:0,this.integrateData[3]=x?1:0;const h=t.boundsSize,O=h.x*.5,D=h.z*.5,_=-5;this.integrateData[4]=-O,this.integrateData[5]=_,this.integrateData[6]=-D,this.integrateData[8]=O,this.integrateData[9]=_+h.y,this.integrateData[10]=D,this.integrateData[12]=t.obstacleCentre.x,this.integrateData[13]=x?t.obstacleCentre.y:t.obstacleCentre.y+t.obstacleSize.y*.5,this.integrateData[14]=t.obstacleCentre.z;const c=x?B:t.obstacleSize.x*.5,g=x?B:t.obstacleSize.y*.5,b=x?B:t.obstacleSize.z*.5;this.integrateData[16]=c,this.integrateData[17]=g,this.integrateData[18]=b,this.integrateData[20]=t.obstacleRotation.x,this.integrateData[21]=t.obstacleRotation.y,this.integrateData[22]=t.obstacleRotation.z,i.queue.writeBuffer(this.physicsUniforms.integrate,0,this.integrateData)}render(e){const{device:t,buffers:n,config:s}=this;this.renderer.resize();const i=t.createCommandEncoder();this.device.queue.writeBuffer(n.indirectDraw,0,this.indirectArgs);const a=this.context.canvas.width/this.context.canvas.height,r=te(Math.PI/3,a,.1,100),d=J(r,e);this.cullParamsData.set(d),this.cullParamsData[16]=s.particleRadius,new Uint32Array(this.cullParamsData.buffer)[17]=n.particleCount,this.device.queue.writeBuffer(this.cullUniformBuffer,0,this.cullParamsData),this.renderer.render(i,this.context.getCurrentTexture().createView(),this.config,this.buffers,e),this.device.queue.submit([i.finish()])}}export{Te as F};
