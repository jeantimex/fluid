export class Simulator {
    device: GPUDevice;
    
    // Grid dimensions
    nx: number; // resolution x
    ny: number; // resolution y
    nz: number; // resolution z
    
    gridWidth: number;
    gridHeight: number;
    gridDepth: number;

    // Grid Buffers (Storage)
    // We use a slightly oversized grid (nx+1, ny+1, nz+1) for the staggered layout
    gridVelocityBuffer: GPUBuffer; // vec4<f32> [x, y, z, weight]
    gridVelocityBufferTemp: GPUBuffer;
    
    markerBuffer: GPUBuffer; // u32 (0: Air, 1: Fluid)
    pressureBuffer: GPUBuffer; // f32
    divergenceBuffer: GPUBuffer; // f32
    
    // Simulation parameters
    flipness: number = 0.99;
    timeStep: number = 1.0 / 60.0;

    // Pipelines
    transferPipeline: GPUComputePipeline;
    advectPipeline: GPUComputePipeline;
    
    // Bind Groups
    simBindGroup: GPUBindGroup;
    uniformBuffer: GPUBuffer;

    constructor(device: GPUDevice, nx: number, ny: number, nz: number, width: number, height: number, depth: number, posBuffer: GPUBuffer, velBuffer: GPUBuffer) {
        this.device = device;
        this.nx = nx;
        this.ny = ny;
        this.nz = nz;
        this.gridWidth = width;
        this.gridHeight = height;
        this.gridDepth = depth;

        const gridCellCount = (nx + 1) * (ny + 1) * (nz + 1);

        this.gridVelocityBuffer = device.createBuffer({
            size: gridCellCount * 16,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        
        this.gridVelocityBufferTemp = device.createBuffer({
            size: gridCellCount * 16,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });

        this.uniformBuffer = device.createBuffer({
            size: 64, // nx, ny, nz, w, h, d, dt
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        const advectShader = device.createShaderModule({
            code: `
                struct Uniforms {
                    nx: u32, ny: u32, nz: u32,
                    width: f32, height: f32, depth: f32,
                    dt: f32,
                };
                @group(0) @binding(0) var<uniform> uniforms: Uniforms;
                @group(0) @binding(1) var<storage, read_write> positions: array<vec4<f32>>;
                @group(0) @binding(2) var<storage, read_write> velocities: array<vec4<f32>>;

                @compute @workgroup_size(64)
                fn main(@builtin(global_invocation_id) id: vec3<u32>) {
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
            `
        });

        this.advectPipeline = device.createComputePipeline({
            layout: 'auto',
            compute: { module: advectShader, entryPoint: 'main' }
        });

        this.simBindGroup = device.createBindGroup({
            layout: this.advectPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.uniformBuffer } },
                { binding: 1, resource: { buffer: posBuffer } },
                { binding: 2, resource: { buffer: velBuffer } },
            ]
        });

        // Initialize uniform buffer
        const uniformData = new ArrayBuffer(32);
        const u32View = new Uint32Array(uniformData, 0, 3);
        const f32View = new Float32Array(uniformData, 12, 4);
        u32View[0] = nx; u32View[1] = ny; u32View[2] = nz;
        f32View[0] = width; f32View[1] = height; f32View[2] = depth;
        f32View[3] = this.timeStep;
        device.queue.writeBuffer(this.uniformBuffer, 0, uniformData);
    }

    step(commandEncoder: GPUComputePassEncoder, particleCount: number) {
        commandEncoder.setPipeline(this.advectPipeline);
        commandEncoder.setBindGroup(0, this.simBindGroup);
        commandEncoder.dispatchWorkgroups(Math.ceil(particleCount / 64));
    }
}
