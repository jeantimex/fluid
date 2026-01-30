/**
 * ============================================================================
 * PARTICLE REORDERING KERNELS
 * ============================================================================
 *
 * Pipeline Stage: Stage 4 (After spatial hash sorting)
 * Entry Points: reorder, copyBack
 * Workgroup Size: 256 threads
 *
 * Purpose:
 * --------
 * Physically rearranges particle data in memory to match the sorted order.
 * This is crucial for cache-efficient neighbor search.
 *
 * Why Physical Reordering Matters:
 * --------------------------------
 * Without reordering (using indirect lookup):
 *
 *   Memory Layout:        [P0] [P1] [P2] [P3] [P4] [P5] [P6] [P7]
 *   Sorted Indices:       [3, 7, 1, 5, 0, 2, 4, 6]
 *
 *   To access neighbors of particle in sorted position 0:
 *     Read P3 (memory addr 3) - CACHE MISS
 *     Read P7 (memory addr 7) - CACHE MISS (likely evicted P3's cache line)
 *     Read P1 (memory addr 1) - CACHE MISS
 *     ... random access pattern = terrible cache performance
 *
 * With physical reordering:
 *
 *   Original:             [P0] [P1] [P2] [P3] [P4] [P5] [P6] [P7]
 *   After Reorder:        [P3] [P7] [P1] [P5] [P0] [P2] [P4] [P6]
 *   (particles in same cell are now contiguous)
 *
 *   To access neighbors in cell 0:
 *     Read position 0 - CACHE MISS (loads cache line)
 *     Read position 1 - CACHE HIT (same cache line)
 *     Read position 2 - CACHE HIT (same or adjacent cache line)
 *     ... sequential access pattern = excellent cache performance
 *
 * Performance Impact:
 * -------------------
 *   - Random memory access: ~100-300 cycles per load (cache miss)
 *   - Sequential access: ~4-10 cycles per load (cache hit)
 *   - For neighbor search with ~50 neighbors, that's 5-30x speedup!
 *
 * Two-Kernel Design:
 * ------------------
 *   1. reorder: Copy from original → sorted buffers (gather)
 *   2. copyBack: Copy from sorted → original buffers (simple copy)
 *
 * Why not in-place?
 *   - Parallel in-place permutation is complex and requires synchronization
 *   - Double-buffering (sorted buffers) is simpler and equally fast
 *   - GPUs have plenty of memory bandwidth for the extra copy
 *
 * Data Flow:
 * ----------
 *   Before reorder:
 *     positions[]       = [P0, P1, P2, P3, P4, P5, P6, P7]  (original order)
 *     indices[]         = [3, 7, 1, 5, 0, 2, 4, 6]          (sorted order mapping)
 *
 *   After reorder:
 *     positionsSorted[] = [P3, P7, P1, P5, P0, P2, P4, P6]  (spatially sorted)
 *
 *   After copyBack:
 *     positions[]       = [P3, P7, P1, P5, P0, P2, P4, P6]  (for next frame)
 *
 * ============================================================================
 */

/**
 * Reorder Parameters Uniform Buffer
 *
 * Memory Layout (16-byte aligned):
 * Offset  Size  Field
 * ------  ----  -----
 *   0      4    particleCount   - Total number of particles to reorder
 *   4     12    pad0            - Padding for 16-byte alignment
 * ------
 * Total: 16 bytes
 */
struct SortParams {
  particleCount: u32,
  pad0: vec3<u32>,
};

// ============================================================================
// BUFFER BINDINGS
// ============================================================================
// Group 0: Reorder/CopyBack compute pass
//
//   Binding 0: indices[]          - Sorted index mapping (from scatter.wgsl)
//              indices[i] = original particle index that belongs at sorted position i
//
//   Binding 1: positions[]        - Original particle positions (source for reorder)
//   Binding 2: velocities[]       - Original particle velocities
//   Binding 3: predicted[]        - Original predicted positions
//
//   Binding 4: positionsSorted[]  - Destination for reordered positions
//   Binding 5: velocitiesSorted[] - Destination for reordered velocities
//   Binding 6: predictedSorted[]  - Destination for reordered predicted positions
//
//   Binding 7: params             - Uniform with particle count
//
// Memory Layout per particle:
//   vec4<f32> = 16 bytes (xyz + padding/w component)
//   Total per particle: 48 bytes (3 vec4s)
// ============================================================================

@group(0) @binding(0) var<storage, read> indices: array<u32>;
@group(0) @binding(1) var<storage, read_write> positions: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> velocities: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> predicted: array<vec4<f32>>;
@group(0) @binding(4) var<storage, read_write> positionsSorted: array<vec4<f32>>;
@group(0) @binding(5) var<storage, read_write> velocitiesSorted: array<vec4<f32>>;
@group(0) @binding(6) var<storage, read_write> predictedSorted: array<vec4<f32>>;
@group(0) @binding(7) var<uniform> params: SortParams;

/**
 * Reorder Kernel (Gather Operation)
 *
 * Rearranges particle data from original order to sorted order.
 *
 * This is a "gather" operation:
 *   - Sequential writes to sorted buffer (good for coalescing)
 *   - Random reads from original buffer (unavoidable)
 *
 * Why gather instead of scatter?
 *   - GPU memory writes are more expensive to coalesce than reads
 *   - Sequential writes + random reads > random writes + sequential reads
 *
 * Dispatch: ceil(particleCount / 256) workgroups
 */
@compute @workgroup_size(256)
fn reorder(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;

  // Bounds check
  if (i >= params.particleCount) { return; }

  // indices[i] tells us which original particle belongs at sorted position i
  // This is the mapping computed by the counting sort scatter phase
  let sortedIndex = indices[i];

  // Gather: Read from scattered location, write to contiguous location
  //
  // sortedIndex may be anywhere in [0, particleCount)
  // i is sequential across threads in a workgroup
  //
  // After this, particles in the same grid cell are contiguous in the
  // sorted buffers, enabling cache-efficient neighbor search
  positionsSorted[i] = positions[sortedIndex];
  velocitiesSorted[i] = velocities[sortedIndex];
  predictedSorted[i] = predicted[sortedIndex];
}

/**
 * CopyBack Kernel
 *
 * Copies sorted data back to the primary buffers for use in the next frame.
 *
 * Why copy back?
 *   - The simulation uses positions[], velocities[], predicted[] as primary buffers
 *   - Density, pressure, viscosity shaders read from these buffers
 *   - After reorder, the sorted data is in the "Sorted" buffers
 *   - This copy makes the sorted order the canonical order
 *
 * Alternative design (not used):
 *   - Swap buffer pointers instead of copying
 *   - More complex buffer management, minimal performance gain
 *   - Current approach is simpler and memory bandwidth is not the bottleneck
 *
 * Dispatch: ceil(particleCount / 256) workgroups
 */
@compute @workgroup_size(256)
fn copyBack(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;

  // Bounds check
  if (i >= params.particleCount) { return; }

  // Simple linear copy (excellent memory coalescing)
  // Both reads and writes are sequential across threads
  positions[i] = positionsSorted[i];
  velocities[i] = velocitiesSorted[i];
  predicted[i] = predictedSorted[i];
}
