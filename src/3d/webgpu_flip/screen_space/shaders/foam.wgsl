/**
 * Foam Render Shader
 *
 * Beginner note: draws foam particles as soft billboards into a foam texture.
 */

struct Uniforms {
  viewProjection: mat4x4<f32>,
  canvasSize: vec2<f32>,
  particleRadius: f32,
  pad0: f32,
  // x=anisotropy, y=renderMode (0 points, 1 patches)
  controls: vec2<f32>,
  pad1: vec2<f32>,
};

@group(0) @binding(0) var<storage, read> foamPositions: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read> foamVelocities: array<vec4<f32>>;
@group(0) @binding(2) var<uniform> uniforms: Uniforms;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) intensity: f32,
};

@vertex
fn vs_main(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32
) -> VertexOutput {
  let posData = foamPositions[instanceIndex];
  let velData = foamVelocities[instanceIndex];

  let pos = posData.xyz;
  let lifetime = posData.w;
  let scale = velData.w;
  let vel = velData.xyz;

  var out: VertexOutput;

  // Dead particles produce degenerate triangles (behind far plane)
  if (lifetime <= 0.0) {
    out.position = vec4<f32>(0.0, 0.0, 2.0, 1.0);
    out.uv = vec2<f32>(0.0, 0.0);
    out.intensity = 0.0;
    return out;
  }

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

  // Fade out over last 2 seconds of lifetime.
  let dissolveScale = saturate(lifetime / 2.0);

  let clipPos = uniforms.viewProjection * vec4<f32>(pos, 1.0);
  let patchMode = uniforms.controls.y > 0.5;
  let speed = length(vel);
  let anisotropy = select(0.0, max(0.0, uniforms.controls.x), patchMode);
  let stretch = 1.0 + anisotropy * clamp(speed * 0.5, 0.0, 2.0);

  let velClip = uniforms.viewProjection * vec4<f32>(pos + vel * 0.02, 1.0);
  let velDirRaw = velClip.xy - clipPos.xy;
  let velDir = select(vec2<f32>(1.0, 0.0), normalize(velDirRaw), length(velDirRaw) > 1e-5);
  let velPerp = vec2<f32>(-velDir.y, velDir.x);

  let billboardBase = uniforms.particleRadius * scale * dissolveScale;
  let billboardSize = select(billboardBase, billboardBase * 1.25, patchMode);
  let radiusNdc = vec2<f32>(
    billboardSize / uniforms.canvasSize.x * 2.0,
    billboardSize / uniforms.canvasSize.y * 2.0
  );
  let offsetDir = velDir * (quadPos.x * stretch) + velPerp * quadPos.y;
  let offset = offsetDir * radiusNdc * clipPos.w;

  out.position = clipPos + vec4<f32>(offset, 0.0, 0.0);
  out.uv = vec2<f32>(quadPos.x / stretch, quadPos.y);
  out.intensity = dissolveScale;
  return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) f32 {
  let d = length(in.uv);
  if (d > 1.0) {
    discard;
  }
  let falloff = exp(-2.75 * d * d);
  return in.intensity * falloff;
}
