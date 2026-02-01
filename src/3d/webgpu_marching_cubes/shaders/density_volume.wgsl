// =============================================================================
// Density Volume Compute Shader (Spatial-Hash Variant)
// =============================================================================
//
// An alternative density volume generator that uses spatial hashing for
// neighbor lookup instead of the brute-force splat approach. Each thread
// processes one voxel, queries the spatial hash for nearby particles, and
// accumulates the Spiky² kernel density at that point.
//
// This shader is NOT used in the current 3-pass atomic splat pipeline —
// it exists as a reference implementation that mirrors the particle density
// pass used in the SPH simulation itself.
//
// ## Algorithm
//
// For each voxel:
//   1. Convert voxel index → UVW → world position
//   2. Determine the spatial hash cell containing that world position
//   3. Iterate over the 3×3×3 neighborhood of hash cells (27 cells)
//   4. For each cell, walk the sorted particle list starting at
//      `spatialOffsets[key]` until the key changes
//   5. Accumulate Spiky² kernel contributions from particles within radius
//   6. Write the final density to the 3D storage texture
//
// ## Spatial Hash
//
// Uses a two-level hashing scheme identical to the simulation's neighbor search:
//   - A 50³ local cell grid within each block
//   - Block IDs are hashed with large primes to distribute spatially
//   - `sortedKeys[j]` stores the hash key for each particle (sorted)
//   - `spatialOffsets[key]` stores the first index in `sortedKeys` for that key
// =============================================================================

/// Per-frame parameters for the density volume pass.
struct DensityVolumeParams {
  radius: f32,            // SPH smoothing radius in world units
  spikyPow2Scale: f32,    // Spiky² kernel normalization: 15 / (2π h⁵)
  particleCount: f32,     // Number of active particles (stored as f32 for alignment)
  pad0: f32,
  boundsSize: vec3<f32>,  // Simulation domain size (width, height, depth)
  pad1: f32,
  volumeSize: vec3<u32>,  // Density texture resolution (voxels per axis)
  pad2: u32,
};

/// Predicted particle positions (vec4 per particle; xyz = position).
@group(0) @binding(0) var<storage, read> predicted: array<vec4<f32>>;

/// Sorted spatial hash keys — one per particle, sorted so particles
/// with the same key are contiguous.
@group(0) @binding(1) var<storage, read> sortedKeys: array<u32>;

/// Offset table: spatialOffsets[key] = index of the first particle with that key.
@group(0) @binding(2) var<storage, read> spatialOffsets: array<u32>;

/// Output 3D density texture (rgba16float, only the R channel is used).
@group(0) @binding(3) var densityVolume: texture_storage_3d<rgba16float, write>;

/// Uniform parameters.
@group(0) @binding(4) var<uniform> params: DensityVolumeParams;

/// Computes the spatial hash key for a 3D cell coordinate.
///
/// Uses a two-level scheme:
///   1. Local cell = (cellCoord + blockSize/2) % blockSize  (wraps negatives)
///   2. Block ID   = (cellCoord + blockSize/2) / blockSize
///   3. Block hash  = dot(blockID, large_primes)
///   4. Final key   = local linear index + block hash
///
/// The blockSize of 50 means each block covers 50³ cells before wrapping.
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

/// Evaluates the Spiky² kernel: W(r, h) = (h − r)² × scale for r < h, else 0.
fn spikyPow2(dst: f32, radius: f32, scale: f32) -> f32 {
  if (dst < radius) {
    let v = radius - dst;
    return v * v * scale;
  }
  return 0.0;
}

/// Computes the total SPH density at a world-space position by querying
/// the spatial hash for neighboring particles within the smoothing radius.
///
/// Iterates over all 27 neighbor cells (3×3×3 grid centered on the
/// cell containing `worldPos`), walks the sorted key list for each cell,
/// and accumulates kernel contributions from particles within range.
fn densityAtPoint(worldPos: vec3<f32>) -> f32 {
  let radius = params.radius;
  let sqrRadius = radius * radius;

  // Determine the spatial hash cell for this position
  let cellX = i32(floor(worldPos.x / radius));
  let cellY = i32(floor(worldPos.y / radius));
  let cellZ = i32(floor(worldPos.z / radius));
  let count = u32(params.particleCount + 0.5); // Round to nearest u32

  var density = 0.0;

  // Iterate over the 3×3×3 neighborhood of hash cells
  for (var dz = -1; dz <= 1; dz++) {
    for (var dy = -1; dy <= 1; dy++) {
      for (var dx = -1; dx <= 1; dx++) {
        let hash = hashCell3D(cellX + dx, cellY + dy, cellZ + dz);
        let key = hash % count;
        let start = spatialOffsets[key];

        // Walk the sorted particle list for this hash key
        var j = start;
        loop {
          if (j >= count) {
            break;
          }
          let neighborKey = sortedKeys[j];
          if (neighborKey != key) {
            break; // Reached particles with a different key
          }

          // Distance check and kernel evaluation
          let neighborPos = predicted[j].xyz;
          let offset = neighborPos - worldPos;
          let sqrDst = dot(offset, offset);
          if (sqrDst <= sqrRadius) {
            density = density + spikyPow2(sqrt(sqrDst), radius, params.spikyPow2Scale);
          }
          j = j + 1u;
        }
      }
    }
  }

  return density;
}

/// Main entry point — one thread per voxel.
/// Converts voxel index to world position and writes the accumulated
/// density into the R channel of the 3D storage texture.
@compute @workgroup_size(8, 8, 4)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  // Bounds check: skip threads outside the volume
  if (id.x >= params.volumeSize.x || id.y >= params.volumeSize.y || id.z >= params.volumeSize.z) {
    return;
  }

  // Convert voxel index → normalized UVW [0, 1]³ → world position
  let volumeSizeF = vec3<f32>(params.volumeSize);
  let uvw = vec3<f32>(id) / max(volumeSizeF - vec3<f32>(1.0), vec3<f32>(1.0));
  let worldPos = (uvw - vec3<f32>(0.5)) * params.boundsSize;

  // Query spatial hash for density at this point
  let density = densityAtPoint(worldPos);

  // Write density to the R channel of the output texture
  textureStore(densityVolume, vec3<i32>(id), vec4<f32>(density, 0.0, 0.0, 1.0));
}
