/**
 * ============================================================================
 * SPH DENSITY CALCULATION SHADER
 * ============================================================================
 *
 * Pipeline Stage: Stage 5 (First SPH physics pass)
 * Entry Point: main
 * Workgroup Size: 256 threads
 *
 * Purpose:
 * --------
 * Computes fluid density at each particle location using SPH (Smoothed Particle
 * Hydrodynamics). Density is the foundation for pressure and viscosity forces.
 *
 * SPH Density Formula:
 * --------------------
 * The density at particle i is the weighted sum of all neighbors:
 *
 *   ρᵢ = Σⱼ mⱼ × W(|rᵢ - rⱼ|, h)
 *
 * Where:
 *   ρᵢ = density at particle i
 *   mⱼ = mass of neighbor j (assumed = 1 in this implementation)
 *   rᵢ, rⱼ = positions of particles i and j
 *   W(r, h) = smoothing kernel function
 *   h = smoothing radius
 *
 * With unit mass, this simplifies to:
 *
 *   ρᵢ = Σⱼ W(|rᵢ - rⱼ|, h)
 *
 * Smoothing Kernels Used:
 * -----------------------
 *
 * 1. SPIKY KERNEL (pow2) - For standard density:
 *
 *    W(r, h) = (h - r)² × scale
 *
 *    - Compact support: W(r) = 0 for r ≥ h
 *    - Smooth at center, sharp at boundary
 *    - scale = normalization constant = 6 / (π × h⁴) in 3D
 *
 *         Kernel Shape:
 *         ▲
 *         │  ●
 *         │  │╲
 *         │  │ ╲
 *         │  │  ╲
 *         │  │   ╲
 *         └──┴────●───▶ r
 *         0      h
 *
 * 2. SPIKY KERNEL (pow3) - For near-density (surface tension):
 *
 *    W(r, h) = (h - r)³ × scale
 *
 *    - Even sharper falloff than pow2
 *    - Stronger repulsion for very close particles
 *    - Prevents particle clumping/clustering
 *    - Creates surface tension effect at fluid boundary
 *
 * Why Two Densities?
 * ------------------
 * The dual-density approach (Clavet et al., 2005) improves stability:
 *
 *   - Standard density: Long-range pressure (incompressibility)
 *   - Near-density: Short-range repulsion (prevents clustering)
 *
 * At rest, particles settle into a hexagonal lattice pattern.
 * Near-density prevents them from collapsing into the same point.
 *
 * Neighbor Search (O(1) per cell):
 * --------------------------------
 * Uses the spatial hash lookup table from previous stages:
 *
 *   for each of 27 neighboring cells (3x3x3):
 *     key = hashCell(cellX, cellY, cellZ)
 *     start = spatialOffsets[key]
 *     if start == particleCount: continue  // Empty cell
 *     for j = start to end of bucket:
 *       if sortedKeys[j] != key: break
 *       process neighbor j
 *
 * This is O(k) where k = average neighbors per cell (typically 20-50).
 *
 * ============================================================================
 */

/**
 * Density Parameters Uniform Buffer
 *
 * Memory Layout (16-byte aligned):
 * Offset  Size  Field
 * ------  ----  -----
 *   0      4    radius          - Smoothing radius h (cell size for hash)
 *   4      4    spikyPow2Scale  - Normalization for (h-r)² kernel
 *   8      4    spikyPow3Scale  - Normalization for (h-r)³ kernel
 *  12      4    particleCountF  - Particle count as float
 *  16     16    pad0            - Padding for 32-byte alignment
 * ------
 * Total: 32 bytes
 *
 * Normalization constants are precomputed on CPU:
 *   spikyPow2Scale = 6 / (π × h⁴)      for 3D Spiky kernel
 *   spikyPow3Scale = 10 / (π × h⁵)     for 3D Spiky^3 kernel
 */
struct DensityParams {
  radius: f32,
  spikyPow2Scale: f32,
  spikyPow3Scale: f32,
  particleCountF: f32,
  pad0: vec4<f32>,
};

