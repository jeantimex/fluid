/**
 * ============================================================================
 * WIREFRAME LINE SHADER
 * ============================================================================
 *
 * Pipeline Stage: Render pass (debug overlay)
 * Entry Points: vs_main (vertex), fs_main (fragment)
 * Topology: line-list
 *
 * Purpose:
 * --------
 * Renders the simulation bounding box and optional obstacles as thin 3D
 * lines using the standard vertex-attribute pipeline (not vertex pulling).
 *
 * Each line segment is defined by two vertices, each carrying a world-space
 * position and an RGBA colour. The vertex shader transforms positions into
 * clip space; the fragment shader passes the colour through unchanged.
 *
 * This shader shares the same view-projection matrix as the particle
 * renderer so the wireframe aligns perfectly with the particles.
 * ============================================================================
 */

/**
 * Wireframe Uniforms Buffer
 *
 * Memory Layout (matches MarchingCubesRenderer renderUniformBuffer first 64 bytes):
 * Offset  Size  Field
 * ------  ----  -----
 *   0     64    viewProjection - Combined View × Projection matrix
 *  64     32    pad0           - Padding/Unused fields
 * ------
 */
struct Uniforms {
  viewProjection: mat4x4<f32>,
  pad0: vec4<f32>,
  pad1: vec4<f32>,
};

// ============================================================================
// BUFFER BINDINGS
// ============================================================================
// Group 0: Wireframe render pass
//
//   Binding 0: uniforms - View-projection matrix and padding
// ============================================================================

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

/**
 * Per-vertex input attributes (from the vertex buffer).
 *
 * @location(0) pos   - World-space position of the line endpoint (vec3<f32>)
 * @location(1) color - RGBA colour for this endpoint (vec4<f32>)
 */
struct VertexIn {
  @location(0) pos: vec3<f32>,
  @location(1) color: vec4<f32>,
};

/**
 * Vertex-to-fragment interpolants.
 *
 * @builtin(position) position - Clip-space position (for rasterisation)
 * @location(0)       color    - Interpolated RGBA colour
 */
struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
};

/**
 * Vertex Shader
 *
 * Transforms the world-space line endpoint to clip space and passes
 * the per-vertex colour to the fragment stage for interpolation.
 */
@vertex
fn vs_main(input: VertexIn) -> VertexOut {
  var out: VertexOut;
  // Transform world position to clip space
  out.position = uniforms.viewProjection * vec4<f32>(input.pos, 1.0);
  // Pass colour through for per-pixel interpolation
  out.color = input.color;
  return out;
}

/**
 * Fragment Shader
 *
 * Outputs the interpolated colour with no additional shading.
 */
@fragment
fn fs_main(@location(0) color: vec4<f32>) -> @location(0) vec4<f32> {
  return color;
}
