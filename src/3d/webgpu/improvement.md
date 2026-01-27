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
  spikyPow2Scale = 15 / (2 * Math.PI * Math.pow(radius, 5));
  spikyPow3Scale = 15 / (Math.PI * Math.pow(radius, 6));
  - These are the correct 3D normalization constants.

  Pressure Calculation ✅ Correct
  - Both use symmetric pressure: sharedPressure = (pressure + neighborPressure) / 2
  - Division by neighbor density matches Unity

  2. Critical Porting Issues Found

  Issue #1: Spatial Hash Function is Different ⚠️

  Unity (SpatialHash3D.hlsl:53-62) - Block-based hybrid hash:
  uint HashCell3D(int3 cell) {
      const uint blockSize = 50;
      uint3 ucell = (uint3)(cell + blockSize / 2);
      uint3 localCell = ucell % blockSize;
      uint3 blockID = ucell / blockSize;
      uint blockHash = blockID.x * 15823 + blockID.y * 9737333 + blockID.z * 440817757;
      return localCell.x + blockSize * (localCell.y + blockSize * localCell.z) + blockHash;
  }

  WebGPU (hash.wgsl:12-14) - Simple polynomial hash:
  fn hashCell3D(cellX: i32, cellY: i32, cellZ: i32) -> u32 {
      return u32(cellX) * 73856093u + u32(cellY) * 19349663u + u32(cellZ) * 83492791u;
  }

  Impact: The Unity hash is designed to minimize collisions by having local cell coordinates that map directly to indices within blocks. The
  WebGPU hash may have more collisions, causing more iterations in neighbor search loops.

  Issue #2: NO Particle Reordering 🔴 MAJOR

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

  Issue #3: Single-Threaded Sorting 🔴 CRITICAL BOTTLENECK

  WebGPU (scatter.wgsl:12-33):
  @compute @workgroup_size(1)  // ← SINGLE THREAD!
  fn prefixAndScatter(...) {
    for (var k = 0u; k < count; k = k + 1u) {  // O(n) sequential loop
      ...
    }
    for (var i = 0u; i < count; i = i + 1u) {  // Another O(n) sequential loop
      ...
    }
  }

  Unity uses parallel GPU Count Sort with atomic operations across 256 threads.

  Impact: With 10,000 particles, the WebGPU version does 20,000 sequential operations on a single GPU thread per frame per iteration. This
  alone can halve your FPS.

  Issue #4: Single-Threaded Spatial Offsets Building

  Same issue - the spatial offsets kernel also runs on a single thread.

  ---
  Performance Improvement Plan

  Phase 1: Fix Critical Bottlenecks (Biggest Impact)
  ┌──────────┬─────────────────────────────────┬──────────────────────────────────┐
  │ Priority │          Optimization           │         Expected Impact          │
  ├──────────┼─────────────────────────────────┼──────────────────────────────────┤
  │ P0       │ Parallel prefix sum for sorting │ 2-5x speedup                     │
  ├──────────┼─────────────────────────────────┼──────────────────────────────────┤
  │ P0       │ Add particle reordering         │ 2-3x speedup in density/pressure │
  ├──────────┼─────────────────────────────────┼──────────────────────────────────┤
  │ P1       │ Match Unity's hash function     │ 10-30% fewer iterations          │
  └──────────┴─────────────────────────────────┴──────────────────────────────────┘
  Phase 2: Rendering Optimizations
  ┌──────────┬─────────────────────────────────────────────┬──────────────────────────┐
  │ Priority │                Optimization                 │     Expected Impact      │
  ├──────────┼─────────────────────────────────────────────┼──────────────────────────┤
  │ P1       │ GPU frustum culling                         │ Skip offscreen particles │
  ├──────────┼─────────────────────────────────────────────┼──────────────────────────┤
  │ P2       │ Depth pre-pass with indirect draw           │ Only draw visible        │
  ├──────────┼─────────────────────────────────────────────┼──────────────────────────┤
  │ P2       │ Use compute shader for billboard generation │ Reduce vertex count      │
  └──────────┴─────────────────────────────────────────────┴──────────────────────────┘
  Phase 3: Advanced Optimizations
  ┌──────────┬────────────────────────────────────────────┬────────────────────────────┐
  │ Priority │                Optimization                │      Expected Impact       │
  ├──────────┼────────────────────────────────────────────┼────────────────────────────┤
  │ P2       │ Workgroup-local memory for neighbor search │ Reduce global memory reads │
  ├──────────┼────────────────────────────────────────────┼────────────────────────────┤
  │ P3       │ Hierarchical spatial hashing               │ Better for large domains   │
  ├──────────┼────────────────────────────────────────────┼────────────────────────────┤
  │ P3       │ Level-of-detail rendering                  │ Combine distant particles  │
  └──────────┴────────────────────────────────────────────┴────────────────────────────┘
  ---
  Recommended Action Plan

  Immediate wins (should fix first):

  1. Replace single-threaded scatter with parallel GPU sort
    - Implement parallel prefix sum (Blelloch scan)
    - Use atomic operations for counting like Unity does
  2. Add particle reordering kernels
    - After sorting keys, reorder positions/velocities/predicted
    - Copy back to main buffers (like Unity's Reorder + ReorderCopyBack)
  3. Update hash function to match Unity
    - Use block-based hybrid hash to reduce collisions

  After profiling:

  4. If rendering is the bottleneck:
    - Add GPU culling compute pass
    - Use indirect draw with only visible particles
  5. If compute is still slow:
    - Add workgroup shared memory optimization for neighbor search
    - Pre-sort particles by depth for better memory coherence

  ---


  Ready to code?

 Here is Claude's plan:
╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
 P0 Performance Optimizations for WebGPU Fluid Simulation

 Overview

 Implement three critical performance optimizations to match Unity's implementation:
 1. Parallel prefix sum for sorting (replace single-threaded scatter)
 2. Particle data reordering for cache-friendly memory access
 3. Updated hash function to match Unity's block-based hash

 Current Bottlenecks
 ┌────────────────────────────┬─────────────────────────────────────┬─────────────────────────────────────┐
 │           Issue            │               Current               │               Impact                │
 ├────────────────────────────┼─────────────────────────────────────┼─────────────────────────────────────┤
 │ Sequential scatter         │ @workgroup_size(1), O(2n) loops     │ 1-5ms per frame at 100k particles   │
 ├────────────────────────────┼─────────────────────────────────────┼─────────────────────────────────────┤
 │ Sequential spatial offsets │ @workgroup_size(1), O(2n) loops     │ 0.5-1ms per frame                   │
 ├────────────────────────────┼─────────────────────────────────────┼─────────────────────────────────────┤
 │ No particle reordering     │ Random memory access via indices[j] │ Cache misses in density/pressure    │
 ├────────────────────────────┼─────────────────────────────────────┼─────────────────────────────────────┤
 │ Simple hash function       │ More hash collisions                │ Extra iterations in neighbor search │
 └────────────────────────────┴─────────────────────────────────────┴─────────────────────────────────────┘
 Implementation Plan

 Step 1: Create Parallel Prefix Sum Shader

 New file: src/3d/webgpu/shaders/prefix_sum.wgsl

 Implement Blelloch parallel scan algorithm:
 - Workgroup size: 256 threads
 - Each thread processes 2 elements (512 per workgroup)
 - Use workgroup shared memory for up-sweep and down-sweep
 - Output group sums for hierarchical scan

 Kernels:
 - blockScan: Per-workgroup exclusive prefix sum
 - blockCombine: Add group sums to subsequent blocks

 Step 2: Create Parallel Scatter Shader

 Modify: src/3d/webgpu/shaders/scatter.wgsl

 Replace sequential scatter with parallel version using atomics:
 - Each thread reads its key, atomically increments the offset
 - Writes to sorted destination using atomic result

 @compute @workgroup_size(256)
 fn parallelScatter(...) {
   let key = keys[id.x];
   var dest: u32;
   atomicAdd(&offsets[key], 1u, &dest);  // Get destination atomically
   indices[dest] = id.x;
   sortedKeys[dest] = key;
 }

 Step 3: Create Parallel Spatial Offsets Shader

 Modify: src/3d/webgpu/shaders/spatial_offsets.wgsl

 Replace sequential with parallel version:
 - initOffsets: Set all offsets to particle count (sentinel)
 - calcOffsets: Each thread checks if it's a key boundary

 @compute @workgroup_size(256)
 fn calcOffsets(...) {
   let key = sortedKeys[id.x];
   let prevKey = select(count, sortedKeys[id.x - 1], id.x > 0);
   if (key != prevKey) {
     spatialOffsets[key] = id.x;
   }
 }

 Step 4: Create Particle Reorder Shaders

 New file: src/3d/webgpu/shaders/reorder.wgsl

 Two kernels to reorder particle data for cache locality:
 - reorder: Copy from original to sorted buffers using indices
 - copyBack: Copy sorted data back to main buffers

 @compute @workgroup_size(256)
 fn reorder(...) {
   let sortedIdx = indices[id.x];  // Original particle at sorted position
   positionsSorted[id.x] = positions[sortedIdx];
   predictedSorted[id.x] = predicted[sortedIdx];
   velocitiesSorted[id.x] = velocities[sortedIdx];
 }

 @compute @workgroup_size(256)
 fn copyBack(...) {
   positions[id.x] = positionsSorted[id.x];
   predicted[id.x] = predictedSorted[id.x];
   velocities[id.x] = velocitiesSorted[id.x];
 }

 Step 5: Update Hash Function

 Modify: src/3d/webgpu/shaders/hash.wgsl, density.wgsl, pressure.wgsl, viscosity.wgsl

 Replace simple polynomial hash with Unity's block-based hash:

 fn hashCell3D(cellX: i32, cellY: i32, cellZ: i32) -> u32 {
     let blockSize = 50u;
     let ucell = vec3<u32>(
         u32(cellX + i32(blockSize / 2u)),
         u32(cellY + i32(blockSize / 2u)),
         u32(cellZ + i32(blockSize / 2u))
     );
     let localCell = ucell % blockSize;
     let blockID = ucell / blockSize;
     let blockHash = blockID.x * 15823u + blockID.y * 9737333u + blockID.z * 440817757u;
     return localCell.x + blockSize * (localCell.y + blockSize * localCell.z) + blockHash;
 }

 Step 6: Update Compute Pipelines

 Modify: src/3d/webgpu/compute_pipelines.ts

 - Add new pipelines: prefixScan, prefixCombine, reorder, copyBack
 - Add new uniform buffer for prefix sum: groupSums buffer
 - Create bind groups for new shaders

 Step 7: Update Simulation Buffers

 Modify: src/3d/webgpu/simulation_buffers.ts

 - Add groupSums buffer for hierarchical prefix sum
 - Ensure positionsSorted, predictedSorted, velocitiesSorted are properly used

 Step 8: Update Fluid Simulation Dispatch

 Modify: src/3d/webgpu/fluid_simulation.ts

 Replace dispatchSpatialHash() with new parallel pipeline:

 dispatchSpatialHash(encoder) {
   // 1. Hash particles (unchanged)
   dispatch(hash, workgroups);

   // 2. Clear counts
   dispatch(clearOffsets, workgroups);

   // 3. Count particles per key (unchanged - already uses atomics)
   dispatch(countOffsets, workgroups);

   // 4. Parallel prefix sum on sortOffsets
   dispatchPrefixSum(encoder, sortOffsets, groupSums);

   // 5. Parallel scatter
   dispatch(parallelScatter, workgroups);

   // 6. Parallel spatial offsets
   dispatch(initSpatialOffsets, workgroups);
   dispatch(calcSpatialOffsets, workgroups);

   // 7. Reorder particle data for cache locality
   dispatch(reorder, workgroups);
   dispatch(copyBack, workgroups);
 }

 Step 9: Update Density/Pressure/Viscosity Shaders

 After reordering, particles are stored in spatially-sorted order in the main buffers. This means:
 - positions[j], predicted[j], velocities[j] now contain spatially-sorted data
 - No need for indirect access via indices[j]
 - The indices buffer is only used during the reorder step, not during neighbor lookups

 Modify: density.wgsl, pressure.wgsl, viscosity.wgsl

 1. Update hash function to match Unity's block-based hash
 2. Remove indices from bind groups (no longer needed for neighbor lookup)
 3. Change neighbor access from indirect to direct:

 // Before (indirect access):
 let neighborIndex = indices[j];
 let neighborPos = predicted[neighborIndex];
 let neighborDensity = densities[neighborIndex];

 // After (direct access - particles are sorted):
 let neighborPos = predicted[j];
 let neighborDensity = densities[j];

 Important: After reordering, particle indices no longer correspond to "identity" - particle at index i changes each frame based on spatial
 position. This is correct and matches Unity's behavior.

 Files to Modify
 ┌──────────────────────────────┬────────────────────────────────────────────────┐
 │             File             │                    Changes                     │
 ├──────────────────────────────┼────────────────────────────────────────────────┤
 │ shaders/prefix_sum.wgsl      │ NEW - Blelloch scan kernels                    │
 ├──────────────────────────────┼────────────────────────────────────────────────┤
 │ shaders/scatter.wgsl         │ Replace with parallel scatter                  │
 ├──────────────────────────────┼────────────────────────────────────────────────┤
 │ shaders/spatial_offsets.wgsl │ Replace with parallel init + calc              │
 ├──────────────────────────────┼────────────────────────────────────────────────┤
 │ shaders/reorder.wgsl         │ NEW - Reorder + copyBack kernels               │
 ├──────────────────────────────┼────────────────────────────────────────────────┤
 │ shaders/hash.wgsl            │ Update hash function                           │
 ├──────────────────────────────┼────────────────────────────────────────────────┤
 │ shaders/density.wgsl         │ Update hash function, simplify neighbor access │
 ├──────────────────────────────┼────────────────────────────────────────────────┤
 │ shaders/pressure.wgsl        │ Update hash function, simplify neighbor access │
 ├──────────────────────────────┼────────────────────────────────────────────────┤
 │ shaders/viscosity.wgsl       │ Update hash function, simplify neighbor access │
 ├──────────────────────────────┼────────────────────────────────────────────────┤
 │ compute_pipelines.ts         │ Add new pipelines and bind groups              │
 ├──────────────────────────────┼────────────────────────────────────────────────┤
 │ simulation_buffers.ts        │ Add groupSums buffer                           │
 ├──────────────────────────────┼────────────────────────────────────────────────┤
 │ fluid_simulation.ts          │ Update dispatch order                          │
 └──────────────────────────────┴────────────────────────────────────────────────┘
 Expected Performance Improvement
 ┌──────────────────────────┬───────────────────────────────────────┐
 │       Optimization       │           Expected Speedup            │
 ├──────────────────────────┼───────────────────────────────────────┤
 │ Parallel prefix sum      │ 10-50x for sorting step               │
 ├──────────────────────────┼───────────────────────────────────────┤
 │ Parallel spatial offsets │ 5-10x for offset building             │
 ├──────────────────────────┼───────────────────────────────────────┤
 │ Particle reordering      │ 1.5-2x for density/pressure/viscosity │
 ├──────────────────────────┼───────────────────────────────────────┤
 │ Better hash function     │ 10-30% fewer neighbor iterations      │
 └──────────────────────────┴───────────────────────────────────────┘
 Overall: 2-5x improvement in simulation step performance

 Verification

 1. Visual check: Simulation should behave identically (same physics)
 2. Performance check: Use browser DevTools Performance tab to measure frame time
 3. Correctness check:
   - Particles should remain in bounds
   - Fluid should settle at rest state
   - No visual artifacts or explosions

 Testing Steps

 1. Run the simulation with current code, note FPS
 2. Apply changes incrementally:
   - First: parallel prefix sum + scatter
   - Second: parallel spatial offsets
   - Third: particle reordering
   - Fourth: updated hash function
 3. After each change, verify simulation still works correctly
 4. Compare final FPS to baseline

 