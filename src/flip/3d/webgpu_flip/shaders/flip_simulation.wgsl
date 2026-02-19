// FLIP fluid simulation kernels (compute).
//
// Core model:
// - Particles carry fluid mass/momentum (Lagrangian representation).
// - A staggered MAC grid enforces incompressibility (Eulerian projection).
// - Each frame performs P2G -> pressure solve -> G2P -> advection.
//
// Important implementation details:
// - Atomic integer accumulators are used for P2G weighted sums to avoid races.
// - `gridVelOrig` snapshots pre-projection grid velocity for FLIP delta update.
// - `fluidity` blends PIC/FLIP behavior (stability vs. vorticity retention).

struct Uniforms {
  nx: u32, ny: u32, nz: u32, particleCount: u32,
  width: f32, height: f32, depth: f32, dt: f32,
  frameNumber: f32, fluidity: f32, gravity: f32, particleDensity: f32,
  mouseVelocity: vec3<f32>, _pad4: f32,
  mouseRayOrigin: vec3<f32>, _pad5: f32,
  mouseRayDirection: vec3<f32>, _pad6: f32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read_write> positions: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> velocities: array<vec4<f32>>;

// Atomic buffers for P2G accumulation
struct AtomicCell { x: atomic<i32>, y: atomic<i32>, z: atomic<i32>, w: atomic<i32> };
@group(0) @binding(3) var<storage, read_write> gridVelAtomic: array<AtomicCell>;
@group(0) @binding(4) var<storage, read_write> gridWeightAtomic: array<AtomicCell>;

// Float buffers for simulation
@group(0) @binding(5) var<storage, read_write> gridVel: array<vec4<f32>>;
@group(0) @binding(6) var<storage, read_write> gridVelOrig: array<vec4<f32>>;
@group(0) @binding(7) var<storage, read_write> marker: array<u32>;
@group(0) @binding(8) var<storage, read_write> pressure: array<f32>;
@group(0) @binding(9) var<storage, read_write> divergence: array<f32>;
@group(0) @binding(10) var<storage, read> randomDirs: array<vec4<f32>>;

// Integer scaling factor for atomic accumulation precision.
const SCALE: f32 = 10000.0;
const TURBULENCE: f32 = 0.05;
const MOUSE_RADIUS: f32 = 5.0;

// =============================================================================
// Index Helper Functions
// =============================================================================

fn velIdx(x: u32, y: u32, z: u32) -> u32 {
  let cx = clamp(x, 0u, uniforms.nx);
  let cy = clamp(y, 0u, uniforms.ny);
  let cz = clamp(z, 0u, uniforms.nz);
  return cx + cy * (uniforms.nx + 1u) + cz * (uniforms.nx + 1u) * (uniforms.ny + 1u);
}

fn scalarIdx(x: u32, y: u32, z: u32) -> u32 {
  let cx = clamp(x, 0u, uniforms.nx - 1u);
  let cy = clamp(y, 0u, uniforms.ny - 1u);
  let cz = clamp(z, 0u, uniforms.nz - 1u);
  return cx + cy * uniforms.nx + cz * uniforms.nx * uniforms.ny;
}

fn worldToGrid(p: vec3<f32>) -> vec3<f32> {
  // Converts simulation/world coordinates into grid index space.
  return vec3<f32>(
    p.x / uniforms.width * f32(uniforms.nx),
    p.y / uniforms.height * f32(uniforms.ny),
    p.z / uniforms.depth * f32(uniforms.nz)
  );
}

// =============================================================================
// Kernel Functions
// =============================================================================

fn h(r: f32) -> f32 {
  if (r >= 0.0 && r <= 1.0) { return 1.0 - r; }
  else if (r >= -1.0 && r < 0.0) { return 1.0 + r; }
  return 0.0;
}

fn kernel(v: vec3<f32>) -> f32 {
  // Separable tent kernel used as interpolation weight.
  return h(v.x) * h(v.y) * h(v.z);
}

fn mouseKernel(gridPosition: vec3<f32>) -> f32 {
  let worldPosition = gridPosition / vec3<f32>(f32(uniforms.nx), f32(uniforms.ny), f32(uniforms.nz)) *
                     vec3<f32>(uniforms.width, uniforms.height, uniforms.depth);
  let toOrigin = worldPosition - uniforms.mouseRayOrigin;
  let distanceToMouseRay = length(cross(uniforms.mouseRayDirection, toOrigin));
  let normalizedDistance = max(0.0, distanceToMouseRay / MOUSE_RADIUS);
  return smoothstep(1.0, 0.9, normalizedDistance);
}

// =============================================================================
// Clear Grid
// =============================================================================

@compute @workgroup_size(8, 4, 4)
fn clearGrid(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x <= uniforms.nx && id.y <= uniforms.ny && id.z <= uniforms.nz) {
    let vi = velIdx(id.x, id.y, id.z);
    atomicStore(&gridVelAtomic[vi].x, 0);
    atomicStore(&gridVelAtomic[vi].y, 0);
    atomicStore(&gridVelAtomic[vi].z, 0);
    atomicStore(&gridVelAtomic[vi].w, 0);
    atomicStore(&gridWeightAtomic[vi].x, 0);
    atomicStore(&gridWeightAtomic[vi].y, 0);
    atomicStore(&gridWeightAtomic[vi].z, 0);
    atomicStore(&gridWeightAtomic[vi].w, 0);
    gridVel[vi] = vec4<f32>(0.0);
    gridVelOrig[vi] = vec4<f32>(0.0);
  }

