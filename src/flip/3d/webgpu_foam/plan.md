# Whitewater (Diffuse Particle) System - Implementation Plan

## Overview

This document outlines the implementation plan for porting Blender FLIP Fluids' diffuse particle
system (foam, bubbles, spray) to our WebGPU FLIP simulator. The goal is to achieve realistic
whitewater effects while maintaining real-time performance.

## Reference Implementation

- Blender FLIP Fluids: `ref/Blender-FLIP-Fluids/src/engine/diffuseparticlesimulation.cpp`
- Original Paper: "Unified Spray, Foam and Bubbles for Particle-Based Fluids" (Ihmsen et al.)

---

## Existing Infrastructure (What We Can Reuse)

Our codebase already has significant infrastructure that reduces implementation effort:

### From `flip_simulation.wgsl`

| Function                | Purpose                                          | Reuse For                       |
| ----------------------- | ------------------------------------------------ | ------------------------------- |
| `sampleVelocity(pos)`   | Trilinear velocity interpolation (MAC-staggered) | Bubble drag, foam advection     |
| `sampleXVelocity/Y/Z()` | Per-component velocity sampling                  | Curl computation for turbulence |
| `worldToGrid(pos)`      | World → grid coordinate conversion               | All grid lookups                |
| `kernel(v)`, `h(r)`     | Trilinear interpolation weights                  | SDF interpolation               |
| `clampToGrid()`         | Boundary clamping                                | Safe grid access                |

### From `simulator.ts`

| Resource                   | Status                  | Notes                                 |
| -------------------------- | ----------------------- | ------------------------------------- |
| `gridMarkerBuffer`         | Bound to whitewater     | Can use for basic inside/outside test |
| `gridVelocityFloatBuffer`  | Bound to whitewater     | Velocity field access ready           |
| `diffuseParticlesBuffer`   | Created (100k capacity) | Particle storage ready                |
| `diffuseCountBuffer`       | Created                 | Atomic counter ready                  |
| `emitWhitewaterPipeline`   | Created                 | Just needs better logic               |
| `updateWhitewaterPipeline` | Created                 | Just needs better physics             |

### From `whitewater.wgsl`

| Function           | Status  | Notes                              |
| ------------------ | ------- | ---------------------------------- |
| `hash()`, `rand()` | Working | PCG random number generation       |
| `emit()`           | Basic   | Needs energy/turbulence potentials |
| `update()`         | Basic   | Needs proper physics per type      |

### From `whitewater_render.wgsl`

| Feature             | Status                              |
| ------------------- | ----------------------------------- |
| Billboard rendering | Working                             |
| Lifetime-based fade | Working                             |
| Type-based sizing   | Basic (needs color differentiation) |

---

## Current State vs. Target

| Feature             | Current          | Target                                     |
| ------------------- | ---------------- | ------------------------------------------ |
| Emission criteria   | Speed-based only | Energy + Wavecrest + Turbulence potentials |
| Type classification | Y-threshold      | SDF-based (inside/surface/above)           |
| Spray physics       | Gravity only     | Gravity + air drag + collision             |
| Bubble physics      | Simple buoyancy  | Buoyancy + drag toward fluid velocity      |
| Foam physics        | Simple advection | Surface-clamped advection                  |
| Foam preservation   | None             | Density-based lifetime extension           |
| Surface detection   | None             | Signed Distance Field (SDF)                |

---

## Implementation Phases

### Phase 1: Copy Velocity Sampling to Whitewater Shader

**Priority: HIGH | Effort: 30 minutes | Unlocks: Phase 2, 4, 5**

Copy the velocity sampling functions from `flip_simulation.wgsl` to `whitewater.wgsl` so diffuse particles can sample the fluid velocity field.

#### 1.1 Add Shared Utilities to `whitewater.wgsl`

Copy these functions from `flip_simulation.wgsl`:

