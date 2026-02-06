/**
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

struct ShadowUniforms {
  lightViewProjection: mat4x4<f32>,
  shadowSoftness: f32,
  particleShadowRadius: f32,
  pad0: vec2<f32>,
};

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
