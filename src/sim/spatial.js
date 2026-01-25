// Spatial hashing constants (match Unity compute shader).
const hashK1 = 15823
const hashK2 = 9737333

export const neighborOffsets = [
  [-1, 1],
  [0, 1],
  [1, 1],
  [-1, 0],
  [0, 0],
  [1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
]

export function hashCell2D(cellX, cellY) {
  const ax = Math.imul(cellX | 0, hashK1)
  const by = Math.imul(cellY | 0, hashK2)
  return (ax + by) >>> 0
}
