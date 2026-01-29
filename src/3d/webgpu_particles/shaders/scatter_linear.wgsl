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

struct SortParams {
  particleCount: u32,
  gridTotalCells: u32,
  pad0: vec2<u32>,
};

@group(0) @binding(0) var<storage, read> keys: array<u32>;
@group(0) @binding(1) var<storage, read_write> sortOffsets: array<atomic<u32>>;
@group(0) @binding(2) var<storage, read_write> indices: array<u32>;
@group(0) @binding(3) var<uniform> params: SortParams;
@group(0) @binding(4) var<storage, read> particleCellOffsets: array<u32>;

@compute @workgroup_size(256)
fn scatter(@builtin(global_invocation_id) id: vec3<u32>) {
  let index = id.x;

  if (index >= params.particleCount) {
    return;
  }

  let key = keys[index];
  
  // No atomicAdd here! Just read.
  let start = atomicLoad(&sortOffsets[key]);
  let localOffset = particleCellOffsets[index];
  
  let dest = start + localOffset;

  indices[dest] = index;
}