- `worldToGrid()`
- `sampleXVelocity()`, `sampleYVelocity()`, `sampleZVelocity()`
- `sampleVelocity()`

```wgsl
// Add after the existing helper functions in whitewater.wgsl

fn worldToGrid(p: vec3<f32>) -> vec3<f32> {
  return p * vec3<f32>(f32(uniforms.nx) / uniforms.width,
                       f32(uniforms.ny) / uniforms.height,
                       f32(uniforms.nz) / uniforms.depth);
}

fn velIdx(i: u32, j: u32, k: u32) -> u32 {
  return i + j * (uniforms.nx + 1u) + k * (uniforms.nx + 1u) * (uniforms.ny + 1u);
}

fn sampleXVelocity(g: vec3<f32>) -> f32 {
  let p = vec3<f32>(g.x, g.y - 0.5, g.z - 0.5);
  let base = vec3<i32>(i32(floor(p.x)), i32(floor(p.y)), i32(floor(p.z)));
  let f = p - vec3<f32>(f32(base.x), f32(base.y), f32(base.z));

  var v = 0.0;
  for (var di = 0; di <= 1; di++) {
    for (var dj = 0; dj <= 1; dj++) {
      for (var dk = 0; dk <= 1; dk++) {
        let w = select(1.0 - f.x, f.x, di == 1) *
                select(1.0 - f.y, f.y, dj == 1) *
                select(1.0 - f.z, f.z, dk == 1);
        let ix = u32(clamp(base.x + di, 0, i32(uniforms.nx)));
        let iy = u32(clamp(base.y + dj, 0, i32(uniforms.ny)));
        let iz = u32(clamp(base.z + dk, 0, i32(uniforms.nz)));
        v += w * gridVel[velIdx(ix, iy, iz)].x;
      }
    }
  }
  return v;
}

// Similar for sampleYVelocity, sampleZVelocity...

fn sampleFluidVelocity(pos: vec3<f32>) -> vec3<f32> {
  let g = worldToGrid(pos);
  return vec3<f32>(sampleXVelocity(g), sampleYVelocity(g), sampleZVelocity(g));
}
```

#### 1.2 Update Bubble Physics to Use Fluid Velocity

```wgsl
// In update() function, replace bubble physics:
} else if (dp.particleKind == 2.0) { // Bubble
    let vFluid = sampleFluidVelocity(dp.position);
    let buoyancy = vec3<f32>(0.0, uniforms.gravity * 0.5, 0.0); // Rise up
    let drag = 1.0 * (vFluid - dp.velocity);
    dp.velocity += (buoyancy + drag) * uniforms.dt;
    dp.position += dp.velocity * uniforms.dt;
}
```

#### Expected Result After Phase 1

- Bubbles now move WITH the fluid currents, not just straight up
- Bubbles in swirling water will spiral and follow the flow
- More natural-looking bubble behavior in turbulent regions
- **Visual test**: Drop particles in swirling water, bubbles should follow vortices

---

### Phase 2: Marker-Based Type Classification

**Priority: HIGH | Effort: 1 hour | Unlocks: Better type transitions**

Use the existing `marker` buffer to determine if a particle is inside fluid or in air.

#### 2.1 Add Marker Sampling Function

