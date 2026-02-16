struct Uniforms {
    nx: u32,
    ny: u32,
    nz: u32,
    width: f32,
    height: f32,
    depth: f32,
    dt: f32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read_write> positions: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> velocities: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> gridVelocity: array<vec4<f32>>;

fn getIndex(x: u32, y: u32, z: u32) -> u32 {
    return x + y * (uniforms.nx + 1) + z * (uniforms.nx + 1) * (uniforms.ny + 1);
}

@compute @workgroup_size(8, 8, 8)
fn vs_gravity(@builtin(global_invocation_id) id: vec3<u32>) {
    if (id.x > uniforms.nx || id.y > uniforms.ny || id.z > uniforms.nz) { return; }
    let idx = getIndex(id.x, id.y, id.z);
    
    // Add gravity to grid velocity
    // Note: gridVelocity must be read_write in the bind group for this to work
}

@compute @workgroup_size(64)
fn vs_advect(@builtin(global_invocation_id) id: vec3<u32>) {
    let particleIdx = id.x;
    if (particleIdx >= arrayLength(&positions)) { return; }

    var p = positions[particleIdx].xyz;
    var v = velocities[particleIdx].xyz;

    // Simple gravity for verification
    v.y -= 9.8 * uniforms.dt;

    p += v * uniforms.dt;

    // Boundary collision
    if (p.x < 0.0) { p.x = 0.0; v.x *= -0.5; }
    if (p.x > uniforms.width) { p.x = uniforms.width; v.x *= -0.5; }
    if (p.y < 0.0) { p.y = 0.0; v.y *= -0.5; }
    if (p.y > uniforms.height) { p.y = uniforms.height; v.y *= -0.5; }
    if (p.z < 0.0) { p.z = 0.0; v.z *= -0.5; }
    if (p.z > uniforms.depth) { p.z = uniforms.depth; v.z *= -0.5; }

    positions[particleIdx] = vec4<f32>(p, 0.0);
    velocities[particleIdx] = vec4<f32>(v, 0.0);
}
