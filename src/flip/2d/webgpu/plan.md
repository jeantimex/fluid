FLIP Fluid Simulation - GPU Compute Shader Port

 Context

 Problem: The FLIP fluid simulation currently runs entirely on CPU (~29,000 particles). While
 rendering uses WebGPU, the simulation bottleneck is JavaScript executing:
 - Particle integration
 - Spatial hashing for collision detection
 - P2G/G2P velocity transfers
 - Pressure solver (50 iterations)

 Goal: Port the CPU simulation to GPU compute shaders for significant performance improvement,
 enabling larger particle counts (100k+).

 Existing Patterns: The codebase has established WebGPU compute patterns in src/sph/2d/webgpu/:
 - compute_pipelines.ts - Pipeline creation with layout: 'auto'
 - shaders/*.wgsl - Compute shaders with @workgroup_size(256)
 - Spatial hashing with counting sort
 - Atomic operations for scattered writes

 ---
 Simulation Steps Analysis

 Step: 1. Integrate Particles
 CPU Method: integrateParticles()
 GPU Complexity: Easy
 Strategy: Per-particle parallel
 ────────────────────────────────────────
 Step: 2. Push Particles Apart
 CPU Method: pushParticlesApart()
 GPU Complexity: Hard
 Strategy: Spatial hash + prefix sum
 ────────────────────────────────────────
 Step: 3. Handle Collisions
 CPU Method: handleParticleCollisions()
 GPU Complexity: Easy
 Strategy: Per-particle parallel
 ────────────────────────────────────────
 Step: 4. P2G Transfer
 CPU Method: transferVelocities(true)
 GPU Complexity: Hard
 Strategy: Atomic accumulation
 ────────────────────────────────────────
 Step: 5. Update Density
 CPU Method: updateParticleDensity()
 GPU Complexity: Medium
 Strategy: Atomic accumulation
 ────────────────────────────────────────
 Step: 6. Pressure Solve
 CPU Method: solveIncompressibility()
 GPU Complexity: Very Hard
 Strategy: Jacobi iterations
 ────────────────────────────────────────
 Step: 7. G2P Transfer
 CPU Method: transferVelocities(false)
 GPU Complexity: Easy
 Strategy: Per-particle reads
 ────────────────────────────────────────
 Step: 8. Update Colors
 CPU Method: updateParticleColors()
 GPU Complexity: Easy
 Strategy: Per-particle parallel

 ---
 Architecture Overview

 src/flip/2d/webgpu/
 ├── main.ts                      # Updated to use GPU simulation
 ├── flip_fluid.ts                # Keep for initialization only
 ├── gpu_simulation.ts            # NEW: GPU simulation orchestrator
 ├── gpu_buffers.ts               # NEW: All GPU buffer management
 ├── gpu_pipelines.ts             # NEW: Compute pipeline management
 └── shaders/
     ├── particle.wgsl            # (existing render shader)
     ├── grid_cell.wgsl           # (existing render shader)
     ├── disk.wgsl                # (existing render shader)
     ├── integrate.wgsl           # NEW: Particle integration
     ├── hash.wgsl                # NEW: Compute spatial hash keys
     ├── count.wgsl               # NEW: Count particles per cell
     ├── prefix_sum.wgsl          # NEW: Parallel prefix sum
     ├── reorder.wgsl             # NEW: Reorder particles by hash
     ├── push_apart.wgsl          # NEW: Particle separation
     ├── collisions.wgsl          # NEW: Boundary/obstacle collisions
     ├── clear_grid.wgsl          # NEW: Zero grid arrays
     ├── p2g.wgsl                  # NEW: Particle to grid transfer
     ├── mark_cells.wgsl          # NEW: Mark fluid/air/solid cells
     ├── density.wgsl             # NEW: Particle density computation
     ├── pressure.wgsl            # NEW: Pressure solver iteration
     ├── g2p.wgsl                  # NEW: Grid to particle transfer
     └── update_colors.wgsl       # NEW: Particle color updates

 ---
 Implementation Phases

 Phase 1: GPU Buffer Infrastructure

 File: src/flip/2d/webgpu/gpu_buffers.ts

 Create comprehensive GPU buffer management:

 class GPUSimulationBuffers {
   // Particle buffers (size = maxParticles)
   particlePos: GPUBuffer;        // vec2<f32> - positions
   particleVel: GPUBuffer;        // vec2<f32> - velocities
   particleColor: GPUBuffer;      // vec3<f32> - colors (padded to vec4)

   // Spatial hash buffers
   particleHash: GPUBuffer;       // u32 - hash key per particle
   particleIndex: GPUBuffer;      // u32 - original index
   cellCount: GPUBuffer;          // u32 - particles per hash cell
   cellOffset: GPUBuffer;         // u32 - prefix sum offsets
   sortedIndex: GPUBuffer;        // u32 - sorted particle indices

   // Grid buffers (size = fNumCells)
   gridU: GPUBuffer;              // f32 - x-velocity
   gridV: GPUBuffer;              // f32 - y-velocity
   gridDU: GPUBuffer;             // f32 - u weight accumulator
   gridDV: GPUBuffer;             // f32 - v weight accumulator
   gridPrevU: GPUBuffer;          // f32 - previous u for FLIP
   gridPrevV: GPUBuffer;          // f32 - previous v for FLIP
   gridP: GPUBuffer;              // f32 - pressure
   gridS: GPUBuffer;              // f32 - solid flag
   gridCellType: GPUBuffer;       // i32 - FLUID/AIR/SOLID
   gridDensity: GPUBuffer;        // f32 - particle density

   // Uniform buffers
   simParams: GPUBuffer;          // Simulation parameters
   obstacleParams: GPUBuffer;     // Obstacle position/velocity
 }

 Memory estimate: ~20MB for 100k particles, 200x100 grid

 ---
 Phase 2: Easy Compute Shaders (Per-Particle)

 2.1: integrate.wgsl

 @group(0) @binding(0) var<storage, read_write> positions: array<vec2<f32>>;
 @group(0) @binding(1) var<storage, read_write> velocities: array<vec2<f32>>;
 @group(0) @binding(2) var<uniform> params: SimParams;

 @compute @workgroup_size(256)
 fn main(@builtin(global_invocation_id) id: vec3<u32>) {
   let i = id.x;
   if (i >= params.numParticles) { return; }

   velocities[i].y += params.gravity * params.dt;
   positions[i] += velocities[i] * params.dt;
 }

 2.2: collisions.wgsl

 Handle boundary and obstacle collisions (per-particle, no atomics needed).

 2.3: g2p.wgsl

 Grid-to-particle velocity transfer with bilinear interpolation (scattered reads, no atomics).

 2.4: update_colors.wgsl

 Update particle colors based on density (per-particle).

 ---
 Phase 3: Spatial Hashing (Medium Complexity)

 Implement counting sort for spatial hash (following SPH pattern):

 3.1: hash.wgsl

 Compute hash key for each particle:
 @compute @workgroup_size(256)
 fn main(@builtin(global_invocation_id) id: vec3<u32>) {
   let i = id.x;
   let pos = positions[i];
   let xi = u32(floor(pos.x * params.pInvSpacing));
   let yi = u32(floor(pos.y * params.pInvSpacing));
   let key = xi * params.pNumY + yi;
   hashKeys[i] = key;
   indices[i] = i;
 }

 3.2: count.wgsl

 Count particles per cell using atomics:
 @group(0) @binding(0) var<storage, read_write> cellCount: array<atomic<u32>>;

 @compute @workgroup_size(256)
 fn main(@builtin(global_invocation_id) id: vec3<u32>) {
   let key = hashKeys[id.x];
   atomicAdd(&cellCount[key], 1u);
 }

 3.3: prefix_sum.wgsl

 Parallel prefix sum (Blelloch scan) - can use single workgroup for small grids or multi-pass for
 large.

 3.4: reorder.wgsl

 Scatter particles into sorted order using atomic decrements.

 ---
 Phase 4: P2G Transfer (Hard - Atomic Accumulation)

 4.1: clear_grid.wgsl

 Zero all grid arrays before accumulation.

 4.2: mark_cells.wgsl

 Mark cells as FLUID where particles exist (atomic write).

 4.3: p2g.wgsl

 Transfer velocities from particles to grid with atomic accumulation:
 @group(0) @binding(0) var<storage, read> positions: array<vec2<f32>>;
 @group(0) @binding(1) var<storage, read> velocities: array<vec2<f32>>;
 @group(0) @binding(2) var<storage, read_write> gridU: array<atomic<u32>>;
 @group(0) @binding(3) var<storage, read_write> gridDU: array<atomic<u32>>;
 // ... more bindings

 @compute @workgroup_size(256)
 fn main(@builtin(global_invocation_id) id: vec3<u32>) {
   let i = id.x;
   let pos = positions[i];
   let vel = velocities[i];

   // Compute bilinear weights for 4 neighboring cells
   // Use atomicAdd with fixed-point encoding for f32 accumulation
   // atomicAdd only works with u32/i32, so encode: u32(vel * SCALE)
 }

 Note: WebGPU atomics only support u32/i32. For float accumulation, use fixed-point encoding:
 - Encode: atomicAdd(&buf[idx], u32(value * 65536.0))
 - Decode: f32(buf[idx]) / 65536.0

 4.4: normalize_grid.wgsl

 Divide accumulated velocities by weights (per-cell, after P2G completes).

 ---
 Phase 5: Density Computation

 5.1: density.wgsl

 Similar to P2G - each particle contributes to 4 neighboring cells using atomic adds.

 ---
 Phase 6: Pressure Solver (Very Hard - Iterative)

 The pressure solver requires multiple iterations with grid-wide synchronization.

 Strategy: Jacobi iteration (parallelizable) instead of Gauss-Seidel (sequential)

 6.1: pressure.wgsl

 Single Jacobi iteration:
 @compute @workgroup_size(16, 16)
 fn main(@builtin(global_invocation_id) id: vec3<u32>) {
   let i = id.x;
   let j = id.y;

   if (cellType[i * n + j] != FLUID_CELL) { return; }

   // Read neighbors
   let s0 = gridS[left]; let s1 = gridS[right];
   let s2 = gridS[bottom]; let s3 = gridS[top];
   let s = s0 + s1 + s2 + s3;
   if (s == 0.0) { return; }

   // Compute divergence
   let div = gridU[right] - gridU[center] + gridV[top] - gridV[center];

   // Apply pressure correction (write to separate buffer for Jacobi)
   let p = -div / s * overRelaxation;
   newU[center] = gridU[center] - s0 * p;
   newU[right] = gridU[right] + s1 * p;
   // ... etc
 }

 Dispatch pattern: Run 50 iterations, ping-pong between buffers:
 for (let iter = 0; iter < numPressureIters; iter++) {
   computePass.setPipeline(pressurePipeline);
   computePass.setBindGroup(0, iter % 2 === 0 ? bindGroupA : bindGroupB);
   computePass.dispatchWorkgroups(gridX / 16, gridY / 16);
 }

 ---
 Phase 7: Push Particles Apart (Hard)

 Uses spatial hash from Phase 3. For each particle, check 3x3 neighboring cells.

 7.1: push_apart.wgsl

 @compute @workgroup_size(256)
 fn main(@builtin(global_invocation_id) id: vec3<u32>) {
   let i = id.x;
   let pos = positions[i];

   // Find cell and iterate 3x3 neighbors
   for (nx in -1..2) {
     for (ny in -1..2) {
       let cellKey = ...;
       let start = cellOffset[cellKey];
       let end = cellOffset[cellKey + 1];

       for (var j = start; j < end; j++) {
         let other = sortedIndex[j];
         if (other == i) { continue; }

         // Push apart logic
         let d = distance(pos, positions[other]);
         if (d < minDist && d > 0) {
           // Apply separation (both particles)
         }
       }
     }
   }
 }

 Note: Multiple iterations require full re-dispatch (expensive).

 ---
 Phase 8: Pipeline Orchestration

 File: src/flip/2d/webgpu/gpu_simulation.ts

 class GPUFluidSimulation {
   async simulate(dt: number): Promise<void> {
     const encoder = device.createCommandEncoder();

     // 1. Integrate particles
     this.dispatch(encoder, this.integratePipeline);

     // 2. Spatial hash (if separating particles)
     if (separateParticles) {
       this.dispatch(encoder, this.hashPipeline);
       this.dispatch(encoder, this.countPipeline);
       this.dispatch(encoder, this.prefixSumPipeline);
       this.dispatch(encoder, this.reorderPipeline);

       // 3. Push apart (multiple iterations)
       for (let i = 0; i < numParticleIters; i++) {
         this.dispatch(encoder, this.pushApartPipeline);
       }
     }

     // 4. Handle collisions
     this.dispatch(encoder, this.collisionsPipeline);

     // 5. P2G transfer
     this.dispatch(encoder, this.clearGridPipeline);
     this.dispatch(encoder, this.markCellsPipeline);
     this.dispatch(encoder, this.p2gPipeline);
     this.dispatch(encoder, this.normalizeGridPipeline);

     // 6. Update density
     this.dispatch(encoder, this.densityPipeline);

     // 7. Pressure solver (50 iterations)
     for (let i = 0; i < numPressureIters; i++) {
       this.dispatch(encoder, this.pressurePipeline, i);
     }

     // 8. G2P transfer
     this.dispatch(encoder, this.g2pPipeline);

     // 9. Update colors
     this.dispatch(encoder, this.colorsPipeline);

     device.queue.submit([encoder.finish()]);
   }
 }

 ---
 Implementation Order

 Incremental approach - verify at each step:

 1. Phase 1: Buffer infrastructure + integrate shader
   - Verify: Particles fall with gravity (other steps still on CPU)
 2. Phase 2: Collisions + G2P + colors
   - Verify: Basic simulation works with hybrid CPU/GPU
 3. Phase 3: Spatial hash (hash, count, prefix sum, reorder)
   - Verify: Hash produces correct sorted order
 4. Phase 4: Push apart using spatial hash
   - Verify: Particles separate correctly
 5. Phase 5: P2G transfer with atomics
   - Verify: Velocities transfer to grid correctly
 6. Phase 6: Density computation
   - Verify: Density values match CPU
 7. Phase 7: Pressure solver
   - Verify: Incompressibility enforced
 8. Phase 8: Full integration + remove CPU fallback
   - Verify: Full simulation runs on GPU

 ---
 Key Technical Challenges

 1. Atomic Float Accumulation

 WebGPU only has atomicAdd for u32/i32. Solutions:
 - Fixed-point encoding: Multiply by scale factor, accumulate as u32, divide after
 - Precision: Use 65536 scale for ~0.00001 precision

 2. Prefix Sum on GPU

 Options:
 - Single workgroup: If cellCount < 1024, use shared memory scan
 - Multi-pass: For larger grids, use Blelloch two-pass algorithm

 3. Pressure Solver Convergence

 - Jacobi converges slower than Gauss-Seidel
 - May need more iterations (100 instead of 50)
 - Consider Red-Black Gauss-Seidel for better convergence

 4. Synchronization

 - Each compute pass is a sync point
 - Minimize number of passes by combining operations where possible

 ---
 Verification Plan

 1. Unit test each shader: Compare GPU output to CPU reference
 2. Visual verification: Should look identical to CPU version
 3. Performance benchmark: Measure frame time improvement
 4. Stress test: Increase to 100k particles

 ---
 Expected Performance

 ┌────────────┬─────────────────────┬─────────────────────┬──────────────────────┐
 │   Metric   │ CPU (29k particles) │ GPU (29k particles) │ GPU (100k particles) │
 ├────────────┼─────────────────────┼─────────────────────┼──────────────────────┤
 │ Frame time │ ~16ms               │ ~2-3ms              │ ~5-8ms               │
 ├────────────┼─────────────────────┼─────────────────────┼──────────────────────┤
 │ FPS        │ 60                  │ 60 (headroom)       │ 60                   │
 └────────────┴─────────────────────┴─────────────────────┴──────────────────────┘

 ---