```wgsl
fn markerIdx(i: u32, j: u32, k: u32) -> u32 {
  return i + j * uniforms.nx + k * uniforms.nx * uniforms.ny;
}

fn isInsideFluid(pos: vec3<f32>) -> bool {
  let g = worldToGrid(pos);
  let i = u32(clamp(i32(g.x), 0, i32(uniforms.nx) - 1));
  let j = u32(clamp(i32(g.y), 0, i32(uniforms.ny) - 1));
  let k = u32(clamp(i32(g.z), 0, i32(uniforms.nz) - 1));
  return marker[markerIdx(i, j, k)] == 1u;
}

// Check if position is near the surface (fluid cell neighboring air)
fn isNearSurface(pos: vec3<f32>) -> bool {
  let g = worldToGrid(pos);
  let i = i32(g.x);
  let j = i32(g.y);
  let k = i32(g.z);

  // Check if this is a fluid cell with at least one air neighbor
  if (!isInsideFluid(pos)) { return false; }

  // Check 6-neighbors for air
  for (var di = -1; di <= 1; di++) {
    for (var dj = -1; dj <= 1; dj++) {
      for (var dk = -1; dk <= 1; dk++) {
        if (abs(di) + abs(dj) + abs(dk) != 1) { continue; } // Only face neighbors
        let ni = u32(clamp(i + di, 0, i32(uniforms.nx) - 1));
        let nj = u32(clamp(j + dj, 0, i32(uniforms.ny) - 1));
        let nk = u32(clamp(k + dk, 0, i32(uniforms.nz) - 1));
        if (marker[markerIdx(ni, nj, nk)] == 0u) {
          return true; // Has air neighbor = near surface
        }
      }
    }
  }
  return false;
}
```

#### 2.2 Update Type Classification in `update()`

```wgsl
// Reclassify particle type each frame
let inside = isInsideFluid(dp.position);
let nearSurface = isNearSurface(dp.position);

var newType = dp.particleKind;
if (!inside) {
    newType = 0.0; // Spray (in air)
} else if (nearSurface) {
    newType = 1.0; // Foam (at surface)
} else {
    newType = 2.0; // Bubble (deep inside)
}

// When transitioning from bubble to foam/spray, inherit fluid velocity
if (dp.particleKind == 2.0 && newType != 2.0) {
    dp.velocity = sampleFluidVelocity(dp.position);
}

dp.particleKind = newType;
```

#### Expected Result After Phase 2

- Particles automatically change type based on position:
  - Deep underwater → Bubble (rises)
  - At water surface → Foam (floats)
  - Above water → Spray (falls)
- Bubbles that reach the surface become foam
- Spray that lands on water becomes foam
- **Visual test**: Emit particles underwater, watch them rise as bubbles, become foam at surface

---

### Phase 3: Improved Emission with Energy Potential

**Priority: HIGH | Effort: 1-2 hours**

Add proper energy-based emission so particles spawn from high-energy regions.

#### 3.1 Add Emission Parameters to Uniforms

Update `simulator.ts` uniform buffer (extend existing whitewater section):

```typescript
// In updateUniforms(), add after existing whitewater params:
f32[32] = 0.1; // minEnergy
f32[33] = 60.0; // maxEnergy
f32[34] = 100.0; // minTurbulence
f32[35] = 200.0; // maxTurbulence
```

Update uniform struct in `whitewater.wgsl`:

```wgsl
struct Uniforms {
  // ... existing fields ...
  minEnergy: f32,
  maxEnergy: f32,
  minTurbulence: f32,
  maxTurbulence: f32,
};
```

#### 3.2 Compute Energy Potential

```wgsl
fn computeEnergyPotential(vel: vec3<f32>) -> f32 {
  let energy = 0.5 * dot(vel, vel);
  let clamped = clamp(energy, uniforms.minEnergy, uniforms.maxEnergy);
  return (clamped - uniforms.minEnergy) / (uniforms.maxEnergy - uniforms.minEnergy);
}
```

#### 3.3 Update Emission Logic

