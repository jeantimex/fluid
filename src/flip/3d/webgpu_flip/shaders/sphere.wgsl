struct Uniforms {
    projectionMatrix: mat4x4<f32>,
    viewMatrix: mat4x4<f32>,
    sphereRadius: f32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> positions: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> velocities: array<vec4<f32>>;

struct VertexInput {
    @location(0) position: vec3<f32>,
    @builtin(instance_index) instanceIndex: u32,
};

struct VertexOutput {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) color: vec4<f32>,
};

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
    let particlePos = positions[input.instanceIndex].xyz;
    let velocity = velocities[input.instanceIndex].xyz;
    
    let worldPos = input.position * uniforms.sphereRadius + particlePos;
    
    var out: VertexOutput;
    out.clip_position = uniforms.projectionMatrix * uniforms.viewMatrix * vec4<f32>(worldPos, 1.0);
    
    // Simple color based on speed (blue for slow, red for fast)
    let speed = length(velocity);
    let colorMix = clamp(speed * 0.1, 0.0, 1.0);
    out.color = mix(vec4<f32>(0.0, 0.4, 0.9, 1.0), vec4<f32>(1.0, 0.2, 0.1, 1.0), colorMix);
    
    return out;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    return input.color;
}
