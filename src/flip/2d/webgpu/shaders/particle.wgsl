struct VertexOutput {
  @builtin(position) position : vec4<f32>,
  @location(0) color : vec3<f32>,
  @location(1) uv : vec2<f32>,
}

struct Uniforms {
  domainSize : vec2<f32>,
  pointSize : f32,
}

@group(0) @binding(0) var<uniform> uniforms : Uniforms;

@vertex
fn vs_main(
  @builtin(vertex_index) vertexIndex : u32,
  @location(0) particlePos : vec2<f32>, // Instanced
  @location(1) particleColor : vec3<f32> // Instanced
) -> VertexOutput {
  var output : VertexOutput;

  // Generate a quad from vertex index (0-3) for triangle-strip
  // 0: (-1, 1), 1: (1, 1), 2: (-1, -1), 3: (1, -1)
  let pos = vec2<f32>(
    f32(vertexIndex % 2u) * 2.0 - 1.0,
    1.0 - f32(vertexIndex / 2u) * 2.0
  );
  
  output.uv = pos; 

  // Transform particle position to clip space
  // Map [0, domainSize] -> [-1, 1]
  let clipPos = (particlePos / uniforms.domainSize) * 2.0 - 1.0;
  
  // Scale the quad to point size (in clip space)
  let quadSize = uniforms.pointSize / uniforms.domainSize.x * 2.0; 
  
  output.position = vec4<f32>(clipPos + pos * quadSize, 0.0, 1.0);
  output.color = particleColor;

  return output;
}

@fragment
fn fs_main(input : VertexOutput) -> @location(0) vec4<f32> {
  // Discard pixels outside the circle radius
  if (dot(input.uv, input.uv) > 1.0) {
    discard;
  }
  return vec4<f32>(input.color, 1.0);
}