```wgsl
@compute @workgroup_size(64)
fn emit(@builtin(global_invocation_id) id: vec3<u32>) {
    let pIdx = id.x;
    if (pIdx >= uniforms.particleCount) { return; }

    let pos = liquidPositions[pIdx].xyz;
    let vel = liquidVelocities[pIdx].xyz;

    // 1. Energy Potential (0 to 1)
    let Ie = computeEnergyPotential(vel);
    if (Ie < 0.01) { return; } // Skip low-energy particles

    // 2. Check if near surface (only emit from surface regions)
    let nearSurface = isNearSurface(pos);
    let inside = isInsideFluid(pos);

    // Surface particles: emit based on energy (wavecrest-like)
    // Inside particles: emit based on energy (turbulence-like)
    var emissionStrength = Ie;
    if (nearSurface) {
        emissionStrength *= 2.0; // Boost surface emission
    } else if (!inside) {
        return; // Don't emit from air
    }

    // 3. Probabilistic emission
    let numToEmit = emissionStrength * uniforms.emissionRate * uniforms.dt;
    let seed = pIdx + u32(uniforms.frameNumber) * 12345u;

    if (rand(seed) < fract(numToEmit)) {
        let writeIdx = atomicAdd(&diffuseCount, 1u);
        if (writeIdx >= uniforms.maxDiffuseParticles) { return; }

        var dp: DiffuseParticle;
        let jitter = (vec3<f32>(rand(seed+1u), rand(seed+2u), rand(seed+3u)) - 0.5) * 0.05;
        dp.position = pos + jitter;
        dp.velocity = vel * mix(1.0, 1.3, rand(seed+4u));
        dp.lifetime = mix(uniforms.minLifetime, uniforms.maxLifetime, rand(seed+5u));

        // Initial type
        if (!inside) {
            dp.particleKind = 0.0; // Spray
        } else if (nearSurface) {
            dp.particleKind = 1.0; // Foam
        } else {
            dp.particleKind = 2.0; // Bubble
        }

        diffuseParticles[writeIdx] = dp;
    }
}
```

#### Expected Result After Phase 3

- More particles spawn from splashes and impacts (high energy)
- Fewer particles spawn from calm water
- Particles spawn at the surface (foam) and inside turbulent regions (bubbles)
- Wave crests produce more whitewater
- **Visual test**: Stir the water - more foam/spray where you stir, calm areas stay clean

---

### Phase 4: Proper Physics Per Type

**Priority: MEDIUM | Effort: 1 hour**

Implement accurate physics for each particle type.

#### 4.1 Add Physics Parameters

```wgsl
// Constants (can move to uniforms later for tweaking)
const SPRAY_DRAG: f32 = 0.1;
const SPRAY_GRAVITY_SCALE: f32 = 1.0;
const BUBBLE_BUOYANCY: f32 = 4.0;
const BUBBLE_DRAG: f32 = 1.0;
const FOAM_ADVECTION_STRENGTH: f32 = 0.8;
```

#### 4.2 Implement Type-Specific Physics

```wgsl
@compute @workgroup_size(64)
fn update(@builtin(global_invocation_id) id: vec3<u32>) {
    let pIdx = id.x;
    let count = atomicLoad(&diffuseCount);
    if (pIdx >= count) { return; }

    var dp = diffuseParticles[pIdx];
    if (dp.lifetime <= 0.0) { return; }

    // Decrease lifetime
    dp.lifetime -= uniforms.dt;

    // Reclassify type (from Phase 2)
    let inside = isInsideFluid(dp.position);
    let nearSurface = isNearSurface(dp.position);

    // Type transition logic
    if (!inside) {
        dp.particleKind = 0.0; // Spray
    } else if (nearSurface) {
        // Transition to foam, inherit fluid velocity
        if (dp.particleKind != 1.0) {
            dp.velocity = sampleFluidVelocity(dp.position);
        }
        dp.particleKind = 1.0; // Foam
    } else {
        dp.particleKind = 2.0; // Bubble
    }

    // Apply physics based on type
    let gravity = vec3<f32>(0.0, -uniforms.gravity, 0.0);

    if (dp.particleKind == 0.0) {
        // === SPRAY ===
        // Ballistic motion with air drag
        let drag = -SPRAY_DRAG * dp.velocity;
        dp.velocity += (gravity * SPRAY_GRAVITY_SCALE + drag) * uniforms.dt;
        dp.position += dp.velocity * uniforms.dt;

    } else if (dp.particleKind == 1.0) {
        // === FOAM ===
        // Follow fluid surface velocity
        let vFluid = sampleFluidVelocity(dp.position);
        dp.velocity = FOAM_ADVECTION_STRENGTH * vFluid;
        dp.position += dp.velocity * uniforms.dt;

    } else if (dp.particleKind == 2.0) {
        // === BUBBLE ===
        // Buoyancy (rise) + drag toward fluid velocity
        let vFluid = sampleFluidVelocity(dp.position);
        let buoyancy = -BUBBLE_BUOYANCY * gravity; // Upward force
        let drag = BUBBLE_DRAG * (vFluid - dp.velocity);
        dp.velocity += (buoyancy + drag) * uniforms.dt;
        dp.position += dp.velocity * uniforms.dt;
    }

    // Boundary clamping
    dp.position = clamp(dp.position,
                        vec3<f32>(0.01),
                        vec3<f32>(uniforms.width, uniforms.height, uniforms.depth) - 0.01);

    diffuseParticles[pIdx] = dp;
}
```

