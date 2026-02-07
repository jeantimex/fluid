#include "shadow_common.wgsl"


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