/**
 * ============================================================================
 * COUNTING SORT KERNELS (LINEAR GRID)
 * ============================================================================
 *
 * Pipeline Stage: Part of Stage 3 (Counting Sort)
 * Entry Points: clearOffsets, countOffsets
 * Workgroup Size: 256 threads
 *
 * Purpose:
 * --------
 * Prepares the histogram for the Linear Grid sort.
 *
 * Key Changes from Spatial Hash:
 * - We compute a "Rank" (local offset) for each particle within its cell
 *   using atomicAdd. This is stored in `particleCellOffsets`.
 * - This Rank + Start (from Prefix Sum) allows for a contention-free Scatter pass.
 *
 * ============================================================================
 */

struct SortParams {
  particleCount: u32,
  gridTotalCells: u32,
  pad0: vec2<u32>,
};

// ============================================================================
// KERNEL 1: CLEAR OFFSETS
// ============================================================================
@group(0) @binding(0) var<storage, read_write> sortOffsets: array<atomic<u32>>;
@group(0) @binding(1) var<uniform> params: SortParams;

@compute @workgroup_size(256)
fn clearOffsets(@builtin(global_invocation_id) id: vec3<u32>) {
  let index = id.x;
  // +1 because sortOffsets includes a sentinel at the end for the last cell's "end" index
  if (index > params.gridTotalCells) {
    return;
  }
  atomicStore(&sortOffsets[index], 0u);
}

// ============================================================================
// KERNEL 2: COUNT OFFSETS & COMPUTE RANK
// ============================================================================
@group(1) @binding(0) var<storage, read> keys: array<u32>;
@group(1) @binding(1) var<storage, read_write> sortOffsetsCount: array<atomic<u32>>;
@group(1) @binding(2) var<uniform> countParams: SortParams;
@group(1) @binding(3) var<storage, read_write> particleCellOffsets: array<u32>;

@compute @workgroup_size(256)
fn countOffsets(@builtin(global_invocation_id) id: vec3<u32>) {
  let index = id.x;

  if (index >= countParams.particleCount) {
    return;
  }

  let key = keys[index];

  // atomicAdd returns the OLD value, which is the 0-based rank of this particle
  // among all particles in the same cell.
  particleCellOffsets[index] = atomicAdd(&sortOffsetsCount[key], 1u);
}