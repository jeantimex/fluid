# Whitewater System - Implementation Context

## Overview

Whitewater is the umbrella term for three types of diffuse particles that add realism to fluid simulations:

| Type | ID | Location | Behavior |
|------|-----|----------|----------|
| **Foam** | 1 | ON surface | Floats, follows surface flow |
| **Spray** | 2 | ABOVE surface | Airborne droplets, ballistic arcs |
| **Bubble** | 3 | BELOW surface | Rises with buoyancy |

---

## Current Implementation Status

### Completed Phases

| Phase | Description | Status |
|-------|-------------|--------|
| **Phase 1** | SDF (Signed Distance Field) | Done |
| **Phase 2** | Emission Potentials (Ita, Iwc, Ike) | Done |
| **Phase 3** | Particle Emission | Done |
| **Phase 4** | Type Classification | Done |
| **Phase 5** | Proper Physics per Type | Done |

### Next Phases

| Phase | Description | Status |
|-------|-------------|--------|
| **Phase 5.5** | SDF Surface Rendering (Marching Cubes) | Done (Basic) |
| **Phase 6** | Foam Preservation (density-based lifetime) | Pending |
| **Phase 7** | Particle Compaction | Pending |
| **Phase 8** | Whitewater Rendering | Pending |

---

## GPU Buffers

### Whitewater Particle Storage

```
whitewaterPosLifeBuffer: vec4<f32>[]
  - xyz: world position
  - w: lifetime (1.0 = full, 0.0 = dead)

whitewaterVelTypeBuffer: vec4<f32>[]
  - xyz: velocity
  - w: particle type (0=dead, 1=foam, 2=spray, 3=bubble)

whitewaterCountBuffer: atomic<u32>
  - Circular buffer counter for particle allocation
```

### Emission Potential Buffers

```
trappedAirPotentialBuffer: f32[]    // Ita - vorticity magnitude (bubble emission)
waveCrestPotentialBuffer: f32[]     // Iwc - velocity dot surface normal (spray emission)
kineticEnergyPotentialBuffer: f32[] // Ike - |velocity|^2 (energy multiplier)
surfaceSDFBuffer: f32[]             // Signed distance to fluid surface
```

---

## Shader Files

| File | Purpose |
|------|---------|
| `shaders/emission.wgsl` | Computes Ita, Iwc, Ike potentials |
| `shaders/whitewater.wgsl` | Emit, update, classify particles |

### Compute Kernels in whitewater.wgsl

1. **emitWhitewater** - Spawns particles based on emission potentials
2. **updateWhitewater** - Advects particles, applies physics per type
3. **classifyWhitewater** - Reclassifies type based on current SDF
4. **resetCount** - Resets particle counter each frame

---

## GUI Controls (lil-gui)

Located in `ui/gui.ts`, under "Whitewater" folder:

| Control | Property | Range | Default |
|---------|----------|-------|---------|
| Show Whitewater | `showWhitewater` | boolean | true |
| Foam Size | `foamSize` | 0.01 - 0.3 | 0.08 |
| Spray Size | `spraySize` | 0.01 - 0.2 | 0.04 |
| Bubble Size | `bubbleSize` | 0.01 - 0.2 | 0.05 |

Access via `simConfig.foamSize`, `simConfig.spraySize`, `simConfig.bubbleSize`.

---

## Phase 5: Proper Physics per Type (IMPLEMENTED)

Physics constants defined in `whitewater.wgsl`:
```wgsl
const SPRAY_DRAG: f32 = 0.3;
const SPRAY_DRAG_VARIANCE: f32 = 0.25;
const SPRAY_RESTITUTION: f32 = 0.3;
const SPRAY_FRICTION: f32 = 0.5;
const BUBBLE_BUOYANCY: f32 = 2.0;
const BUBBLE_DRAG: f32 = 2.0;
const FOAM_ADVECTION: f32 = 0.9;
const FOAM_DAMPING: f32 = 0.98;
```

### 5.1 Spray Physics (Implemented)
- Full gravity
- Per-particle drag variation (based on particle index)
- Ground collision with restitution and friction

### 5.2 Bubble Physics (Implemented)
- Samples fluid velocity via `sampleFluidVelocity()`
- Buoyancy force (opposes gravity)
- Drag toward fluid velocity (follows underwater currents)