  if (id.x < uniforms.nx && id.y < uniforms.ny && id.z < uniforms.nz) {
    let si = scalarIdx(id.x, id.y, id.z);
    marker[si] = 0u;
    pressure[si] = 0.0;
    divergence[si] = 0.0;
  }
}

// =============================================================================
// Particle to Grid (P2G)
// =============================================================================

@compute @workgroup_size(64)
fn transferToGrid(@builtin(global_invocation_id) id: vec3<u32>) {
  let pIdx = id.x;
  if (pIdx >= uniforms.particleCount) { return; }

  let pos = positions[pIdx].xyz;
  let vel = velocities[pIdx].xyz;
  let g = worldToGrid(pos);

  // Base cell for 2x2x2 neighborhood splat.
  let baseX = i32(floor(g.x));
  let baseY = i32(floor(g.y));
  let baseZ = i32(floor(g.z));

  for (var di = 0; di <= 1; di++) {
    for (var dj = 0; dj <= 1; dj++) {
      for (var dk = 0; dk <= 1; dk++) {
        let cellX = u32(max(0, baseX + di));
        let cellY = u32(max(0, baseY + dj));
        let cellZ = u32(max(0, baseZ + dk));

        if (cellX > uniforms.nx || cellY > uniforms.ny || cellZ > uniforms.nz) {
          continue;
        }

        let cellIdx = velIdx(cellX, cellY, cellZ);

        // MAC staggering:
        // - x velocity on yz-face center
        // - y velocity on xz-face center
        // - z velocity on xy-face center
        let xPos = vec3<f32>(f32(cellX), f32(cellY) + 0.5, f32(cellZ) + 0.5);
        let yPos = vec3<f32>(f32(cellX) + 0.5, f32(cellY), f32(cellZ) + 0.5);
        let zPos = vec3<f32>(f32(cellX) + 0.5, f32(cellY) + 0.5, f32(cellZ));
        let scalarPos = vec3<f32>(f32(cellX) + 0.5, f32(cellY) + 0.5, f32(cellZ) + 0.5);

        let xWeight = kernel(g - xPos);
        let yWeight = kernel(g - yPos);
        let zWeight = kernel(g - zPos);
        let scalarWeight = kernel(g - scalarPos);

        atomicAdd(&gridWeightAtomic[cellIdx].x, i32(xWeight * SCALE));
        atomicAdd(&gridWeightAtomic[cellIdx].y, i32(yWeight * SCALE));
        atomicAdd(&gridWeightAtomic[cellIdx].z, i32(zWeight * SCALE));
        atomicAdd(&gridWeightAtomic[cellIdx].w, i32(scalarWeight * SCALE));

        atomicAdd(&gridVelAtomic[cellIdx].x, i32(vel.x * xWeight * SCALE));
        atomicAdd(&gridVelAtomic[cellIdx].y, i32(vel.y * yWeight * SCALE));
        atomicAdd(&gridVelAtomic[cellIdx].z, i32(vel.z * zWeight * SCALE));
      }
    }
  }
}

