// G-Buffer Pass Shader
// Renders particles to a G-buffer storing normal, speed, and depth

struct Uniforms {
    projectionMatrix: mat4x4<f32>,
    viewMatrix: mat4x4<f32>,
    sphereRadius: f32,
    positionScale: f32,
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
    let spherePos = positions[instanceIndex].xyz * uniforms.positionScale;
    let velocity = velocities[instanceIndex].xyz;
    let simOffset = vec3<f32>(uniforms.simOffsetX, uniforms.simOffsetY, uniforms.simOffsetZ);
    let worldPos = vertexPos * uniforms.sphereRadius + spherePos + simOffset;
    let viewPos = uniforms.viewMatrix * vec4<f32>(worldPos, 1.0);

    var out: VertexOutput;
    out.position = uniforms.projectionMatrix * viewPos;
    out.viewSpaceNormal = (uniforms.viewMatrix * vec4<f32>(vertexNormal, 0.0)).xyz;
    out.viewSpaceZ = viewPos.z;
    out.speed = length(velocity);
    return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    let n = normalize(in.viewSpaceNormal);
    return vec4<f32>(n.x, n.y, in.speed, in.viewSpaceZ);
}