### 5.3 Foam Physics (Implemented)
- Samples fluid velocity via `sampleFluidVelocity()`
- Blends toward fluid velocity (follows surface currents)
- Velocity damping
- Surface tracking using SDF gradient (nudges foam toward surface)

---

## Phase 5.5: SDF Surface Rendering (NEW)

Switch main fluid rendering from particles to smooth mesh surface using SDF + Marching Cubes.

### Current: Particle Rendering
- Each fluid particle rendered as a small sphere
- Instanced rendering via `GBufferPass`
- Looks like balls/blobs, not smooth water

### Target: Surface Rendering (like Blender FLIP Fluids)
- Compute SDF from particle positions
- Extract mesh using Marching Cubes algorithm
- Render smooth, continuous water surface

### Implementation Steps

#### 5.5.1 Particle-to-SDF Conversion
```
For each grid cell:
  1. Find nearby particles (within kernel radius)
  2. Compute density contribution from each particle
  3. Convert density to signed distance
  4. Smooth/filter the SDF
```

#### 5.5.2 Marching Cubes Mesh Extraction
```
For each grid cell:
  1. Sample SDF at 8 corners
  2. Determine cube configuration (256 cases)
  3. Generate triangles using lookup table
  4. Compute normals from SDF gradient
```

#### 5.5.3 Mesh Rendering
```
1. Vertex buffer with extracted triangles
2. Normal buffer (or compute from SDF gradient)
3. Render with existing deferred pipeline
4. Add water-specific shading (refraction, fresnel, etc.)
```

### GPU Buffers Needed
- `fluidSDFBuffer`: f32[] - SDF values at grid cells
- `meshVertexBuffer`: vec4<f32>[] - extracted triangle vertices
- `meshNormalBuffer`: vec4<f32>[] - vertex normals
- `meshIndexBuffer`: u32[] - triangle indices (or use non-indexed)
- `meshCountBuffer`: atomic<u32> - number of triangles generated

### GUI Toggle
- `simConfig.useSurfaceRendering`: boolean - switch between particle/surface rendering

### Files Created
- `shaders/surface_field.wgsl` - Particle-to-scalar-field compute shader
- `shaders/marching_cubes.wgsl` - Marching cubes mesh extraction
- `surface_renderer.ts` - SurfaceRenderer class encapsulating surface rendering

### Current Limitations
- Grid-centric field computation (O(particles * field_vertices)) - slow for many particles
- No spatial hashing for particle lookup
- Basic water shading (could add refraction, caustics)
- Surface may need tuning of kernelRadius and surfaceLevel

---

## Phase 8: Whitewater Rendering (Missing)

**Current state**: No render pass exists for whitewater particles.

**Needed**: `WhitewaterRenderPass` that:
1. Reads `whitewaterPosLifeBuffer` and `whitewaterVelTypeBuffer`
2. Renders particles with type-specific appearance:
   - **Foam**: Flat surface-aligned quads, white, opaque
   - **Spray**: Small bright white points
   - **Bubble**: Small translucent spheres, blue tint
3. Uses `simConfig.foamSize/spraySize/bubbleSize` for sizing
4. Uses instanced rendering for performance

### Rendering Considerations

```
Foam:   size = simConfig.foamSize,  color = white,      opacity = 0.9
Spray:  size = simConfig.spraySize, color = white,      opacity = 0.7
Bubble: size = simConfig.bubbleSize, color = light blue, opacity = 0.5
```

Could use:
- Point sprites with size attenuation
- Instanced billboards
- Screen-space rendering for foam

---

## Key Files

| File | Description |
|------|-------------|
| `main.ts` | Entry point, simulation loop, simConfig |
| `simulator.ts` | GPU simulation driver, buffer management |
| `ui/gui.ts` | lil-gui setup, SimulationGuiConfig interface |
| `shaders/whitewater.wgsl` | Emit/update/classify compute kernels |
| `shaders/emission.wgsl` | Emission potential compute kernels |
| `plan.md` | Full implementation plan with code examples |

---

## Diagnostic Output

The simulation outputs diagnostic info every 60 frames including:
- Emission potential ranges (Ita, Iwc, Ike)
- Whitewater particle counts by type (foam/spray/bubble/dead)
- Buffer wrap status (circular buffer)

---

## References

- Blender FLIP Fluids: `ref/Blender-FLIP-Fluids/src/engine/diffuseparticlesimulation.cpp`
- Paper: "Unified Spray, Foam and Bubbles for Particle-Based Fluids" (Ihmsen et al.)
