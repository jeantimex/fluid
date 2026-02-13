# webgpu_flip - FLIP-style Whitewater Port Plan

## Objective

Port the most impactful FLIP whitewater ideas into `webgpu_flip` (based on `webgpu_screen_space`) so foam reads as cohesive sheets/clumps instead of sparse point dots.

Scope is intentionally split:

- Physics + classification upgrade first.
- Rendering/style upgrade second.
- Keep core SPH fluid simulation unchanged.

## Non-goals

- Do not attempt full Blender/FLIP parity in one pass.
- Do not change other demos (`webgpu_screen_space`, `webgpu_raymarch`) until `webgpu_flip` is stable.
- Do not introduce CPU readback-heavy debug paths in the runtime loop.

## Baseline Gaps (Current)

- Spawn signal is mostly trapped-air + kinetic thresholds.
- Particle type classification is pure neighbor-count thresholding.
- No foam-preservation/lifetime reinforcement from local foam density.
- Rendering is single scalar foam intensity pass; visually too point-like.

## Design Principles

- Prefer GPU-only passes and existing linear grid data (`sortOffsets`, `predicted`, `velocities`).
- Add functionality incrementally behind config toggles.
- Keep memory layout stable and explicit for WGSL uniform/storage structs.
- Validate each phase visually and with build checks before next phase.

## Implementation Phases

### Phase 0 - Planning/Scaffolding (this document)

Deliverables:

- Finalized staged plan and acceptance criteria.
- New config fields listed before code work.

Exit criteria:

- Team agrees on phase boundaries and rollback points.

---

### Phase 1 - Whitewater Data Model + Config Expansion

Goal:
Expose FLIP-inspired controls needed for later compute/render phases.

Files to update:

- `src/3d/webgpu_flip/types.ts`
- `src/3d/webgpu_flip/main.ts` (defaults)
- `src/3d/webgpu_flip/fluid_simulation.ts` (uniform packing)
- `src/3d/webgpu_fluid/main.ts` (if GUI should expose flip-only controls through adapter)

Add config groups:

- Emission:
  - `whitewaterEmitterRate`
  - `wavecrestMin`, `wavecrestMax`, `wavecrestSharpness`
  - `energyMin`, `energyMax`
  - `turbulenceMin`, `turbulenceMax`
  - `obstacleInfluenceBase`, `obstacleInfluenceDecay`
- Classification:
  - `foamLayerDepth`, `foamLayerOffset`
  - `foamBubbleHysteresis`
  - `sprayNeighborMax`, `bubbleNeighborMin` (keep existing thresholds but rename/alias)
- Lifetime:
  - `foamLifetimeDecay`, `bubbleLifetimeDecay`, `sprayLifetimeDecay`
  - `foamPreservationEnabled`
  - `foamPreservationRate`, `foamDensityMin`, `foamDensityMax`
- Dynamics:
  - `foamAdvectionStrength`
  - `bubbleBuoyancy`, `bubbleDrag`
  - `sprayDrag`, `sprayRestitution`, `sprayFriction`
- Rendering:
  - `foamRenderMode` (`points`, `patches`)
  - `foamBlurPasses`, `foamThreshold`, `foamSoftness`
  - `foamAnisotropy`, `foamEdgeBoost`

Exit criteria:

- Build passes.
- No behavior change when new controls are left at compatibility defaults.

---

### Phase 2 - Compute: Emission Signal Upgrade

Goal:
Upgrade spawn from single trapped-air heuristic to multi-signal FLIP-like scoring.

Files to update:

- `src/3d/common/shaders/foam_spawn.wgsl` (or copy into `webgpu_flip` local shader path if decoupling is preferred)
- `src/3d/common/foam_pipeline.ts` (if bind groups/uniforms need extension)
- `src/3d/webgpu_flip/fluid_simulation.ts` (uniform values)

Changes:

- Keep existing neighbor search and add terms:
  - `energyPotential` from local speed (clamped/remapped).
  - `wavecrestPotential` proxy from local surface gradient/curvature approximation.
  - `turbulencePotential` proxy from local velocity variance/vorticity-like metric.
  - optional obstacle attenuation/boost from obstacle distance/proxy field.
- Spawn count:
  - weighted sum of potentials _ emitter rate _ dt.
  - deterministic stochastic rounding (keep current PCG approach).
- Preserve ring-buffer safety and burst clamp.

Exit criteria:

- Spawn concentrates around breaking crests/impact regions.
- No exploding spawn counts or persistent counter overflow artifacts.

---

### Phase 3 - Compute: Type Classification + Hysteresis

Goal:
Move from neighbor-count-only type assignment to surface-band-based FLIP-like classification.

Files to update:

- `src/3d/common/shaders/foam_update.wgsl`
- `src/3d/webgpu_flip/fluid_simulation.ts` (uniform packing)

Changes:

- Add per-particle type state storage:
  - extend foam velocity/state buffer packing (or add dedicated `foamState` buffer).
  - type enum (`foam`, `bubble`, `spray`) + flags.
- Classification logic:
  - surface-band test using fluid-surface proxy (thickness/depth neighborhood or particle signed-distance approximation).
  - bubble below band, spray above band/outside boundary, foam near surface band.
  - hysteresis buffer to prevent foam/bubble flicker.
  - keep neighbor thresholds only as secondary fallback/safety.

Exit criteria:

- Stable foam sheets at interface, fewer frame-to-frame type flips.
- Bubble/spray separation becomes visually plausible.

---

### Phase 4 - Compute: Lifetime Preservation + Per-Type Dynamics

Goal:
Port FLIP’s clumping behavior and distinct motion models.

Files to update:

- `src/3d/common/shaders/foam_update.wgsl`
- `src/3d/webgpu_flip/fluid_simulation.ts`

Changes:

- Lifetime:
  - per-type decay modifiers.
  - foam-preservation term from local foam density grid/proxy.
- Dynamics by type:
  - Foam: advection-dominant (`foamAdvectionStrength`).
  - Bubble: buoyancy + drag toward local fluid velocity.
  - Spray: ballistic gravity + drag + collision response controls.
- Keep boundary and obstacle collision behavior consistent.

Exit criteria:

- Foam persists and forms streaks/clumps instead of disappearing uniformly.
- Spray follows ballistic arcs; bubbles remain submerged/near-surface.

---

### Phase 5 - Rendering: From Dots to Patches

Goal:
Replace dot-like whitewater look with soft clustered foam appearance.

Files to update:

- `src/3d/webgpu_flip/screen_space/shaders/foam.wgsl`
- `src/3d/webgpu_flip/screen_space/passes/foam_pass.ts`
- `src/3d/webgpu_flip/screen_space/shaders/composite_final.wgsl`
- `src/3d/webgpu_flip/screen_space/passes/composite_pass.ts`
- optional new shaders/passes:
  - `foam_blur.wgsl`
  - `foam_reconstruct.wgsl`
  - new pass files under `src/3d/webgpu_flip/screen_space/passes/`

Changes:

- Render typed foam with different footprint/opacity response.
- Add foam post-process:
  - accumulate -> separable blur -> threshold/soft-threshold -> composite.
- Composite tweaks:
  - depth-aware foam masking.
  - edge/crest emphasis near high curvature or thin film areas.
  - optional anisotropic streaking along flow direction.

Exit criteria:

- Foam reads as connected patches/lines at crests, not a static particle cloud.
- No severe haloing or screen-space popping.

---

### Phase 6 - Tuning, Perf, and Guardrails

Goal:
Make the result usable in demo conditions.

Files to update:

- `src/3d/webgpu_flip/main.ts` (preset values)
- `src/3d/webgpu_flip/style.css` (if UI hints are needed)
- `src/3d/webgpu_flip/screen_space/screen_space_renderer.ts` (pass ordering/resolution scaling)

Tasks:

- Add 2-3 curated presets:
  - `Calm Shoreline`
  - `Breaking Waves`
  - `High Energy`
- Add quality/performance mode:
  - lower foam pass resolution option.
  - clamp max spawn per frame.
- Protect against pathological cases:
  - NaN guards in WGSL.
  - strict lifetime floor/ceiling.

Exit criteria:

- Stable 60fps-ish behavior on typical particle counts used by the demo.
- Visual quality clearly improved over current baseline screenshots.

## Validation Checklist (per phase)

- `npm run build` passes.
- No WebGPU validation errors in browser console.
- Toggle new features on/off without requiring full app restart.
- Resize + camera orbit + interaction continue to work.
- Adapter switching (if wired into `webgpu_fluid`) does not crash.

## Risks and Mitigations

- Risk: Overfitting to one scene.
  - Mitigation: tune with at least two obstacle layouts and energy levels.
- Risk: Too many extra passes hurt performance.
  - Mitigation: half-resolution foam pipeline and adjustable blur pass count.
- Risk: Type flicker and noisy transitions.
  - Mitigation: hysteresis + temporal smoothing for type and opacity.
- Risk: Shared `common` shader changes affect other demos.
  - Mitigation: prefer local shader copies under `webgpu_flip` when behavior diverges.

## Suggested Execution Order

1. Phase 1
2. Phase 2
3. Phase 3
4. Phase 4
5. Phase 5
6. Phase 6

No simulation code changes should start before Phase 1 config/model updates are merged.
