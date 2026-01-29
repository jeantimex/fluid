@group(0) @binding(0) var blitTexture: texture_2d<f32>;
@group(0) @binding(1) var blitSampler: sampler;

struct VSOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex fn vs_main(@builtin(vertex_index) i: u32) -> VSOut {
  // Fullscreen triangle: 3 vertices cover the entire screen
  let x = f32(i32(i) / 2) * 4.0 - 1.0;
  let y = f32(i32(i) % 2) * 4.0 - 1.0;
  var out: VSOut;
  out.position = vec4<f32>(x, y, 0.0, 1.0);
  out.uv = vec2<f32>((x + 1.0) * 0.5, (1.0 - y) * 0.5);
  return out;
}

@fragment fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  let color = textureSample(blitTexture, blitSampler, in.uv);
  // Convert linear output to sRGB to match Unity's Linear color space display.
  let lo = color.rgb * 12.92;
  let hi = 1.055 * pow(color.rgb, vec3<f32>(1.0 / 2.4)) - 0.055;
  let srgb = select(hi, lo, color.rgb <= vec3<f32>(0.0031308));
  return vec4<f32>(srgb, color.a);
}
