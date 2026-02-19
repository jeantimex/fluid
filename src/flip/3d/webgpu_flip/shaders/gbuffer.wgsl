// =============================================================================
// G-BUFFER RENDERING PASS
// =============================================================================
//
// This pass renders fluid particles as instanced sphere meshes into a G-buffer
// texture. Each particle becomes a small sphere in 3D space.
//
// ## Deferred Rendering
//
// Rather than computing final lighting here, we output intermediate data:
// - **Normal (xy)**: View-space normal direction (z reconstructed from unit length)
// - **Speed**: Velocity magnitude for color variation
// - **Depth**: View-space Z coordinate for AO and compositing
//
// This data is consumed by later fullscreen passes (AO, composite) which
// perform the actual lighting calculations.
//
// ## Instanced Rendering
//
// All particles share the same sphere mesh (generated via icosphere subdivision).
// We use GPU instancing: one draw call renders all particles, with each instance
// sampling its position/velocity from storage buffers.
//
// ## G-Buffer Layout (rgba16float)
//
// | Channel | Content              | Range     |
// |---------|----------------------|-----------|
// | R       | Normal.x (view)      | [-1, 1]   |
// | G       | Normal.y (view)      | [-1, 1]   |
// | B       | Speed (|velocity|)   | [0, ∞)    |
// | A       | View-space Z (depth) | (-∞, 0]   |
//
// Normal.z is reconstructed: z = sqrt(1 - x² - y²)

struct Uniforms {
  projectionMatrix: mat4x4<f32>,
  viewMatrix: mat4x4<f32>,
  // Sphere radius in world units.
  sphereRadius: f32,
  // Optional scale for simulation-space positions.
  positionScale: f32,
  // Simulation-to-world translation.
  simOffsetX: f32,
  simOffsetY: f32,
  simOffsetZ: f32,
  _pad: f32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> positions: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> velocities: array<vec4<f32>>;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) viewSpaceNormal: vec3<f32>,
  @location(1) viewSpaceZ: f32,
  @location(2) speed: f32,
};

@vertex
fn vs_main(
  @location(0) vertexPos: vec3<f32>,
  @location(1) vertexNormal: vec3<f32>,
  @builtin(instance_index) instanceIndex: u32
) -> VertexOutput {
  // Per-instance particle state.
  let spherePos = positions[instanceIndex].xyz * uniforms.positionScale;
  let velocity = velocities[instanceIndex].xyz;
  let simOffset = vec3<f32>(uniforms.simOffsetX, uniforms.simOffsetY, uniforms.simOffsetZ);

  // Expand unit sphere vertex into world and then view space.
  let worldPos = vertexPos * uniforms.sphereRadius + spherePos + simOffset;
  let viewPos = uniforms.viewMatrix * vec4<f32>(worldPos, 1.0);

  var out: VertexOutput;
  out.position = uniforms.projectionMatrix * viewPos;
  out.viewSpaceNormal = (uniforms.viewMatrix * vec4<f32>(vertexNormal, 0.0)).xyz;
  out.viewSpaceZ = viewPos.z;
  // Speed is scalar magnitude used later for color ramping.
  out.speed = length(velocity);
  return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
  // Pack only x/y to save bandwidth; z reconstructed in composite/AO.
  let n = normalize(in.viewSpaceNormal);
  return vec4<f32>(n.x, n.y, in.speed, in.viewSpaceZ);
}
