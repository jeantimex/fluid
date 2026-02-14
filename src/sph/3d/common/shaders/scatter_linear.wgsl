/**
 * ============================================================================
 * CONTENTION-FREE SCATTER KERNEL
 * ============================================================================
 *
 * Pipeline Stage: Final step of Stage 3
 * Entry Point: scatter
 * Workgroup Size: 256 threads
 *
 * Purpose:
 * --------
 * Places particles into their sorted positions.
 *
 * Optimization: "Rank + Start"
 * - Instead of atomicAdd on global memory (which causes high contention),
 *   we use the precomputed `particleCellOffsets` (Rank) and `sortOffsets` (Start).
 * - Destination = Start + Rank.
 * - This is 100% parallel and contention-free.
 *
 * ============================================================================
 */

// Beginner note: scatter computes each particle’s final sorted slot so
// neighbors in the same cell become contiguous in memory.

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
// BUFFER BINDINGS
// ============================================================================
// Group 0: Contention-free scatter compute pass
//
//   Binding 0: keys[]               - Linear grid indices from hash_linear.wgsl
//              Used to look up the cell's start offset
//
//   Binding 1: sortOffsets[]        - Prefix-sum result (cell start offsets)
//              Read-only via atomicLoad (no concurrent writes)
//
//   Binding 2: indices[]            - Output: sorted index mapping
//              indices[dest] = original particle index
//
//   Binding 3: params               - Uniform with particle count
//
//   Binding 4: particleCellOffsets[] - Per-particle rank within its cell
//              Computed by countOffsets in sort_linear.wgsl
// ============================================================================

@group(0) @binding(0) var<storage, read> keys: array<u32>;
@group(0) @binding(1) var<storage, read_write> sortOffsets: array<atomic<u32>>;
@group(0) @binding(2) var<storage, read_write> indices: array<u32>;
@group(0) @binding(3) var<uniform> params: SortParams;
@group(0) @binding(4) var<storage, read> particleCellOffsets: array<u32>;

/**
 * Contention-Free Scatter Kernel
 *
 * Places each particle at its sorted position using:
 *   dest = start + rank
 *
 * Where:
 *   start = sortOffsets[key]           (from prefix sum — cell start index)
 *   rank  = particleCellOffsets[index] (from countOffsets — particle's local offset)
 *
 * This avoids the atomicAdd used in the spatial-hash scatter, making the
 * write pattern fully deterministic and contention-free. Each particle
 * writes to a unique destination with no synchronisation needed.
 *
 * Dispatch: ceil(particleCount / 256) workgroups
 */
@compute @workgroup_size(256)
fn scatter(@builtin(global_invocation_id) id: vec3<u32>) {
  let index = id.x;

  // Bounds check: one thread per particle
  if (index >= params.particleCount) {
    return;
  }

  let key = keys[index];

  // Read the cell's start offset (no mutation — just a load)
  let start = atomicLoad(&sortOffsets[key]);

  // Read the pre-computed rank of this particle within its cell
  let localOffset = particleCellOffsets[index];

  // Compute the unique destination: start of cell + particle's rank
  let dest = start + localOffset;

  // Write the original particle index to the sorted position
  indices[dest] = index;
}