// ============================================================================
// BUFFER BINDINGS
// ============================================================================
// Group 0: Density compute pass
//
//   Binding 0: predicted[]      - Predicted particle positions (spatially sorted)
//              These are the positions used for neighbor search
//
//   Binding 1: sortedKeys[]     - Spatial hash keys in sorted order
//              Used to detect end of each cell's particle list
//
//   Binding 2: spatialOffsets[] - Lookup table: key → starting index
//              Enables O(1) cell lookup during neighbor search
//
//   Binding 3: densities[]      - Output: (density, nearDensity) per particle
//              vec2<f32>: x = standard density, y = near-density
//
//   Binding 4: params           - Uniform density parameters
// ============================================================================

@group(0) @binding(0) var<storage, read> predicted: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read> sortedKeys: array<u32>;
@group(0) @binding(2) var<storage, read> spatialOffsets: array<u32>;
@group(0) @binding(3) var<storage, read_write> densities: array<vec2<f32>>;
@group(0) @binding(4) var<uniform> params: DensityParams;

/**
 * Unity's Block-Based Spatial Hash Function
 *
 * Must match the hash function in hash.wgsl exactly to ensure
 * consistent cell assignment between hashing and lookup.
 *
 * See hash.wgsl for detailed algorithm explanation.
 */
fn hashCell3D(cellX: i32, cellY: i32, cellZ: i32) -> u32 {
    let blockSize = 50u;
    let ucell = vec3<u32>(
        u32(cellX + i32(blockSize / 2u)),
        u32(cellY + i32(blockSize / 2u)),
        u32(cellZ + i32(blockSize / 2u))
    );
    let localCell = ucell % blockSize;
    let blockID = ucell / blockSize;
    let blockHash = blockID.x * 15823u + blockID.y * 9737333u + blockID.z * 440817757u;
    return localCell.x + blockSize * (localCell.y + blockSize * localCell.z) + blockHash;
}

/**
 * Spiky Kernel (pow2) - Standard Density Kernel
 *
 * W(r, h) = (h - r)² × scale
 *
 * Properties:
 * - Compact support: returns 0 for r ≥ h
 * - Smooth at r = 0: first derivative is continuous
 * - Sharp at r = h: drops to zero with finite slope
 *
 * @param dst    Distance between particles
 * @param radius Smoothing radius h
 * @param scale  Precomputed normalization constant
 * @returns      Kernel value W(dst, radius)
 */
fn spikyPow2(dst: f32, radius: f32, scale: f32) -> f32 {
  if (dst < radius) {
    let v = radius - dst;
    return v * v * scale;
  }
  return 0.0;
}

/**
 * Spiky Kernel (pow3) - Near-Density Kernel
 *
 * W(r, h) = (h - r)³ × scale
 *
 * Properties:
 * - Sharper falloff than pow2 (cubic vs quadratic)
 * - Higher contribution at small distances
 * - Provides stronger repulsion for very close particles
 *
 * Used for near-density which prevents particle clustering.
 *
 * @param dst    Distance between particles
 * @param radius Smoothing radius h
 * @param scale  Precomputed normalization constant
 * @returns      Kernel value W(dst, radius)
 */
fn spikyPow3(dst: f32, radius: f32, scale: f32) -> f32 {
  if (dst < radius) {
    let v = radius - dst;
    return v * v * v * scale;
  }
  return 0.0;
}