#### Expected Result After Phase 4

- **Spray**: Falls in arcs, affected by gravity and air drag
- **Foam**: Slides along the water surface following fluid flow
- **Bubbles**: Rise up while being pushed by underwater currents
- Particles transition smoothly between types
- **Visual test**:
  - Spray should arc like thrown water droplets
  - Foam should collect and drift on the surface
  - Bubbles should rise in spirals in swirling water

---

### Phase 5: Surface SDF for Accurate Classification

**Priority: MEDIUM | Effort: 2-3 hours | Significant quality improvement**

Replace the binary marker-based classification with a smooth signed distance field.

#### 5.1 Add SDF Buffer

**File: `simulator.ts`**

```typescript
// Add new buffer
surfaceSDFBuffer: GPUBuffer;

// In constructor:
this.surfaceSDFBuffer = createBuffer(scalarGridCount * 4); // f32 per cell

// Add to whitewater bind group
```

#### 5.2 Create SDF Initialization Shader

**File: `shaders/sdf.wgsl`** (new file)

```wgsl
// Initialize SDF from marker grid
@compute @workgroup_size(8, 4, 4)
fn initSDF(@builtin(global_invocation_id) id: vec3<u32>) {
    if (id.x >= uniforms.nx || id.y >= uniforms.ny || id.z >= uniforms.nz) { return; }

    let idx = id.x + id.y * uniforms.nx + id.z * uniforms.nx * uniforms.ny;
    let dx = uniforms.width / f32(uniforms.nx);

    if (marker[idx] == 1u) {
        sdf[idx] = -0.5 * dx; // Inside fluid (negative)
    } else {
        sdf[idx] = 0.5 * dx;  // Outside fluid (positive)
    }
}

// Simple distance propagation (run 4-8 times)
@compute @workgroup_size(8, 4, 4)
fn propagateSDF(@builtin(global_invocation_id) id: vec3<u32>) {
    if (id.x >= uniforms.nx || id.y >= uniforms.ny || id.z >= uniforms.nz) { return; }

    let idx = id.x + id.y * uniforms.nx + id.z * uniforms.nx * uniforms.ny;
    let dx = uniforms.width / f32(uniforms.nx);

    var minDist = sdf[idx];
    let sign = select(1.0, -1.0, minDist < 0.0);

    // Check 6 neighbors
    let offsets = array<vec3<i32>, 6>(
        vec3<i32>(1, 0, 0), vec3<i32>(-1, 0, 0),
        vec3<i32>(0, 1, 0), vec3<i32>(0, -1, 0),
        vec3<i32>(0, 0, 1), vec3<i32>(0, 0, -1)
    );

    for (var i = 0; i < 6; i++) {
        let ni = i32(id.x) + offsets[i].x;
        let nj = i32(id.y) + offsets[i].y;
        let nk = i32(id.z) + offsets[i].z;

        if (ni >= 0 && ni < i32(uniforms.nx) &&
            nj >= 0 && nj < i32(uniforms.ny) &&
            nk >= 0 && nk < i32(uniforms.nz)) {
            let nidx = u32(ni) + u32(nj) * uniforms.nx + u32(nk) * uniforms.nx * uniforms.ny;
            let neighborDist = sdf[nidx];

            // Propagate: if neighbor is closer to surface, update
            let propagated = neighborDist + sign * dx;
            if (abs(propagated) < abs(minDist)) {
                minDist = propagated;
            }
        }
    }

    sdf[idx] = minDist;
}
```

