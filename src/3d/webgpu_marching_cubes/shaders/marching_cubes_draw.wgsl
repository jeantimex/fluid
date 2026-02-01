struct Vertex {
  position: vec3<f32>,
  normal: vec3<f32>,
};

struct Uniforms {
  viewProjection: mat4x4<f32>,
  color: vec4<f32>,
  lightDir: vec3<f32>,
  _pad0: f32,
};

@group(0) @binding(0) var<storage, read> vertices: array<Vertex>;
@group(0) @binding(1) var<uniform> uniforms: Uniforms;

struct VSOut {
  @builtin(position) position: vec4<f32>,
  @location(0) normal: vec3<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VSOut {
  let v = vertices[vertexIndex];
  var out: VSOut;
  out.position = uniforms.viewProjection * vec4<f32>(v.position, 1.0);
  out.normal = v.normal;
  return out;
}

@fragment
fn fs_main(input: VSOut) -> @location(0) vec4<f32> {
  let n = normalize(input.normal);
  let l = normalize(uniforms.lightDir);
  let diffuse = dot(n, l) * 0.5 + 0.5;
  let shading = 0.25 + 0.75 * diffuse;
  return vec4<f32>(uniforms.color.rgb * shading, uniforms.color.a);
}
