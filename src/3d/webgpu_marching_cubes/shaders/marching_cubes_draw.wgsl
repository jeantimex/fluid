struct Vertex {
  position: vec3<f32>,
  normal: vec3<f32>,
};

struct Uniforms {
  viewProjection: mat4x4<f32>,
  color: vec4<f32>,
  lightDir: vec3<f32>,
  ambient: f32,
  sceneExposure: f32,
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
  let shading = uniforms.ambient + (1.0 - uniforms.ambient) * diffuse;
  return vec4<f32>(uniforms.color.rgb * shading * uniforms.sceneExposure, uniforms.color.a);
}