/**
 * Main Density Compute Kernel
 *
 * Computes density and near-density for each particle by summing
 * smoothing kernel contributions from all neighbors.
 *
 * Dispatch: ceil(particleCount / 256) workgroups
 * Each thread processes exactly one particle.
 *
 * Time Complexity: O(k) per particle, where k = avg neighbors (~27-50)
 * Total: O(n × k) which is effectively O(n) for bounded k
 *
 * Algorithm:
 * ----------
 * 1. Determine which grid cell this particle is in
 * 2. For each of 27 neighboring cells (3x3x3 cube):
 *    a. Compute cell hash key
 *    b. Look up starting index in spatialOffsets
 *    c. If cell is empty (sentinel value), skip
 *    d. Iterate through all particles in that cell
 *    e. For each neighbor within smoothing radius:
 *       - Add kernel contribution to density
 *       - Add kernel contribution to near-density
 * 3. Store result in densities array
 */
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  let count = u32(params.particleCountF + 0.5);

  // Bounds check
  if (i >= count) {
    return;
  }

  // Get this particle's (predicted) position
  // Using predicted positions gives more stable results for fast-moving particles
  let pos = predicted[i].xyz;

  // Determine which grid cell this particle belongs to
  // Cell coordinates can be negative (particles can be anywhere in space)
  let originCellX = i32(floor(pos.x / params.radius));
  let originCellY = i32(floor(pos.y / params.radius));
  let originCellZ = i32(floor(pos.z / params.radius));

  // Accumulators for density contributions
  var density = 0.0;
  var nearDensity = 0.0;

  // Precompute squared radius for fast distance checks
  // Avoids sqrt() for particles clearly outside the kernel
  let radiusSq = params.radius * params.radius;

  // ========================================================================
  // NEIGHBOR SEARCH: 3x3x3 CELL NEIGHBORHOOD
  // ========================================================================
  // Why 3x3x3?
  // - Smoothing radius = cell size
  // - A particle at cell edge can have neighbors in adjacent cell
  // - In worst case (particle at cell corner), need to check all 8 adjacent cells
  // - Using 3x3x3 (27 cells) guarantees we find ALL neighbors within radius
  //
  //   Visualization (2D cross-section):
  //   ┌───┬───┬───┐
  //   │-1,1│0,1│1,1│
  //   ├───┼───┼───┤
  //   │-1,0│ P │1,0│  P = particle, checks all 9 cells (27 in 3D)
  //   ├───┼───┼───┤
  //   │-1,-1│0,-1│1,-1│
  //   └───┴───┴───┘

  for (var z = -1; z <= 1; z = z + 1) {
    for (var y = -1; y <= 1; y = y + 1) {
      for (var x = -1; x <= 1; x = x + 1) {
        // Compute neighbor cell coordinates
        let cellX = originCellX + x;
        let cellY = originCellY + y;
        let cellZ = originCellZ + z;

        // Hash the cell coordinates to get the lookup key
        let hash = hashCell3D(cellX, cellY, cellZ);
        let key = hash % count;

        // Look up where this cell's particles start in the sorted array
        let start = spatialOffsets[key];

        // Skip empty cells (sentinel value = particleCount)
        if (start == count) { continue; }

        // ================================================================
        // ITERATE THROUGH ALL PARTICLES IN THIS CELL
        // ================================================================
        // After physical reordering, particles with the same key are
        // contiguous in memory. We iterate until we hit a different key.
        //
        // This is where cache efficiency matters:
        // - Sequential memory access (j, j+1, j+2, ...)
        // - predicted[], sortedKeys[] accesses are cache-friendly
        var j = start;
        loop {
            // Termination conditions:
            // 1. Ran out of particles
            // 2. Hit a particle with a different key (end of this cell's data)
            if (j >= count || sortedKeys[j] != key) { break; }

            // Get neighbor position (direct access, no indirection needed)
            let neighborPos = predicted[j].xyz;

            // Vector from this particle to neighbor
            let offset = neighborPos - pos;

            // Squared distance (avoids expensive sqrt for distant particles)
            let dstSq = dot(offset, offset);

            // Only process neighbors within the smoothing radius
            if (dstSq <= radiusSq) {
                // Now we need the actual distance for the kernel
                let dst = sqrt(dstSq);

                // Accumulate kernel contributions
                // Note: Self-contribution (j == i, dst = 0) is included
                // This is correct - particle contributes to its own density
                density = density + spikyPow2(dst, params.radius, params.spikyPow2Scale);
                nearDensity = nearDensity + spikyPow3(dst, params.radius, params.spikyPow3Scale);
            }

            j = j + 1u;
        }
      }
    }
  }

  // Store both densities in a single vec2
  // x = standard density (for pressure)
  // y = near-density (for surface tension / anti-clustering)
  densities[i] = vec2<f32>(density, nearDensity);
}
