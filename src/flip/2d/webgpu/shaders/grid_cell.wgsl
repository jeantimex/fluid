/**
 * Grid Cell Rendering Shader
 *
 * Renders grid cells as colored squares using instanced quad rendering.
 * Similar to particle shader but without the circular cutout.
 */

struct Uniforms {
  domainSize: vec2<f32>,
  cellSize: f32,
  _pad: f32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> centers: array<vec2<f32>>;
@group(0) @binding(2) var<storage, read> colors: array<f32>;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec3<f32>,
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

  // Get cell center position
  let cellCenter = centers[instanceIndex];

  // Get quad vertex offset
  let quadOffset = quadVertices[vertexIndex];

  // Scale quad by cell size (0.9 to leave small gaps)
  let halfSize = uniforms.cellSize * 0.45;
  let worldPos = cellCenter + quadOffset * halfSize;

  // Transform to NDC: [-1, 1] range
  let screenPos = vec2<f32>(
    2.0 * worldPos.x / uniforms.domainSize.x - 1.0,
    2.0 * worldPos.y / uniforms.domainSize.y - 1.0
  );

  output.position = vec4<f32>(screenPos, 0.0, 1.0);

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
  return vec4<f32>(input.color, 1.0);
}