// =============================================================================
// Mark Cells
// =============================================================================

@compute @workgroup_size(64)
fn markCells(@builtin(global_invocation_id) id: vec3<u32>) {
  let pIdx = id.x;
  if (pIdx >= uniforms.particleCount) { return; }

  let pos = positions[pIdx].xyz;
  let g = worldToGrid(pos);

  let cellX = u32(clamp(i32(floor(g.x)), 0, i32(uniforms.nx) - 1));
  let cellY = u32(clamp(i32(floor(g.y)), 0, i32(uniforms.ny) - 1));
  let cellZ = u32(clamp(i32(floor(g.z)), 0, i32(uniforms.nz) - 1));

  let si = scalarIdx(cellX, cellY, cellZ);
  marker[si] = 1u;
}

// =============================================================================
// Normalize Grid
// =============================================================================

@compute @workgroup_size(8, 4, 4)
fn normalizeGrid(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x > uniforms.nx || id.y > uniforms.ny || id.z > uniforms.nz) { return; }
  let vi = velIdx(id.x, id.y, id.z);

  let wx = f32(atomicLoad(&gridWeightAtomic[vi].x)) / SCALE;
  let wy = f32(atomicLoad(&gridWeightAtomic[vi].y)) / SCALE;
  let wz = f32(atomicLoad(&gridWeightAtomic[vi].z)) / SCALE;
  let ws = f32(atomicLoad(&gridWeightAtomic[vi].w)) / SCALE;

  // Divide weighted sums by total weights component-wise.
  var vx = 0.0;
  var vy = 0.0;
  var vz = 0.0;

  if (wx > 0.0) {
    vx = f32(atomicLoad(&gridVelAtomic[vi].x)) / SCALE / wx;
  }
  if (wy > 0.0) {
    vy = f32(atomicLoad(&gridVelAtomic[vi].y)) / SCALE / wy;
  }
  if (wz > 0.0) {
    vz = f32(atomicLoad(&gridVelAtomic[vi].z)) / SCALE / wz;
  }

  gridVel[vi] = vec4<f32>(vx, vy, vz, ws);
  gridVelOrig[vi] = vec4<f32>(vx, vy, vz, ws);
}

// =============================================================================
// Add Gravity and Mouse Force
// =============================================================================

@compute @workgroup_size(8, 4, 4)
fn addGravity(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x > uniforms.nx || id.y > uniforms.ny || id.z > uniforms.nz) { return; }
  let vi = velIdx(id.x, id.y, id.z);

  gridVel[vi].y -= uniforms.gravity * uniforms.dt;

  let xPosition = vec3<f32>(f32(id.x), f32(id.y) + 0.5, f32(id.z) + 0.5);
  let yPosition = vec3<f32>(f32(id.x) + 0.5, f32(id.y), f32(id.z) + 0.5);
  let zPosition = vec3<f32>(f32(id.x) + 0.5, f32(id.y) + 0.5, f32(id.z));

  let kernelX = mouseKernel(xPosition);
  let kernelY = mouseKernel(yPosition);
  let kernelZ = mouseKernel(zPosition);

  // Mouse force scales with timestep to remain stable across dt changes.
  let forceMultiplier = 3.0 * smoothstep(0.0, 1.0 / 200.0, uniforms.dt);

  gridVel[vi].x += uniforms.mouseVelocity.x * kernelX * forceMultiplier;
  gridVel[vi].y += uniforms.mouseVelocity.y * kernelY * forceMultiplier;
  gridVel[vi].z += uniforms.mouseVelocity.z * kernelZ * forceMultiplier;
}

// =============================================================================
// Enforce Boundary Conditions
// =============================================================================

