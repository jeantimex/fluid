struct Uniforms {
  viewProjection: mat4x4<f32>,
  canvasSize: vec2<f32>,
  particleRadius: f32,
  velocityDisplayMax: f32,
};

@group(0) @binding(0) var<storage, read> positions: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read> velocities: array<vec4<f32>>;
@group(0) @binding(2) var<uniform> uniforms: Uniforms;
@group(0) @binding(3) var<storage, read> gradient: array<vec4<f32>>;
@group(0) @binding(4) var<storage, read> visibleIndices: array<u32>;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) color: vec3<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instanceIndex: u32) -> VertexOutput {
  let index = visibleIndices[instanceIndex];
  let pos = positions[index].xyz;
  let vel = velocities[index].xyz;
  
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

  let clipPos = uniforms.viewProjection * vec4<f32>(pos, 1.0);

  // Convert pixel radius to NDC (same as 2D calculation)
  let radiusNdc = vec2<f32>(
    uniforms.particleRadius / uniforms.canvasSize.x * 2.0,
    uniforms.particleRadius / uniforms.canvasSize.y * 2.0
  );
  // Scale by clipPos.w to work in clip space (before perspective divide)
  let offset = quadPos * radiusNdc * clipPos.w;

  var out: VertexOutput;
  out.position = clipPos + vec4<f32>(offset, 0.0, 0.0);
  
  out.uv = quadPos;
  let speed = length(vel);
  let t = saturate(speed / uniforms.velocityDisplayMax);
  let colorIndex = u32(t * f32(arrayLength(&gradient) - 1u));
  out.color = gradient[colorIndex].rgb;
  
  return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
  let d = length(in.uv);
  if (d > 1.0) { discard; }
  return vec4<f32>(in.color, 1.0);
}
