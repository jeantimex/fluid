/**
 * Spatial hashing utilities for efficient neighbor queries.
 *
 * In SPH simulations, each particle must find all neighbors within its
 * smoothing radius. Naive O(n²) search is too slow for real-time simulation.
 *
 * Spatial hashing divides space into a grid of cells, where each cell has
 * size equal to the smoothing radius. To find neighbors, we only need to
 * check the particle's own cell and the 8 adjacent cells (9 cells total).
 *
 * The hash function maps 2D cell coordinates to a 1D index, allowing us to
 * use a simple array for storage. Collisions are acceptable because we
 * verify actual distances during the neighbor search.
 *
 * This reduces neighbor search from O(n²) to approximately O(n·k) where k
 * is the average number of particles per cell neighborhood (~50-100).
 */

/**
 * Hash function constants (matching Unity compute shader implementation).
 * These are large primes that provide good distribution of hash values
 * and minimize clustering/collisions in the hash table.
 */
const hashK1 = 15823;
const hashK2 = 9737333;

/**
 * Relative offsets to check all 9 neighboring cells (including self).
 *
 * When searching for neighbors, we need to check:
 * - The particle's own cell (0, 0)
 * - All 8 adjacent cells (Moore neighborhood)
 *
 * This ensures we don't miss any particles that might be close to the
 * cell boundary but within the smoothing radius.
 *
 * Layout:
 *   [-1,1]  [0,1]  [1,1]
 *   [-1,0]  [0,0]  [1,0]
 *   [-1,-1] [0,-1] [1,-1]
 */
export const neighborOffsets: [number, number][] = [
  [-1, 1],
  [0, 1],
  [1, 1],
  [-1, 0],
  [0, 0],
  [1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
];

/**
 * Computes a spatial hash for a 2D cell coordinate.
 *
 * This function maps integer cell coordinates to a pseudo-random 32-bit
 * unsigned integer. The hash should:
 * - Distribute evenly across the output range
 * - Minimize collisions for nearby cells
 * - Be fast to compute
 *
 * The implementation uses a simple linear combination with large prime
 * multipliers, followed by unsigned conversion.
 *
 * @param cellX - X coordinate of the grid cell (integer)
 * @param cellY - Y coordinate of the grid cell (integer)
 * @returns Unsigned 32-bit hash value
 *
 * @example
 * // Get hash for cell at grid position (3, 5)
 * const hash = hashCell2D(3, 5)
 * // Use modulo to map to hash table: const index = hash % tableSize
 */
export function hashCell2D(cellX: number, cellY: number): number {
  // Convert to 32-bit integers and multiply by prime constants
  const ax = Math.imul(cellX | 0, hashK1);
  const by = Math.imul(cellY | 0, hashK2);

  // Combine and convert to unsigned 32-bit integer
  // The >>> 0 operation ensures the result is treated as unsigned
  return (ax + by) >>> 0;
}
