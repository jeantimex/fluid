/**
 * ============================================================================
 * SUBGROUP-OPTIMIZED PARALLEL PREFIX SUM (SCAN) SHADER
 * ============================================================================
 *
 * Pipeline Stage: Part of Stage 3 (Counting Sort)
 * Entry Points: blockScan, blockCombine
 * Workgroup Size: 256 threads (processes 512 elements per workgroup)
 *
 * Purpose:
 * --------
 * Same as prefix_sum.wgsl but uses subgroup operations for massive speedup.
 * Subgroup operations execute in a single instruction across all lanes in
 * a subgroup (typically 32 lanes on NVIDIA, 64 on AMD).
 *
 * Key Optimization:
 * -----------------
 * The Blelloch algorithm requires O(log n) iterations for the up-sweep and
 * down-sweep phases. With subgroups, we can do the entire prefix sum within
 * a subgroup in ONE instruction using subgroupExclusiveAdd().
 *
 * Algorithm:
 * ----------
 * 1. Each thread loads 2 values (512 total per workgroup)
 * 2. For each value, use subgroupExclusiveAdd() for instant within-subgroup scan
 * 3. Last lane of each subgroup writes subgroup total to shared memory
 * 4. Sequential scan of subgroup totals (only ~8-16 values)
 * 5. Each thread adds its subgroup's base offset
 * 6. Write results back to global memory
 *
 * Performance:
 * ------------
 * - Reduces log(512) = 9 iterations to effectively 3-4 steps
 * - Eliminates most workgroupBarrier() calls
 * - Single instruction for 32/64 element prefix sums
 *
 * ============================================================================
 */

// Enable subgroup operations
enable subgroups;

/**
 * Scan Parameters Uniform Buffer
 */
struct Params {
  count: u32,
  pad0: vec3<u32>,
};

// ============================================================================
// BUFFER BINDINGS
// ============================================================================

@group(0) @binding(0) var<storage, read_write> data: array<u32>;
@group(0) @binding(1) var<storage, read_write> groupSums: array<u32>;
@group(0) @binding(2) var<uniform> params: Params;

/**
 * Workgroup Shared Memory
 *
 * Layout:
 * - temp[0..511]: Working space for 512 elements
 * - subgroupTotals[0..15]: Totals from each subgroup (256 threads / subgroup_size)
 */
var<workgroup> temp: array<u32, 512>;
var<workgroup> subgroupTotals: array<u32, 16>;  // Max 16 subgroups for 256 threads

/**
 * Block Scan Kernel (Subgroup-Optimized)
 *
 * Uses subgroupExclusiveAdd for instant within-subgroup prefix sums,
 * then combines subgroup results using shared memory.
 */
@compute @workgroup_size(256)
fn blockScan(
    @builtin(global_invocation_id) global_id: vec3<u32>,
    @builtin(local_invocation_id) local_id: vec3<u32>,
    @builtin(workgroup_id) group_id: vec3<u32>,
    @builtin(subgroup_size) sg_size: u32,
    @builtin(subgroup_invocation_id) sg_lane: u32
) {
    let tid = local_id.x;
    let gid = global_id.x;
    let groupIndex = group_id.x;
    let n = params.count;

    // Calculate subgroup ID within workgroup
    let sg_id = tid / sg_size;
    let num_subgroups = 256u / sg_size;

    // ========================================================================
    // PHASE 1: LOAD DATA
    // ========================================================================
    // Each thread loads 2 elements
    let idx1 = 2u * gid;
    let idx2 = 2u * gid + 1u;

    var val1 = 0u;
    var val2 = 0u;
    if (idx1 < n) { val1 = data[idx1]; }
    if (idx2 < n) { val2 = data[idx2]; }

    // ========================================================================
    // PHASE 2: SUBGROUP PREFIX SUM (Single instruction!)
    // ========================================================================
    // Compute prefix sum within each subgroup for both values
    // We process as pairs: first do val1, then val1+val2 for the second element

    // For the first element of each thread's pair
    let prefix1 = subgroupExclusiveAdd(val1);

    // Get the total of val1 within this subgroup (needed for val2's offset)
    let total1_in_subgroup = subgroupAdd(val1);

    // For the second element, we need: prefix of all val1's + prefix of val2's in earlier threads
    // But since we're processing pairs, we handle this differently

    // Store to shared memory: each thread writes its pair
    temp[2u * tid] = val1;
    temp[2u * tid + 1u] = val2;

    workgroupBarrier();

    // ========================================================================
    // PHASE 3: SEQUENTIAL SCAN WITHIN SHARED MEMORY (Hybrid approach)
    // ========================================================================
    // Now we have 512 elements. We'll use subgroup operations on chunks.
    //
    // Approach: Each thread processes 2 elements using subgroup operations
    // Thread k handles elements at position (k*2) and (k*2+1)
    // Combined value for subgroup scan = val1 + val2

    let combined = val1 + val2;

    // Subgroup exclusive scan on combined values
    // This gives us the sum of all pairs BEFORE this thread within the subgroup
    let sg_prefix = subgroupExclusiveAdd(combined);

    // Get subgroup total (sum of all combined values in this subgroup)
    let sg_total = subgroupAdd(combined);

    // Last lane in each subgroup stores the subgroup total
    if (sg_lane == sg_size - 1u) {
        subgroupTotals[sg_id] = sg_total;
    }

    workgroupBarrier();

    // ========================================================================
    // PHASE 4: SCAN SUBGROUP TOTALS
    // ========================================================================
    // Only thread 0 scans the subgroup totals (sequential but tiny: 4-8 values)
    if (tid == 0u) {
        var running = 0u;
        for (var i = 0u; i < num_subgroups; i++) {
            let t = subgroupTotals[i];
            subgroupTotals[i] = running;
            running += t;
        }
        // Save block total for hierarchical scan
        if (groupIndex < arrayLength(&groupSums)) {
            groupSums[groupIndex] = running;
        }
    }

    workgroupBarrier();

    // ========================================================================
    // PHASE 5: COMPUTE FINAL VALUES
    // ========================================================================
    // Final prefix for each pair = subgroup base offset + within-subgroup prefix
    let base_offset = subgroupTotals[sg_id];
    let pair_prefix = base_offset + sg_prefix;

    // Write results:
    // First element's prefix = pair_prefix
    // Second element's prefix = pair_prefix + val1
    if (idx1 < n) { data[idx1] = pair_prefix; }
    if (idx2 < n) { data[idx2] = pair_prefix + val1; }
}

// Binding for the combine phase
@group(0) @binding(3) var<storage, read> scannedGroupSums: array<u32>;

/**
 * Block Combine Kernel
 *
 * Adds the scanned block offset to each element in the block.
 * Same as original - subgroup operations don't help here since
 * we're just adding a uniform value to all elements.
 */
@compute @workgroup_size(256)
fn blockCombine(
    @builtin(global_invocation_id) global_id: vec3<u32>,
    @builtin(workgroup_id) group_id: vec3<u32>
) {
    let groupIndex = group_id.x;

    // Block 0 already has correct values
    if (groupIndex == 0u) { return; }

    let groupAdd = scannedGroupSums[groupIndex];
    let idx1 = 2u * global_id.x;
    let idx2 = 2u * global_id.x + 1u;
    let n = params.count;

    if (idx1 < n) { data[idx1] = data[idx1] + groupAdd; }
    if (idx2 < n) { data[idx2] = data[idx2] + groupAdd; }
}
