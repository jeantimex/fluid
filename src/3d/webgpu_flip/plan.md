# webgpu_flip - FLIP Whitewater Port Plan (Track 3: Max Fidelity)

## Selected Track

`3 (Max fidelity)`: prioritize FLIP-like whitewater behavior and visual structure over implementation speed.

## Objective

Port the highest-impact FLIP whitewater concepts into `webgpu_flip` so foam appears as cohesive, persistent sheets/clumps with stable type behavior (`foam`/`bubble`/`spray`), while keeping the core SPH fluid simulation intact.

## Non-goals

- Do not target exact Blender shading parity in one iteration.
- Do not modify `webgpu_screen_space` or `webgpu_raymarch` during core implementation.
- Do not add CPU readback-dependent runtime logic.

## Fidelity Targets

- Emission is concentrated at energetic crests/impacts, not broad noise.
- Type transitions are stable (minimal flicker).
- Foam preservation creates visible streaking/clumping.
- Spray and bubbles behave distinctly from surface foam.
- Final render reads as patches/lines, not point cloud speckle.

## Baseline Gaps

- Spawn: trapped-air + kinetic thresholds only.
- Type logic: neighbor count thresholds only.
- No foam-preservation reinforcement.
- Rendering: single scalar foam splat composited as one color.

## Architecture Rules

- Prefer GPU-only additions.
- Keep linear-grid neighbor search (`sortOffsets`) as common primitive.
- Isolate high-fidelity changes in `webgpu_flip` path; avoid breaking shared demos.
- Add features behind config toggles; default to compatibility-safe values.

## Phase Plan

### Phase 0 - Planning Lock

Deliverables:

- This document approved.
- File ownership and order of work fixed.

Exit criteria:

- No simulation code changes before Phase 1 starts.

---

### Phase 1 - Config + Data Model Expansion

Goal:
Add all parameters and storage hooks needed for high-fidelity behavior.

Files:

- `src/3d/webgpu_flip/types.ts`
- `src/3d/webgpu_flip/main.ts`
- `src/3d/webgpu_flip/fluid_simulation.ts`

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
  - `sprayNeighborMax`, `bubbleNeighborMin`
- Lifetime:
  - `foamLifetimeDecay`, `bubbleLifetimeDecay`, `sprayLifetimeDecay`
  - `foamPreservationEnabled`
  - `foamPreservationRate`, `foamDensityMin`, `foamDensityMax`
- Dynamics:
  - `foamAdvectionStrength`
  - `bubbleBuoyancy`, `bubbleDrag`
  - `sprayDrag`, `sprayFriction`, `sprayRestitution`
- Rendering:
  - `foamRenderMode` (`points`, `patches`)
  - `foamBlurPasses`, `foamThreshold`, `foamSoftness`
  - `foamAnisotropy`, `foamEdgeBoost`
  - `foamTemporalBlend`

Storage changes:

- Add dedicated foam state buffer (type + flags + hysteresis helper data).
- Preserve existing foam position/velocity buffer contracts.

Exit criteria:

- `npm run build` passes.
- Default config preserves baseline behavior.

---

### Phase 2 - Emission Signal Upgrade (FLIP-like Multi-signal)

Goal:
Replace single-factor spawn with combined signal scoring.

Files:

- `src/3d/webgpu_flip/shaders/foam_spawn.wgsl` (create local shader copy)
- `src/3d/webgpu_flip/fluid_simulation.ts`
- `src/3d/common/foam_pipeline.ts` (only if bind layout extension is required)

Implementation:

- Compute per-fluid-particle emission potential:
  - `energyPotential` from speed (clamped/remapped).
  - `wavecrestPotential` proxy from local surface/gradient cues.
  - `turbulencePotential` proxy from local velocity variance/vorticity.
  - optional obstacle influence multiplier.
- Spawn count:
  - weighted sum _ emitter rate _ dt.
  - stochastic rounding with deterministic hash.
- Directional emitter sampling:
  - velocity-aligned spawn offset/radius to mimic crest throw.

Exit criteria:

- Spawn localizes to high-energy crest regions.
- No burst instability / counter overflow artifacts.

---

### Phase 3 - Type Classification + Hysteresis

Goal:
Introduce FLIP-like type assignment and temporal stability.

Files:

- `src/3d/webgpu_flip/shaders/foam_update.wgsl` (local shader)
- `src/3d/webgpu_flip/fluid_simulation.ts`

Implementation:

- Classify by surface-band proxy first:
  - foam near band, bubble below band, spray above/outside.
- Keep neighbor thresholds as fallback support.
- Add hysteresis buffer for foam<->bubble and foam<->spray transitions.
- Persist and update type in dedicated state buffer.

Exit criteria:

- Strong reduction of type flicker at interface.
- Stable foam banding around the fluid surface.

---

### Phase 4 - Lifetime Preservation + Per-type Dynamics

Goal:
Port clumping persistence and motion differences.

