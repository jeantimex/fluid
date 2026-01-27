struct Uniforms {
  viewProjection: mat4x4<f32>,
  radius: f32,
  pad0: vec3<f32>,
};

@group(0) @binding(0) var<storage, read> positions: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read> velocities: array<vec4<f32>>;
@group(0) @binding(2) var<uniform> uniforms: Uniforms;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) color: vec3<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instanceIndex: u32) -> VertexOutput {
  let pos = positions[instanceIndex].xyz;
  let vel = velocities[instanceIndex].xyz;
  
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

  // Simple billboard logic in clip space (fixed size on screen)
  let clipPos = uniforms.viewProjection * vec4<f32>(pos, 1.0);
  
  var out: VertexOutput;
  // Offset in clip space X/Y
  // Adjust radius based on w component to fake perspective scaling? 
  // No, let's keep it fixed screen size ("point sprite") or 
  // multiply by clipPos.w to make it world size?
  // Let's make it world size roughly.
  
  // World size approach:
  // Requires View matrix to align quad to camera. 
  // Simplified: clipPos + offset * w.
  // If we want fixed size points, just add offset (after divide by W usually).
  // But here we are before divide.
  
  out.position = clipPos + vec4<f32>(quadPos * uniforms.radius, 0.0, 0.0);
  
  out.uv = quadPos;
  let speed = length(vel);
  out.color = mix(vec3<f32>(0.0, 0.0, 1.0), vec3<f32>(1.0, 0.0, 0.0), saturate(speed * 0.2)); 
  
  return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
  let d = length(in.uv);
  if (d > 1.0) { discard; }
  return vec4<f32>(in.color, 1.0);
}
