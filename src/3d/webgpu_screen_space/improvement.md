---

Analysis: WebGPU Port vs Unity Original

1. Porting Accuracy - Calculations

SPH Kernel Functions ✅ Correct

- Both use the same kernel types:
  - Density: SpikyPow2 - (r - dst)²
  - Near Density: SpikyPow3 - (r - dst)³
  - Pressure derivative: DerivativeSpikyPow2 and DerivativeSpikyPow3
  - Viscosity: Poly6 kernel

Normalization Constants ✅ Correct

- WebGPU (fluid_simulation.ts:218-233):
  spikyPow2Scale = 15 / (2 _ Math.PI _ Math.pow(radius, 5));
  spikyPow3Scale = 15 / (Math.PI \* Math.pow(radius, 6));
- These are the correct 3D normalization constants.

Pressure Calculation ✅ Correct

- Both use symmetric pressure: sharedPressure = (pressure + neighborPressure) / 2
- Division by neighbor density matches Unity

2. Critical Porting Issues Found

Issue #1: Spatial Hash Function is Different ✅ Fixed

Unity (SpatialHash3D.hlsl:53-62) - Block-based hybrid hash:
uint HashCell3D(int3 cell) {
const uint blockSize = 50;
uint3 ucell = (uint3)(cell + blockSize / 2);
uint3 localCell = ucell % blockSize;
uint3 blockID = ucell / blockSize;
uint blockHash = blockID.x _ 15823 + blockID.y _ 9737333 + blockID.z _ 440817757;
return localCell.x + blockSize _ (localCell.y + blockSize \* localCell.z) + blockHash;
}

WebGPU (hash.wgsl:12-14) - Simple polynomial hash:
fn hashCell3D(cellX: i32, cellY: i32, cellZ: i32) -> u32 {
return u32(cellX) _ 73856093u + u32(cellY) _ 19349663u + u32(cellZ) \* 83492791u;
}

Impact: The Unity hash is designed to minimize collisions by having local cell coordinates that map directly to indices within blocks. The
WebGPU hash may have more collisions, causing more iterations in neighbor search loops.

Issue #2: NO Particle Reordering ✅ Fixed

Unity has Reorder + ReorderCopyBack kernels (FluidSim.compute:165-185):
void Reorder(uint3 id : SV_DispatchThreadID) {
uint sortedIndex = SortedIndices[id.x];
SortTarget_Positions[id.x] = Positions[sortedIndex];
SortTarget_PredictedPositions[id.x] = PredictedPositions[sortedIndex];
SortTarget_Velocities[id.x] = Velocities[sortedIndex];
}

WebGPU does NOT reorder particles - it only uses indirect access via indices[j].

Impact: This is a massive performance difference. Without reordering:

- Memory access during density/pressure calculations is random (cache misses)
- Every neighbor lookup requires: predicted[indices[j]] - two memory reads
- Unity's reordering ensures particles in the same cell are contiguous in memory

Issue #3: Single-Threaded Sorting ✅ Fixed

WebGPU (scatter.wgsl:12-33):
@compute @workgroup_size(1) // ← SINGLE THREAD!
fn prefixAndScatter(...) {
for (var k = 0u; k < count; k = k + 1u) { // O(n) sequential loop
...
}
for (var i = 0u; i < count; i = i + 1u) { // Another O(n) sequential loop
...
}
}

Unity uses parallel GPU Count Sort with atomic operations across 256 threads.

Impact: With 10,000 particles, the WebGPU version does 20,000 sequential operations on a single GPU thread per frame per iteration. This
alone can halve your FPS.

Issue #4: Single-Threaded Spatial Offsets Building ✅ Fixed

Same issue - the spatial offsets kernel also runs on a single thread.

---

Performance Improvement Plan

Phase 1: Fix Critical Bottlenecks (Biggest Impact)
┌──────────┬─────────────────────────────────┬──────────────────────────────────┐
│ Priority │ Optimization │ Status │
├──────────┼─────────────────────────────────┼──────────────────────────────────┤
│ P0 │ Parallel prefix sum for sorting │ ✅ Completed │
├──────────┼─────────────────────────────────┼──────────────────────────────────┤
│ P0 │ Add particle reordering │ ✅ Completed │
├──────────┼─────────────────────────────────┼──────────────────────────────────┤
│ P1 │ Match Unity's hash function │ ✅ Completed │
└──────────┴─────────────────────────────────┴──────────────────────────────────┘
Phase 2: Rendering Optimizations
┌──────────┬─────────────────────────────────────────────┬──────────────────────────┐
│ Priority │ Optimization │ Status │
├──────────┼─────────────────────────────────────────────┼──────────────────────────┤
│ P1 │ GPU frustum culling │ ✅ Completed │
├──────────┼─────────────────────────────────────────────┼──────────────────────────┤
│ P2 │ Depth pre-pass with indirect draw │ 🚫 Skipped (See Note 7) │
├──────────┼─────────────────────────────────────────────┼──────────────────────────┤
│ P2 │ Use compute shader for billboard generation │ 🚫 Skipped (See Note 8) │
└──────────┴─────────────────────────────────────────────┴──────────────────────────┘

---

Implementation Notes & Technical Challenges

1.  **3-Level Hierarchical Prefix Sum**:
    - **Challenge**: With 400,000+ particles, a single level of group sums (400k / 512 ≈ 782 blocks) exceeded the workgroup size for the second pass if not handled carefully, or required a larger buffer than anticipated for intermediate sums.
    - **Solution**: Implemented a robust 3-level scan (L0 -> L1 -> L2) to handle arbitrary particle counts efficiently.

