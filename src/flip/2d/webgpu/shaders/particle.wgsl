/**
 * Particle Rendering Shader
 *
 * Renders particles as circular disks using instanced quad rendering.
 * Each particle is rendered as a quad with a circular cutout in the fragment shader.
 */

struct Uniforms {
  domainSize: vec2<f32>,
  pointSize: f32,
  _pad: f32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> positions: array<vec2<f32>>;
@group(0) @binding(2) var<storage, read> colors: array<f32>;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec3<f32>,
  @location(1) uv: vec2<f32>,
};

// Quad vertices: 4 corners of a unit square centered at origin
const quadVertices = array<vec2<f32>, 4>(
  vec2<f32>(-1.0, -1.0),
  vec2<f32>(1.0, -1.0),
  vec2<f32>(-1.0, 1.0),
  vec2<f32>(1.0, 1.0)
);

@vertex
fn vs_main(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32
) -> VertexOutput {
  var output: VertexOutput;

  // Get particle position
  let particlePos = positions[instanceIndex];

  // Get quad vertex offset
  let quadOffset = quadVertices[vertexIndex];

  // Scale quad by point size (in simulation units)
  let halfSize = uniforms.pointSize * 0.5;
  let worldPos = particlePos + quadOffset * halfSize;

  // Transform to NDC: [-1, 1] range
  let screenPos = vec2<f32>(
    2.0 * worldPos.x / uniforms.domainSize.x - 1.0,
    2.0 * worldPos.y / uniforms.domainSize.y - 1.0
  );

  output.position = vec4<f32>(screenPos, 0.0, 1.0);

  // Pass UV for circular mask (0 to 1 range)
  output.uv = quadOffset * 0.5 + 0.5;

  // Get color (stored as interleaved r,g,b)
  let colorIndex = instanceIndex * 3u;
  output.color = vec3<f32>(
    colors[colorIndex],
    colors[colorIndex + 1u],
    colors[colorIndex + 2u]
  );

  return output;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
  // Discard pixels outside the circle
  let dist = length(input.uv - vec2<f32>(0.5, 0.5));
  if (dist > 0.5) {
    discard;
  }

  return vec4<f32>(input.color, 1.0);
}