@compute @workgroup_size(8, 4, 4)
fn enforceBoundary(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x > uniforms.nx || id.y > uniforms.ny || id.z > uniforms.nz) { return; }
  let vi = velIdx(id.x, id.y, id.z);

  if (id.x == 0u) { gridVel[vi].x = 0.0; }
  if (id.x == uniforms.nx) { gridVel[vi].x = 0.0; }
  if (id.y == 0u) { gridVel[vi].y = 0.0; }
  if (id.y == uniforms.ny) { gridVel[vi].y = min(gridVel[vi].y, 0.0); }
  if (id.z == 0u) { gridVel[vi].z = 0.0; }
  if (id.z == uniforms.nz) { gridVel[vi].z = 0.0; }
}

// =============================================================================
// Compute Divergence
// =============================================================================

@compute @workgroup_size(8, 4, 4)
fn computeDivergence(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= uniforms.nx || id.y >= uniforms.ny || id.z >= uniforms.nz) { return; }
  let si = scalarIdx(id.x, id.y, id.z);

  if (marker[si] == 0u) {
    divergence[si] = 0.0;
    return;
  }

  let leftX = gridVel[velIdx(id.x, id.y, id.z)].x;
  let rightX = gridVel[velIdx(id.x + 1u, id.y, id.z)].x;
  let bottomY = gridVel[velIdx(id.x, id.y, id.z)].y;
  let topY = gridVel[velIdx(id.x, id.y + 1u, id.z)].y;
  let backZ = gridVel[velIdx(id.x, id.y, id.z)].z;
  let frontZ = gridVel[velIdx(id.x, id.y, id.z + 1u)].z;

  // Discrete divergence of staggered velocity field.
  var div = (rightX - leftX) + (topY - bottomY) + (frontZ - backZ);

  // Extra compression term pushes dense regions apart.
  let density = gridVel[velIdx(id.x, id.y, id.z)].w;
  div -= max((density - uniforms.particleDensity) * 1.0, 0.0);

  divergence[si] = div;
}

// =============================================================================
// Jacobi Pressure Solve
// =============================================================================

@compute @workgroup_size(8, 4, 4)
fn jacobi(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= uniforms.nx || id.y >= uniforms.ny || id.z >= uniforms.nz) { return; }
  let si = scalarIdx(id.x, id.y, id.z);

  if (marker[si] == 0u) { return; }

  let div = divergence[si];

  var pL = 0.0; var pR = 0.0; var pB = 0.0; var pT = 0.0; var pBk = 0.0; var pFr = 0.0;

  if (id.x > 0u) { pL = pressure[scalarIdx(id.x - 1u, id.y, id.z)]; }
  if (id.x < uniforms.nx - 1u) { pR = pressure[scalarIdx(id.x + 1u, id.y, id.z)]; }
  if (id.y > 0u) { pB = pressure[scalarIdx(id.x, id.y - 1u, id.z)]; }
  if (id.y < uniforms.ny - 1u) { pT = pressure[scalarIdx(id.x, id.y + 1u, id.z)]; }
  if (id.z > 0u) { pBk = pressure[scalarIdx(id.x, id.y, id.z - 1u)]; }
  if (id.z < uniforms.nz - 1u) { pFr = pressure[scalarIdx(id.x, id.y, id.z + 1u)]; }

  // One Jacobi relaxation step for Poisson pressure equation.
  pressure[si] = (pL + pR + pB + pT + pBk + pFr - div) / 6.0;
}

// =============================================================================
// Apply Pressure Gradient
// =============================================================================

@compute @workgroup_size(8, 4, 4)
fn applyPressure(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x > uniforms.nx || id.y > uniforms.ny || id.z > uniforms.nz) { return; }
  let vi = velIdx(id.x, id.y, id.z);

  var v = gridVel[vi];

  let pRight = pressure[scalarIdx(id.x, id.y, id.z)];
  let pLeft = pressure[scalarIdx(id.x - 1u, id.y, id.z)];
  v.x -= (pRight - pLeft);

  let pTop = pressure[scalarIdx(id.x, id.y, id.z)];
  let pBottom = pressure[scalarIdx(id.x, id.y - 1u, id.z)];
  v.y -= (pTop - pBottom);

  let pFront = pressure[scalarIdx(id.x, id.y, id.z)];
  let pBack = pressure[scalarIdx(id.x, id.y, id.z - 1u)];
  v.z -= (pFront - pBack);

  gridVel[vi] = v;
}

