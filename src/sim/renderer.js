export function createRenderer(canvas, config, gradientLut) {
  const ctx = canvas.getContext('2d')
  let imageData = ctx.createImageData(canvas.width, canvas.height)
  let pixelBuffer = imageData.data
  let baseUnitsPerPixel = null
  let scale = canvas.width / config.boundsSize.x
  let originX = canvas.width * 0.5
  let originY = canvas.height * 0.5
  let stampRadius = -1
  let stampOffsets = []

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect()
    const nextWidth = Math.max(1, Math.round(rect.width))
    const nextHeight = Math.max(1, Math.round(rect.height))
    if (baseUnitsPerPixel === null) {
      const refWidth = Math.max(1, rect.width)
      baseUnitsPerPixel = config.boundsSize.x / refWidth
    }
    if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
      canvas.width = nextWidth
      canvas.height = nextHeight
      imageData = ctx.createImageData(canvas.width, canvas.height)
      pixelBuffer = imageData.data
    }

    // Preserve world-units-per-pixel so physics stays consistent.
    config.boundsSize = {
      x: canvas.width * baseUnitsPerPixel,
      y: canvas.height * baseUnitsPerPixel,
    }
    scale = canvas.width / config.boundsSize.x
    originX = canvas.width * 0.5
    originY = canvas.height * 0.5
  }

  function worldToCanvas(x, y) {
    return {
      x: originX + x * scale,
      y: originY - y * scale,
    }
  }

  function canvasToWorld(x, y) {
    return {
      x: (x - originX) / scale,
      y: (originY - y) / scale,
    }
  }

  function rebuildStamp() {
    const nextRadius = Math.max(1, Math.round(config.particleRadius))
    if (nextRadius === stampRadius) return
    stampRadius = nextRadius
    const offsets = []
    const r2 = stampRadius * stampRadius
    for (let oy = -stampRadius; oy <= stampRadius; oy += 1) {
      for (let ox = -stampRadius; ox <= stampRadius; ox += 1) {
        if (ox * ox + oy * oy <= r2) {
          offsets.push([ox, oy])
        }
      }
    }
    stampOffsets = offsets
  }

  function draw(state) {
    const width = canvas.width
    const height = canvas.height
    pixelBuffer.fill(0)

    const bg = [5, 7, 11]
    for (let i = 0; i < pixelBuffer.length; i += 4) {
      pixelBuffer[i] = bg[0]
      pixelBuffer[i + 1] = bg[1]
      pixelBuffer[i + 2] = bg[2]
      pixelBuffer[i + 3] = 255
    }

    const maxSpeed = config.velocityDisplayMax
    rebuildStamp()
    for (let i = 0; i < state.count; i += 1) {
      const x = state.positions[i * 2]
      const y = state.positions[i * 2 + 1]
      const p = worldToCanvas(x, y)
      const vx = state.velocities[i * 2]
      const vy = state.velocities[i * 2 + 1]
      const speed = Math.sqrt(vx * vx + vy * vy)
      const t = Math.max(0, Math.min(1, speed / maxSpeed))
      const idx = Math.min(
        gradientLut.length - 1,
        Math.floor(t * (gradientLut.length - 1))
      )
      const col = gradientLut[idx]
      const r = Math.round(col.r * 255)
      const g = Math.round(col.g * 255)
      const b = Math.round(col.b * 255)
      const px = Math.round(p.x)
      const py = Math.round(p.y)

      for (let j = 0; j < stampOffsets.length; j += 1) {
        const offset = stampOffsets[j]
        const yy = py + offset[1]
        if (yy < 0 || yy >= height) continue
        const xx = px + offset[0]
        if (xx < 0 || xx >= width) continue
        const pixelIndex = (yy * width + xx) * 4
        pixelBuffer[pixelIndex] = r
        pixelBuffer[pixelIndex + 1] = g
        pixelBuffer[pixelIndex + 2] = b
        pixelBuffer[pixelIndex + 3] = 255
      }
    }

    ctx.putImageData(imageData, 0, 0)

    const halfW = (config.boundsSize.x * scale) / 2
    const halfH = (config.boundsSize.y * scale) / 2
    ctx.strokeStyle = '#1b2432'
    ctx.lineWidth = 1
    ctx.strokeRect(originX - halfW, originY - halfH, halfW * 2, halfH * 2)
  }

  resizeCanvas()
  window.addEventListener('resize', resizeCanvas)

  return {
    draw,
    worldToCanvas,
    canvasToWorld,
    getScale: () => scale,
  }
}
