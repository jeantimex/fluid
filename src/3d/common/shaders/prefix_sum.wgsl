/**
 * ============================================================================
 * PARALLEL PREFIX SUM (SCAN) SHADER - BLELLOCH ALGORITHM
 * ============================================================================
 *
 * Pipeline Stage: Part of Stage 3 (Counting Sort)
 * Entry Points: blockScan, blockCombine
 * Workgroup Size: 256 threads (processes 512 elements per workgroup)
 *
 * Purpose:
 * --------
 * Computes the exclusive prefix sum (scan) of the histogram array.
 * This transforms counts into starting offsets for each bucket:
 *
 *   Input:   [2, 1, 3, 2, 0, 1]  <- counts per bucket
 *   Output:  [0, 2, 3, 6, 8, 8]  <- starting index for each bucket
 *
 * The output tells us: "Bucket k starts at index offsets[k]"
 *
 * Blelloch Scan Algorithm:
 * ------------------------
 * The Blelloch scan is a work-efficient parallel algorithm with two phases:
 *
 * PHASE 1: UP-SWEEP (Reduction)
 * Build a balanced binary tree of partial sums from leaves to root.
 *
 *   Level 0:  [a₀] [a₁] [a₂] [a₃] [a₄] [a₅] [a₆] [a₇]  <- Input
 *              ↘↙     ↘↙     ↘↙     ↘↙
 *   Level 1:  [a₀][a₀₁]  [a₂][a₂₃]  [a₄][a₄₅]  [a₆][a₆₇]
 *                  ↘↙          ↘↙
 *   Level 2:  [a₀][a₀₁][a₂][a₀₋₃]    [a₄][a₄₅][a₆][a₄₋₇]
 *                        ↘↙
 *   Level 3:  [a₀][a₀₁][a₂][a₀₋₃][a₄][a₄₅][a₆][TOTAL]  <- Root has total
 *
 * PHASE 2: DOWN-SWEEP (Distribution)
 * Traverse down the tree, propagating partial sums:
 *
 *   1. Set root to identity (0 for addition)
 *   2. At each level, for each node:
 *      - Left child = parent
 *      - Right child = parent + old left child
 *
 *   Result: Exclusive prefix sum at each position
 *
 * Hierarchical Processing (3 Levels):
 * ------------------------------------
 * For arrays larger than 512 elements, we use a 3-level hierarchy:
 *
 *   Level 0 (L0): Process 512-element blocks, save block totals
 *   Level 1 (L1): Scan block totals (if > 512 blocks, do another level)
 *   Level 2 (L2): Scan L1 totals (handles up to 512³ = 134M elements)
 *   Combine: Add scanned block totals back to each block
 *
 *     ┌─────────────────────────────────────────────────────────────┐
 *     │                    Input Array (N elements)                 │
 *     └─────────────────────────────────────────────────────────────┘
 *            ↓ blockScan L0
 *     ┌─────┬─────┬─────┬─────┬─────┐
 *     │ B0  │ B1  │ B2  │ B3  │ ... │  Each block scanned, totals saved
 *     └─────┴─────┴─────┴─────┴─────┘
 *     └──────── groupSums L0 ────────┘
 *            ↓ blockScan L1
 *     ┌─────────────────────────────┐
 *     │ Scanned group sums (L1)     │
 *     └─────────────────────────────┘
 *            ↓ blockCombine L0
 *     ┌─────────────────────────────────────────────────────────────┐
 *     │    Final prefix sum (each block + its scanned group sum)    │
 *     └─────────────────────────────────────────────────────────────┘
 *
 * Performance:
 * ------------
 * - O(n) work complexity (same as sequential)
 * - O(log n) step complexity (parallel depth)
 * - Shared memory reduces global memory bandwidth
 * - Each thread handles 2 elements (coalesced access)
 *
 * ============================================================================
 */

/**
 * Scan Parameters Uniform Buffer
 *
 * Memory Layout (16-byte aligned):
 * Offset  Size  Field
 * ------  ----  -----
 *   0      4    count   - Number of elements to scan
 *   4     12    pad0    - Padding for 16-byte alignment
 * ------
 * Total: 16 bytes
 */
