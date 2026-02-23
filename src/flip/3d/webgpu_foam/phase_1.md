# Phase 1: Surface SDF Infrastructure

**Date**: 2026-02-22
**Status**: Complete
**Goal**: Create a Signed Distance Field (SDF) for the fluid surface to enable whitewater particle classification (foam, spray, bubbles).

---

## Overview

The SDF provides distance-to-surface information for every grid cell:
- **Negative values**: Inside fluid (deeper = more negative)
- **Positive values**: Outside fluid (farther = more positive)
- **Near zero**: At the fluid surface

This is essential for whitewater because:
- `SDF < -threshold` → deep inside fluid → **bubble**
- `SDF ≈ 0` → at surface → **foam**
- `SDF > +threshold` → outside fluid → **spray**

---

## Files Modified/Created

### 1. `shaders/sdf.wgsl` (NEW FILE)

Created a separate shader module to stay within WebGPU's 10 storage buffer per-stage limit. The main `flip_simulation.wgsl` already uses 10 buffers, so SDF operations needed isolation.

**Uniforms:**
```wgsl
struct SDFUniforms {
  nx: u32,        // Grid X dimension
  ny: u32,        // Grid Y dimension
  nz: u32,        // Grid Z dimension
  jumpSize: u32,  // JFA jump distance (updated per pass)
};
```

**Bindings:**
| Binding | Type | Buffer |
|---------|------|--------|
| 0 | uniform | SDFUniforms |
| 1 | storage, read | marker (from main sim) |
| 2 | storage, read_write | surfaceSDF |

**Kernels:**

#### `initSDF` - Initialize SDF from marker buffer
```wgsl
@compute @workgroup_size(8, 4, 4)
fn initSDF(@builtin(global_invocation_id) id: vec3<u32>)
```

Logic:
1. Check if cell is a "surface cell" (fluid with air neighbor OR air with fluid neighbor)
2. Initialize values:
   - Surface fluid cells: `-0.5` (just inside)
   - Surface air cells: `+0.5` (just outside)
   - Interior fluid cells: `-1000.0` (unknown distance, inside)
   - Far air cells: `+1000.0` (unknown distance, outside)

#### `jfaPass` - Jump Flooding Algorithm pass
```wgsl
@compute @workgroup_size(8, 4, 4)
fn jfaPass(@builtin(global_invocation_id) id: vec3<u32>)
```

Logic:
1. Read current cell's SDF (distance and sign)
2. Check 26 neighbors at `jumpSize` distance (3x3x3 cube minus center)
3. For each neighbor: compute `newDist = neighborDist + stepDist`
4. Keep the minimum distance found
5. Write back: `sign(currentSDF) * bestDist`

---

### 2. `simulator.ts` - Additions

**New Properties:**
```typescript
// SDF buffer (same size as marker grid)
surfaceSDFBuffer: GPUBuffer;

// Separate shader module for SDF operations
private sdfShaderModule: GPUShaderModule;
private sdfPipelineLayout: GPUPipelineLayout;
private sdfBindGroup: GPUBindGroup;
private sdfUniformBuffer: GPUBuffer;

// Pipelines
initSDFPipeline!: GPUComputePipeline;
jfaPassPipeline!: GPUComputePipeline;
```

**Buffer Creation:**
```typescript
this.surfaceSDFBuffer = createBuffer(
  scalarGridCount * 4,  // float32 per cell
  GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
);
```

**Bind Group Setup:**
```typescript
const sdfBindGroupLayout = device.createBindGroupLayout({
  entries: [
    { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
    { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
    { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
  ],
});

this.sdfBindGroup = device.createBindGroup({
  layout: sdfBindGroupLayout,
  entries: [
    { binding: 0, resource: { buffer: this.sdfUniformBuffer } },
    { binding: 1, resource: { buffer: this.gridMarkerBuffer } },
    { binding: 2, resource: { buffer: this.surfaceSDFBuffer } },
  ],
});
```

