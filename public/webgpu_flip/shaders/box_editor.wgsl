struct Uniforms {
    projectionMatrix: mat4x4<f32>,
    viewMatrix: mat4x4<f32>,
    translation: vec3<f32>,
    scale: vec3<f32>,
    color: vec4<f32>,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

@vertex
fn vs_main(@location(0) position: vec3<f32>) -> @builtin(position) vec4<f32> {
    let scaledPos = position * uniforms.scale + uniforms.translation;
    return uniforms.projectionMatrix * uniforms.viewMatrix * vec4<f32>(scaledPos, 1.0);
}

@fragment
fn fs_main() -> @location(0) vec4<f32> {
    return uniforms.color;
}
