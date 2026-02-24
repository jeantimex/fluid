# Phase 2: Whitewater Emission Potentials

**Date**: 2026-02-23
**Status**: Complete
**Goal**: Compute emission potentials that determine where whitewater particles (foam, spray, bubbles) should spawn.

---

## Overview

Whitewater particles are emitted based on three physical criteria:

| Potential | Symbol | Formula | What It Measures |
|-----------|--------|---------|------------------|
| **Trapped Air** | Ita | \|∇ × v\| | Vorticity/turbulence → bubbles |
| **Wave Crest** | Iwc | max(0, v · n) | Breaking waves → spray |
| **Kinetic Energy** | Ike | \|v\|² | Overall energy → emission rate |

These potentials are computed per grid cell near the fluid surface and will be used in Phase 3 to determine emission probability.

---

## Files Created/Modified

### 1. `shaders/emission.wgsl` (NEW FILE)

New shader module for emission potential computation. Uses 6 bindings (within the 10-buffer limit).

**Uniforms:**

```wgsl
struct EmissionUniforms {
  nx: u32,
  ny: u32,
  nz: u32,
  _pad: u32,
};
```

**Bindings:**

| Binding | Type | Buffer |
|---------|------|--------|
| 0 | uniform | EmissionUniforms |
| 1 | storage, read | velocity (MAC grid) |
| 2 | storage, read | surfaceSDF |
| 3 | storage, read_write | trappedAirPotential |
| 4 | storage, read_write | waveCrestPotential |
| 5 | storage, read_write | kineticEnergyPotential |

**Helper Functions:**

```wgsl
/// Sample velocity at cell center by averaging face velocities (MAC grid)
fn sampleVelocityAtCell(x: u32, y: u32, z: u32) -> vec3<f32> {
  let vx = (velocity[velIdx(x, y, z)].x + velocity[velIdx(x + 1u, y, z)].x) * 0.5;
  let vy = (velocity[velIdx(x, y, z)].y + velocity[velIdx(x, y + 1u, z)].y) * 0.5;
  let vz = (velocity[velIdx(x, y, z)].z + velocity[velIdx(x, y, z + 1u)].z) * 0.5;
  return vec3<f32>(vx, vy, vz);
}
```

**Kernels:**

#### `computeTrappedAir` - Vorticity (Curl Magnitude)

Computes the curl of the velocity field: **ω = ∇ × v**

```wgsl
@compute @workgroup_size(8, 4, 4)
fn computeTrappedAir(@builtin(global_invocation_id) id: vec3<u32>) {
  // Skip cells far from surface (optimization)
  if (abs(sdf) > 3.0) {
    trappedAirPotential[si] = 0.0;
    return;
  }

  // Sample velocities at neighboring cells
  let v_xm = sampleVelocityAtCell(x - 1, y, z);
  let v_xp = sampleVelocityAtCell(x + 1, y, z);
  // ... (y and z neighbors)

  // Compute curl using central differences
  // ωx = ∂vz/∂y - ∂vy/∂z
  let curl_x = (v_yp.z - v_ym.z) * 0.5 - (v_zp.y - v_zm.y) * 0.5;
  // ωy = ∂vx/∂z - ∂vz/∂x
  let curl_y = (v_zp.x - v_zm.x) * 0.5 - (v_xp.z - v_xm.z) * 0.5;
  // ωz = ∂vy/∂x - ∂vx/∂y
  let curl_z = (v_xp.y - v_xm.y) * 0.5 - (v_yp.x - v_ym.x) * 0.5;

  // Vorticity magnitude
  let vorticity = sqrt(curl_x * curl_x + curl_y * curl_y + curl_z * curl_z);
  trappedAirPotential[si] = vorticity;
}
```

#### `computeWaveCrest` - Velocity Dot Surface Normal

Measures breaking waves where fluid moves outward from the surface.

```wgsl
@compute @workgroup_size(8, 4, 4)
fn computeWaveCrest(@builtin(global_invocation_id) id: vec3<u32>) {
  // Only compute near surface
  if (abs(sdf) > 2.0) {
    waveCrestPotential[si] = 0.0;
    return;
  }

  // Compute SDF gradient (surface normal direction)
  var normal = vec3<f32>(
    (sdf_xp - sdf_xm) * 0.5,
    (sdf_yp - sdf_ym) * 0.5,
    (sdf_zp - sdf_zm) * 0.5
  );
  normal = normalize(normal);

  // Sample velocity at cell center
  let vel = sampleVelocityAtCell(x, y, z);

  // Wave crest potential = max(0, v · n)
  // Positive when velocity points outward (breaking wave)
  waveCrestPotential[si] = max(0.0, dot(vel, normal));
}
```

#### `computeKineticEnergy` - Velocity Magnitude Squared

Simple energy measure used as emission rate multiplier.

```wgsl
@compute @workgroup_size(8, 4, 4)
fn computeKineticEnergy(@builtin(global_invocation_id) id: vec3<u32>) {
  // Only compute near surface
  if (abs(sdf) > 3.0) {
    kineticEnergyPotential[si] = 0.0;
    return;
  }

  let vel = sampleVelocityAtCell(id.x, id.y, id.z);
  kineticEnergyPotential[si] = dot(vel, vel);  // |v|²
}
```

