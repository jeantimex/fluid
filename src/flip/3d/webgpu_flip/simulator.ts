import { AABB } from './aabb';

export class Simulator {
    device: GPUDevice;
    
    // Grid dimensions
    nx: number; ny: number; nz: number;
    gridWidth: number; gridHeight: number; gridDepth: number;

    // Buffers
    gridVelocityBuffer: GPUBuffer;
    gridVelocityFloatBuffer: GPUBuffer;
    uniformBuffer: GPUBuffer;
    
    // Pipelines
    clearGridPipeline: GPUComputePipeline;
    transferToGridPipeline: GPUComputePipeline;
    normalizeGridPipeline: GPUComputePipeline;
    advectPipeline: GPUComputePipeline;
    
    // Bind Groups
    simBindGroup: GPUBindGroup;

    constructor(device: GPUDevice, nx: number, ny: number, nz: number, width: number, height: number, depth: number, posBuffer: GPUBuffer, velBuffer: GPUBuffer) {
        this.device = device;
        this.nx = nx; this.ny = ny; this.nz = nz;
        this.gridWidth = width; this.gridHeight = height; this.gridDepth = depth;

        const gridCellCount = (nx + 1) * (ny + 1) * (nz + 1);

        this.gridVelocityBuffer = device.createBuffer({
            size: gridCellCount * 16,
            usage: GPUBufferUsage.STORAGE,
        });

        this.gridVelocityFloatBuffer = device.createBuffer({
            size: gridCellCount * 16,
            usage: GPUBufferUsage.STORAGE,
        });

        this.uniformBuffer = device.createBuffer({
            size: 64,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        const shaderSource = `
            struct Uniforms {
                nx: u32, ny: u32, nz: u32,
                width: f32, height: f32, depth: f32,
                dt: f32,
            };

            @group(0) @binding(0) var<uniform> uniforms: Uniforms;
            @group(0) @binding(1) var<storage, read_write> positions: array<vec4<f32>>;
            @group(0) @binding(2) var<storage, read_write> velocities: array<vec4<f32>>;
            
            struct AtomicGridCell {
                x: atomic<i32>,
                y: atomic<i32>,
                z: atomic<i32>,
                w: atomic<i32>,
            };
            @group(0) @binding(3) var<storage, read_write> gridVelocityAtomic: array<AtomicGridCell>;
            @group(0) @binding(4) var<storage, read_write> gridVelocityFloat: array<vec4<f32>>;

            fn getIndex(x: u32, y: u32, z: u32) -> u32 {
                return x + y * (uniforms.nx + 1) + z * (uniforms.nx + 1) * (uniforms.ny + 1);
            }

            const FIXED_POINT_SCALE: f32 = 1000.0;

            @compute @workgroup_size(8, 4, 4)
            fn clearGrid(@builtin(global_invocation_id) id: vec3<u32>) {
                if (id.x > uniforms.nx || id.y > uniforms.ny || id.z > uniforms.nz) { return; }
                let idx = getIndex(id.x, id.y, id.z);
                atomicStore(&gridVelocityAtomic[idx].x, 0);
                atomicStore(&gridVelocityAtomic[idx].y, 0);
                atomicStore(&gridVelocityAtomic[idx].z, 0);
                atomicStore(&gridVelocityAtomic[idx].w, 0);
            }

            @compute @workgroup_size(64)
            fn transferToGrid(@builtin(global_invocation_id) id: vec3<u32>) {
                let pIdx = id.x;
                if (pIdx >= arrayLength(&positions)) { return; }

                let p = positions[pIdx].xyz;
                let v = velocities[pIdx].xyz;

                let gx = (p.x / uniforms.width) * f32(uniforms.nx);
                let gy = (p.y / uniforms.height) * f32(uniforms.ny);
                let gz = (p.z / uniforms.depth) * f32(uniforms.nz);

                let ix = u32(floor(gx));
                let iy = u32(floor(gy));
                let iz = u32(floor(gz));

                let fx = gx - f32(ix);
                let fy = gy - f32(iy);
                let fz = gz - f32(iz);

                for (var i: u32 = 0; i <= 1; i++) {
                    for (var j: u32 = 0; j <= 1; j++) {
                        for (var k: u32 = 0; k <= 1; k++) {
                            let nIdx = getIndex(ix + i, iy + j, iz + k);
                            let weight = (select(1.0 - fx, fx, i == 1)) *
                                         (select(1.0 - fy, fy, j == 1)) *
                                         (select(1.0 - fz, fz, k == 1));
                            
                            atomicAdd(&gridVelocityAtomic[nIdx].x, i32(v.x * weight * FIXED_POINT_SCALE));
                            atomicAdd(&gridVelocityAtomic[nIdx].y, i32(v.y * weight * FIXED_POINT_SCALE));
                            atomicAdd(&gridVelocityAtomic[nIdx].z, i32(v.z * weight * FIXED_POINT_SCALE));
                            atomicAdd(&gridVelocityAtomic[nIdx].w, i32(weight * FIXED_POINT_SCALE));
                        }
                    }
                }
            }

            @compute @workgroup_size(8, 4, 4)
            fn normalizeGrid(@builtin(global_invocation_id) id: vec3<u32>) {
                if (id.x > uniforms.nx || id.y > uniforms.ny || id.z > uniforms.nz) { return; }
                let idx = getIndex(id.x, id.y, id.z);
                
                let weight = f32(atomicLoad(&gridVelocityAtomic[idx].w)) / FIXED_POINT_SCALE;
                if (weight > 0.0) {
                    let vx = f32(atomicLoad(&gridVelocityAtomic[idx].x)) / (FIXED_POINT_SCALE * weight);
                    let vy = f32(atomicLoad(&gridVelocityAtomic[idx].y)) / (FIXED_POINT_SCALE * weight);
                    let vz = f32(atomicLoad(&gridVelocityAtomic[idx].z)) / (FIXED_POINT_SCALE * weight);
                    gridVelocityFloat[idx] = vec4<f32>(vx, vy, vz, weight);
                } else {
                    gridVelocityFloat[idx] = vec4<f32>(0.0);
                }
            }

            @compute @workgroup_size(64)
            fn advect(@builtin(global_invocation_id) id: vec3<u32>) {
                let idx = id.x;
                if (idx >= arrayLength(&positions)) { return; }
                var p = positions[idx].xyz;
                var v = velocities[idx].xyz;

                v.y -= 9.8 * uniforms.dt;
                p += v * uniforms.dt;

                if (p.x < 0.0) { p.x = 0.0; v.x *= -0.5; }
                if (p.x > uniforms.width) { p.x = uniforms.width; v.x *= -0.5; }
                if (p.y < 0.0) { p.y = 0.0; v.y *= -0.5; }
                if (p.y > uniforms.height) { p.y = uniforms.height; v.y *= -0.5; }
                if (p.z < 0.0) { p.z = 0.0; v.z *= -0.5; }
                if (p.z > uniforms.depth) { p.z = uniforms.depth; v.z *= -0.5; }

                positions[idx] = vec4<f32>(p, 1.0);
                velocities[idx] = vec4<f32>(v, 0.0);
            }
        `;

        const shaderModule = device.createShaderModule({ code: shaderSource });

        // Explicit Bind Group Layout to ensure compatibility across all pipelines
        const bindGroupLayout = device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
                { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
                { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
                { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
            ]
        });

        const pipelineLayout = device.createPipelineLayout({
            bindGroupLayouts: [bindGroupLayout]
        });

        const pipelineDesc = (entry: string) => ({
            layout: pipelineLayout,
            compute: { module: shaderModule, entryPoint: entry }
        });

        this.clearGridPipeline = device.createComputePipeline(pipelineDesc('clearGrid'));
        this.transferToGridPipeline = device.createComputePipeline(pipelineDesc('transferToGrid'));
        this.normalizeGridPipeline = device.createComputePipeline(pipelineDesc('normalizeGrid'));
        this.advectPipeline = device.createComputePipeline(pipelineDesc('advect'));

        this.simBindGroup = device.createBindGroup({
            layout: bindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: this.uniformBuffer } },
                { binding: 1, resource: { buffer: posBuffer } },
                { binding: 2, resource: { buffer: velBuffer } },
                { binding: 3, resource: { buffer: this.gridVelocityBuffer } },
                { binding: 4, resource: { buffer: this.gridVelocityFloatBuffer } },
            ]
        });