struct Params {
  count: u32,
  pad0: vec3<u32>,
};

// ============================================================================
// BUFFER BINDINGS
// ============================================================================
// Group 0: Prefix sum compute pass
//
//   Binding 0: data[]       - Input/output array (in-place scan)
//              Size: 'count' elements
//              Contains histogram on input, offsets on output
//
//   Binding 1: groupSums[]  - Block total sums for hierarchical scan
//              Size: ceil(count / 512) elements
//              Written by blockScan, read by next level
//
//   Binding 2: params       - Uniform with element count
//
//   Binding 3: scannedGroupSums[] - (for blockCombine only)
//              The group sums AFTER they've been scanned
//              Used to add block offsets in the combine phase
// ============================================================================

@group(0) @binding(0) var<storage, read_write> data: array<u32>;
@group(0) @binding(1) var<storage, read_write> groupSums: array<u32>;
@group(0) @binding(2) var<uniform> params: Params;

/**
 * Workgroup Shared Memory
 *
 * Size: 512 elements (2 per thread × 256 threads)
 *
 * Used for:
 * - Loading data from global memory (coalesced)
 * - Performing the up-sweep and down-sweep in fast shared memory
 * - Avoiding global memory round-trips during the algorithm
 */
var<workgroup> temp: array<u32, 512>;

/**
 * Block Scan Kernel (Blelloch Algorithm)
 *
 * Performs an exclusive prefix sum on a block of 512 elements.
 * Each workgroup processes one block independently.
 *
 * Dispatch: ceil(count / 512) workgroups
 *
 * Input: data[] contains histogram counts
 * Output:
 *   - data[] contains local prefix sums within each block
 *   - groupSums[] contains the total sum of each block
 *
 * The local prefix sums will be adjusted by blockCombine to create
 * the global prefix sum.
 *
 * Example (block of 8 elements for clarity):
 *   Input:     [2, 1, 3, 2, 0, 1, 2, 1]
 *   After scan: [0, 2, 3, 6, 8, 8, 9, 11]  <- Local exclusive scan
 *   Block sum:  12 (saved to groupSums)
 */
