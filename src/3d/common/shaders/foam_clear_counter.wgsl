/**
 * ============================================================================
 * FOAM CLEAR COUNTER COMPUTE SHADER
 * ============================================================================
 *
 * Entry Point: main
 * Workgroup Size: 1 thread
 *
 * Purpose:
 * --------
 * Resets the foam spawn counter to zero at the start of each frame,
 * before the foam spawn pass runs.
 *
 * ============================================================================
 */

@group(0) @binding(0) var<storage, read_write> foamCounter: atomic<u32>;

@compute @workgroup_size(1)
fn main() {
  atomicStore(&foamCounter, 0u);
}