// =============================================================================
// Staggered Velocity Sampling Functions
// =============================================================================

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
        v += gridVel[velIdx(ix, iy, iz)].x * w;
      }
    }
  }
  return v;
}

fn sampleYVelocity(g: vec3<f32>) -> f32 {
  let p = vec3<f32>(g.x - 0.5, g.y, g.z - 0.5);
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
        v += gridVel[velIdx(ix, iy, iz)].y * w;
      }
    }
  }
  return v;
}

fn sampleZVelocity(g: vec3<f32>) -> f32 {
  let p = vec3<f32>(g.x - 0.5, g.y - 0.5, g.z);
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
        v += gridVel[velIdx(ix, iy, iz)].z * w;
      }
    }
  }
  return v;
}

fn sampleVelocity(p: vec3<f32>) -> vec3<f32> {
  let g = worldToGrid(p);
  return vec3<f32>(sampleXVelocity(g), sampleYVelocity(g), sampleZVelocity(g));
}

fn sampleXVelocityOrig(g: vec3<f32>) -> f32 {
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
        v += gridVelOrig[velIdx(ix, iy, iz)].x * w;
      }
    }
  }
  return v;
}

fn sampleYVelocityOrig(g: vec3<f32>) -> f32 {
  let p = vec3<f32>(g.x - 0.5, g.y, g.z - 0.5);
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
        v += gridVelOrig[velIdx(ix, iy, iz)].y * w;
      }
    }
  }
  return v;
}

fn sampleZVelocityOrig(g: vec3<f32>) -> f32 {
  let p = vec3<f32>(g.x - 0.5, g.y - 0.5, g.z);
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
        v += gridVelOrig[velIdx(ix, iy, iz)].z * w;
      }
    }
  }
  return v;
}

fn sampleVelocityOrig(p: vec3<f32>) -> vec3<f32> {
  let g = worldToGrid(p);
  return vec3<f32>(sampleXVelocityOrig(g), sampleYVelocityOrig(g), sampleZVelocityOrig(g));
}

// =============================================================================
// Grid to Particle (G2P)
// =============================================================================

@compute @workgroup_size(64)
fn gridToParticle(@builtin(global_invocation_id) id: vec3<u32>) {
  let pIdx = id.x;
  if (pIdx >= uniforms.particleCount) { return; }

  let pos = positions[pIdx].xyz;
  let velOld = velocities[pIdx].xyz;

  let vGridNew = sampleVelocity(pos);
  let vGridOld = sampleVelocityOrig(pos);

  // FLIP = add grid delta to previous particle velocity.
  let vFlip = velOld + (vGridNew - vGridOld);
  let vPic = vGridNew;
  // fluidity controls PIC/FLIP blend.
  let vNew = mix(vPic, vFlip, uniforms.fluidity);

  velocities[pIdx] = vec4<f32>(vNew, 0.0);
}

// =============================================================================
// Advect Particles
// =============================================================================

@compute @workgroup_size(64)
fn advect(@builtin(global_invocation_id) id: vec3<u32>) {
  let pIdx = id.x;
  if (pIdx >= uniforms.particleCount) { return; }

  var pos = positions[pIdx].xyz;

  // Midpoint (RK2) integration for better stability than Euler.
  let v1 = sampleVelocity(pos);
  let midPos = pos + v1 * uniforms.dt * 0.5;
  let v2 = sampleVelocity(midPos);

  var step = v2 * uniforms.dt;

  let offset = u32(uniforms.frameNumber) % uniforms.particleCount;
  let randomIdx = (pIdx + offset) % uniforms.particleCount;
  let randomDir = randomDirs[randomIdx].xyz;
  // Small velocity-proportional noise keeps motion lively.
  step += TURBULENCE * randomDir * length(v1) * uniforms.dt;

  pos += step;

  // Keep particles inside container with small epsilon.
  let eps = 0.01;
  pos = clamp(pos, vec3<f32>(eps), vec3<f32>(uniforms.width - eps, uniforms.height - eps, uniforms.depth - eps));

  positions[pIdx] = vec4<f32>(pos, 1.0);
}