@compute @workgroup_size(256)
fn blockScan(@builtin(global_invocation_id) global_id: vec3<u32>, @builtin(local_invocation_id) local_id: vec3<u32>, @builtin(workgroup_id) group_id: vec3<u32>) {
    let tid = local_id.x;       // Thread ID within workgroup [0, 255]
    let gid = global_id.x;      // Global thread ID
    let groupIndex = group_id.x; // Which block/workgroup

    // Each thread loads 2 elements (coalesced memory access pattern)
    let idx1 = 2u * gid;
    let idx2 = 2u * gid + 1u;
    let n = params.count;

    // Load from global memory to shared memory
    // Pad with 0 for elements beyond array bounds (handles non-power-of-2 sizes)
    if (idx1 < n) { temp[2u * tid] = data[idx1]; } else { temp[2u * tid] = 0u; }
    if (idx2 < n) { temp[2u * tid + 1u] = data[idx2]; } else { temp[2u * tid + 1u] = 0u; }

    // Synchronize: all threads must finish loading before we start the algorithm
    workgroupBarrier();

    // ========================================================================
    // PHASE 1: UP-SWEEP (REDUCTION)
    // ========================================================================
    // Build a tree of partial sums. After this phase, temp[511] contains
    // the total sum of all 512 elements.
    //
    // Iteration pattern (for 512 elements):
    //   d=256: 256 threads, offset=1  -> pairs at distance 1
    //   d=128: 128 threads, offset=2  -> pairs at distance 2
    //   d=64:   64 threads, offset=4  -> pairs at distance 4
    //   ...
    //   d=1:     1 thread,  offset=256 -> final pair at distance 256
    //
    // Each iteration halves the active threads and doubles the stride.
    var offset = 1u;
    for (var d = 256u; d > 0u; d = d >> 1u) {
        workgroupBarrier();
        if (tid < d) {
            // Indices into the binary tree:
            // ai = left child, bi = right child (bi = ai's sibling)
            let ai = offset * (2u * tid + 1u) - 1u;
            let bi = offset * (2u * tid + 2u) - 1u;
            // Sum flows up: right child = left + right
            temp[bi] = temp[bi] + temp[ai];
        }
        offset = offset * 2u;
    }

    // ========================================================================
    // SAVE BLOCK SUM & CLEAR ROOT
    // ========================================================================
    // Only thread 0 performs these operations (single-threaded section)
    if (tid == 0u) {
        // Save the total sum of this block for the next level of the hierarchy
        // This will be scanned to compute block offsets
        if (groupIndex < arrayLength(&groupSums)) {
            groupSums[groupIndex] = temp[511u];
        }
        // Clear the last element to start the down-sweep
        // This is what makes it an EXCLUSIVE scan (first output is 0)
        temp[511u] = 0u;
    }

    // ========================================================================
    // PHASE 2: DOWN-SWEEP (DISTRIBUTION)
    // ========================================================================
    // Propagate partial sums down the tree to compute prefix sums.
    //
    // At each node:
    //   1. Save left child value (t)
    //   2. Left child = current (parent's prefix sum)
    //   3. Right child = current + t (includes left subtree)
    //
    // Iteration pattern (reverse of up-sweep):
    //   d=1:     1 thread,  offset=256
    //   d=2:     2 threads, offset=128
    //   d=4:     4 threads, offset=64
    //   ...
    //   d=256: 256 threads, offset=1
    for (var d = 1u; d < 512u; d = d * 2u) {
        offset = offset >> 1u;
        workgroupBarrier();
        if (tid < d) {
            let ai = offset * (2u * tid + 1u) - 1u;
            let bi = offset * (2u * tid + 2u) - 1u;
            // Swap and accumulate
            let t = temp[ai];
            temp[ai] = temp[bi];
            temp[bi] = temp[bi] + t;
        }
    }

    // Final sync before writing results
    workgroupBarrier();

    // Write results back to global memory
    if (idx1 < n) { data[idx1] = temp[2u * tid]; }
    if (idx2 < n) { data[idx2] = temp[2u * tid + 1u]; }
}

// Binding for the combine phase (scanned group sums from level above)
@group(0) @binding(3) var<storage, read> scannedGroupSums: array<u32>;

/**
 * Block Combine Kernel
 *
 * After blockScan completes on all blocks:
 *   - Each block has its local exclusive scan
 *   - groupSums contains the total of each block
 *   - scannedGroupSums contains the exclusive scan of block totals
 *
 * This kernel adds the block's base offset to all elements in that block,
 * converting local scans to global scans.
 *
 * Example:
 *   Block 0 local scan: [0, 2, 5, 8]   scannedGroupSums[0] = 0
 *   Block 1 local scan: [0, 1, 4, 6]   scannedGroupSums[1] = 10
 *
 *   After combine:
 *   Block 0: [0, 2, 5, 8]     (unchanged, base = 0)
 *   Block 1: [10, 11, 14, 16] (each element + 10)
 *
 * Dispatch: ceil(count / 512) workgroups
 */
@compute @workgroup_size(256)
fn blockCombine(@builtin(global_invocation_id) global_id: vec3<u32>, @builtin(workgroup_id) group_id: vec3<u32>) {
    let groupIndex = group_id.x;

    // Block 0 already has the correct values (its base offset is 0)
    if (groupIndex == 0u) { return; }

    // Get the cumulative offset for this block from the scanned group sums
    // This is the sum of all elements in blocks 0 through (groupIndex - 1)
    let groupAdd = scannedGroupSums[groupIndex];

    // Each thread processes 2 elements
    let idx1 = 2u * global_id.x;
    let idx2 = 2u * global_id.x + 1u;
    let n = params.count;

    // Add the block offset to convert local scan to global scan
    if (idx1 < n) { data[idx1] = data[idx1] + groupAdd; }
    if (idx2 < n) { data[idx2] = data[idx2] + groupAdd; }
}
