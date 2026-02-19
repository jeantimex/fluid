// Shadow Pass Shader
// Renders particles to shadow depth map

struct Uniforms {
    projectionViewMatrix: mat4x4<f32>,
    sphereRadius: f32,
    positionScale: f32,
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
    return uniforms.projectionViewMatrix * vec4<f32>(worldPos, 1.0);
}

@fragment
fn fs_main() {}