#### 5.3 Add SDF Sampling to Whitewater

```wgsl
fn sampleSDF(pos: vec3<f32>) -> f32 {
    let g = worldToGrid(pos);
    let i = u32(clamp(i32(g.x), 0, i32(uniforms.nx) - 1));
    let j = u32(clamp(i32(g.y), 0, i32(uniforms.ny) - 1));
    let k = u32(clamp(i32(g.z), 0, i32(uniforms.nz) - 1));
    return sdf[i + j * uniforms.nx + k * uniforms.nx * uniforms.ny];
}

// Improved type classification using SDF
fn classifyParticleType(pos: vec3<f32>) -> f32 {
    let dist = sampleSDF(pos);
    let dx = uniforms.width / f32(uniforms.nx);
    let foamThickness = dx * 1.5;

    if (dist > foamThickness) {
        return 0.0; // Spray (above surface)
    } else if (dist > -foamThickness) {
        return 1.0; // Foam (at surface)
    } else {
        return 2.0; // Bubble (inside fluid)
    }
}
```

#### 5.4 Add to Simulation Loop

```typescript
// In step(), after markCells:
pass.setPipeline(this.initSDFPipeline);
pass.dispatchWorkgroups(scalarGridWG[0], scalarGridWG[1], scalarGridWG[2]);

// Propagate 4 times
for (let i = 0; i < 4; i++) {
  pass.setPipeline(this.propagateSDFPipeline);
  pass.dispatchWorkgroups(scalarGridWG[0], scalarGridWG[1], scalarGridWG[2]);
}
```

#### Expected Result After Phase 5

- Smooth particle type transitions (no flickering)
- Foam layer has consistent thickness around water surface
- Better handling of splashing water (spray → foam transition)
- Particles correctly classified even in thin sheets of water
- **Visual test**:
  - Foam should form a consistent layer on the water surface
  - No particles randomly switching types frame-to-frame
  - Thin splashes should have foam on their surfaces

---

### Phase 6: Turbulence Field for Better Emission

**Priority: LOW-MEDIUM | Effort: 2 hours | Improves emission realism**

Compute the curl (vorticity) of the velocity field to emit particles from churning water.

#### 6.1 Add Turbulence Buffer

```typescript
turbulenceBuffer: GPUBuffer;
// In constructor:
this.turbulenceBuffer = createBuffer(scalarGridCount * 4);
```

#### 6.2 Compute Turbulence Shader

**File: `shaders/turbulence.wgsl`** (new file)

