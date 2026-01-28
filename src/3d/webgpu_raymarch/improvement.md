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

#### Issue #1: Voxel-Side Density Evaluation (P0)
The `density_volume.wgsl` compute shader evaluates density at every voxel using a neighbor search (the "Pull" method).
- **Location**: `density_volume.wgsl:46-85`
- **Complexity**: $O(Voxels \times AvgParticlesPerCell)$.
- **Impact**: At a resolution of 150, we evaluate $\sim 3.4$ million voxels. Even with spatial hashing, this is extremely heavy and dominates the frame time.
- **Proposed Fix**: Switch to **Particle Splatting** ("Push" method). Each particle iterates over its neighboring voxels and accumulates its density contribution using `atomicAdd`. This is generally much faster when the fluid occupies only a portion of the volume.

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

#### Issue #5: Expensive Refraction Heuristic (P1) — NEW
The refraction path selection heuristic samples density along both reflection and refraction directions.
- **Location**: `raymarch.wgsl:467-468`
- **Impact**: `calculateDensityForRefraction` internally calls `calculateDensityForShadow` (64 steps each). With `numRefractions = 4`, this adds up to **512 extra raymarch steps per pixel**.
- **Proposed Fix**:
  - Use a cheaper heuristic (e.g., single sample or gradient-based direction estimation).
  - Cache density values from previous surface finding pass.
  - Consider a fixed refraction bias instead of per-pixel heuristic.

#### Issue #6: Suboptimal Workgroup Size (P2) — NEW
The density volume compute shader uses small workgroups.
- **Location**: `density_volume.wgsl:87` — workgroup size is 4×4×4 = 64 threads
- **Impact**: Modern GPUs prefer 256 threads per workgroup for better occupancy and latency hiding.
- **Proposed Fix**: Increase to 8×8×4 = 256 or 4×4×16 = 256 threads.

#### Issue #7: Missing Early Transmittance Cutoff (P2) — NEW
The refraction loop continues even when the accumulated transmittance becomes negligible.
- **Location**: `raymarch.wgsl:428-496`
- **Impact**: Dense fluid regions waste cycles computing invisible contributions.
- **Proposed Fix**: Add early exit when `max(totalTransmittance) < 0.01`.

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
| **P0** | **Particle Splatting** | Change volume generation from "voxel search" to "particle splatting" via atomics. | ⏳ Pending |
| **P2** | **R-only Texture** | Change `densityVolume` format to single-channel. Complex due to WebGPU format limitations (see Issue #8). | ⏳ Pending |
| **P1** | **Fix Refraction Heuristic** | Replace expensive 64-step density sampling with cheaper single-sample or gradient-based heuristic. | ⏳ Pending |
| **P1** | **Occupancy Grid** | Implement a low-res occupancy grid to skip empty space during raymarching. | ⏳ Pending |

### Phase 2: Refinement (P2)
| Priority | Optimization | Description | Status |
| :--- | :--- | :--- | :--- |
| **P2** | **Gradient Volume** | Pre-compute and store normals in a 3D texture to avoid 6× sampling cost. | ⏳ Pending |
| **P2** | **Shadow Map** | Bake fluid shadows into a 2D depth/transmittance texture. | ⏳ Pending |
| **P2** | **Temporal Upscaling** | Render the raymarched volume at a lower resolution and upscale with a bilateral filter. | ⏳ Pending |
| **P2** | **Workgroup Size** | Increase density volume workgroup from 64 to 256 threads. | ⏳ Pending |
| **P2** | **Early Transmittance Exit** | Skip refraction iterations when transmittance drops below threshold. | ⏳ Pending |

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

### Particle Splatting Implementation
When switching to particle splatting:
- Use `atomicAdd` on `r32float` storage texture (or manual atomic on `r32uint`)
- Each particle writes to ~27 neighboring voxels (within smoothing radius)
- Requires clearing the volume texture each frame
- May need double-buffering to avoid race conditions with raymarching

### Occupancy Grid Strategy
For empty space skipping:
- Generate a low-res (e.g., 32³) occupancy bitmask during density volume pass
- Mark cells as "occupied" if any particle splatted there
- During raymarching, take larger steps through empty cells
- Can use hierarchical structure (mipmap) for adaptive step sizes


Phase 1: Easy Wins & Rendering Efficiency
   * Sub-task 1.1: Optimize Compute Occupancy
       * Change: Update density_volume.wgsl workgroup size from (4, 4, 4) (64 threads) to (8, 8, 4) (256
         threads).
       * Goal: Better GPU utilization.
       * Verification: Ensure simulation still runs and the density volume looks identical.
   * Sub-task 1.2: Early Transmittance Cutoff
       * Change: Add an early exit in the raymarch.wgsl refraction loop if totalTransmittance falls below
         a threshold (e.g., 0.01).
       * Goal: Stop computing expensive refractions once the fluid is already opaque.
       * Verification: No visual change in dense regions; slight FPS boost in deep water.

  Phase 2: Refraction Heuristic
   * Sub-task 2.1: Simplify `calculateDensityForRefraction`
       * Change: Replace the 64-step shadow-marching trace in the refraction heuristic with a cheaper
         single-sample or 4-step lookup.
       * Goal: Remove the "512 steps per pixel" bottleneck.
       * Verification: Compare refraction quality; significant FPS increase expected.

  Phase 3: Particle Splatting (The "Push" Method)
   * Sub-task 3.1: Atomic Buffer Infrastructure
       * Change: Set up a u32 storage buffer for atomic density accumulation (fixed-point) and a "Clear"
         pass.
   * Sub-task 3.2: Splatting Kernel & Resolve
       * Change: Implement the new splatting logic where particles write to the volume, plus a "Resolve"
         pass to copy it to the filterable texture.
       * Goal: Massive speedup in volume generation ($O(N\_particles)$ instead of $O(Voxels)$).
       * Verification: The fluid volume should look the same as the current "Pull" method.