Files:

- `src/3d/webgpu_flip/shaders/foam_update.wgsl`
- `src/3d/webgpu_flip/fluid_simulation.ts`

Implementation:

- Lifetime:
  - per-type decay rates.
  - foam-preservation boost based on local foam density proxy.
- Dynamics:
  - Foam: advection-dominant.
  - Bubble: buoyancy + drag toward fluid velocity.
  - Spray: ballistic + drag + collision response.
- Boundary behavior:
  - support per-type mode semantics (`collide`, `ballistic`, `kill`).

Exit criteria:

- Persistent foam streaks in recirculation zones.
- Clear visual separation between spray/bubble/foam motion.

---

### Phase 5 - Rendering Upgrade (Patch-based Whitewater)

Goal:
Make whitewater read as sheets and patch clusters.

Files:

- `src/3d/webgpu_flip/screen_space/shaders/foam.wgsl`
- `src/3d/webgpu_flip/screen_space/passes/foam_pass.ts`
- `src/3d/webgpu_flip/screen_space/shaders/composite_final.wgsl`
- `src/3d/webgpu_flip/screen_space/passes/composite_pass.ts`
- new optional shaders/passes:
  - `foam_blur.wgsl`
  - `foam_reconstruct.wgsl`
  - `foam_temporal.wgsl`

Implementation:

- Typed rendering response:
  - foam: broader soft patches
  - bubble: subdued subsurface contribution
  - spray: sharper highlights/speckles
- Post chain:
  - accumulate -> blur -> threshold/soft-threshold -> temporal blend -> composite.
- Composite:
  - depth-aware masking.
  - crest/edge boost and directional (anisotropic) emphasis.

Exit criteria:

- Visual texture changes from dots to coherent whitewater patches.
- No major haloing/pop artifacts.

---

### Phase 6 - Performance + Stability Guardrails

Goal:
Keep high-fidelity pipeline operational in interactive settings.

Files:

- `src/3d/webgpu_flip/screen_space/screen_space_renderer.ts`
- `src/3d/webgpu_flip/main.ts`

Implementation:

- Add quality tiers (high/medium/low) controlling:
  - foam resolution scale
  - blur pass count
  - max spawn per frame
  - temporal blend strength
- Add NaN/invalid-value guards in WGSL.
- Add hard caps on per-cell/per-frame spawn and lifetime.

Exit criteria:

- Stable runtime with no validation errors.
- Acceptable FPS at demo particle counts with `medium` tier.

---

### Phase 7 - FLIP-Parity Feature Pass (Required for Track 3)

Goal:
Close remaining realism gaps that are not covered by base phases.

Files:

- `src/3d/webgpu_flip/fluid_simulation.ts`
- `src/3d/webgpu_flip/screen_space/shaders/composite_final.wgsl`
- additional flip-local compute shaders if needed

Implementation:

- Obstacle influence field/proxy sampled by emission and lifetime logic.
- Whitewater density proxy field reused across simulation + rendering.
- Per-type force-field weights (foam/bubble/spray) for richer coupling.
- Debug views:
  - type map
  - emission potential
  - foam density preservation field

Exit criteria:

- Debug views match expected behavior.
- Obstacle-rich scenes show localized, believable whitewater enhancement.

---

### Phase 8 - Cross-scene Calibration (Required for Track 3)

Goal:
Prevent overtuning and ensure robust defaults.

Scenes:

- Breaking wave over obstacles.
- Calm shoreline wash.
- High-energy collision/inflow.

Tasks:

- Tune and save presets:
  - `Calm Shoreline`
  - `Breaking Waves`
  - `High Energy`
- Define default parameter envelope valid across all scenes.

Exit criteria:

- One default preset acceptable across all scenes.
- Scene presets improve quality without code-path changes.

---

### Phase 9 - Optional Raymarch Follow-up

Goal:
After `webgpu_flip` is stable, optionally port mature whitewater state to raymarch.

Exit criteria:

- Raymarch integration works without regressions to `webgpu_flip`.

## Validation Checklist (Every Phase)

- `npm run build` passes.
- No WebGPU validation errors.
- Interaction/camera/resize remain stable.
- New toggles can be changed live.

Track 3 metrics:

- Flicker score below target in 300+ frame capture.
- Type distribution stable under steady inflow.
- No long-run runaway foam accumulation.

## Risks and Mitigations

- Risk: overfitting one scene.
  - Mitigation: Phase 8 mandatory before declaring done.
- Risk: performance collapse from extra passes.
  - Mitigation: quality tiers + half-resolution foam path.
- Risk: shared shader regressions.
  - Mitigation: keep high-fidelity shader logic under `webgpu_flip` local paths.

## Execution Order

1. Phase 1
2. Phase 2
3. Phase 3
4. Phase 4
5. Phase 5
6. Phase 6
7. Phase 7
8. Phase 8
9. Phase 9 (optional)