        const uniformData = new ArrayBuffer(32);
        const u32View = new Uint32Array(uniformData, 0, 3);
        const f32View = new Float32Array(uniformData, 12, 4);
        u32View[0] = nx; u32View[1] = ny; u32View[2] = nz;
        f32View[0] = width; f32View[1] = height; f32View[2] = depth;
        f32View[3] = 1.0 / 60.0;
        device.queue.writeBuffer(this.uniformBuffer, 0, uniformData);
    }

    step(commandEncoder: GPUComputePassEncoder, particleCount: number) {
        commandEncoder.setBindGroup(0, this.simBindGroup);

        commandEncoder.setPipeline(this.clearGridPipeline);
        commandEncoder.dispatchWorkgroups(Math.ceil((this.nx + 1) / 8), Math.ceil((this.ny + 1) / 4), Math.ceil((this.nz + 1) / 4));

        commandEncoder.setPipeline(this.transferToGridPipeline);
        commandEncoder.dispatchWorkgroups(Math.ceil(particleCount / 64));

        commandEncoder.setPipeline(this.normalizeGridPipeline);
        commandEncoder.dispatchWorkgroups(Math.ceil((this.nx + 1) / 8), Math.ceil((this.ny + 1) / 4), Math.ceil((this.nz + 1) / 4));

        commandEncoder.setPipeline(this.advectPipeline);
        commandEncoder.dispatchWorkgroups(Math.ceil(particleCount / 64));
    }
}
