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

    constructor(device: GPUDevice, nx: number, ny: number, nz: number, width: number, height: number, depth: number) {
        this.device = device;
        this.nx = nx;
        this.ny = ny;
        this.nz = nz;
        this.gridWidth = width;
        this.gridHeight = height;
        this.gridDepth = depth;

        const gridCellCount = (nx + 1) * (ny + 1) * (nz + 1);

        // gridVelocityBuffer stores [v.x, v.y, v.z, weight] per cell
        this.gridVelocityBuffer = device.createBuffer({
            size: gridCellCount * 16,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
        
        this.gridVelocityBufferTemp = device.createBuffer({
            size: gridCellCount * 16,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });

        this.markerBuffer = device.createBuffer({
            size: gridCellCount * 4,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });

        this.pressureBuffer = device.createBuffer({
            size: gridCellCount * 4,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });

        this.divergenceBuffer = device.createBuffer({
            size: gridCellCount * 4,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        });
    }
}
