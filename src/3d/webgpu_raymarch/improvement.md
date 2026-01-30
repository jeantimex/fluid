# Performance Analysis & Improvement Plan - WebGPU Raymarch

## Current State Analysis

The current implementation is a high-fidelity port of the Unity Fluid Raymarch scene. It successfully reuses the optimized SPH simulation core from `webgpu_particles`, but introduces significant new bottlenecks in the volume generation and raymarching stages.

### 1. Reused Optimizations (from `webgpu_particles`)
These P0/P1 optimizations are already integrated into this port:
- **Parallel Prefix Sum (P0)**: Used for efficient GPU sorting of particles.
- **Particle Reordering (P0)**: Ensures cache-coherent memory access during density calculation and volume generation.
- **Block-Based Spatial Hash (P1)**: Matches Unity's hash function to minimize collisions and improve locality.

### 2. Existing Minor Optimizations
These optimizations are already in place:
- **Random Jitter** (`raymarch.wgsl:160`): Starting position jitter of `stepSize × 0.4` to reduce banding.
- **Shadow Step Doubling** (`raymarch.wgsl:282`): Shadow marching uses `stepSize × 2.0` to reduce iterations.
- **Boundary Normal Smoothing** (`raymarch.wgsl:125-139`): Blends volume normals with face normals at edges.

### 3. New Bottlenecks (Raymarch Specific)

#### Issue #1: Voxel-Side Density Evaluation (P0) — RESOLVED
The `density_volume.wgsl` compute shader evaluated density at every voxel using a neighbor search (the "Pull" method).
- **Location**: Previously `density_volume.wgsl:46-85`
- **Complexity**: $O(Voxels \times AvgParticlesPerCell)$.
- **Impact**: At a resolution of 150, we evaluated $\sim 3.4$ million voxels. Even with spatial hashing, this was extremely heavy and dominated the frame time.
- **Fix Applied**: Switched to **Particle Splatting** ("Push" method) via a 3-pass pipeline: `splat_clear.wgsl` (zero atomic buffer) → `splat_particles.wgsl` (each particle splatts to ~27 neighboring voxels using `atomicAdd` with fixed-point encoding) → `splat_resolve.wgsl` (convert atomic `u32` back to `f32` and write to `rgba16float` texture). Cost is now $O(N\_{particles})$ instead of $O(Voxels)$. Wired up in `fluid_simulation.ts` replacing the old single-pass density volume dispatch.

#### Issue #2: Fixed-Step Raymarching (P1)
The `raymarch.wgsl` shader uses a fixed `stepSize` across the entire simulation bounds.
- **Location**: `raymarch.wgsl:181-215`
- **Impact**: Large empty regions are marched with the same granularity as dense fluid, wasting cycles.
- **Proposed Fix**:
  - **Empty Space Skipping**: Use a coarse occupancy grid (e.g., a low-res 3D bitmask or mipmap) to skip empty regions of the simulation box.
  - **Jittered Starting Positions**: Already partially implemented, but can be improved to hide banding with fewer steps.

#### Issue #3: Expensive Normal Calculation (P1)
Normals are computed via finite differences, requiring 6 additional texture samples per surface hit.
- **Location**: `raymarch.wgsl:113-140`
- **Impact**: Multiplies texture sampling cost by 6x at the most critical part of the shader.
- **Proposed Fix**:
  - **Gradient Volume**: Generate a 3D texture storing the gradient ($\nabla \rho$) alongside the density volume.
  - **Tetrahedral Pattern**: If bandwidth is a concern, reduce to 4 samples using a tetrahedral tap pattern (slightly lower quality at grazing angles).

#### Issue #4: Redundant Shadow Marching (P2)
Shadows are calculated by marching toward the sun for every floor and background pixel.
- **Location**: `raymarch.wgsl:271-293`, called from `sampleEnvironment` at line 344
- **Impact**: 64 iterations per floor/background pixel.
- **Proposed Fix**: Pre-calculate a 2D **Fluid Shadow Map** from the light's perspective and sample it during the environment pass.

