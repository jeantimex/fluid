struct Uniforms {
    nx: u32,
    ny: u32,
    nz: u32,
    width: f32,
    height: f32,
    depth: f32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> positions: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> velocities: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> gridVelocity: array<vec4<f32>>; // [vx, vy, vz, weight]

// Helper to get 1D index from 3D coords
fn getIndex(x: u32, y: u32, z: u32) -> u32 {
    return x + y * (uniforms.nx + 1) + z * (uniforms.nx + 1) * (uniforms.ny + 1);
}

// Atomic float addition is not standard, so we use a simpler approach for now:
// Each particle handles its own splatting. 
// Note: This has race conditions without atomics. 
// For a production fluid sim, we'd use a grid-based scatter or atomic-int hacks.
// For this verification, we'll implement the logic, knowing it might be noisy.

@compute @workgroup_size(64)
fn vs_transfer(@builtin(global_invocation_id) id: vec3<u32>) {
    let particleIdx = id.x;
    if (particleIdx >= arrayLength(&positions)) { return; }

    let p = positions[particleIdx].xyz;
    let v = velocities[particleIdx].xyz;

    // Convert world position to grid coordinates
    let gx = (p.x / uniforms.width) * f32(uniforms.nx);
    let gy = (p.y / uniforms.height) * f32(uniforms.ny);
    let gz = (p.z / uniforms.depth) * f32(uniforms.nz);

    let ix = u32(floor(gx));
    let iy = u32(floor(gy));
    let iz = u32(floor(gz));

    // Linear interpolation weights
    let fx = gx - f32(ix);
    let fy = gy - f32(iy);
    let fz = gz - f32(iz);

    // Splat to 8 neighbors
    for (var i: u32 = 0; i <= 1; i++) {
        for (var j: u32 = 0; j <= 1; j++) {
            for (var k: u32 = 0; k <= 1; k++) {
                let neighborIdx = getIndex(ix + i, iy + j, iz + k);
                let weight = (select(1.0 - fx, fx, i == 1)) *
                             (select(1.0 - fy, fy, j == 1)) *
                             (select(1.0 - fz, fz, k == 1));
                
                // We use race-condition prone addition for now just to prove the pipeline.
                // In Task 3.2 proper, we will fix this with atomics or a different strategy.
                gridVelocity[neighborIdx] += vec4<f32>(v * weight, weight);
            }
        }
    }
}

@compute @workgroup_size(8, 8, 8)
fn vs_normalize(@builtin(global_invocation_id) id: vec3<u32>) {
    if (id.x > uniforms.nx || id.y > uniforms.ny || id.z > uniforms.nz) { return; }
    
    let idx = getIndex(id.x, id.y, id.z);
    let val = gridVelocity[idx];
    
    if (val.w > 0.0) {
        gridVelocity[idx] = vec4<f32>(val.xyz / val.w, val.w);
    }
}
