/**
 * ============================================================================
 * PARALLEL SCATTER SHADER
 * ============================================================================
 *
 * Pipeline Stage: Final step of Stage 3 (Counting Sort)
 * Entry Point: scatter
 * Workgroup Size: 256 threads
 *
 * Purpose:
 * --------
 * Moves particles to their sorted positions using the offsets computed by
 * the prefix sum. This is the final step that produces a sorted particle list.
 *
 * How Scatter Works:
 * ------------------
 * After prefix sum, sortOffsets[key] contains the START index for bucket 'key'.
 *
 * The challenge: Multiple particles may have the same key.
 * How do we assign unique positions within a bucket?
 *
 * Solution: Use atomicAdd as an "allocator":
 *   1. dest = atomicAdd(&sortOffsets[key], 1)  <- Returns OLD value, then increments
 *   2. Write particle data to position 'dest'
 *
 * This ensures each particle gets a unique slot, even when keys collide.
 *
 * Example:
 * --------
 *   Initial state after prefix sum:
 *     keys[] = [2, 0, 2, 1, 0, 2]
 *     sortOffsets[] = [0, 2, 3]  <- key 0 starts at 0, key 1 at 2, key 2 at 3
 *
 *   Scatter execution (thread order may vary due to parallelism):
 *     Thread 0: key=2, dest=atomicAdd(sortOffsets[2])=3, sortOffsets[2]=4
 *     Thread 1: key=0, dest=atomicAdd(sortOffsets[0])=0, sortOffsets[0]=1
 *     Thread 2: key=2, dest=atomicAdd(sortOffsets[2])=4, sortOffsets[2]=5
 *     Thread 3: key=1, dest=atomicAdd(sortOffsets[1])=2, sortOffsets[1]=3
 *     Thread 4: key=0, dest=atomicAdd(sortOffsets[0])=1, sortOffsets[0]=2
 *     Thread 5: key=2, dest=atomicAdd(sortOffsets[2])=5, sortOffsets[2]=6
 *
 *   Result (sorted by key):
 *     indices[]    = [1, 4, 3, 0, 2, 5]  <- Original particle indices
 *     sortedKeys[] = [0, 0, 1, 2, 2, 2]  <- Keys in sorted order
 *
 * Note on Stability:
 * ------------------
 * This scatter is NOT stable within buckets due to thread scheduling.
 * Particles with the same key may appear in any order.
 * This is acceptable because we only care about spatial grouping, not order.
 *
 * ============================================================================
 */

/**
 * Sort Parameters Uniform Buffer
 *
 * Memory Layout (16-byte aligned):
 * Offset  Size  Field
 * ------  ----  -----
 *   0      4    particleCount   - Total number of particles
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
// Group 0: Scatter compute pass
//
//   Binding 0: keys[]        - Hash keys for each particle (read-only)
//              From hash.wgsl, determines bucket assignment
//
//   Binding 1: sortOffsets[] - Prefix sum offsets (atomic read-write)
//              Used as a counter to allocate slots within each bucket
//              IMPORTANT: Modified by this shader! After scatter,
//              sortOffsets[k] points to END of bucket k, not start
//
//   Binding 2: sortedKeys[]  - Output: keys in sorted order
//              After execution: sortedKeys is monotonically non-decreasing
//
//   Binding 3: indices[]     - Output: original particle indices in sorted order
//              indices[sorted_pos] = original_particle_index
//              Used by reorder.wgsl to physically move particle data
//
//   Binding 4: params        - Uniform with particle count
// ============================================================================

@group(0) @binding(0) var<storage, read> keys: array<u32>;
@group(0) @binding(1) var<storage, read_write> sortOffsets: array<atomic<u32>>;
@group(0) @binding(2) var<storage, read_write> sortedKeys: array<u32>;
@group(0) @binding(3) var<storage, read_write> indices: array<u32>;
@group(0) @binding(4) var<uniform> params: SortParams;

/**
 * Scatter Kernel
 *
 * Dispatch: ceil(particleCount / 256) workgroups
 * Each thread processes exactly one particle.
 *
 * Algorithm:
 * 1. Load this particle's hash key
 * 2. Atomically reserve a slot in the bucket for this key
 * 3. Write particle index and key to the reserved slot
 *
 * After all threads complete:
 * - sortedKeys[] contains keys in sorted order
 * - indices[] maps sorted positions to original particle indices
 */
@compute @workgroup_size(256)
fn scatter(@builtin(global_invocation_id) id: vec3<u32>) {
  let index = id.x;

  // Bounds check: one thread per particle
  if (index >= params.particleCount) {
    return;
  }

  // Get this particle's hash key (bucket assignment)
  let key = keys[index];

  // ========================================================================
  // ATOMIC SLOT ALLOCATION
  // ========================================================================
  // atomicAdd does TWO things:
  //   1. Returns the CURRENT value of sortOffsets[key]
  //   2. Increments sortOffsets[key] by 1
  //
  // The returned value becomes our unique write position.
  // Even if many threads have the same key, each gets a different slot.
  //
  // Think of it as: "Reserve the next available slot in bucket 'key'"
  let dest = atomicAdd(&sortOffsets[key], 1u);

  // ========================================================================
  // WRITE TO SORTED ARRAYS
  // ========================================================================
  // Store the original particle index at the sorted position
  // This creates the mapping: sorted_position -> original_index
  indices[dest] = index;

  // Store the key at the sorted position (for spatial offset calculation)
  // After this, sortedKeys is grouped by key value
  sortedKeys[dest] = key;
}
