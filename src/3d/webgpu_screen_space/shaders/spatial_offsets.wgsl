/**
 * ============================================================================
 * SPATIAL OFFSETS SHADER
 * ============================================================================
 *
 * Pipeline Stage: Part of Stage 4 (After counting sort, before reorder)
 * Entry Points: initOffsets, calculateOffsets
 * Workgroup Size: 256 threads
 *
 * Purpose:
 * --------
 * Creates a lookup table for O(1) cell access during neighbor search.
 *
 * After counting sort, particles are grouped by their hash key:
 *   sortedKeys[] = [0, 0, 1, 2, 2, 2, 5, 5]
 *
 * We need to quickly find where each key starts:
 *   spatialOffsets[0] = 0  (key 0 starts at index 0)
 *   spatialOffsets[1] = 2  (key 1 starts at index 2)
 *   spatialOffsets[2] = 3  (key 2 starts at index 3)
 *   spatialOffsets[3] = 8  (key 3 not present, sentinel value)
 *   spatialOffsets[4] = 8  (key 4 not present, sentinel value)
 *   spatialOffsets[5] = 6  (key 5 starts at index 6)
 *
 * Neighbor Search Algorithm (using spatialOffsets):
 * -------------------------------------------------
 *   function findNeighbors(particle):
 *     for each adjacent cell (3x3x3 = 27 cells):
 *       key = hashCell(cellX, cellY, cellZ)
 *       start = spatialOffsets[key]
 *       if start == particleCount:
 *         continue  // Empty cell
 *       j = start
 *       while sortedKeys[j] == key:
 *         process neighbor at index j
 *         j++
 *
 * This gives O(k) per-particle neighbor search where k = avg neighbors per cell.
 *
 * Two-Pass Algorithm:
 * -------------------
 *   Pass 1 (initOffsets):
 *     Set all entries to sentinel value (particleCount)
 *     This marks all cells as "empty" initially
 *
 *   Pass 2 (calculateOffsets):
 *     Detect key boundaries in sortedKeys[]
 *     When sortedKeys[i] != sortedKeys[i-1], that's a new key starting
 *     Write the start index for each unique key
 *
 *     Visual example:
 *       sortedKeys:     [0] [0] [1] [2] [2] [2] [5] [5]
 *       indices:          0   1   2   3   4   5   6   7
 *       boundaries:       ^       ^   ^               ^
 *       (first occurrence of each key)
 *
 * Why Two Passes?
 * ---------------
 * The init pass is needed because not all keys appear in the sorted array.
 * Keys that map to empty cells (no particles) would never be written in
 * calculateOffsets, leaving garbage values. The sentinel value (particleCount)
 * serves as a reliable "cell is empty" indicator.
 *
 * ============================================================================
 */

/**
 * Sort Parameters Uniform Buffer
 *
 * Memory Layout (16-byte aligned):
 * Offset  Size  Field
 * ------  ----  -----
 *   0      4    particleCount   - Total particles (also used as sentinel)
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
// Group 0: Spatial Offsets compute pass
//
//   Binding 0: sortedKeys[]    - Keys in sorted order (from scatter.wgsl)
//              Used to detect boundaries between different keys
//
//   Binding 1: spatialOffsets[] - Output lookup table (key -> start index)
//              Size: particleCount (one entry per possible key)
//              spatialOffsets[k] = first index where sortedKeys[i] == k
//              or particleCount if key k has no particles
//
//   Binding 2: params          - Uniform with particle count
// ============================================================================

@group(0) @binding(0) var<storage, read> sortedKeys: array<u32>;
@group(0) @binding(1) var<storage, read_write> spatialOffsets: array<u32>;
@group(0) @binding(2) var<uniform> params: SortParams;

/**
 * Initialize Offsets Kernel
 *
 * Sets all offset entries to the sentinel value (particleCount).
 *
 * Why particleCount as sentinel?
 * - It's always out of bounds for sortedKeys[] indexing
 * - Easy to check: if (start == particleCount) -> empty cell
 * - No special constants needed
 *
 * Dispatch: ceil(particleCount / 256) workgroups
 */
@compute @workgroup_size(256)
fn initOffsets(@builtin(global_invocation_id) id: vec3<u32>) {
  let index = id.x;

  // Bounds check
  if (index >= params.particleCount) { return; }

  // Set to sentinel value (marks cell as empty)
  spatialOffsets[index] = params.particleCount;
}

/**
 * Calculate Offsets Kernel
 *
 * Detects boundaries between different keys in the sorted array and
 * records the starting index for each unique key.
 *
 * Algorithm:
 * 1. For index 0: Always a boundary (first key starts here)
 * 2. For index i > 0: Check if sortedKeys[i] != sortedKeys[i-1]
 *    If different, i is the start of a new key
 *
 * This is a classic "find unique" / "stream compaction" pattern.
 *
 * Dispatch: ceil(particleCount / 256) workgroups
 */
@compute @workgroup_size(256)
fn calculateOffsets(@builtin(global_invocation_id) id: vec3<u32>) {
  let index = id.x;

  // Bounds check
  if (index >= params.particleCount) { return; }

  // Get the key at this position
  let key = sortedKeys[index];

  if (index == 0u) {
    // The very first element is always a boundary
    // (the first occurrence of whatever key is at position 0)
    spatialOffsets[key] = index;
  } else {
    // Check if this is a boundary (key changed from previous)
    let prevKey = sortedKeys[index - 1u];
    if (key != prevKey) {
      // New key starts here - record this position
      spatialOffsets[key] = index;
    }
    // If key == prevKey, this is a continuation of the same bucket
    // No write needed (offset was already set by an earlier element)
  }
}