2.  **WebGPU Alignment Requirements**:
    - **Challenge**: `createBuffer` with `minBindingSize` validation errors.
    - **Detail**: WebGPU requires uniform buffers to be at least 32 bytes in size for certain binding types, even if the data is smaller (e.g., a single `vec4` or `uint`).
    - **Solution**: Padded all `scanParams` uniform buffers to 32 bytes.

3.  **Atomic Scatter Logic**:
    - **Challenge**: Correctly implementing the parallel scatter.
    - **Detail**: `atomicAdd` returns the _original_ value before the addition. This is the correct "ticket" or "destination index" for the particle.
    - **Code**: `let dest = atomicAdd(&sortOffsets[key], 1u);`

4.  **Shader Variable Scope**:
    - **Challenge**: Variable name collision in `particle3d.wgsl`.
    - **Detail**: `index` was used for the visible particle index and then reused for the color gradient index in the same scope.
    - **Solution**: Renamed the second variable to `colorIndex`.

5.  **Bind Group Layout Compatibility**:
    - **Challenge**: "Binding index not present in layout".
    - **Detail**: The WGSL compiler optimizes away unused bindings (like `indices` in the density shader after switching to direct access). The TypeScript `createBindGroup` call must match the _compiled_ pipeline layout, not just the source code intent.
    - **Solution**: Created specific bind groups (e.g., `copyBackBindGroup`, `initSpatialOffsetsBindGroup`) that exactly match the active bindings of their respective pipelines.

6.  **GPU Frustum Culling**:
    - Implemented a Compute Shader `cull.wgsl` that tests particle bounds against the camera frustum.
    - Uses `atomicAdd` on an `indirectDraw` buffer to count visible instances.
    - Populates a `visibleIndices` buffer.
    - Vertex shader now reads from `visibleIndices` instead of assuming `gl_InstanceIndex` maps 1:1 to particle index.

7.  **Skipping Depth Pre-pass**:
    - **Reason**: Depth pre-passes are effective for reducing overdraw when Fragment Shaders are expensive (complex lighting, PBR, etc.).
    - **Current State**: Our particle fragment shader is extremely lightweight (simple color output).
    - **Conclusion**: The overhead of submitting geometry twice (vertex processing cost) would likely outweigh the savings from reduced fragment processing. We have already achieved the primary benefit of "Indirect Draw" via the Frustum Culling implementation, which skips vertex processing entirely for off-screen particles.

8.  **Skipping Compute Shader Billboard Generation**:
    - **Reason**: The current implementation uses procedural instancing (calculating vertex positions on-the-fly in the vertex shader from a single center point).
    - **Analysis**: Pre-generating quad vertices in a compute shader would drastically increase memory bandwidth usage (writing 4 vertices + UVs to global memory per particle) compared to the negligible ALU cost of computing them in the vertex shader.
    - **Conclusion**: Procedural instantiation is the optimal approach for simple particle billboards.

Differences Found

1. timeScale -- 2x faster in WebGPU

- Unity: normalTimeScale: 1
- WebGPU: timeScale: 2 (config.ts:5)
- This makes the entire simulation run at double speed, affecting foam spawn rates, lifetimes, and overall
  fluid behavior.

2. viscosityStrength -- added where Unity has none

- Unity: viscosityStrength: 0
- WebGPU: viscosityStrength: 0.001 (config.ts:14)
- Small but nonzero; Unity has it completely disabled in this scene.

3. spawnRateFadeInTime / spawnRateFadeStartTime -- missing from WebGPU

- Unity: spawnRateFadeInTime: 0.75, spawnRateFadeStartTime: 0.1
- WebGPU: Not implemented
- Unity gradually ramps up foam spawning over 0.75 seconds after a 0.1s delay. The WebGPU port spawns at
  full rate immediately, causing a potential burst of foam at startup.

4. bubbleChangeScaleSpeed -- missing from WebGPU

- Unity: bubbleChangeScaleSpeed: 7
- WebGPU: Not implemented
- Unity dynamically interpolates bubble scale over time (speed=7). The WebGPU port sets scale once at spawn
  as (bubbleScale + 1.0) / 2.0 = 0.65 and never changes it (foam_spawn.wgsl:155).

5. Foam rendering scale and testParams -- not replicated

- Unity FoamTest component: scale: 2, testParams: {x: 1, y: 3, z: 0.6}
- WebGPU: Uses particleRadius _ scale _ dissolveScale with no equivalent of the Unity foam renderer's
  scale=2 or its testParams
- This likely affects foam billboard size and visual prominence.

6. Absorption / extinction model -- significant visual difference

- Unity: Per-channel extinction coefficients {2.12, 0.43, 0.3} with multiplier 2.24 -- produces
  color-dependent absorption (blue absorbs least, red absorbs most), giving the fluid its colored tint.
- WebGPU: Simple scalar exp(-thickness \* 2.0) in the composite shader (composite_final.wgsl:107) -- uniform
  gray absorption, no per-channel color variation.
- This is one of the biggest visual differences between the two.

7. Refraction strength -- dramatically different

- Unity: refractionMultiplier: 9.15
- WebGPU: refractionStrength: 0.12 (hardcoded in composite_final.wgsl:103)
- Unity's refraction is ~76x stronger. The WebGPU fluid will look much flatter and less distorted at the
  edges.

8. Thickness particle scale -- not separately configurable

- Unity: thicknessParticleScale: 0.07 (separate from depth size 0.1)
- WebGPU: Uses the same particle radius for both depth and thickness passes
- Unity renders thickness with smaller particles than depth, which gives a tighter, more refined thickness
  accumulation.
