/**
 * ============================================================================
 * COUNTING SORT HELPER SHADERS
 * ============================================================================
 *
 * Pipeline Stage: Part of Stage 3 (Counting Sort)
 * Entry Points: clearOffsets, countOffsets
 * Workgroup Size: 256 threads
 *
 * Purpose:
 * --------
 * These two kernels prepare data for the parallel counting sort algorithm.
 * Counting sort is ideal for spatial hashing because:
 *   - Keys are bounded integers (hash values mod particleCount)
 *   - Stable sort (preserves relative order of equal keys)
 *   - O(n) time complexity (linear in number of particles)
 *
 * Counting Sort Overview:
 * -----------------------
 *     Step 1: Clear histogram  <- clearOffsets (this file)
 *     Step 2: Count particles  <- countOffsets (this file)
 *     Step 3: Prefix sum       <- prefix_sum.wgsl
 *     Step 4: Scatter          <- scatter.wgsl
 *
 * How Counting Sort Works:
 * ------------------------
 *
 * Given particles with keys [2, 0, 2, 1, 0, 2]:
 *
 *   1. Count occurrences:
 *        histogram[0] = 2  (two particles with key 0)
 *        histogram[1] = 1  (one particle with key 1)
 *        histogram[2] = 3  (three particles with key 2)
 *
 *   2. Prefix sum (exclusive):
 *        offsets[0] = 0  (key 0 starts at index 0)
 *        offsets[1] = 2  (key 1 starts at index 2)
 *        offsets[2] = 3  (key 2 starts at index 3)
 *
 *   3. Scatter particles to sorted positions:
 *        For each particle, atomicAdd to get unique slot within bucket
 *
 *   Result: Particles sorted by key [0, 0, 1, 2, 2, 2]
 *
 * ============================================================================
 */

/**
 * Sort Parameters Uniform Buffer
 *
 * Memory Layout (16-byte aligned):
 * Offset  Size  Field
 * ------  ----  -----
 *   0      4    particleCount   - Total number of particles/buckets
 *   4     12    pad0            - Padding for 16-byte alignment
 * ------
 * Total: 16 bytes
 */
struct SortParams {
  particleCount: u32,
  pad0: vec3<u32>,
};

// ============================================================================
// KERNEL 1: CLEAR OFFSETS
// ============================================================================
// Bind Group 0: Used exclusively by clearOffsets
//
//   Binding 0: sortOffsets[] - Histogram/offset array to clear
//              Size: particleCount elements (one per possible key)
//              Type: atomic<u32> for thread-safe counting in next pass
//
//   Binding 1: params        - Uniform with particle count
// ============================================================================

@group(0) @binding(0) var<storage, read_write> sortOffsets: array<atomic<u32>>;
@group(0) @binding(1) var<uniform> params: SortParams;

/**
 * Clear Offsets Kernel
 *
 * Resets all histogram buckets to zero before counting.
 *
 * Why atomicStore instead of regular assignment?
 * - The buffer is typed as atomic<u32> for use in countOffsets
 * - Must use atomic operations to access atomic variables in WGSL
 *
 * Dispatch: ceil(particleCount / 256) workgroups
 */
@compute @workgroup_size(256)
fn clearOffsets(@builtin(global_invocation_id) id: vec3<u32>) {
  let index = id.x;

  // Bounds check: one thread per histogram bucket
  if (index >= params.particleCount) {
    return;
  }

  // Reset bucket to zero
  // atomicStore ensures the write is visible to other threads
  atomicStore(&sortOffsets[index], 0u);
}

// ============================================================================
// KERNEL 2: COUNT OFFSETS
// ============================================================================
// Bind Group 1: Used exclusively by countOffsets
// (Separate group to allow different pipeline layouts)
//
//   Binding 0: keys[]           - Spatial hash keys from hash.wgsl
//              Size: particleCount elements
//
//   Binding 1: sortOffsetsCount[] - Histogram to increment
//              This is the SAME buffer as sortOffsets (aliased)
//              Type: atomic<u32> for thread-safe increment
//
//   Binding 2: countParams      - Uniform with particle count
// ============================================================================

@group(1) @binding(0) var<storage, read> keys: array<u32>;
@group(1) @binding(1) var<storage, read_write> sortOffsetsCount: array<atomic<u32>>;
@group(1) @binding(2) var<uniform> countParams: SortParams;

/**
 * Count Offsets Kernel
 *
 * Builds a histogram of how many particles have each hash key.
 *
 * Algorithm:
 * 1. Load the hash key for this particle
 * 2. Atomically increment the counter for that key
 *
 * Why atomic operations?
 * - Many particles may have the same key (same grid cell)
 * - Without atomics, concurrent writes would lose counts
 * - atomicAdd guarantees each particle is counted exactly once
 *
 * After this pass:
 *   sortOffsetsCount[key] = number of particles with that key
 *
 * Dispatch: ceil(particleCount / 256) workgroups
 */
@compute @workgroup_size(256)
fn countOffsets(@builtin(global_invocation_id) id: vec3<u32>) {
  let index = id.x;

  // Bounds check: one thread per particle
  if (index >= countParams.particleCount) {
    return;
  }

  // Get this particle's hash key
  let key = keys[index];

  // Increment the count for this key's bucket
  // atomicAdd returns the previous value, but we don't need it here
  atomicAdd(&sortOffsetsCount[key], 1u);
}
