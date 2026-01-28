/**
 * ============================================================================
 * SPATIAL HASH KERNEL
 * ============================================================================
 *
 * Pipeline Stage: 2 of 8 (After external forces)
 * Entry Point: main
 * Workgroup Size: 256 threads
 *
 * Purpose:
 * --------
 * Assigns each particle to a spatial hash cell based on its predicted position.
 * This enables O(n) neighbor search instead of O(n²) brute force.
 *
 * How Spatial Hashing Works:
 * --------------------------
 * 1. Divide 3D space into a uniform grid of cells (cell size = smoothing radius)
 * 2. Each particle maps to exactly one cell based on its position
 * 3. Particles in the same or adjacent cells are potential neighbors
 *
 *     Grid Visualization (2D slice):
 *     ┌─────┬─────┬─────┬─────┐
 *     │  5  │  6  │  7  │  8  │  <- Cell IDs (hash keys)
 *     │ ·   │ · · │     │  ·  │  <- Particles in cells
 *     ├─────┼─────┼─────┼─────┤
 *     │  1  │  2  │  3  │  4  │
 *     │ · · │  ·  │ · · │     │
 *     └─────┴─────┴─────┴─────┘
 *
 * Hash Function Design:
 * ---------------------
 * Uses Unity's block-based spatial hash to minimize collisions.
 *
 * Simple prime hashing: hash = x*p1 + y*p2 + z*p3
 *   Problem: Adjacent cells in 3D can have very different hashes,
 *            causing poor cache locality during neighbor search.
 *
 * Block-based approach:
 *   1. Divide space into 50³ "blocks" of cells
 *   2. Within a block, cells are numbered 0 to 124,999 (contiguous)
 *   3. Block IDs are hashed with large primes
 *
 *   This ensures that:
 *   - Cells within the same block have similar keys (better locality)
 *   - Different blocks are spread across the hash table
 *
 *     Block structure:
 *     localIndex = x + 50*(y + 50*z)   <- [0, 124999]
 *     blockHash = bx*p1 + by*p2 + bz*p3  <- Large offset per block
 *     finalHash = localIndex + blockHash
 *
 * Output:
 * -------
 *   keys[i]    = spatial hash key for particle i (determines sort order)
 *   indices[i] = i (original particle index, preserved through sorting)
 *
 * ============================================================================
 */

/**
 * Hash Parameters Uniform Buffer
 *
 * Memory Layout (16-byte aligned):
 * Offset  Size  Field
 * ------  ----  -----
 *   0      4    radius          - Smoothing radius (= grid cell size)
 *   4      4    particleCount   - Total number of particles (as float for GPU)
 *   8      8    pad0            - Padding for 16-byte alignment
 * ------
 * Total: 16 bytes
 *
 * Note: particleCount is stored as f32 because some GPU operations work
 * better with floats. We convert to u32 with rounding (+0.5) in the shader.
 */
struct HashParams {
  radius: f32,
  particleCount: f32,
  pad0: vec2<f32>,
};

// ============================================================================
// BUFFER BINDINGS
// ============================================================================
// Group 0: Spatial Hash compute pass
//
//   Binding 0: predicted[] - Predicted particle positions from Stage 1
//              Used to determine which cell each particle belongs to
//
//   Binding 1: keys[]      - Output hash keys (one per particle)
//              These keys will be sorted to group particles by cell
//
//   Binding 2: indices[]   - Output original indices (one per particle)
//              Tracks which particle each key belongs to after sorting
//
//   Binding 3: params      - Uniform hash parameters
// ============================================================================

@group(0) @binding(0) var<storage, read> predicted: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> keys: array<u32>;
@group(0) @binding(2) var<storage, read_write> indices: array<u32>;
@group(0) @binding(3) var<uniform> params: HashParams;

/**
 * Unity's Block-Based Spatial Hash Function
 *
 * Converts 3D cell coordinates to a single hash key.
 *
 * Algorithm:
 * 1. Shift cell coordinates to positive range (add blockSize/2)
 * 2. Extract local cell position within the 50³ block
 * 3. Extract block ID (which 50³ block this cell is in)
 * 4. Compute local index within block (linear addressing)
 * 5. Add block hash (large prime mixing) for uniqueness
 *
 * @param cellX, cellY, cellZ - Integer cell coordinates (can be negative)
 * @returns Hash key in range [0, very large number]
 *
 * Prime numbers chosen to minimize collisions:
 *   15823      - Small prime for X
 *   9737333    - Medium prime for Y
 *   440817757  - Large prime for Z
 */
fn hashCell3D(cellX: i32, cellY: i32, cellZ: i32) -> u32 {
    // Block size: 50 cells per dimension
    // This creates 50³ = 125,000 cells per block
    let blockSize = 50u;

    // Shift coordinates to positive range
    // Adding blockSize/2 = 25 handles cells in range [-25, +24] around origin
    let ucell = vec3<u32>(
        u32(cellX + i32(blockSize / 2u)),
        u32(cellY + i32(blockSize / 2u)),
        u32(cellZ + i32(blockSize / 2u))
    );

    // Local position within the block [0, 49] for each axis
    let localCell = ucell % blockSize;

    // Block ID: which 50³ block this cell belongs to
    let blockID = ucell / blockSize;

    // Block hash: spread different blocks across the hash space
    // Large primes ensure minimal collision between blocks
    let blockHash = blockID.x * 15823u + blockID.y * 9737333u + blockID.z * 440817757u;

    // Final hash: local linear index + block offset
    // localCell.x + 50 * (localCell.y + 50 * localCell.z) = 3D to 1D mapping
    return localCell.x + blockSize * (localCell.y + blockSize * localCell.z) + blockHash;
}

/**
 * Main Compute Kernel
 *
 * Dispatch: ceil(particleCount / 256) workgroups
 * Each thread processes exactly one particle.
 *
 * The output (keys[], indices[]) will be used by the counting sort
 * to group particles by their spatial hash key.
 */
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let index = id.x;

  // Convert particle count to integer (stored as float in uniform)
  // +0.5 ensures proper rounding
  let count = u32(params.particleCount + 0.5);

  // Bounds check
  if (index >= count) {
    return;
  }

  // Get predicted position for this particle
  let pos = predicted[index].xyz;

  // ========================================================================
  // POSITION TO CELL COORDINATE MAPPING
  // ========================================================================
  // Divide position by cell size (radius) and floor to get integer cell coords
  //
  // Example: pos = (1.7, -0.3, 2.1), radius = 0.5
  //   cellX = floor(1.7 / 0.5)  = floor(3.4)  = 3
  //   cellY = floor(-0.3 / 0.5) = floor(-0.6) = -1
  //   cellZ = floor(2.1 / 0.5)  = floor(4.2)  = 4
  //
  // Note: floor() handles negative numbers correctly (rounds toward -∞)
  let cellX = i32(floor(pos.x / params.radius));
  let cellY = i32(floor(pos.y / params.radius));
  let cellZ = i32(floor(pos.z / params.radius));

  // ========================================================================
  // COMPUTE HASH KEY
  // ========================================================================
  // Get raw hash from cell coordinates
  let hash = hashCell3D(cellX, cellY, cellZ);

  // Wrap hash to array size to prevent out-of-bounds access
  // This creates a hash table with 'count' buckets
  // Note: This can cause collisions when count < total possible cells,
  // but the spatial locality of the block-based hash minimizes this
  let key = hash % count;

  // Store results
  keys[index] = key;

  // Store original index for tracking through the sort
  // After sorting: indices[sorted_position] = original_particle_index
  indices[index] = index;
}