**In `step()` method - dispatch initSDF:**
```typescript
// After marker update, before pressure solve
pass.setPipeline(this.initSDFPipeline);
pass.setBindGroup(0, this.sdfBindGroup);
pass.dispatchWorkgroups(scalarGridWG[0], scalarGridWG[1], scalarGridWG[2]);
pass.setBindGroup(0, this.simBindGroup); // Restore main bind group
```

**New `runJFA()` method:**
```typescript
runJFA() {
  const scalarGridWG = [
    Math.ceil(this.nx / 8),
    Math.ceil(this.ny / 4),
    Math.ceil(this.nz / 4),
  ];

  // Calculate starting jump size (next power of 2 >= max dimension, then halve)
  const maxDim = Math.max(this.nx, this.ny, this.nz);
  let jumpSize = 1;
  while (jumpSize < maxDim) {
    jumpSize *= 2;
  }
  jumpSize = jumpSize / 2;

  // Run JFA passes with decreasing jump sizes
  // Each pass submitted separately so uniform updates take effect
  while (jumpSize >= 1) {
    const sdfData = new Uint32Array([this.nx, this.ny, this.nz, jumpSize]);
    this.device.queue.writeBuffer(this.sdfUniformBuffer, 0, sdfData);

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.jfaPassPipeline);
    pass.setBindGroup(0, this.sdfBindGroup);
    pass.dispatchWorkgroups(scalarGridWG[0], scalarGridWG[1], scalarGridWG[2]);
    pass.end();
    this.device.queue.submit([encoder.finish()]);

    jumpSize = Math.floor(jumpSize / 2);
  }
}
```

---

### 3. `main.ts` - Additions

**SDF Staging Buffer (for diagnostics):**
```typescript
const sdfStagingBuffer = device.createBuffer({
  size: scalarBufferSize,
  usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
});
```

**Frame Loop - Simulation/JFA Ordering:**
```typescript
// Run simulation step
simulator.step(computePass, ...);
computePass.end();

// Submit simulation work BEFORE running JFA
// (JFA needs initSDF results to be on GPU)
device.queue.submit([commandEncoder.finish()]);

// Run JFA to propagate SDF distances
simulator.runJFA();

// Create new command encoder for rendering passes
commandEncoder = device.createCommandEncoder();
```

**Diagnostic Output:**
```typescript
// SDF analysis
let sdfInsideCount = 0;
let sdfOutsideCount = 0;
let minSDF = Infinity;
let maxSDF = -Infinity;
let surfaceCells = 0;

for (let i = 0; i < totalCells; i++) {
  const sdf = sdfData[i];
  if (sdf < 0) sdfInsideCount++;
  else sdfOutsideCount++;
  minSDF = Math.min(minSDF, sdf);
  maxSDF = Math.max(maxSDF, sdf);
  if (Math.abs(sdf) < 1) surfaceCells++;
}

const jfaWorking = maxSDF < 500 && minSDF > -500;

// Output
console.log(`
├─ Surface SDF ──────────────────────────────
│ Inside (SDF<0): ${sdfInsideCount} | Outside (SDF>0): ${sdfOutsideCount}
│ Expected: Inside=${fluidCells}, Outside=${totalCells - fluidCells}
│ SDF Range: [${minSDF.toFixed(2)}, ${maxSDF.toFixed(2)}]
│ Surface Cells (|SDF|<1): ${surfaceCells}
│ JFA Status: ${jfaWorking ? '✓ Propagated' : '⚠ Not propagated'}
│ Status: ${sdfStatus}
`);
```

---

## Bugs Encountered and Fixed

### Bug 1: Storage Buffer Limit Exceeded (11 > 10)

**Error:**
```
Exceeded the maximum number of storage buffers per shader stage (11 > 10)
```

**Cause:** Adding `surfaceSDF` as binding 11 in `flip_simulation.wgsl` exceeded WebGPU's hardware limit.

**Fix:** Created separate `sdf.wgsl` shader module with only 3 bindings (uniforms, marker, surfaceSDF).

---

### Bug 2: Air Surface Cells Not Identified

**Symptom:** `minSDF` was updating (-5 to -8) but `maxSDF` stayed at 1000.

**Cause:** `isSurfaceCell()` only checked fluid cells for air neighbors, not air cells for fluid neighbors.