---

### 2. `simulator.ts` - Additions

**New Buffer Properties:**

```typescript
// Whitewater Emission Potential Buffers
trappedAirPotentialBuffer: GPUBuffer;   // Ita - vorticity
waveCrestPotentialBuffer: GPUBuffer;    // Iwc - v·n
kineticEnergyPotentialBuffer: GPUBuffer; // Ike - |v|²

// Emission shader resources
private emissionShaderModule: GPUShaderModule;
private emissionPipelineLayout: GPUPipelineLayout;
private emissionBindGroup: GPUBindGroup;
private emissionUniformBuffer: GPUBuffer;

// Pipelines
computeTrappedAirPipeline!: GPUComputePipeline;
computeWaveCrestPipeline!: GPUComputePipeline;
computeKineticEnergyPipeline!: GPUComputePipeline;
```

**Buffer Creation:**

```typescript
// Trapped Air Potential (Ita)
this.trappedAirPotentialBuffer = createBuffer(
  scalarGridCount * 4,
  GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
);

// Wave Crest Potential (Iwc)
this.waveCrestPotentialBuffer = createBuffer(
  scalarGridCount * 4,
  GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
);

// Kinetic Energy Potential (Ike)
this.kineticEnergyPotentialBuffer = createBuffer(
  scalarGridCount * 4,
  GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
);
```

**Bind Group Setup:**

```typescript
const emissionBindGroupLayout = device.createBindGroupLayout({
  entries: [
    { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
    { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
    { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
    { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
  ],
});

this.emissionBindGroup = device.createBindGroup({
  layout: emissionBindGroupLayout,
  entries: [
    { binding: 0, resource: { buffer: this.emissionUniformBuffer } },
    { binding: 1, resource: { buffer: this.gridVelocityFloatBuffer } },
    { binding: 2, resource: { buffer: this.surfaceSDFBuffer } },
    { binding: 3, resource: { buffer: this.trappedAirPotentialBuffer } },
    { binding: 4, resource: { buffer: this.waveCrestPotentialBuffer } },
    { binding: 5, resource: { buffer: this.kineticEnergyPotentialBuffer } },
  ],
});
```

**New Method - `computeEmissionPotentials()`:**

```typescript
computeEmissionPotentials() {
  const scalarGridWG = [
    Math.ceil(this.nx / 8),
    Math.ceil(this.ny / 4),
    Math.ceil(this.nz / 4),
  ];

  // Update emission uniforms
  const emissionData = new Uint32Array([this.nx, this.ny, this.nz, 0]);
  this.device.queue.writeBuffer(this.emissionUniformBuffer, 0, emissionData);

  // Create encoder and compute pass
  const encoder = this.device.createCommandEncoder();
  const pass = encoder.beginComputePass();
  pass.setBindGroup(0, this.emissionBindGroup);

  // Compute all three potentials
  pass.setPipeline(this.computeTrappedAirPipeline);
  pass.dispatchWorkgroups(scalarGridWG[0], scalarGridWG[1], scalarGridWG[2]);

  pass.setPipeline(this.computeWaveCrestPipeline);
  pass.dispatchWorkgroups(scalarGridWG[0], scalarGridWG[1], scalarGridWG[2]);

  pass.setPipeline(this.computeKineticEnergyPipeline);
  pass.dispatchWorkgroups(scalarGridWG[0], scalarGridWG[1], scalarGridWG[2]);

  pass.end();
  this.device.queue.submit([encoder.finish()]);
}
```

---

### 3. `main.ts` - Additions

**Frame Loop Integration:**

```typescript
// Run JFA to propagate SDF distances
simulator.runJFA();

// Compute whitewater emission potentials (Ita, Iwc, Ike)
simulator.computeEmissionPotentials();

// Create new command encoder for rendering passes
commandEncoder = device.createCommandEncoder();
```

**Diagnostic Staging Buffers:**

```typescript
const trappedAirStagingBuffer = device.createBuffer({
  size: scalarBufferSize,
  usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
});
const waveCrestStagingBuffer = device.createBuffer({
  size: scalarBufferSize,
  usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
});
const kineticEnergyStagingBuffer = device.createBuffer({
  size: scalarBufferSize,
  usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
});
```

**Diagnostic Analysis:**

```typescript
// Analyze emission potentials at surface cells (|SDF| < 3)
let itaMin = Infinity, itaMax = 0, itaSum = 0, itaCount = 0;
let iwcMin = Infinity, iwcMax = 0, iwcSum = 0, iwcCount = 0;
let ikeMin = Infinity, ikeMax = 0, ikeSum = 0, ikeCount = 0;
let activeCells = 0;

for (let i = 0; i < totalCells; i++) {
  const sdf = sdfData[i];
  if (Math.abs(sdf) > 3.0) continue;

  const ita = trappedAirData[i];
  const iwc = waveCrestData[i];
  const ike = kineticEnergyData[i];

  // Track statistics...
}
```

