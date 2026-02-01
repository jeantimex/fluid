// =============================================================================
// Background Shader
// =============================================================================
// Renders the shared environment (Sky + Floor) using a fullscreen triangle.

#include "../../common/shaders/environment.wgsl"

// The shared environment.wgsl expects a 'uniforms' variable of type EnvironmentUniforms
// We bind it at group 0, binding 0
@group(0) @binding(0) var<uniform> uniforms: EnvironmentUniforms;

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

  // Sample the shared environment function
  let color = getEnvironmentColor(camera.cameraPos, dir, uniforms);
  
  let exposedColor = color * uniforms.sceneExposure;
  
  return vec4<f32>(exposedColor, 1.0);
}
