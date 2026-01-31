# Screen-Space Fluid Renderer Checklist

Base: copied from webgpu_particles. Add/replace items to match screen-space rendering.

## Simulation (reuse from particles)
- [ ] Particle simulation buffers (positions, velocities, densities, etc.)
- [ ] Compute pipelines for integration, neighbor search, pressure, viscosity
- [ ] Spawner/initialization + reset

## Rendering passes (new)
- [ ] Particle depth pass into depth/linear depth texture
- [ ] Thickness accumulation pass (additive blending)
- [ ] Normal reconstruction from depth (screen-space)
- [ ] Thickness smoothing (bilateral/gaussian; likely ping-pong)
- [ ] Shadow map pass (optional; shadow camera)
- [ ] Shadow smoothing pass (optional)
- [ ] Final composite (refraction + absorption + lighting)

## Resources & formats
- [ ] Choose render target sizes (full-res vs downsampled)
- [ ] Depth/linear depth texture format
- [ ] Thickness texture format (likely R16F/R32F)
- [ ] Normal texture format (RGB16F/10-10-10-2)
- [ ] Shadow map format
- [ ] Samplers (point/linear, compare sampler for shadow)

## Camera & matrices
- [ ] Main camera matrices (view/projection, inverse, clip-to-world)
- [ ] Shadow camera matrices (ortho) if used
- [ ] Screen-space reconstruction constants (proj params)

## Shaders
- [ ] Depth shader (particle -> depth)
- [ ] Thickness shader (particle -> thickness)
- [ ] Normal shader (depth -> normal)
- [ ] Smooth shader(s)
- [ ] Composite shader
- [ ] Shadow pass shader (if needed)

## Integration points
- [ ] Replace particle billboard renderer with screen-space pipeline
- [ ] Hook UI/params to screen-space settings
- [ ] Validation tools (debug view modes: depth/thickness/normal)

## Performance
- [ ] Downsample strategy for heavy passes
- [ ] Avoid unnecessary texture clears/copies
- [ ] Balance particle count vs pass resolution