```wgsl
@compute @workgroup_size(8, 4, 4)
fn computeTurbulence(@builtin(global_invocation_id) id: vec3<u32>) {
    if (id.x >= uniforms.nx || id.y >= uniforms.ny || id.z >= uniforms.nz) { return; }

    let idx = id.x + id.y * uniforms.nx + id.z * uniforms.nx * uniforms.ny;

    // Only compute for fluid cells
    if (marker[idx] == 0u) {
        turbulence[idx] = 0.0;
        return;
    }

    let i = i32(id.x);
    let j = i32(id.y);
    let k = i32(id.z);

    // Sample velocities at neighbors for curl computation
    let g = vec3<f32>(f32(i) + 0.5, f32(j) + 0.5, f32(k) + 0.5);

    let vxp = sampleVelocityAtGrid(g + vec3<f32>(1.0, 0.0, 0.0));
    let vxm = sampleVelocityAtGrid(g - vec3<f32>(1.0, 0.0, 0.0));
    let vyp = sampleVelocityAtGrid(g + vec3<f32>(0.0, 1.0, 0.0));
    let vym = sampleVelocityAtGrid(g - vec3<f32>(0.0, 1.0, 0.0));
    let vzp = sampleVelocityAtGrid(g + vec3<f32>(0.0, 0.0, 1.0));
    let vzm = sampleVelocityAtGrid(g - vec3<f32>(0.0, 0.0, 1.0));

    // Curl = nabla x v
    let curl = vec3<f32>(
        (vyp.z - vym.z) - (vzp.y - vzm.y),
        (vzp.x - vzm.x) - (vxp.z - vxm.z),
        (vxp.y - vxm.y) - (vyp.x - vym.x)
    ) * 0.5;

    turbulence[idx] = length(curl);
}
```

#### 6.3 Use Turbulence in Emission

```wgsl
fn sampleTurbulence(pos: vec3<f32>) -> f32 {
    let g = worldToGrid(pos);
    let i = u32(clamp(i32(g.x), 0, i32(uniforms.nx) - 1));
    let j = u32(clamp(i32(g.y), 0, i32(uniforms.ny) - 1));
    let k = u32(clamp(i32(g.z), 0, i32(uniforms.nz) - 1));
    return turbulence[i + j * uniforms.nx + k * uniforms.nx * uniforms.ny];
}

// In emit():
let turb = sampleTurbulence(pos);
let It = saturate((turb - uniforms.minTurbulence) /
                  (uniforms.maxTurbulence - uniforms.minTurbulence));

// Combine with energy potential
let emissionStrength = Ie * (1.0 + It * 2.0); // Boost emission in turbulent areas
```

#### Expected Result After Phase 6

- More particles spawn in churning/swirling water
- Waterfalls and impacts create dense bubble clouds
- Calm water produces very few particles
- Vortices generate visible bubble trails
- **Visual test**:
  - Stir water in circles → bubbles form in the vortex center
  - Water falling from height → dense foam at impact point
  - Quiet pool → almost no particle emission

---

### Phase 7: Foam Preservation

**Priority: LOW | Effort: 1-2 hours | Visual polish**

Keep foam clumped together by extending lifetime based on local density.

#### 7.1 Add Density Counting Pass

```wgsl
// First pass: count foam particles per cell
@compute @workgroup_size(64)
fn countFoamDensity(@builtin(global_invocation_id) id: vec3<u32>) {
    let pIdx = id.x;
    if (pIdx >= atomicLoad(&diffuseCount)) { return; }

    let dp = diffuseParticles[pIdx];
    if (dp.particleKind != 1.0 || dp.lifetime <= 0.0) { return; }

    let g = worldToGrid(dp.position);
    let i = u32(clamp(i32(g.x), 0, i32(uniforms.nx) - 1));
    let j = u32(clamp(i32(g.y), 0, i32(uniforms.ny) - 1));
    let k = u32(clamp(i32(g.z), 0, i32(uniforms.nz) - 1));
    let idx = i + j * uniforms.nx + k * uniforms.nx * uniforms.ny;

    atomicAdd(&foamDensity[idx], 1u);
}

// Second pass: extend lifetime based on density
@compute @workgroup_size(64)
fn applyFoamPreservation(@builtin(global_invocation_id) id: vec3<u32>) {
    let pIdx = id.x;
    if (pIdx >= atomicLoad(&diffuseCount)) { return; }

    var dp = diffuseParticles[pIdx];
    if (dp.particleKind != 1.0 || dp.lifetime <= 0.0) { return; }

    let g = worldToGrid(dp.position);
    let i = u32(clamp(i32(g.x), 0, i32(uniforms.nx) - 1));
    let j = u32(clamp(i32(g.y), 0, i32(uniforms.ny) - 1));
    let k = u32(clamp(i32(g.z), 0, i32(uniforms.nz) - 1));
    let idx = i + j * uniforms.nx + k * uniforms.nx * uniforms.ny;

    let density = f32(foamDensity[idx]);
    let minDensity = 5.0;
    let maxDensity = 30.0;
    let preservationRate = 0.75;

    let d = saturate((density - minDensity) / (maxDensity - minDensity));
    dp.lifetime += preservationRate * d * uniforms.dt;

    diffuseParticles[pIdx] = dp;
}
```

