# FLIP Particle Physics - Blender vs WebGPU Comparison

This document compares the core FLIP simulation parameters between Blender FLIP Fluids addon
and our WebGPU implementation to ensure the foundation is correct before adding whitewater effects.

## Reference Files

- **Blender**: `ref/Blender-FLIP-Fluids/src/engine/fluidsimulation.h/.cpp`
- **WebGPU**: `src/flip/3d/webgpu_foam/simulator.ts`, `shaders/flip_simulation.wgsl`

---

## Core Parameter Comparison

| Parameter | Blender FLIP Fluids | WebGPU Implementation | Status |
|-----------|---------------------|----------------------|--------|
| **PIC/FLIP Ratio** | 5% PIC / 95% FLIP | 1% PIC / 99% FLIP | Similar |
| **Particles per Cell** | 8 (2×2×2 subcells) | Variable (spacing factor) | Needs verification |
| **Particle Radius** | `0.24 * dx` (computed) | `0.12` (fixed) | Different approach |
| **CFL Condition** | 5.0 (adaptive dt) | Fixed dt = 1/60s | Different |
| **Pressure Solver** | PCG | Jacobi / Red-Black GS | Different |
| **Grid Staggering** | MAC grid | MAC grid | Same |
| **Advection** | RK4 + Semi-Lagrangian | RK2 | Similar |
| **Marker Particle Scale** | 3.0 (default) | N/A | - |

---

## Detailed Analysis

### 1. PIC/FLIP Velocity Blending

**Blender** (`fluidsimulation.cpp:6781`):
```cpp
vmath::vec3 vPIC = _MACVelocity.evaluateVelocityAtPositionLinear(pos);
vmath::vec3 vFLIP = vel + vPIC - _savedVelocityField.evaluateVelocityAtPositionLinear(pos);
vmath::vec3 v = (float)_ratioPICFLIP * vPIC + (float)(1 - _ratioPICFLIP) * vFLIP;
// _ratioPICFLIP = 0.05 (default) → 5% PIC, 95% FLIP
```

**WebGPU** (`flip_simulation.wgsl:1140`):
```wgsl
let vFlip = velOld + (vGridNew - vGridOld);
let vPic = vGridNew;
let vNew = mix(vPic, vFlip, uniforms.fluidity);
// fluidity = 0.99 (default) → 1% PIC, 99% FLIP
```

**Convention Difference**:
- Blender: `_ratioPICFLIP` = PIC ratio (0.05 = 5% PIC)
- WebGPU: `fluidity` = FLIP ratio (0.99 = 99% FLIP)

**Equivalence**: `fluidity = 1.0 - _ratioPICFLIP`

| Setting | Blender | WebGPU Equivalent |
|---------|---------|-------------------|
| Default | `_ratioPICFLIP = 0.05` | `fluidity = 0.95` |
| More stable | `_ratioPICFLIP = 0.10` | `fluidity = 0.90` |
| More energetic | `_ratioPICFLIP = 0.02` | `fluidity = 0.98` |

---

### 2. Particles Per Cell

**Blender's Approach** (`fluidsimulation.cpp:4347`):
```cpp
double volume = _dx * _dx * _dx / 8.0;  // Each particle represents 1/8 of cell volume
```

This means **8 particles per cell** in a 2×2×2 subcell arrangement.

**WebGPU's Approach** (`main.ts`):
```typescript
spacingFactor: 3.0,  // Multiplier for particle spacing
```

The spacing factor controls how particles are distributed but doesn't explicitly target 8 per cell.

**Recommendation**: Calculate and verify average particles per fluid cell:
```
targetParticlesPerCell = 8
actualParticlesPerCell = totalParticles / numFluidCells
```

---

### 3. Particle Radius

**Blender's Formula** (`fluidsimulation.cpp:4347-4349`):
```cpp
double volume = _dx * _dx * _dx / 8.0;           // Volume per particle
double pi = 3.141592653;
_markerParticleRadius = pow(3*volume / (4*pi), 1.0/3.0);  // Sphere radius for that volume
```

Simplified: `radius = dx * pow(3.0 / (32.0 * PI), 1.0/3.0) ≈ 0.2067 * dx`

With `_markerParticleScale = 3.0` (default), the visual radius becomes:
```cpp
visualRadius = _markerParticleRadius * _markerParticleScale ≈ 0.62 * dx
```

**WebGPU's Approach** (`main.ts`):
```typescript
particleRadius: 0.12,  // Fixed world units
```

**Comparison Table**:

| Grid Resolution | Cell Size (dx) | Blender Radius | Blender Visual | WebGPU Radius |
|-----------------|----------------|----------------|----------------|---------------|
| 32×16×16, 24 wide | 0.75 | 0.155 | 0.465 | 0.12 |
| 64×32×32, 24 wide | 0.375 | 0.078 | 0.233 | 0.12 |

**Recommendation**: Make particle radius proportional to cell size:
```typescript
const dx = containerWidth / RESOLUTION_X;
const particleRadius = 0.207 * dx;  // Match Blender's ratio
const visualRadius = particleRadius * 3.0;  // With scale factor
```

---

### 4. Pressure Solver

**Blender**: Preconditioned Conjugate Gradient (PCG)
- Mathematically robust
- Converges to high accuracy
- Essential for large-scale simulations

**WebGPU**: Jacobi / Red-Black Gauss-Seidel
- GPU-friendly (highly parallel)
- Slower convergence
- May result in slight compressibility

**Quality Comparison**:

| Solver | Iterations Needed | Incompressibility | GPU Friendliness |
|--------|-------------------|-------------------|------------------|
| Jacobi | 50-100 | Good | Excellent |
| Red-Black GS | 25-50 | Better | Good |
| PCG | 10-20 | Excellent | Medium |
| Multigrid | 2-5 | Excellent | Medium |

**Recommendation**: For real-time WebGPU, Red-Black GS with 50 iterations is a reasonable tradeoff.

---

### 5. CFL Condition & Timestep

**Blender** (`fluidsimulation.h:2190`):
```cpp
double _CFLConditionNumber = 5.0;
// Adaptive timestep: dt = CFL * dx / maxVelocity
```

**WebGPU**:
```typescript
dt: 1/60  // Fixed timestep
```

**Implications**:
- Blender adapts timestep to maintain stability
- WebGPU uses fixed timestep, may need substeps for fast motion
- CFL = 5.0 is aggressive; typical values are 1.0-3.0

---

### 6. Marker Particle Jitter

**Blender** (`fluidsimulation.h:2323-2324`):
```cpp
double _markerParticleRadius = 0.0;  // Computed
double _markerParticleScale = 3.0;   // Visual multiplier
double _markerParticleJitterFactor;  // Position noise
```

**WebGPU** (`flip_simulation.wgsl`):
```wgsl
const TURBULENCE: f32 = 0.02;  // Small random perturbation during advection
```

Blender has more sophisticated jitter for particle initialization and emission.

---

## Diagnostic Checklist

Before adding whitewater, verify these properties:

### Visual Checks

- [ ] **Volume Conservation**: Does the fluid volume stay roughly constant over time?
- [ ] **Energy Preservation**: Does fluid remain "lively" or dampen out quickly?
- [ ] **Surface Smoothness**: Are there visible gaps or clumping at the surface?
- [ ] **Splash Behavior**: Do splashes break apart naturally?

### Numerical Checks

- [x] **Particles per Cell**: ~13.5 (above Blender's 8 baseline - good quality) ✓
- [x] **Pre-Projection Divergence**: ~13 settled, ~50-80 during splashes (normal) ✓
- [x] **Velocity Magnitude**: ~1-6 settled, ~30-55 during splashes (good range) ✓

### Visual Checks (Verified 2026-02-22)

- [x] **Volume Conservation**: Fluid volume stays constant ✓
- [x] **Energy Preservation**: Fluid remains energetic with 0.95 FLIP ✓
- [x] **Surface Smoothness**: No visible gaps, smooth surface ✓
- [x] **Splash Behavior**: Natural splash dynamics ✓

### Diagnostic Results (2026-02-22)

**Configuration:**
- Grid: 32×16×16 (8,192 cells)
- Particles: 35,000
- Container: 24×10×15

**Measured:**
- Fluid Cells: ~2,550 (31% fill)
- Particles/Cell: **13.7** (71% above Blender's 8.0 target)
- Status: ✓ Good (6-16 range is acceptable)

**Conclusion:** Particle density is healthy for whitewater implementation.
Higher density means more emission candidates for foam/spray/bubbles.

### Legacy Diagnostic Code (now in main.ts)

```typescript
// Diagnostic is now implemented in main.ts
// Runs at frame 10, then every 60 frames
// Uses GPU buffer readback of gridMarkerBuffer
```

---

## Recommended Parameter Alignment

To better match Blender's behavior:

### Option A: Match Blender Exactly

```typescript
const simConfig = {
  // Grid
  boxWidth: 24,
  boxHeight: 10,
  boxDepth: 15,

  // Computed from grid
  dx: 24 / 32,  // = 0.75 (cell size)

  // Particle radius (Blender formula)
  particleRadius: 0.207 * dx,  // ≈ 0.155

  // Visual radius
  visualRadius: 0.155 * 3.0,  // ≈ 0.465

  // Target 8 particles per cell
  particleCount: 8 * (32 * 16 * 16) * fillRatio,  // fillRatio ≈ 0.5 for half-full container

  // PIC/FLIP (match Blender's 95% FLIP)
  fluidity: 0.95,

  // Pressure solver
  jacobiIterations: 50,
  useRedBlackGS: true,
};
```

### Option B: Keep Current Visual Style, Fix Density

If you prefer the current particle size visually:

```typescript
const simConfig = {
  particleRadius: 0.12,  // Keep current

  // Adjust particle count to maintain ~8 per cell
  // With 32×16×16 grid = 8192 cells, ~50% fluid = 4096 fluid cells
  // Target: 4096 * 8 = 32,768 particles
  particleCount: 33000,

  fluidity: 0.95,  // Slightly reduce for stability
};
```

---

## Summary

| Priority | Issue | Action |
|----------|-------|--------|
| HIGH | Particle density | Verify ~8 particles per fluid cell |
| MEDIUM | Radius/cell relationship | Consider making radius proportional to dx |
| LOW | PIC/FLIP ratio | Current 0.99 is fine, could reduce to 0.95 |
| LOW | Pressure solver | Current Red-Black GS is acceptable |

**Bottom Line**: The simulation should work well for whitewater once particle density is verified. The pressure solver difference will cause slight compressibility but shouldn't prevent good foam/spray behavior.

---

## References

- Blender FLIP Fluids: `ref/Blender-FLIP-Fluids/src/engine/fluidsimulation.cpp`
- Zhu & Bridson (2005): "Animating Sand as a Fluid"
- Brackbill & Ruppel (1986): "FLIP: A Method for Adaptively Zoned, Particle-in-Cell Calculations"
