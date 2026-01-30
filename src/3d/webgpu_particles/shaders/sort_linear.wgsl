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

/**
 * Sort Parameters Uniform Buffer
 *
 * Memory Layout (16-byte aligned):
 * Offset  Size  Field
 * ------  ----  -----
 *   0      4    particleCount   - Total number of particles
 *   4      4    gridTotalCells  - Total cells in the linear grid
 *   8      8    pad0            - Padding for 16-byte alignment
 * ------
 * Total: 16 bytes
 */
struct SortParams {
  particleCount: u32,
  gridTotalCells: u32,
  pad0: vec2<u32>,
};

// ============================================================================
// KERNEL 1: CLEAR OFFSETS
// ============================================================================
// Bind Group 0: Used exclusively by clearOffsets
//
//   Binding 0: sortOffsets[] - Histogram / prefix-sum buffer to clear
//              Size: (gridTotalCells + 1) elements
//              The extra "+1" element serves as a sentinel: after prefix sum,
//              sortOffsets[gridTotalCells] holds the total particle count,
//              which is the "end" index for the last occupied cell.
//
//   Binding 1: params        - Uniform with grid cell count
// ============================================================================

@group(0) @binding(0) var<storage, read_write> sortOffsets: array<atomic<u32>>;
@group(0) @binding(1) var<uniform> params: SortParams;

/**
 * Clear Offsets Kernel
 *
 * Zeros all histogram entries including the sentinel element.
 * Must run before countOffsets to ensure a clean histogram.
 *
 * Dispatch: ceil((gridTotalCells + 1) / 256) workgroups
 */
@compute @workgroup_size(256)
fn clearOffsets(@builtin(global_invocation_id) id: vec3<u32>) {
  let index = id.x;

  // Bounds check: includes the sentinel at position gridTotalCells
  if (index > params.gridTotalCells) {
    return;
  }

  atomicStore(&sortOffsets[index], 0u);
}

// ============================================================================
// KERNEL 2: COUNT OFFSETS & COMPUTE RANK
// ============================================================================
// Bind Group 1: Used exclusively by countOffsets
// (Separate group number to allow different pipeline layout from clearOffsets)
//
//   Binding 0: keys[]                - Linear grid indices from hash_linear.wgsl
//   Binding 1: sortOffsetsCount[]    - Histogram buffer (aliased with sortOffsets)
//              Type: atomic<u32> for thread-safe increment
//   Binding 2: countParams           - Uniform with particle count
//   Binding 3: particleCellOffsets[] - Output: per-particle rank within its cell
//              The rank is the return value of atomicAdd (0-based offset)
// ============================================================================

@group(1) @binding(0) var<storage, read> keys: array<u32>;
@group(1) @binding(1) var<storage, read_write> sortOffsetsCount: array<atomic<u32>>;
@group(1) @binding(2) var<uniform> countParams: SortParams;
@group(1) @binding(3) var<storage, read_write> particleCellOffsets: array<u32>;

/**
 * Count Offsets & Compute Rank Kernel
 *
 * Builds a histogram of particles per grid cell AND simultaneously computes
 * each particle's local rank (offset) within its cell.
 *
 * The rank is the key difference from the spatial-hash variant: it enables
 * the scatter pass to compute destination indices without contention
 * (dest = start + rank), eliminating atomicAdd from the scatter.
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

  let key = keys[index];

  // atomicAdd returns the OLD value, which is the 0-based rank of this
  // particle among all particles in the same cell. Subsequent particles
  // in the same cell get incrementing ranks (1, 2, 3, ...).
  particleCellOffsets[index] = atomicAdd(&sortOffsetsCount[key], 1u);
}