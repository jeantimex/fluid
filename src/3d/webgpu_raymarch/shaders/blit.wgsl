// =============================================================================
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
