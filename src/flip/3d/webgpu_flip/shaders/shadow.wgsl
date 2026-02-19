// =============================================================================
// SHADOW MAP DEPTH PASS
// =============================================================================
//
// This pass renders the scene from the light's point of view to create a
// depth buffer (shadow map). This map is later sampled during compositing
// to determine which pixels are in shadow.
//
// ## Shadow Mapping Overview
//
// 1. Render scene depth from light's perspective (this pass)
// 2. During compositing, for each pixel:
//    a. Transform world position to light's clip space
//    b. Compare pixel's depth to shadow map depth
//    c. If pixel is farther than shadow map → in shadow
//
// ## Implementation Details
//
// - **Light projection**: Orthographic for directional sun light
// - **Resolution**: 1024x1024 (configurable via SHADOW_MAP_SIZE)
// - **Filtering**: 3x3 PCF in composite pass
// - **Bias**: Small offset (0.002) prevents self-shadowing artifacts
//
// ## Empty Fragment Shader
//
// Since we only need depth values (stored automatically by the depth buffer),
// the fragment shader is empty. No color attachment is needed.
//
// ## Performance Optimization
//
// Uses lower-polygon sphere geometry (1 subdivision level) since shadow
// edges will be softened by PCF filtering anyway.

struct Uniforms {
  // Light camera transform.
  projectionViewMatrix: mat4x4<f32>,
  sphereRadius: f32,
  positionScale: f32,
  // Simulation-space to world-space offset.
  simOffsetX: f32,
  simOffsetY: f32,
  simOffsetZ: f32,
  _pad: vec3<f32>,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> positions: array<vec4<f32>>;

@vertex
fn vs_main(
  @location(0) vertexPos: vec3<f32>,
  @builtin(instance_index) instanceIndex: u32
) -> @builtin(position) vec4<f32> {
  let spherePos = positions[instanceIndex].xyz * uniforms.positionScale;
  let simOffset = vec3<f32>(uniforms.simOffsetX, uniforms.simOffsetY, uniforms.simOffsetZ);
  let worldPos = vertexPos * uniforms.sphereRadius + spherePos + simOffset;
  // Clip-space output from the light's point of view.
  return uniforms.projectionViewMatrix * vec4<f32>(worldPos, 1.0);
}

@fragment
fn fs_main() {}