#### Expected Result After Phase 7

- Foam forms visible clumps and streaks
- Isolated foam particles fade quickly
- Dense foam patches persist longer (like real sea foam)
- Natural-looking foam patterns on water surface
- **Visual test**:
  - After stirring, foam should collect into streaks
  - Individual foam particles fade, clusters persist
  - Foam looks like realistic "suds" on water

---

### Phase 8: Particle Cleanup (Compaction)

**Priority: LOW | Effort: 1-2 hours | Performance**

Remove dead particles to maintain performance.

#### 8.1 Simple Hybrid Approach

```typescript
// In main.ts, every 60 frames:
if (frameCount % 60 === 0) {
  await compactDiffuseParticles();
}

async function compactDiffuseParticles() {
  // Read count
  const countBuffer = device.createBuffer({
    size: 4,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  commandEncoder.copyBufferToBuffer(diffuseCountBuffer, 0, countBuffer, 0, 4);
  await countBuffer.mapAsync(GPUMapMode.READ);
  const count = new Uint32Array(countBuffer.getMappedRange())[0];
  countBuffer.unmap();

  if (count < 1000) return; // Don't bother if few particles

  // Read all particles, filter dead ones, re-upload
  // ... (CPU-side compaction)
}
```

#### Expected Result After Phase 8

- Particle count stays bounded
- No gradual slowdown over time
- Memory usage remains stable
- **Visual test**: Run simulation for 10+ minutes, performance should not degrade

---

## Summary: Implementation Order

| Phase                        | Effort | Impact | Dependency |
| ---------------------------- | ------ | ------ | ---------- |
| **1. Velocity Sampling**     | 30 min | HIGH   | None       |
| **2. Marker Classification** | 1 hr   | HIGH   | Phase 1    |
| **3. Energy Emission**       | 1-2 hr | HIGH   | Phase 2    |
| **4. Type Physics**          | 1 hr   | HIGH   | Phase 1, 2 |
| **5. Surface SDF**           | 2-3 hr | MEDIUM | None       |
| **6. Turbulence**            | 2 hr   | MEDIUM | Phase 5    |
| **7. Foam Preservation**     | 1-2 hr | LOW    | Phase 4    |
| **8. Compaction**            | 1-2 hr | LOW    | None       |

**Recommended order**: 1 → 2 → 4 → 3 → 5 → 6 → 7 → 8

**Minimum viable whitewater**: Phases 1-4 (~4 hours)

**Full Blender-like quality**: All phases (~12-15 hours)

---

## Quick Reference: Buffer Bindings for Whitewater

Current (`whitewater.wgsl`):

```wgsl
@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> liquidPositions: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> liquidVelocities: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> diffuseParticles: array<DiffuseParticle>;
@group(0) @binding(4) var<storage, read_write> diffuseCount: atomic<u32>;
@group(0) @binding(5) var<storage, read> gridVel: array<vec4<f32>>;
@group(0) @binding(6) var<storage, read> marker: array<u32>;
```

After Phase 5-6 (add):

```wgsl
@group(0) @binding(7) var<storage, read> sdf: array<f32>;
@group(0) @binding(8) var<storage, read> turbulence: array<f32>;
```

After Phase 7 (add):

```wgsl
@group(0) @binding(9) var<storage, read_write> foamDensity: array<atomic<u32>>;
```