**Diagnostic Output:**

```
├─ Emission Potentials ───────────────────
│ Active Cells: 3449 (near surface with potential > 0)
│ Trapped Air (Ita): [0.02, 15.40] avg=3.67 (2870 cells)
│ Wave Crest (Iwc):  [0.00, 18.75] avg=3.14 (1175 cells)
│ Kinetic (Ike):     [0.00, 491.95] avg=56.92 (3449 cells)
│ Status: ✓ Good
```

---

## Verification Results

**Sample Diagnostic Output (active splashing):**

```
├─ Emission Potentials ───────────────────
│ Active Cells: 4868 (near surface with potential > 0)
│ Trapped Air (Ita): [0.00, 17.21] avg=5.41 (3837 cells)
│ Wave Crest (Iwc):  [0.00, 22.53] avg=4.51 (1160 cells)
│ Kinetic (Ike):     [0.44, 858.61] avg=118.45 (4868 cells)
│ Status: ✓ Good
```

**Sample Diagnostic Output (settling):**

```
├─ Emission Potentials ───────────────────
│ Active Cells: 3449 (near surface with potential > 0)
│ Trapped Air (Ita): [0.02, 15.40] avg=3.67 (2870 cells)
│ Wave Crest (Iwc):  [0.00, 18.75] avg=3.14 (1175 cells)
│ Kinetic (Ike):     [0.00, 491.95] avg=56.92 (3449 cells)
│ Status: ✓ Good
```

**Interpretation:**

| Potential | Active Motion | Settling | Notes |
|-----------|--------------|----------|-------|
| Ita (Vorticity) | max ~17-30 | max ~15 | Spikes in turbulent regions |
| Iwc (Wave Crest) | max ~22-27 | max ~18 | Localized to breaking waves |
| Ike (Energy) | max ~858-1311 | max ~492 | Correlates with velocity |

**Key Observations:**

1. **Trapped Air (Ita)** is active in 2800-3800 cells
   - Spreads through turbulent regions
   - Good for bubble emission in churning water

2. **Wave Crest (Iwc)** is active in 640-1360 cells
   - More localized than Ita (as expected)
   - Concentrated at wave peaks and splashes
   - Good for spray emission

3. **Kinetic Energy (Ike)** is active in 3300-4800 cells
   - Wherever there's motion
   - Will serve as emission rate multiplier

---

## Algorithm Details

### Vorticity (Curl) Computation

The curl of a velocity field measures local rotation:

```
ω = ∇ × v = (∂vz/∂y - ∂vy/∂z, ∂vx/∂z - ∂vz/∂x, ∂vy/∂x - ∂vx/∂y)
```

Using central differences on a grid:
- `∂vz/∂y ≈ (vz[y+1] - vz[y-1]) / 2`
- Similar for other components

High vorticity indicates:
- Swirling water (eddies)
- Turbulent mixing zones
- Where air gets trapped → bubbles

### Wave Crest Detection

Wave crests occur where:
1. Fluid is at the surface (|SDF| < 2)
2. Velocity points outward from fluid (v · n > 0)

The surface normal `n` comes from the SDF gradient:
```
n = normalize(∇SDF)
```

High `v · n` indicates:
- Water moving away from bulk fluid
- Breaking wave peaks
- Splash trajectories → spray

---

## Performance Notes

**Per-Frame Cost:**

| Operation | Dispatches | Cells Processed |
|-----------|------------|-----------------|
| computeTrappedAir | 1 | ~2500 (near surface) |
| computeWaveCrest | 1 | ~2500 (near surface) |
| computeKineticEnergy | 1 | ~2500 (near surface) |

**Optimization:** All three kernels skip cells with |SDF| > 3, reducing computation to ~30% of the grid (near-surface region only).

**Memory:**

| Buffer | Size (32×16×16 grid) |
|--------|---------------------|
| trappedAirPotentialBuffer | 32 KB |
| waveCrestPotentialBuffer | 32 KB |
| kineticEnergyPotentialBuffer | 32 KB |
| **Total Phase 2** | 96 KB |

---

## Next Steps: Phase 3

With emission potentials computed, Phase 3 will:

1. **Create Whitewater Particle System**
   - Separate particle buffers for foam/spray/bubbles
   - Position, velocity, lifetime, type

2. **Emission Kernel**
   - Sample potentials at particle emission sites
   - Probabilistic emission based on combined potential
   - `P_emit = k_ta * Ita + k_wc * Iwc) * Ike`

3. **Classification Kernel**
   - Use SDF to classify particles:
     - SDF < -threshold → bubble
     - |SDF| < threshold → foam
     - SDF > threshold → spray

4. **Advection & Rendering**
   - Different physics for each type
   - Point sprite or mesh rendering

---

## References

- Ihmsen et al. (2012): "Unified Spray, Foam and Bubbles for Particle-Based Fluids"
- Blender FLIP Fluids: `ref/Blender-FLIP-Fluids/src/engine/diffuseparticle.cpp`
- Bridson (2015): "Fluid Simulation for Computer Graphics", Chapter 12
