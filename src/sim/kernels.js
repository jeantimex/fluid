export function smoothingKernelPoly6(dst, radius, scale) {
  if (dst < radius) {
    const v = radius * radius - dst * dst
    return v * v * v * scale
  }
  return 0
}

export function spikyKernelPow3(dst, radius, scale) {
  if (dst < radius) {
    const v = radius - dst
    return v * v * v * scale
  }
  return 0
}

export function spikyKernelPow2(dst, radius, scale) {
  if (dst < radius) {
    const v = radius - dst
    return v * v * scale
  }
  return 0
}

export function derivativeSpikyPow3(dst, radius, scale) {
  if (dst <= radius) {
    const v = radius - dst
    return -v * v * scale
  }
  return 0
}

export function derivativeSpikyPow2(dst, radius, scale) {
  if (dst <= radius) {
    const v = radius - dst
    return -v * scale
  }
  return 0
}

export function buildGradientLut(keys, resolution) {
  const sorted = [...keys].sort((a, b) => a.t - b.t)
  const lut = new Array(resolution)
  for (let i = 0; i < resolution; i += 1) {
    const t = resolution === 1 ? 0 : i / (resolution - 1)
    let left = sorted[0]
    let right = sorted[sorted.length - 1]
    for (let k = 0; k < sorted.length - 1; k += 1) {
      const a = sorted[k]
      const b = sorted[k + 1]
      if (t >= a.t && t <= b.t) {
        left = a
        right = b
        break
      }
    }
    const span = right.t - left.t || 1
    const localT = (t - left.t) / span
    const r = left.r + (right.r - left.r) * localT
    const g = left.g + (right.g - left.g) * localT
    const b = left.b + (right.b - left.b) * localT
    lut[i] = { r, g, b }
  }
  return lut
}
