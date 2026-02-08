#include "shadow_common.wgsl"

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