#### Issue #5: Expensive Refraction Heuristic (P1) — RESOLVED
The refraction path selection heuristic sampled density along both reflection and refraction directions.
- **Location**: `raymarch.wgsl:401-417`
- **Impact**: Previously called `calculateDensityForShadow` (64 steps each). With `numRefractions = 4`, this added up to **512 extra raymarch steps per pixel**.
- **Fix Applied**: Replaced with a short 4-step march capped at distance 2.0. Uses `rayBoxIntersection` for bounds clipping, then 4 evenly-spaced samples with `sampleDensityRaw`. Per-bounce cost reduced from 128 texture samples (2 × 64) to 8 samples (2 × 4) — a **16× reduction** in the refraction path.

#### Issue #6: Suboptimal Workgroup Size (P2) — RESOLVED
The density volume compute shader used small workgroups.
- **Location**: Previously `density_volume.wgsl:87` — workgroup size was 4×4×4 = 64 threads
- **Fix Applied**: Increased to 8×8×4 = 256 threads (commit `577428f`). Now superseded by the particle splatting pipeline which uses workgroup size 256 for clear/splat passes and 8×8×4 for the resolve pass.

#### Issue #7: Missing Early Transmittance Cutoff (P2) — RESOLVED
The refraction loop continued even when the accumulated transmittance became negligible.
- **Location**: `raymarch.wgsl:429-431`
- **Fix Applied**: Added early exit when `all(totalTransmittance < vec3(0.01))` (commit `546a83a`).

#### Issue #8: Wasted Texture Bandwidth (P2 — Downgraded)
The density volume uses `rgba16float` but only stores data in the R channel.
- **Location**: `fluid_simulation.ts:355` (texture creation), `density_volume.wgsl:98` (stores `vec4(density, 0, 0, 1)`)
- **Impact**: 75% of memory bandwidth is wasted.
- **Proposed Fix**: Change format to single-channel.
- **Complexity Note**: WebGPU format limitations make this non-trivial:
  - `r16float`: Doesn't support storage texture access (`STORAGE_BINDING`)
  - `r32float`: Doesn't support filterable sampling (required by `textureSampleLevel`)
  - **Workarounds**: (1) Manual trilinear interpolation using `textureLoad`, (2) Copy from `r32float` storage to `r16float` filterable texture each frame, (3) Combine with Gradient Volume to make better use of all 4 channels.

---

## Performance Improvement Plan