**Fix:** Added else branch to check air cells:
```wgsl
fn isSurfaceCell(x: u32, y: u32, z: u32) -> bool {
  let isFluid = marker[si] == 1u;

  if (isFluid) {
    // Fluid cell: check for air neighbors
    // ... 6 neighbor checks for marker == 0
  } else {
    // Air cell: check for fluid neighbors  <-- ADDED
    // ... 6 neighbor checks for marker == 1
  }
  return false;
}
```

---

### Bug 3: JFA Uniform Buffer Race Condition

**Symptom:** All JFA passes ran with `jumpSize=1` (the last value).

**Cause:** `writeBuffer` calls in loop all completed before any compute passes ran, leaving uniform with final value.

**Fix:** Submit each JFA pass separately:
```typescript
while (jumpSize >= 1) {
  this.device.queue.writeBuffer(...);  // Update uniform

  const encoder = this.device.createCommandEncoder();
  // ... record pass ...
  this.device.queue.submit([encoder.finish()]);  // Submit immediately

  jumpSize = Math.floor(jumpSize / 2);
}
```

---

### Bug 4: JFA Running Before initSDF Complete

**Symptom:** SDF values still ±1000 after JFA.

**Cause:** Main command encoder (containing initSDF) wasn't submitted before `runJFA()` was called.

**Fix:** Split command encoder submission:
```typescript
simulator.step(computePass, ...);
computePass.end();

// Submit simulation work BEFORE JFA
device.queue.submit([commandEncoder.finish()]);

// Now JFA can run on initialized data
simulator.runJFA();

// Create new encoder for rendering
commandEncoder = device.createCommandEncoder();
```

---

## Verification Results

**Diagnostic Output (steady state):**
```
├─ Surface SDF ──────────────────────────────
│ Inside (SDF<0): 2581 | Outside (SDF>0): 5611
│ Expected: Inside=2581, Outside=5611
│ SDF Range: [-8.16, 14.23]
│ Surface Cells (|SDF|<1): 1034
│ JFA Status: ✓ Propagated
│ Status: ✓ Good
```

**Interpretation:**
- Inside/Outside counts match marker buffer exactly
- SDF range is reasonable (max ~14 grid cells from surface)
- ~1000 cells near surface (|SDF| < 1)
- JFA successfully propagating distances

---

## Algorithm: Jump Flooding Algorithm (JFA)

JFA efficiently computes approximate distance fields in O(log n) passes.

**Steps:**
1. Initialize seeds (surface cells) with distance 0
2. Initialize non-seeds with large distance (±1000)
3. For `jumpSize` in [n/2, n/4, ..., 2, 1]:
   - Each cell checks 26 neighbors at `jumpSize` distance
   - If `neighborDist + stepDist < currentDist`, update
4. After all passes, each cell has approximate distance to nearest seed

**For 32x16x16 grid:**
- Max dimension = 32
- Jump sizes: 16, 8, 4, 2, 1 (5 passes)
- Each pass: 8192 cells × 26 neighbors checked

---

## Performance Notes

- **initSDF**: Runs every frame (cheap, single pass)
- **JFA**: 5 passes for 32-cell dimension, each submitted separately
- **Memory**: 1 additional float32 buffer (same size as marker grid)

For a 32×16×16 grid:
- SDF buffer: 8192 × 4 bytes = 32 KB
- JFA passes: 5 × single dispatch

---

## Next Steps: Phase 2

With SDF infrastructure complete, Phase 2 will add whitewater emission potentials:

1. **Trapped Air Potential** - Curvature-based (Laplacian of velocity)
2. **Wave Crest Potential** - Velocity dot surface normal
3. **Kinetic Energy Potential** - Velocity magnitude squared

These will be stored in additional buffers and used to determine where to spawn foam/spray/bubble particles.

---

## References

- Rong & Tan (2006): "Jump Flooding in GPU with Applications to Voronoi Diagram and Distance Transform"
- Blender FLIP Fluids: `ref/Blender-FLIP-Fluids/src/engine/fluidsimulation.cpp`
