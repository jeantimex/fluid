export class Simulator {
    device: GPUDevice;
    nx: number; ny: number; nz: number;
    gridWidth: number; gridHeight: number; gridDepth: number;

    // Staggered MAC grid buffers
    // We store velocity and weights separately for each component
    // gridVel stores (vx, vy, vz, scalarWeight) but each is at different staggered positions
    gridVelocityBuffer: GPUBuffer;      // Atomic accumulator for weighted velocities
    gridWeightBuffer: GPUBuffer;        // Atomic accumulator for weights
    gridVelocityFloatBuffer: GPUBuffer; // Normalized velocities
    gridVelocityOrigBuffer: GPUBuffer;  // Original velocities before pressure solve
    gridMarkerBuffer: GPUBuffer;        // Cell markers (fluid/air)
    pressureBuffer: GPUBuffer;
    pressureTempBuffer: GPUBuffer;      // Stores divergence, then used as temp for Jacobi
    uniformBuffer: GPUBuffer;

    clearGridPipeline: GPUComputePipeline;
    transferToGridPipeline: GPUComputePipeline;
    normalizeGridPipeline: GPUComputePipeline;
    markCellsPipeline: GPUComputePipeline;
    addGravityPipeline: GPUComputePipeline;
    enforceBoundaryPipeline: GPUComputePipeline;
    divergencePipeline: GPUComputePipeline;
    jacobiPipeline: GPUComputePipeline;
    applyPressurePipeline: GPUComputePipeline;
    gridToParticlePipeline: GPUComputePipeline;
    advectPipeline: GPUComputePipeline;

    simBindGroup: GPUBindGroup;
    simBindGroupAlt: GPUBindGroup;
    frameNumber: number = 0;

    constructor(device: GPUDevice, nx: number, ny: number, nz: number, width: number, height: number, depth: number, posBuffer: GPUBuffer, velBuffer: GPUBuffer, randomBuffer: GPUBuffer) {
        this.device = device;
        this.nx = nx; this.ny = ny; this.nz = nz;
        this.gridWidth = width; this.gridHeight = height; this.gridDepth = depth;

        // Velocity grid is (nx+1) x (ny+1) x (nz+1) for staggered MAC grid
        const velGridCount = (nx + 1) * (ny + 1) * (nz + 1);
        // Scalar grid (pressure, markers) is nx x ny x nz
        const scalarGridCount = nx * ny * nz;

        const createBuffer = (size: number, usage = GPUBufferUsage.STORAGE) =>
            device.createBuffer({ size, usage });

        // Velocity buffers use vel grid size
        this.gridVelocityBuffer = createBuffer(velGridCount * 16);   // vec4<i32> atomic
        this.gridWeightBuffer = createBuffer(velGridCount * 16);     // vec4<i32> atomic weights
        this.gridVelocityFloatBuffer = createBuffer(velGridCount * 16); // vec4<f32>
        this.gridVelocityOrigBuffer = createBuffer(velGridCount * 16);  // vec4<f32>

        // Marker uses scalar grid size
        this.gridMarkerBuffer = createBuffer(scalarGridCount * 4);

        // Pressure uses scalar grid size
        this.pressureBuffer = createBuffer(scalarGridCount * 4);
        this.pressureTempBuffer = createBuffer(scalarGridCount * 4);

        // Increased buffer size to accommodate mouse data
        this.uniformBuffer = createBuffer(112, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);

        const shaderSource = `
            struct Uniforms {
                nx: u32, ny: u32, nz: u32, particleCount: u32,
                width: f32, height: f32, depth: f32, dt: f32,
                frameNumber: f32, fluidity: f32, gravity: f32, particleDensity: f32,
                mouseVelocity: vec3<f32>, _pad4: f32,
                mouseRayOrigin: vec3<f32>, _pad5: f32,
                mouseRayDirection: vec3<f32>, _pad6: f32,
            };

            @group(0) @binding(0) var<uniform> uniforms: Uniforms;
            @group(0) @binding(1) var<storage, read_write> positions: array<vec4<f32>>;
            @group(0) @binding(2) var<storage, read_write> velocities: array<vec4<f32>>;

            // Atomic buffers for P2G accumulation
            struct AtomicCell { x: atomic<i32>, y: atomic<i32>, z: atomic<i32>, w: atomic<i32> };
            @group(0) @binding(3) var<storage, read_write> gridVelAtomic: array<AtomicCell>;  // weighted velocity
            @group(0) @binding(4) var<storage, read_write> gridWeightAtomic: array<AtomicCell>; // weights

            // Float buffers for simulation
            @group(0) @binding(5) var<storage, read_write> gridVel: array<vec4<f32>>;      // current velocity
            @group(0) @binding(6) var<storage, read_write> gridVelOrig: array<vec4<f32>>; // original velocity
            @group(0) @binding(7) var<storage, read_write> marker: array<u32>;            // scalar grid
            @group(0) @binding(8) var<storage, read_write> pressure: array<f32>;          // scalar grid
            @group(0) @binding(9) var<storage, read_write> divergence: array<f32>;        // scalar grid
            @group(0) @binding(10) var<storage, read> randomDirs: array<vec4<f32>>;       // pre-computed random directions

            const SCALE: f32 = 10000.0;
            const TURBULENCE: f32 = 0.05;  // Match WebGL

            // Velocity grid index (nx+1) x (ny+1) x (nz+1)
            fn velIdx(x: u32, y: u32, z: u32) -> u32 {
                let cx = clamp(x, 0u, uniforms.nx);
                let cy = clamp(y, 0u, uniforms.ny);
                let cz = clamp(z, 0u, uniforms.nz);
                return cx + cy * (uniforms.nx + 1u) + cz * (uniforms.nx + 1u) * (uniforms.ny + 1u);
            }

            // Scalar grid index nx x ny x nz
            fn scalarIdx(x: u32, y: u32, z: u32) -> u32 {
                let cx = clamp(x, 0u, uniforms.nx - 1u);
                let cy = clamp(y, 0u, uniforms.ny - 1u);
                let cz = clamp(z, 0u, uniforms.nz - 1u);
                return cx + cy * uniforms.nx + cz * uniforms.nx * uniforms.ny;
            }

            fn worldToGrid(p: vec3<f32>) -> vec3<f32> {
                return vec3<f32>(
                    p.x / uniforms.width * f32(uniforms.nx),
                    p.y / uniforms.height * f32(uniforms.ny),
                    p.z / uniforms.depth * f32(uniforms.nz)
                );
            }

            // Trilinear kernel weight function (matches WebGL h() and k())
            fn h(r: f32) -> f32 {
                if (r >= 0.0 && r <= 1.0) { return 1.0 - r; }
                else if (r >= -1.0 && r < 0.0) { return 1.0 + r; }
                return 0.0;
            }

            fn kernel(v: vec3<f32>) -> f32 {
                return h(v.x) * h(v.y) * h(v.z);
            }

            // Mouse kernel function (matches WebGL addforce.frag)
            const MOUSE_RADIUS: f32 = 5.0;

            fn mouseKernel(gridPosition: vec3<f32>) -> f32 {
                // Convert grid position to world position
                let worldPosition = gridPosition / vec3<f32>(f32(uniforms.nx), f32(uniforms.ny), f32(uniforms.nz)) *
                                   vec3<f32>(uniforms.width, uniforms.height, uniforms.depth);

                // Distance to mouse ray using cross product
                let toOrigin = worldPosition - uniforms.mouseRayOrigin;
                let distanceToMouseRay = length(cross(uniforms.mouseRayDirection, toOrigin));

                let normalizedDistance = max(0.0, distanceToMouseRay / MOUSE_RADIUS);
                return smoothstep(1.0, 0.9, normalizedDistance);
            }

            // ============ CLEAR GRID ============
            @compute @workgroup_size(8, 4, 4)
            fn clearGrid(@builtin(global_invocation_id) id: vec3<u32>) {
                // Clear velocity grid
                if (id.x <= uniforms.nx && id.y <= uniforms.ny && id.z <= uniforms.nz) {
                    let vi = velIdx(id.x, id.y, id.z);
                    atomicStore(&gridVelAtomic[vi].x, 0);
                    atomicStore(&gridVelAtomic[vi].y, 0);
                    atomicStore(&gridVelAtomic[vi].z, 0);
                    atomicStore(&gridVelAtomic[vi].w, 0);
                    atomicStore(&gridWeightAtomic[vi].x, 0);
                    atomicStore(&gridWeightAtomic[vi].y, 0);
                    atomicStore(&gridWeightAtomic[vi].z, 0);
                    atomicStore(&gridWeightAtomic[vi].w, 0);
                    gridVel[vi] = vec4<f32>(0.0);
                    gridVelOrig[vi] = vec4<f32>(0.0);
                }

                // Clear scalar grid
                if (id.x < uniforms.nx && id.y < uniforms.ny && id.z < uniforms.nz) {
                    let si = scalarIdx(id.x, id.y, id.z);
                    marker[si] = 0u;
                    pressure[si] = 0.0;
                    divergence[si] = 0.0;
                }
            }

            // ============ PARTICLE TO GRID (P2G) - Staggered MAC Grid ============
            // Matches WebGL transfertogrid.frag exactly
            @compute @workgroup_size(64)
            fn transferToGrid(@builtin(global_invocation_id) id: vec3<u32>) {
                let pIdx = id.x;
                if (pIdx >= uniforms.particleCount) { return; }

                let pos = positions[pIdx].xyz;
                let vel = velocities[pIdx].xyz;
                let g = worldToGrid(pos);  // Position in grid coordinates

                // For each nearby grid cell (splat to 2x2x2 neighborhood)
                let baseX = i32(floor(g.x));
                let baseY = i32(floor(g.y));
                let baseZ = i32(floor(g.z));

                for (var di = 0; di <= 1; di++) {
                    for (var dj = 0; dj <= 1; dj++) {
                        for (var dk = 0; dk <= 1; dk++) {
                            let cellX = u32(max(0, baseX + di));
                            let cellY = u32(max(0, baseY + dj));
                            let cellZ = u32(max(0, baseZ + dk));

                            if (cellX > uniforms.nx || cellY > uniforms.ny || cellZ > uniforms.nz) {
                                continue;
                            }

                            let cellIdx = velIdx(cellX, cellY, cellZ);

                            // MAC grid staggered positions:
                            // X velocity at (i, j+0.5, k+0.5)
                            // Y velocity at (i+0.5, j, k+0.5)
                            // Z velocity at (i+0.5, j+0.5, k)
                            // Scalar at (i+0.5, j+0.5, k+0.5)

                            let xPos = vec3<f32>(f32(cellX), f32(cellY) + 0.5, f32(cellZ) + 0.5);
                            let yPos = vec3<f32>(f32(cellX) + 0.5, f32(cellY), f32(cellZ) + 0.5);
                            let zPos = vec3<f32>(f32(cellX) + 0.5, f32(cellY) + 0.5, f32(cellZ));
                            let scalarPos = vec3<f32>(f32(cellX) + 0.5, f32(cellY) + 0.5, f32(cellZ) + 0.5);

                            let xWeight = kernel(g - xPos);
                            let yWeight = kernel(g - yPos);
                            let zWeight = kernel(g - zPos);
                            let scalarWeight = kernel(g - scalarPos);

                            // Accumulate weights
                            atomicAdd(&gridWeightAtomic[cellIdx].x, i32(xWeight * SCALE));
                            atomicAdd(&gridWeightAtomic[cellIdx].y, i32(yWeight * SCALE));
                            atomicAdd(&gridWeightAtomic[cellIdx].z, i32(zWeight * SCALE));
                            atomicAdd(&gridWeightAtomic[cellIdx].w, i32(scalarWeight * SCALE));

                            // Accumulate weighted velocities
                            atomicAdd(&gridVelAtomic[cellIdx].x, i32(vel.x * xWeight * SCALE));
                            atomicAdd(&gridVelAtomic[cellIdx].y, i32(vel.y * yWeight * SCALE));
                            atomicAdd(&gridVelAtomic[cellIdx].z, i32(vel.z * zWeight * SCALE));
                        }
                    }
                }
            }

            // ============ MARK CELLS ============
            @compute @workgroup_size(64)
            fn markCells(@builtin(global_invocation_id) id: vec3<u32>) {
                let pIdx = id.x;
                if (pIdx >= uniforms.particleCount) { return; }

                let pos = positions[pIdx].xyz;
                let g = worldToGrid(pos);

                let cellX = u32(clamp(i32(floor(g.x)), 0, i32(uniforms.nx) - 1));
                let cellY = u32(clamp(i32(floor(g.y)), 0, i32(uniforms.ny) - 1));
                let cellZ = u32(clamp(i32(floor(g.z)), 0, i32(uniforms.nz) - 1));

                let si = scalarIdx(cellX, cellY, cellZ);
                marker[si] = 1u;
            }

            // ============ NORMALIZE GRID ============
            @compute @workgroup_size(8, 4, 4)
            fn normalizeGrid(@builtin(global_invocation_id) id: vec3<u32>) {
                if (id.x > uniforms.nx || id.y > uniforms.ny || id.z > uniforms.nz) { return; }
                let vi = velIdx(id.x, id.y, id.z);

                let wx = f32(atomicLoad(&gridWeightAtomic[vi].x)) / SCALE;
                let wy = f32(atomicLoad(&gridWeightAtomic[vi].y)) / SCALE;
                let wz = f32(atomicLoad(&gridWeightAtomic[vi].z)) / SCALE;
                let ws = f32(atomicLoad(&gridWeightAtomic[vi].w)) / SCALE;

                var vx = 0.0;
                var vy = 0.0;
                var vz = 0.0;

                if (wx > 0.0) {
                    vx = f32(atomicLoad(&gridVelAtomic[vi].x)) / SCALE / wx;
                }
                if (wy > 0.0) {
                    vy = f32(atomicLoad(&gridVelAtomic[vi].y)) / SCALE / wy;
                }
                if (wz > 0.0) {
                    vz = f32(atomicLoad(&gridVelAtomic[vi].z)) / SCALE / wz;
                }

                gridVel[vi] = vec4<f32>(vx, vy, vz, ws);
                gridVelOrig[vi] = vec4<f32>(vx, vy, vz, ws);
            }

            // ============ ADD GRAVITY AND MOUSE FORCE ============
            @compute @workgroup_size(8, 4, 4)
            fn addGravity(@builtin(global_invocation_id) id: vec3<u32>) {
                if (id.x > uniforms.nx || id.y > uniforms.ny || id.z > uniforms.nz) { return; }
                let vi = velIdx(id.x, id.y, id.z);

                // Apply gravity to all cells (matches WebGL)
                gridVel[vi].y -= uniforms.gravity * uniforms.dt;

                // Apply mouse force (matches WebGL addforce.frag)
                // MAC grid staggered positions for velocity components
                let xPosition = vec3<f32>(f32(id.x), f32(id.y) + 0.5, f32(id.z) + 0.5);
                let yPosition = vec3<f32>(f32(id.x) + 0.5, f32(id.y), f32(id.z) + 0.5);
                let zPosition = vec3<f32>(f32(id.x) + 0.5, f32(id.y) + 0.5, f32(id.z));

                let kernelX = mouseKernel(xPosition);
                let kernelY = mouseKernel(yPosition);
                let kernelZ = mouseKernel(zPosition);

                // Force multiplier: 3.0 * smoothstep(0.0, 1/200, timeStep)
                let forceMultiplier = 3.0 * smoothstep(0.0, 1.0 / 200.0, uniforms.dt);

                gridVel[vi].x += uniforms.mouseVelocity.x * kernelX * forceMultiplier;
                gridVel[vi].y += uniforms.mouseVelocity.y * kernelY * forceMultiplier;
                gridVel[vi].z += uniforms.mouseVelocity.z * kernelZ * forceMultiplier;
            }

            // ============ ENFORCE BOUNDARY ============
            @compute @workgroup_size(8, 4, 4)
            fn enforceBoundary(@builtin(global_invocation_id) id: vec3<u32>) {
                if (id.x > uniforms.nx || id.y > uniforms.ny || id.z > uniforms.nz) { return; }
                let vi = velIdx(id.x, id.y, id.z);

                // Solid walls (matching WebGL enforceboundaries.frag)
                if (id.x == 0u) { gridVel[vi].x = 0.0; }
                if (id.x == uniforms.nx) { gridVel[vi].x = 0.0; }
                if (id.y == 0u) { gridVel[vi].y = 0.0; }
                if (id.y == uniforms.ny) { gridVel[vi].y = min(gridVel[vi].y, 0.0); }
                if (id.z == 0u) { gridVel[vi].z = 0.0; }
                if (id.z == uniforms.nz) { gridVel[vi].z = 0.0; }
            }

            // ============ COMPUTE DIVERGENCE ============
            @compute @workgroup_size(8, 4, 4)
            fn computeDivergence(@builtin(global_invocation_id) id: vec3<u32>) {
                if (id.x >= uniforms.nx || id.y >= uniforms.ny || id.z >= uniforms.nz) { return; }
                let si = scalarIdx(id.x, id.y, id.z);

                if (marker[si] == 0u) {
                    divergence[si] = 0.0;
                    return;
                }

                // Sample velocities at face centers (MAC grid)
                // Left face X velocity at (i, j+0.5, k+0.5) -> velIdx(i, j, k)
                // Right face X velocity at (i+1, j+0.5, k+0.5) -> velIdx(i+1, j, k)
                let leftX = gridVel[velIdx(id.x, id.y, id.z)].x;
                let rightX = gridVel[velIdx(id.x + 1u, id.y, id.z)].x;

                let bottomY = gridVel[velIdx(id.x, id.y, id.z)].y;
                let topY = gridVel[velIdx(id.x, id.y + 1u, id.z)].y;

                let backZ = gridVel[velIdx(id.x, id.y, id.z)].z;
                let frontZ = gridVel[velIdx(id.x, id.y, id.z + 1u)].z;

                var div = (rightX - leftX) + (topY - bottomY) + (frontZ - backZ);

                // Volume conservation: use scalar weight (w component)
                let density = gridVel[velIdx(id.x, id.y, id.z)].w;
                div -= max((density - uniforms.particleDensity) * 1.0, 0.0);

                divergence[si] = div;
            }

            // ============ JACOBI PRESSURE SOLVE ============
            @compute @workgroup_size(8, 4, 4)
            fn jacobi(@builtin(global_invocation_id) id: vec3<u32>) {
                if (id.x >= uniforms.nx || id.y >= uniforms.ny || id.z >= uniforms.nz) { return; }
                let si = scalarIdx(id.x, id.y, id.z);

                if (marker[si] == 0u) { return; }

                let div = divergence[si];

                // Sample neighbor pressures
                var pL = 0.0; var pR = 0.0; var pB = 0.0; var pT = 0.0; var pBk = 0.0; var pFr = 0.0;

                if (id.x > 0u) { pL = pressure[scalarIdx(id.x - 1u, id.y, id.z)]; }
                if (id.x < uniforms.nx - 1u) { pR = pressure[scalarIdx(id.x + 1u, id.y, id.z)]; }
                if (id.y > 0u) { pB = pressure[scalarIdx(id.x, id.y - 1u, id.z)]; }
                if (id.y < uniforms.ny - 1u) { pT = pressure[scalarIdx(id.x, id.y + 1u, id.z)]; }
                if (id.z > 0u) { pBk = pressure[scalarIdx(id.x, id.y, id.z - 1u)]; }
                if (id.z < uniforms.nz - 1u) { pFr = pressure[scalarIdx(id.x, id.y, id.z + 1u)]; }

                pressure[si] = (pL + pR + pB + pT + pBk + pFr - div) / 6.0;
            }

            // ============ APPLY PRESSURE GRADIENT (subtract.frag) ============
            @compute @workgroup_size(8, 4, 4)
            fn applyPressure(@builtin(global_invocation_id) id: vec3<u32>) {
                if (id.x > uniforms.nx || id.y > uniforms.ny || id.z > uniforms.nz) { return; }
                let vi = velIdx(id.x, id.y, id.z);

                var v = gridVel[vi];

                // For X velocity at face (i, j+0.5, k+0.5):
                // gradient = pressure[i,j,k] - pressure[i-1,j,k]
                let pRight = pressure[scalarIdx(id.x, id.y, id.z)];
                let pLeft = pressure[scalarIdx(id.x - 1u, id.y, id.z)];
                v.x -= (pRight - pLeft);

                // For Y velocity at face (i+0.5, j, k+0.5):
                // gradient = pressure[i,j,k] - pressure[i,j-1,k]
                let pTop = pressure[scalarIdx(id.x, id.y, id.z)];
                let pBottom = pressure[scalarIdx(id.x, id.y - 1u, id.z)];
                v.y -= (pTop - pBottom);

                // For Z velocity at face (i+0.5, j+0.5, k):
                // gradient = pressure[i,j,k] - pressure[i,j,k-1]
                let pFront = pressure[scalarIdx(id.x, id.y, id.z)];
                let pBack = pressure[scalarIdx(id.x, id.y, id.z - 1u)];
                v.z -= (pFront - pBack);

                gridVel[vi] = v;
            }

            // ============ STAGGERED VELOCITY SAMPLING ============
            // Sample X velocity: stored at (i, j+0.5, k+0.5)
            fn sampleXVelocity(g: vec3<f32>) -> f32 {
                // Shift to X-face coordinates
                let p = vec3<f32>(g.x, g.y - 0.5, g.z - 0.5);
                let base = vec3<i32>(i32(floor(p.x)), i32(floor(p.y)), i32(floor(p.z)));
                let f = p - vec3<f32>(f32(base.x), f32(base.y), f32(base.z));

                var v = 0.0;
                for (var di = 0; di <= 1; di++) {
                    for (var dj = 0; dj <= 1; dj++) {
                        for (var dk = 0; dk <= 1; dk++) {
                            let w = select(1.0 - f.x, f.x, di == 1) *
                                    select(1.0 - f.y, f.y, dj == 1) *
                                    select(1.0 - f.z, f.z, dk == 1);
                            let ix = u32(clamp(base.x + di, 0, i32(uniforms.nx)));
                            let iy = u32(clamp(base.y + dj, 0, i32(uniforms.ny)));
                            let iz = u32(clamp(base.z + dk, 0, i32(uniforms.nz)));
                            v += gridVel[velIdx(ix, iy, iz)].x * w;
                        }
                    }
                }
                return v;
            }

            // Sample Y velocity: stored at (i+0.5, j, k+0.5)
            fn sampleYVelocity(g: vec3<f32>) -> f32 {
                let p = vec3<f32>(g.x - 0.5, g.y, g.z - 0.5);
                let base = vec3<i32>(i32(floor(p.x)), i32(floor(p.y)), i32(floor(p.z)));
                let f = p - vec3<f32>(f32(base.x), f32(base.y), f32(base.z));

                var v = 0.0;
                for (var di = 0; di <= 1; di++) {
                    for (var dj = 0; dj <= 1; dj++) {
                        for (var dk = 0; dk <= 1; dk++) {
                            let w = select(1.0 - f.x, f.x, di == 1) *
                                    select(1.0 - f.y, f.y, dj == 1) *
                                    select(1.0 - f.z, f.z, dk == 1);
                            let ix = u32(clamp(base.x + di, 0, i32(uniforms.nx)));
                            let iy = u32(clamp(base.y + dj, 0, i32(uniforms.ny)));
                            let iz = u32(clamp(base.z + dk, 0, i32(uniforms.nz)));
                            v += gridVel[velIdx(ix, iy, iz)].y * w;
                        }
                    }
                }
                return v;
            }

            // Sample Z velocity: stored at (i+0.5, j+0.5, k)
            fn sampleZVelocity(g: vec3<f32>) -> f32 {
                let p = vec3<f32>(g.x - 0.5, g.y - 0.5, g.z);
                let base = vec3<i32>(i32(floor(p.x)), i32(floor(p.y)), i32(floor(p.z)));
                let f = p - vec3<f32>(f32(base.x), f32(base.y), f32(base.z));

                var v = 0.0;
                for (var di = 0; di <= 1; di++) {
                    for (var dj = 0; dj <= 1; dj++) {
                        for (var dk = 0; dk <= 1; dk++) {
                            let w = select(1.0 - f.x, f.x, di == 1) *
                                    select(1.0 - f.y, f.y, dj == 1) *
                                    select(1.0 - f.z, f.z, dk == 1);
                            let ix = u32(clamp(base.x + di, 0, i32(uniforms.nx)));
                            let iy = u32(clamp(base.y + dj, 0, i32(uniforms.ny)));
                            let iz = u32(clamp(base.z + dk, 0, i32(uniforms.nz)));
                            v += gridVel[velIdx(ix, iy, iz)].z * w;
                        }
                    }
                }
                return v;
            }

            fn sampleVelocity(p: vec3<f32>) -> vec3<f32> {
                let g = worldToGrid(p);
                return vec3<f32>(sampleXVelocity(g), sampleYVelocity(g), sampleZVelocity(g));
            }

            // Same for original velocity grid
            fn sampleXVelocityOrig(g: vec3<f32>) -> f32 {
                let p = vec3<f32>(g.x, g.y - 0.5, g.z - 0.5);
                let base = vec3<i32>(i32(floor(p.x)), i32(floor(p.y)), i32(floor(p.z)));
                let f = p - vec3<f32>(f32(base.x), f32(base.y), f32(base.z));

                var v = 0.0;
                for (var di = 0; di <= 1; di++) {
                    for (var dj = 0; dj <= 1; dj++) {
                        for (var dk = 0; dk <= 1; dk++) {
                            let w = select(1.0 - f.x, f.x, di == 1) *
                                    select(1.0 - f.y, f.y, dj == 1) *
                                    select(1.0 - f.z, f.z, dk == 1);
                            let ix = u32(clamp(base.x + di, 0, i32(uniforms.nx)));
                            let iy = u32(clamp(base.y + dj, 0, i32(uniforms.ny)));
                            let iz = u32(clamp(base.z + dk, 0, i32(uniforms.nz)));
                            v += gridVelOrig[velIdx(ix, iy, iz)].x * w;
                        }
                    }
                }
                return v;
            }

            fn sampleYVelocityOrig(g: vec3<f32>) -> f32 {
                let p = vec3<f32>(g.x - 0.5, g.y, g.z - 0.5);
                let base = vec3<i32>(i32(floor(p.x)), i32(floor(p.y)), i32(floor(p.z)));
                let f = p - vec3<f32>(f32(base.x), f32(base.y), f32(base.z));

                var v = 0.0;
                for (var di = 0; di <= 1; di++) {
                    for (var dj = 0; dj <= 1; dj++) {
                        for (var dk = 0; dk <= 1; dk++) {
                            let w = select(1.0 - f.x, f.x, di == 1) *
                                    select(1.0 - f.y, f.y, dj == 1) *
                                    select(1.0 - f.z, f.z, dk == 1);
                            let ix = u32(clamp(base.x + di, 0, i32(uniforms.nx)));
                            let iy = u32(clamp(base.y + dj, 0, i32(uniforms.ny)));
                            let iz = u32(clamp(base.z + dk, 0, i32(uniforms.nz)));
                            v += gridVelOrig[velIdx(ix, iy, iz)].y * w;
                        }
                    }
                }
                return v;
            }

            fn sampleZVelocityOrig(g: vec3<f32>) -> f32 {
                let p = vec3<f32>(g.x - 0.5, g.y - 0.5, g.z);
                let base = vec3<i32>(i32(floor(p.x)), i32(floor(p.y)), i32(floor(p.z)));
                let f = p - vec3<f32>(f32(base.x), f32(base.y), f32(base.z));

                var v = 0.0;
                for (var di = 0; di <= 1; di++) {
                    for (var dj = 0; dj <= 1; dj++) {
                        for (var dk = 0; dk <= 1; dk++) {
                            let w = select(1.0 - f.x, f.x, di == 1) *
                                    select(1.0 - f.y, f.y, dj == 1) *
                                    select(1.0 - f.z, f.z, dk == 1);
                            let ix = u32(clamp(base.x + di, 0, i32(uniforms.nx)));
                            let iy = u32(clamp(base.y + dj, 0, i32(uniforms.ny)));
                            let iz = u32(clamp(base.z + dk, 0, i32(uniforms.nz)));
                            v += gridVelOrig[velIdx(ix, iy, iz)].z * w;
                        }
                    }
                }
                return v;
            }

            fn sampleVelocityOrig(p: vec3<f32>) -> vec3<f32> {
                let g = worldToGrid(p);
                return vec3<f32>(sampleXVelocityOrig(g), sampleYVelocityOrig(g), sampleZVelocityOrig(g));
            }

            // ============ GRID TO PARTICLE (G2P) ============
            @compute @workgroup_size(64)
            fn gridToParticle(@builtin(global_invocation_id) id: vec3<u32>) {
                let pIdx = id.x;
                if (pIdx >= uniforms.particleCount) { return; }

                let pos = positions[pIdx].xyz;
                let velOld = velocities[pIdx].xyz;

                let vGridNew = sampleVelocity(pos);
                let vGridOld = sampleVelocityOrig(pos);

                // FLIP: particle velocity + grid velocity change
                let vFlip = velOld + (vGridNew - vGridOld);
                // PIC: just use grid velocity
                let vPic = vGridNew;
                // Blend
                let vNew = mix(vPic, vFlip, uniforms.fluidity);

                velocities[pIdx] = vec4<f32>(vNew, 0.0);
            }

            // ============ ADVECT PARTICLES ============
            @compute @workgroup_size(64)
            fn advect(@builtin(global_invocation_id) id: vec3<u32>) {
                let pIdx = id.x;
                if (pIdx >= uniforms.particleCount) { return; }

                var pos = positions[pIdx].xyz;

                // RK2 advection
                let v1 = sampleVelocity(pos);
                let midPos = pos + v1 * uniforms.dt * 0.5;
                let v2 = sampleVelocity(midPos);

                var step = v2 * uniforms.dt;

                // Turbulence using pre-computed random directions (matching WebGL)
                // WebGL: fract(v_coordinates + u_frameNumber / u_particlesResolution)
                // We simulate this by offsetting the index based on frame number
                let offset = u32(uniforms.frameNumber) % uniforms.particleCount;
                let randomIdx = (pIdx + offset) % uniforms.particleCount;
                let randomDir = randomDirs[randomIdx].xyz;
                step += TURBULENCE * randomDir * length(v1) * uniforms.dt;

                pos += step;

                // Clamp to bounds (same as WebGL)
                let eps = 0.01;
                pos = clamp(pos, vec3<f32>(eps), vec3<f32>(uniforms.width - eps, uniforms.height - eps, uniforms.depth - eps));

                positions[pIdx] = vec4<f32>(pos, 1.0);
            }
        `;

        const shaderModule = device.createShaderModule({ code: shaderSource });

        const bindGroupLayout = device.createBindGroupLayout({
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
                { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
                { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
                { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
                { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
                { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
                { binding: 7, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
                { binding: 8, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
                { binding: 9, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
                { binding: 10, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
            ]
        });

        const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });
        const makePipeline = (entry: string) => device.createComputePipeline({
            layout: pipelineLayout,
            compute: { module: shaderModule, entryPoint: entry }
        });

        this.clearGridPipeline = makePipeline('clearGrid');
        this.transferToGridPipeline = makePipeline('transferToGrid');
        this.normalizeGridPipeline = makePipeline('normalizeGrid');
        this.markCellsPipeline = makePipeline('markCells');
        this.addGravityPipeline = makePipeline('addGravity');
        this.enforceBoundaryPipeline = makePipeline('enforceBoundary');
        this.divergencePipeline = makePipeline('computeDivergence');
        this.jacobiPipeline = makePipeline('jacobi');
        this.applyPressurePipeline = makePipeline('applyPressure');
        this.gridToParticlePipeline = makePipeline('gridToParticle');
        this.advectPipeline = makePipeline('advect');

        this.simBindGroup = device.createBindGroup({
            layout: bindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: this.uniformBuffer } },
                { binding: 1, resource: { buffer: posBuffer } },
                { binding: 2, resource: { buffer: velBuffer } },
                { binding: 3, resource: { buffer: this.gridVelocityBuffer } },
                { binding: 4, resource: { buffer: this.gridWeightBuffer } },
                { binding: 5, resource: { buffer: this.gridVelocityFloatBuffer } },
                { binding: 6, resource: { buffer: this.gridVelocityOrigBuffer } },
                { binding: 7, resource: { buffer: this.gridMarkerBuffer } },
                { binding: 8, resource: { buffer: this.pressureBuffer } },
                { binding: 9, resource: { buffer: this.pressureTempBuffer } },
                { binding: 10, resource: { buffer: randomBuffer } },
            ]
        });

        // Alt bind group not needed for current implementation
        this.simBindGroupAlt = this.simBindGroup;

        this.updateUniforms(0, 0.99, 40.0, 10.0, [0, 0, 0], [0, 0, 0], [0, 0, 1]);
    }

    updateUniforms(particleCount: number, fluidity: number, gravity: number, particleDensity: number, mouseVelocity: number[], mouseRayOrigin: number[], mouseRayDirection: number[]) {
        const data = new ArrayBuffer(112);
        const u32 = new Uint32Array(data);
        const f32 = new Float32Array(data);
        u32[0] = this.nx;
        u32[1] = this.ny;
        u32[2] = this.nz;
        u32[3] = particleCount;
        f32[4] = this.gridWidth;
        f32[5] = this.gridHeight;
        f32[6] = this.gridDepth;
        f32[7] = 1.0 / 60.0;
        f32[8] = this.frameNumber;  // Frame number for time-varying turbulence
        f32[9] = fluidity;  // fluidity (FLIP ratio)
        f32[10] = gravity;  // gravity
        f32[11] = particleDensity; // target density
        // Mouse velocity (vec3 + padding)
        f32[12] = mouseVelocity[0];
        f32[13] = mouseVelocity[1];
        f32[14] = mouseVelocity[2];
        f32[15] = 0.0; // padding
        // Mouse ray origin (vec3 + padding)
        f32[16] = mouseRayOrigin[0];
        f32[17] = mouseRayOrigin[1];
        f32[18] = mouseRayOrigin[2];
        f32[19] = 0.0; // padding
        // Mouse ray direction (vec3 + padding)
        f32[20] = mouseRayDirection[0];
        f32[21] = mouseRayDirection[1];
        f32[22] = mouseRayDirection[2];
        f32[23] = 0.0; // padding
        this.device.queue.writeBuffer(this.uniformBuffer, 0, data);
        this.frameNumber++;
    }

    step(pass: GPUComputePassEncoder, particleCount: number, fluidity: number, gravity: number, particleDensity: number, mouseVelocity: number[], mouseRayOrigin: number[], mouseRayDirection: number[]) {
        this.updateUniforms(particleCount, fluidity, gravity, particleDensity, mouseVelocity, mouseRayOrigin, mouseRayDirection);

        const velGridWG = [
            Math.ceil((this.nx + 1) / 8),
            Math.ceil((this.ny + 1) / 4),
            Math.ceil((this.nz + 1) / 4)
        ];
        const scalarGridWG = [
            Math.ceil(this.nx / 8),
            Math.ceil(this.ny / 4),
            Math.ceil(this.nz / 4)
        ];
        const particleWG = Math.ceil(particleCount / 64);

        pass.setBindGroup(0, this.simBindGroup);

        // 1. Clear grid (covers both velocity and scalar grids)
        pass.setPipeline(this.clearGridPipeline);
        pass.dispatchWorkgroups(velGridWG[0], velGridWG[1], velGridWG[2]);

        // 2. P2G: Transfer particle velocities to grid (staggered MAC)
        pass.setPipeline(this.transferToGridPipeline);
        pass.dispatchWorkgroups(particleWG);

        // 3. Mark cells with fluid
        pass.setPipeline(this.markCellsPipeline);
        pass.dispatchWorkgroups(particleWG);

        // 4. Normalize grid velocities
        pass.setPipeline(this.normalizeGridPipeline);
        pass.dispatchWorkgroups(velGridWG[0], velGridWG[1], velGridWG[2]);

        // 5. Add gravity
        pass.setPipeline(this.addGravityPipeline);
        pass.dispatchWorkgroups(velGridWG[0], velGridWG[1], velGridWG[2]);

        // 6. Enforce boundary conditions
        pass.setPipeline(this.enforceBoundaryPipeline);
        pass.dispatchWorkgroups(velGridWG[0], velGridWG[1], velGridWG[2]);

        // 7. Compute divergence (scalar grid)
        pass.setPipeline(this.divergencePipeline);
        pass.dispatchWorkgroups(scalarGridWG[0], scalarGridWG[1], scalarGridWG[2]);

        // 8. Jacobi pressure solve (50 iterations - match WebGL)
        for (let i = 0; i < 50; i++) {
            pass.setPipeline(this.jacobiPipeline);
            pass.dispatchWorkgroups(scalarGridWG[0], scalarGridWG[1], scalarGridWG[2]);
        }

        // 9. Apply pressure gradient (velocity grid)
        pass.setPipeline(this.applyPressurePipeline);
        pass.dispatchWorkgroups(velGridWG[0], velGridWG[1], velGridWG[2]);

        // 10. Enforce boundaries again after pressure
        pass.setPipeline(this.enforceBoundaryPipeline);
        pass.dispatchWorkgroups(velGridWG[0], velGridWG[1], velGridWG[2]);

        // 11. G2P: Transfer grid velocity back to particles (FLIP/PIC)
        pass.setPipeline(this.gridToParticlePipeline);
        pass.dispatchWorkgroups(particleWG);

        // 12. Advect particles using grid velocity
        pass.setPipeline(this.advectPipeline);
        pass.dispatchWorkgroups(particleWG);
    }
}