### Phase 1: High Impact (P0-P1)
| Priority | Optimization | Description | Status |
| :--- | :--- | :--- | :--- |
| **P0** | **Particle Splatting** | Change volume generation from "voxel search" to "particle splatting" via atomics. | ✅ Done |
| **P2** | **R-only Texture** | Change `densityVolume` format to single-channel. Complex due to WebGPU format limitations (see Issue #8). | ⏳ Pending |
| **P1** | **Fix Refraction Heuristic** | Replace expensive 64-step density sampling with cheaper 4-step short march. | ✅ Done |
| **P1** | **Occupancy Grid** | Implement a low-res occupancy grid to skip empty space during raymarching. | ⏳ Pending |

### Phase 2: Refinement (P2)
| Priority | Optimization | Description | Status |
| :--- | :--- | :--- | :--- |
| **P2** | **Gradient Volume** | Pre-compute and store normals in a 3D texture to avoid 6× sampling cost. | ⏳ Pending |
| **P2** | **Shadow Map** | Bake fluid shadows into a 2D depth/transmittance texture. | ⏳ Pending |
| **P2** | **Temporal Upscaling** | Render the raymarched volume at a lower resolution and upscale with a bilateral filter. | ⏳ Pending |
| **P2** | **Workgroup Size** | Increase density volume workgroup from 64 to 256 threads. | ✅ Done |
| **P2** | **Early Transmittance Exit** | Skip refraction iterations when transmittance drops below threshold. | ✅ Done |

---

## Implementation Notes

### R-only Texture vs Gradient Volume Conflict
The **R-only Texture** optimization (P1) and **Gradient Volume** (P2) are mutually exclusive in their simplest forms:
- R-only uses `r16float` (2 bytes/voxel)
- Gradient volume would need `rgba16float` to store density + gradient (8 bytes/voxel)

**Resolution Options**:
1. Implement R-only first, then evaluate if gradient volume is still needed.
2. Use separate textures: `r16float` for density, `rgba16float` for gradient (computed on demand or every N frames).
3. Use `rg16float` to store density + packed 2D gradient (derive Z from normalization).

### Particle Splatting Implementation — DONE
Implemented as a 3-pass pipeline in `fluid_simulation.ts`:
1. **Clear** (`splat_clear.wgsl`): Zeros a `u32` storage buffer (one entry per voxel) using `atomicStore`.
2. **Splat** (`splat_particles.wgsl`): Each particle computes affected voxels within its smoothing radius, evaluates the SPH spiky kernel, and uses `atomicAdd` with fixed-point encoding (scale = 1000).
3. **Resolve** (`splat_resolve.wgsl`): Reads `u32` values, divides by fixed-point scale, writes to `rgba16float` storage texture.

No double-buffering needed — the 3 passes run sequentially within a single command encoder submission, and raymarching happens in a separate render pass afterward.

### Occupancy Grid Strategy
For empty space skipping:
- Generate a low-res (e.g., 32³) occupancy bitmask during density volume pass
- Mark cells as "occupied" if any particle splatted there
- During raymarching, take larger steps through empty cells
- Can use hierarchical structure (mipmap) for adaptive step sizes


Phase 1: Easy Wins & Rendering Efficiency — ✅ COMPLETE
   * Sub-task 1.1: Optimize Compute Occupancy — ✅ Done (commit 577428f)
       * Change: Updated density_volume.wgsl workgroup size from (4, 4, 4) to (8, 8, 4) = 256 threads.
   * Sub-task 1.2: Early Transmittance Cutoff — ✅ Done (commit 546a83a)
       * Change: Added early exit in raymarch.wgsl refraction loop when totalTransmittance < 0.01.

  Phase 2: Refraction Heuristic — ✅ COMPLETE
   * Sub-task 2.1: Simplify `calculateDensityForRefraction` — ✅ Done
       * Change: Replaced the 64-step `calculateDensityForShadow` call with a 4-step short march
         capped at distance 2.0. 16x reduction in texture samples per refraction bounce.

  Phase 3: Particle Splatting (The "Push" Method) — ✅ COMPLETE
   * Sub-task 3.1: Atomic Buffer Infrastructure — ✅ Done
       * Change: Created `splat_clear.wgsl` and `u32` storage buffer for fixed-point atomic density
         accumulation. Buffer sized at totalVoxels × 4 bytes.
   * Sub-task 3.2: Splatting Kernel — ✅ Done
       * Change: Created `splat_particles.wgsl`. Each thread processes one particle, splatting density
         to nearby voxels within smoothing radius using `atomicAdd` with fixed-point scale of 1000.
   * Sub-task 3.3: Resolve Pass — ✅ Done
       * Change: Created `splat_resolve.wgsl`. Converts atomic `u32` values back to `f32` and writes
         to the `rgba16float` storage texture.
   * Sub-task 3.4: Pipeline Wiring — ✅ Done
       * Change: Replaced single density volume dispatch in `fluid_simulation.ts` with 3-pass
         Clear → Splat → Resolve pipeline. Removed old `density_volume.wgsl` import and pipeline.


        Performance Analysis: webgpu_raymarch

  The rendering pipeline has two expensive stages: density splatting (compute) and raymarching (fragment).
   The raymarch shader is the dominant bottleneck — every pixel walks through the volume with up to 512
  steps, and each refraction bounce multiplies that cost.

  1. Empty-Space Skipping (High Impact)

  File: raymarch.wgsl:295 — findNextSurface

  The primary ray loop steps through the entire bounding box at a uniform stepSize, even when most of the
  volume is empty air (e.g. fluid settled at the bottom). Every step calls sampleDensity, which is a 3D
  texture fetch plus a boundary check.

  Optimization: Generate a mipmap chain (or a separate low-res "occupancy" volume) of the density texture.
   Before stepping, sample a coarse mip to skip large empty regions. This is the classic "hierarchical
  empty-space skipping" technique. It could reduce the average step count from ~512 to ~50–100 for typical
   scenes where fluid occupies a small fraction of the volume.

  Alternative (simpler): Adaptive step size — start with a large step (4× stepSize), and when density is
  detected, back up and refine with the normal stepSize. This is easier to implement and still cuts step
  count significantly for empty regions.

  2. Redundant Boundary Check in sampleDensity (Medium-High Impact)

  File: raymarch.wgsl:157–164

  sampleDensity performs 6 float comparisons on every call:

  if (any(uvw >= vec3<f32>(1.0 - epsilon)) || any(uvw <= vec3<f32>(epsilon))) {
      return -params.densityOffset;
  }

  This function is called:
  - Once per step in findNextSurface (up to 512 times per bounce)
  - 6 times in calculateNormal (central differences)
  - Multiple times in shadow/refraction density probes

  That's easily 2000+ boundary checks per pixel.

  Optimization: Pad the density texture by 1 voxel on each side during the resolve pass, filling border
  voxels with 0. Then use sampleDensityRaw everywhere and remove sampleDensity entirely. The clamp-to-edge
   sampler already handles out-of-bounds UVs; the padding ensures edge samples return zero density
  naturally.

  3. isInsideFluid Uses Ray-Box Intersection (Low-Effort Fix)

  File: raymarch.wgsl:168–173

  fn isInsideFluid(pos: vec3<f32>) -> bool {
      let hit = rayBoxIntersection(pos, vec3<f32>(0.0, 0.0, 1.0), boundsMin, boundsMax);
      return (hit.x <= 0.0 && hit.y > 0.0) && sampleDensity(pos) > 0.0;
  }

  This fires a ray-box intersection (reciprocals, 6 min/max operations) just to check if a point is inside
   a box. A simple point-in-AABB test is cheaper:

  let inside = all(pos >= boundsMin) && all(pos <= boundsMax);
  return inside && sampleDensity(pos) > 0.0;

  4. Density Texture Format Waste (Medium Impact)

  File: splat_pipeline.ts:215 and splat_resolve.wgsl:52

  The density texture uses rgba16float (64 bits/voxel) but only the R channel carries data:

  textureStore(densityVolume, vec3<i32>(id), vec4<f32>(density, 0.0, 0.0, 1.0));

  And the raymarch shader only reads .r:

  textureSampleLevel(densityTex, densitySampler, uvw, 0.0).r

  This wastes 75% of texture memory and bandwidth. Unfortunately, r16float doesn't support STORAGE_BINDING
   in base WebGPU. Options:

  - r32float — supports storage binding. 32 bits/voxel (2× savings). Requires the float32-filterable
  feature for trilinear filtering, which is widely supported on desktop GPUs.
  - Keep rgba16float but pack 4 density values per texel (tile the volume) — complex but 4× effective
  compression.

  5. calculateNormal — 6 Texture Samples (Medium Impact)

  File: raymarch.wgsl:200–211

  Central differences require 6 samples per normal. Called at every refraction surface hit. With
  numRefractions = 4, that's up to 24 density texture samples just for normals.

  Optimization: Use forward differences (4 samples: 1 center + 3 axis offsets) instead of central
  differences. Costs 33% fewer samples. Slightly less accurate but imperceptible at typical density
  resolutions:

  let d0 = sampleDensity(pos);
  let dx = sampleDensity(pos + offsetX) - d0;
  let dy = sampleDensity(pos + offsetY) - d0;
  let dz = sampleDensity(pos + offsetZ) - d0;

  6. Shadow Ray Over-Sampling (Medium Impact)

  File: raymarch.wgsl:424

  calculateDensityForShadow steps at lightStepSize * 2.0 but allows up to 32 iterations. This is called:
  - Once per floor pixel hit (sampleEnvironment, line 544, maxDst=100)
  - Once per discarded ray at each refraction bounce (via sampleEnvironment)
  - Once as the final density remainder (line 772, maxDst=1000)

  That's potentially 4–6 shadow ray evaluations per pixel, each doing up to 32 steps = ~160 texture
  samples.

  Optimization: Use a coarser step size (3–4× lightStepSize) for shadow rays. Shadow quality is
  low-frequency and soft shadows are visually forgiving. Also, lower the early-exit threshold from 3.0 to
  2.0 — exp(-2) ≈ 0.135, already very dark.

  7. Splat Particle Kernel — sqrt in Inner Loop (Low Impact)

  File: splat_particles.wgsl:99

  The triple-nested voxel loop computes sqrt(sqrDst) for every voxel in the AABB. The sqrt is needed
  because the Spiky² kernel is defined in terms of distance, not squared distance. However, for the
  specific case of (h - r)², you could reformulate using squared distance directly if you pre-compute the
  kernel in terms of sqrDst. This is a micro-optimization with minimal visual impact.

  8. Offscreen Texture Precision (Low Impact, Quality Improvement)

  File: renderer.ts:250

  The half-res offscreen texture uses the swap chain format (typically bgra8unorm, 8 bits per channel).
  Exposure is applied in the fragment shader before output, so HDR values are clamped. This can cause
  banding in dark regions.

  Using rgba16float for the offscreen texture and moving exposure/tone-mapping to the blit pass would
  preserve dynamic range. The performance difference of the format change itself is minimal on modern
  GPUs.

  ---
  Summary by Priority
  ┌──────────┬──────────────────────────────────────────────────────┬───────────────────────┬─────────┐
  │ Priority │                     Optimization                     │     Est. Speedup      │ Effort  │
  ├──────────┼──────────────────────────────────────────────────────┼───────────────────────┼─────────┤
  │ 1        │ Empty-space skipping (adaptive stepping)             │ 2–5× for rays         │ Medium  │
  ├──────────┼──────────────────────────────────────────────────────┼───────────────────────┼─────────┤
  │ 2        │ Remove sampleDensity boundary check (padded texture) │ 10–20% overall        │ Low     │
  ├──────────┼──────────────────────────────────────────────────────┼───────────────────────┼─────────┤
  │ 3        │ Simplify isInsideFluid to point-in-box               │ Small                 │ Trivial │
  ├──────────┼──────────────────────────────────────────────────────┼───────────────────────┼─────────┤
  │ 4        │ r32float density texture                             │ 10–15% bandwidth      │ Low     │
  ├──────────┼──────────────────────────────────────────────────────┼───────────────────────┼─────────┤
  │ 5        │ Forward-difference normals (6→4 samples)             │ 5–10% per bounce      │ Trivial │
  ├──────────┼──────────────────────────────────────────────────────┼───────────────────────┼─────────┤
  │ 6        │ Coarser shadow rays                                  │ 10–20% on shadow cost │ Trivial │
  ├──────────┼──────────────────────────────────────────────────────┼───────────────────────┼─────────┤
  │ 7        │ Avoid sqrt in splat kernel                           │ ~5% on splat pass     │ Low     │
  ├──────────┼──────────────────────────────────────────────────────┼───────────────────────┼─────────┤
  │ 8        │ rgba16float offscreen texture                        │ Quality improvement   │ Low     │
  └──────────┴──────────────────────────────────────────────────────┴───────────────────────┴─────────┘
  The biggest single win would be empty-space skipping (#1). For a typical scene where fluid occupies ~20%
   of the volume, this could reduce the per-pixel ray cost by 3–5×.