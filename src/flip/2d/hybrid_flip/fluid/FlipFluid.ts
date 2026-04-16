// ─── Cell type constants ──────────────────────────────────────────────────────
// Every cell in the MAC grid is tagged with one of these three types each frame.
// FLUID  – at least one particle centre falls inside this cell.
// AIR    – no particle, and the cell is not a boundary wall.
// SOLID  – a boundary wall; velocity on its face is forced to zero (no-slip).
export const FLUID_CELL = 0;
export const AIR_CELL = 1;
export const SOLID_CELL = 2;
export const DIFFUSE_BUBBLE = 0;
export const DIFFUSE_FOAM = 1;
export const DIFFUSE_SPRAY = 2;

function clamp(x: number, min: number, max: number): number {
  if (x < min) return min;
  if (x > max) return max;
  return x;
}

// ─── FlipFluid ────────────────────────────────────────────────────────────────
//
// Implements the FLIP (Fluid-Implicit-Particle) method on a 2-D MAC (marker-
// and-cell) staggered grid.  The core idea is a two-way coupling between a
// Lagrangian particle layer and an Eulerian velocity grid:
//
//   1. Particles carry position, velocity, and colour.
//   2. Every step, particle velocities are splat onto the grid (P→G).
//   3. The grid solves for pressure to enforce incompressibility (∇·u = 0).
//   4. The pressure-induced velocity change is transferred back to the particles
//      (G→P) using a blend of PIC (fully grid-driven) and FLIP (velocity-
//      correction only) to control numerical dissipation.
//
// Grid layout (staggered MAC):
//   u[i][j]  – horizontal velocity stored on the LEFT face of cell (i,j).
//   v[i][j]  – vertical   velocity stored on the BOTTOM face of cell (i,j).
//   p[i][j]  – pressure   stored at the cell CENTRE.
//
// All flat arrays are laid out in column-major order: index = i * fNumY + j.
export class FlipFluid {
  // ── Grid geometry ────────────────────────────────────────────────────────
  density: number;    // fluid density  [kg/m³]; used in pressure coefficient
  fNumX: number;      // number of grid columns (can change when domain resizes)
  fNumY: number;      // number of grid rows    (can change when domain resizes)
  h: number;          // cell side length [world units]; fixed for the lifetime
                      //   of the simulation — derived from SIM_HEIGHT/resolution
  fInvSpacing: number; // 1 / h; cached for performance
  fNumCells: number;  // fNumX * fNumY; total cell count

  // ── MAC velocity field ───────────────────────────────────────────────────
  // u[i*fNumY+j]  – horizontal velocity on left face of cell (i,j)
  // v[i*fNumY+j]  – vertical   velocity on bottom face of cell (i,j)
  u: Float32Array;
  v: Float32Array;
  // Weighted-sum accumulators used during the particle-to-grid (P→G) transfer.
  // After all particles have contributed, each face velocity is divided by its
  // accumulated weight to obtain the weighted average.
  du: Float32Array;
  dv: Float32Array;
  // Snapshot of u/v taken at the start of the P→G transfer (before the current
  // frame's particle velocities overwrite them).  Used in two ways:
  //   • Solid-wall enforcement: faces adjacent to a SOLID cell are restored to
  //     their pre-transfer value (zero for stationary walls).
  //   • FLIP correction: solveIncompressibility overwrites prevU/prevV with the
  //     post-P2G velocities so that the G→P step can compute the pressure-only
  //     velocity delta (f_post_pressure − f_pre_pressure).
  prevU: Float32Array;
  prevV: Float32Array;
  p: Float32Array;    // pressure field [Pa]; reset to zero every frame
  // Temporary velocity buffers for extrapolation or intermediate steps.
  tempU: Float32Array;
  tempV: Float32Array;
  // Solid mask: s[i*fNumY+j] = 0.0 for SOLID cells, 1.0 for everything else.
  // Used in solveIncompressibility to count and weight open neighbours so that
  // the pressure update never pushes velocity into a wall.
  s: Float32Array;
  cellType: Int32Array;    // per-cell type (FLUID_CELL / AIR_CELL / SOLID_CELL)
  cellColor: Float32Array; // packed RGB [0,1] for grid debug visualisation (3 floats per cell)
  vorticity: Float32Array; // vorticity magnitude for whitewater emission

  // ── Particle data ────────────────────────────────────────────────────────
  maxParticles: number;         // allocated capacity (fixed after construction)
  particlePos: Float32Array;    // [x0,y0, x1,y1, …]  world-space positions
  particleColor: Float32Array;  // [r0,g0,b0, r1,g1,b1, …]  per-particle colour
  particleVel: Float32Array;    // [vx0,vy0, vx1,vy1, …]  velocities [world/s]
  // Per-cell particle density computed by bilinear splatting each particle onto
  // the four surrounding cell centres.  One scalar per grid cell.
  particleDensity: Float32Array;
  // Average particleDensity over all FLUID cells, computed on the very first
  // frame and then held constant for the lifetime of the simulation.
  // Used by solveIncompressibility to detect local compression and generate an
  // extra divergence term that gently pushes over-compressed regions apart
  // (the "drift compensation" feature).
  // IMPORTANT: must NOT be reset when the domain is resized — it is a physical
  // property of the particle packing and should only be recomputed when the
  // simulation is fully restarted (new FlipFluid instance).
  particleRestDensity: number;
  numParticles: number; // live particle count (≤ maxParticles)

  // ── Colour settings ──────────────────────────────────────────────────────
  baseColor: { r: number; g: number; b: number }; // colour of bulk fluid
  foamColor: { r: number; g: number; b: number };
  sprayColor: { r: number; g: number; b: number };
  bubbleColor: { r: number; g: number; b: number };

  // ── Diffuse whitewater particles ─────────────────────────────────────────
  maxDiffuseParticles: number;
  numDiffuseParticles: number;
  diffusePos: Float32Array;
  diffuseVel: Float32Array;
  diffuseLife: Float32Array;
  diffuseType: Int8Array;
  diffuseColor: Float32Array;
  diffuseEmissionRate: number;
  diffuseMinSpeed: number;
  diffuseLifetime: number;

  // ── Diffuse spatial hash ─────────────────────────────────────────────────
  // Used for diffuse-diffuse repulsion to prevent bubbles/foam from clumping.
  // We use the same h spacing as the liquid spatial hash for simplicity.
  numCellDiffuse: Int32Array;
  firstCellDiffuse: Int32Array;
  cellDiffuseIds: Int32Array;

  // ── Particle spatial hash ────────────────────────────────────────────────
  // A uniform grid hash used to accelerate the nearest-neighbour search in
  // pushParticlesApart.  Its cell size is set to 2.2 × particleRadius so each
  // cell holds at most a handful of particles, keeping the inner loop O(1) per
  // particle on average.
  particleRadius: number;
  pInvSpacing: number; // 1 / (2.2 * particleRadius)
  pNumX: number;       // hash grid columns
  pNumY: number;       // hash grid rows
  pNumCells: number;   // pNumX * pNumY
  // These three arrays together implement a compact adjacency list (CSR format):
  //   numCellParticles[c]  – how many particles map to hash cell c.
  //   firstCellParticle[c] – first index into cellParticleIds for cell c
  //                          (built as a prefix-sum of numCellParticles, then
  //                           decremented as particles are inserted).
  //   cellParticleIds[k]   – particle index stored at slot k.
  numCellParticles: Int32Array;
  firstCellParticle: Int32Array; // length pNumCells + 1 (sentinel at the end)
  cellParticleIds: Int32Array;   // length maxParticles

  constructor(
    density: number,
    width: number,
    height: number,
    spacing: number,
    particleRadius: number,
    maxParticles: number,
    baseColor?: { r: number; g: number; b: number }
  ) {
    this.density = density;

    // Compute grid dimensions so that each cell is as close to `spacing` as
    // possible.  The +1 ensures there is always at least one layer of solid
    // boundary cells on each side.
    this.fNumX = Math.floor(width / spacing) + 1;
    this.fNumY = Math.floor(height / spacing) + 1;
    // Actual cell size may be slightly larger than `spacing` to tile exactly.
    this.h = Math.max(width / this.fNumX, height / this.fNumY);
    this.fInvSpacing = 1.0 / this.h;
    this.fNumCells = this.fNumX * this.fNumY;

    this.u = new Float32Array(this.fNumCells);
    this.v = new Float32Array(this.fNumCells);
    this.du = new Float32Array(this.fNumCells);
    this.dv = new Float32Array(this.fNumCells);
    this.prevU = new Float32Array(this.fNumCells);
    this.prevV = new Float32Array(this.fNumCells);
    this.p = new Float32Array(this.fNumCells);
    this.tempU = new Float32Array(this.fNumCells);
    this.tempV = new Float32Array(this.fNumCells);
    this.s = new Float32Array(this.fNumCells);
    this.cellType = new Int32Array(this.fNumCells);
    this.cellColor = new Float32Array(3 * this.fNumCells);
    this.vorticity = new Float32Array(this.fNumCells);

    this.maxParticles = maxParticles;
    this.particlePos = new Float32Array(2 * this.maxParticles);
    this.particleColor = new Float32Array(3 * this.maxParticles);

    const defaultColor = { r: 0.06, g: 0.45, b: 0.9 };
    const color = baseColor || defaultColor;
    this.baseColor = { ...color };
    this.foamColor   = { r: 1.00, g: 1.00, b: 1.00 };
    this.sprayColor  = { r: 1.00, g: 1.00, b: 1.00 };
    this.bubbleColor = { r: 1.00, g: 1.00, b: 1.00 };

    // Initialise every particle slot to the base colour.  Only the first
    // numParticles entries are ever rendered, but initialising all slots avoids
    // stale colours if the live count is later increased.
    for (let i = 0; i < this.maxParticles; i++) {
      this.particleColor[3 * i] = color.r;
      this.particleColor[3 * i + 1] = color.g;
      this.particleColor[3 * i + 2] = color.b;
    }

    this.particleVel = new Float32Array(2 * this.maxParticles);
    this.particleDensity = new Float32Array(this.fNumCells);
    // Zero signals "not yet computed"; updateParticleDensity will compute it
    // on the first simulation frame and then leave it fixed.
    this.particleRestDensity = 0.0;

    this.particleRadius = particleRadius;
    // Cell width ≈ 2.2 × radius ensures a 3×3 neighbourhood search covers all
    // particles within 2 radii of any given particle.
    this.pInvSpacing = 1.0 / (2.2 * particleRadius);
    this.pNumX = Math.floor(width * this.pInvSpacing) + 1;
    this.pNumY = Math.floor(height * this.pInvSpacing) + 1;
    this.pNumCells = this.pNumX * this.pNumY;

    this.numCellParticles = new Int32Array(this.pNumCells);
    this.firstCellParticle = new Int32Array(this.pNumCells + 1);
    this.cellParticleIds = new Int32Array(maxParticles);

    this.numParticles = 0;

    this.maxDiffuseParticles = 12000;
    this.numDiffuseParticles = 0;

    this.numCellDiffuse = new Int32Array(this.pNumCells);
    this.firstCellDiffuse = new Int32Array(this.pNumCells + 1);
    this.cellDiffuseIds = new Int32Array(this.maxDiffuseParticles);

    this.diffusePos = new Float32Array(2 * this.maxDiffuseParticles);
    this.diffuseVel = new Float32Array(2 * this.maxDiffuseParticles);
    this.diffuseLife = new Float32Array(this.maxDiffuseParticles);
    this.diffuseType = new Int8Array(this.maxDiffuseParticles);
    this.diffuseColor = new Float32Array(3 * this.maxDiffuseParticles);
    this.diffuseEmissionRate = 6.0;
    this.diffuseMinSpeed = 1.4;
    this.diffuseLifetime = 2.4;
  }

  // ── extrapolateVelocity ──────────────────────────────────────────────────
  // Extends the velocity field from FLUID cells into adjacent AIR cells.
  // This is essential for FLIP to ensure that particles moving near the
  // surface can always sample a valid velocity from the grid.
  //
  // NOTE: We also set prevU/prevV equal to the extrapolated values. This
  // ensures that the FLIP correction (f - prevF) is zero in extrapolated
  // regions, effectively falling back to a pure PIC update there. This
  // prevents particles from receiving massive "kicks" when entering air.
  extrapolateVelocity(numIters: number): void {
    const n = this.fNumY;

    for (let component = 0; component < 2; component++) {
      const f = component === 0 ? this.u : this.v;
      const prevF = component === 0 ? this.prevU : this.prevV;
      const tempF = component === 0 ? this.tempU : this.tempV;
      const offset = component === 0 ? n : 1;

      for (let iter = 0; iter < numIters; iter++) {
        tempF.set(f);

        for (let i = 0; i < this.fNumX; i++) {
          for (let j = 0; j < this.fNumY; j++) {
            const idx = i * n + j;

            // A face is valid if it touches a fluid cell.
            const isValid =
              (idx < this.fNumCells && this.cellType[idx] === FLUID_CELL) ||
              (idx >= offset && this.cellType[idx - offset] === FLUID_CELL);

            if (!isValid) {
              let sum = 0.0;
              let count = 0;

              // Check 4-neighbors
              if (i > 0) { // Left
                const nIdx = (i - 1) * n + j;
                if (this.cellType[nIdx] === FLUID_CELL || (nIdx >= offset && this.cellType[nIdx - offset] === FLUID_CELL)) {
                  sum += f[nIdx]; count++;
                }
              }
              if (i < this.fNumX - 1) { // Right
                const nIdx = (i + 1) * n + j;
                if (this.cellType[nIdx] === FLUID_CELL || (nIdx >= offset && this.cellType[nIdx - offset] === FLUID_CELL)) {
                  sum += f[nIdx]; count++;
                }
              }
              if (j > 0) { // Bottom
                const nIdx = i * n + (j - 1);
                if (this.cellType[nIdx] === FLUID_CELL || (nIdx >= offset && this.cellType[nIdx - offset] === FLUID_CELL)) {
                  sum += f[nIdx]; count++;
                }
              }
              if (j < this.fNumY - 1) { // Top
                const nIdx = i * n + (j + 1);
                if (this.cellType[nIdx] === FLUID_CELL || (nIdx >= offset && this.cellType[nIdx - offset] === FLUID_CELL)) {
                  sum += f[nIdx]; count++;
                }
              }

              if (count > 0) {
                tempF[idx] = sum / count;
                // Sync prevF so FLIP delta is zero here
                prevF[idx] = tempF[idx];
              }
            }
          }
        }
        f.set(tempF);
      }
    }
  }

  // ── applyGravity ─────────────────────────────────────────────────────────
  // Accumulate gravity and apply optional velocity damping.
  applyGravity(dt: number, gravityX: number, gravityY: number, damping: number): void {
    for (let i = 0; i < this.numParticles; i++) {
      this.particleVel[2 * i]     += dt * gravityX;
      this.particleVel[2 * i + 1] += dt * gravityY;
      this.particleVel[2 * i]     *= damping;
      this.particleVel[2 * i + 1] *= damping;
    }
  }

  // ── advectParticles ───────────────────────────────────────────────────────
  // Moves particles through the velocity field using the Midpoint method (RK2).
  advectParticles(dt: number): void {
    for (let i = 0; i < this.numParticles; i++) {
      const x = this.particlePos[2 * i];
      const y = this.particlePos[2 * i + 1];

      // Step 1: Sample velocity at current position (v1)
      let v1 = this.sampleVelocity(x, y);
      
      // Fallback to particle velocity if we are deep in air (outside grid field)
      if (v1.x === 0 && v1.y === 0) {
        v1.x = this.particleVel[2 * i];
        v1.y = this.particleVel[2 * i + 1];
      }

      // Step 2: Midpoint position (x_mid = x + v1 * dt/2)
      const xMid = x + v1.x * dt * 0.5;
      const yMid = y + v1.y * dt * 0.5;

      // Step 3: Sample velocity at midpoint (v_mid)
      let vMid = this.sampleVelocity(xMid, yMid);
      if (vMid.x === 0 && vMid.y === 0) vMid = v1;

      // Step 4: Final position (x_new = x + v_mid * dt)
      this.particlePos[2 * i]     += vMid.x * dt;
      this.particlePos[2 * i + 1] += vMid.y * dt;
    }
  }

  // ── pushParticlesApart ────────────────────────────────────────────────────
  // Iterative position-level separation pass that prevents particles from
  // overlapping.  Runs entirely in Lagrangian space and is O(N) per iteration
  // thanks to the spatial hash.
  //
  // Algorithm outline:
  //   1. Build the hash — bin every particle into a (pNumX × pNumY) grid.
  //   2. For each particle, check the 3×3 neighbourhood of hash cells.
  //      For every neighbour closer than 2r, push both apart by half the
  //      penetration depth along their connecting axis.
  //   3. This pass is positional only; liquid particle colour is controlled by
  //      the palette and whitewater is represented by separate diffuse particles.
  //
  // The spatial hash uses a compact CSR (Compressed Sparse Row) structure
  // built in two passes:
  //   Pass 1 – count particles per cell  → numCellParticles
  //   Pass 2 – convert to suffix sum, then fill cellParticleIds by decrementing
  //             each cell's start pointer as particles are inserted.
  pushParticlesApart(numIters: number): void {
    // ── Pass 1: count particles per hash cell ──────────────────────────────
    this.numCellParticles.fill(0);
    for (let i = 0; i < this.numParticles; i++) {
      const x = this.particlePos[2 * i];
      const y = this.particlePos[2 * i + 1];
      const xi = clamp(Math.floor(x * this.pInvSpacing), 0, this.pNumX - 1);
      const yi = clamp(Math.floor(y * this.pInvSpacing), 0, this.pNumY - 1);
      const cellNr = xi * this.pNumY + yi;
      this.numCellParticles[cellNr]++;
    }

    // ── Build suffix-sum start pointers ───────────────────────────────────
    // After this loop, firstCellParticle[c] = total particles in cells 0..c-1,
    // i.e. the end (exclusive) of the range for cell c−1.  The extra sentinel
    // at index pNumCells holds the total particle count.
    let first = 0;
    for (let i = 0; i < this.pNumCells; i++) {
      first += this.numCellParticles[i];
      this.firstCellParticle[i] = first;
    }
    this.firstCellParticle[this.pNumCells] = first;

    // ── Pass 2: fill cellParticleIds ──────────────────────────────────────
    // We decrement firstCellParticle[c] before writing each entry so that
    // after all insertions, firstCellParticle[c] points to the first element
    // of cell c's range (i.e. it becomes the start pointer, not the end).
    for (let i = 0; i < this.numParticles; i++) {
      const x = this.particlePos[2 * i];
      const y = this.particlePos[2 * i + 1];
      const xi = clamp(Math.floor(x * this.pInvSpacing), 0, this.pNumX - 1);
      const yi = clamp(Math.floor(y * this.pInvSpacing), 0, this.pNumY - 1);
      const cellNr = xi * this.pNumY + yi;
      this.firstCellParticle[cellNr]--;
      this.cellParticleIds[this.firstCellParticle[cellNr]] = i;
    }

    // ── Separation iterations ─────────────────────────────────────────────
    const minDist = 2.0 * this.particleRadius;
    const minDist2 = minDist * minDist;

    for (let iter = 0; iter < numIters; iter++) {
      for (let i = 0; i < this.numParticles; i++) {
        const px = this.particlePos[2 * i];
        const py = this.particlePos[2 * i + 1];
        const pxi = Math.floor(px * this.pInvSpacing);
        const pyi = Math.floor(py * this.pInvSpacing);

        // Search the 3×3 block of hash cells surrounding particle i.
        const x0 = Math.max(pxi - 1, 0);
        const y0 = Math.max(pyi - 1, 0);
        const x1 = Math.min(pxi + 1, this.pNumX - 1);
        const y1 = Math.min(pyi + 1, this.pNumY - 1);

        for (let xi = x0; xi <= x1; xi++) {
          for (let yi = y0; yi <= y1; yi++) {
            const cellNr = xi * this.pNumY + yi;
            const firstIdx = this.firstCellParticle[cellNr];
            const lastIdx  = this.firstCellParticle[cellNr + 1];

            for (let j = firstIdx; j < lastIdx; j++) {
              const id = this.cellParticleIds[j];
              if (id === i) continue; // skip self

              const qx = this.particlePos[2 * id];
              const qy = this.particlePos[2 * id + 1];
              const dx = qx - px;
              const dy = qy - py;
              const d2 = dx * dx + dy * dy;

              // Only act if the particles overlap and are not exactly coincident.
              if (d2 > minDist2 || d2 === 0.0) continue;

              const d = Math.sqrt(d2);
              // Move each particle half the penetration depth along the
              // separation axis: s = (minDist − d) / d  gives a normalised
              // displacement; multiply by dx/dy to get world-space delta.
              const s = (0.5 * (minDist - d)) / d;
              const deltaX = dx * s;
              const deltaY = dy * s;

              this.particlePos[2 * i]     -= deltaX;
              this.particlePos[2 * i + 1] -= deltaY;
              this.particlePos[2 * id]    += deltaX;
              this.particlePos[2 * id + 1]+= deltaY;
            }
          }
        }
      }
    }
  }

  // ── pushDiffuseParticlesApart ─────────────────────────────────────────────
  // Separation pass for diffuse particles (whitewater) to prevent clumping.
  // This helps bubbles and foam spread out more naturally on the surface.
  // Unlike liquid particles, this is a "soft" repulsion: we only push by
  // a fraction of the penetration depth controlled by `strength`.
  pushDiffuseParticlesApart(numIters: number, strength: number): void {
    if (this.numDiffuseParticles === 0 || strength <= 0) return;

    // ── Build diffuse spatial hash ──────────────────────────────────────────
    this.numCellDiffuse.fill(0);
    for (let i = 0; i < this.numDiffuseParticles; i++) {
      const xi = clamp(Math.floor(this.diffusePos[2 * i] * this.pInvSpacing), 0, this.pNumX - 1);
      const yi = clamp(Math.floor(this.diffusePos[2 * i + 1] * this.pInvSpacing), 0, this.pNumY - 1);
      this.numCellDiffuse[xi * this.pNumY + yi]++;
    }

    let first = 0;
    for (let i = 0; i < this.pNumCells; i++) {
      first += this.numCellDiffuse[i];
      this.firstCellDiffuse[i] = first;
    }
    this.firstCellDiffuse[this.pNumCells] = first;

    for (let i = 0; i < this.numDiffuseParticles; i++) {
      const xi = clamp(Math.floor(this.diffusePos[2 * i] * this.pInvSpacing), 0, this.pNumX - 1);
      const yi = clamp(Math.floor(this.diffusePos[2 * i + 1] * this.pInvSpacing), 0, this.pNumY - 1);
      const cellNr = xi * this.pNumY + yi;
      this.firstCellDiffuse[cellNr]--;
      this.cellDiffuseIds[this.firstCellDiffuse[cellNr]] = i;
    }

    // ── Separation iterations ─────────────────────────────────────────────
    const minDist = 1.0 * this.particleRadius; // slightly tighter than liquid
    const minDist2 = minDist * minDist;

    for (let iter = 0; iter < numIters; iter++) {
      for (let i = 0; i < this.numDiffuseParticles; i++) {
        const px = this.diffusePos[2 * i];
        const py = this.diffusePos[2 * i + 1];
        const pxi = Math.floor(px * this.pInvSpacing);
        const pyi = Math.floor(py * this.pInvSpacing);

        const x0 = Math.max(pxi - 1, 0);
        const y0 = Math.max(pyi - 1, 0);
        const x1 = Math.min(pxi + 1, this.pNumX - 1);
        const y1 = Math.min(pyi + 1, this.pNumY - 1);

        for (let xi = x0; xi <= x1; xi++) {
          for (let yi = y0; yi <= y1; yi++) {
            const cellNr = xi * this.pNumY + yi;
            for (let j = this.firstCellDiffuse[cellNr]; j < this.firstCellDiffuse[cellNr + 1]; j++) {
              const id = this.cellDiffuseIds[j];
              if (id === i) continue;

              const dx = this.diffusePos[2 * id] - px;
              const dy = this.diffusePos[2 * id + 1] - py;
              const d2 = dx * dx + dy * dy;

              if (d2 > minDist2 || d2 === 0.0) continue;

              const d = Math.sqrt(d2);
              // "Soft" push: only move by a fraction of the penetration depth.
              const s = (0.5 * strength * (minDist - d)) / d;
              const deltaX = dx * s;
              const deltaY = dy * s;

              this.diffusePos[2 * i]      -= deltaX;
              this.diffusePos[2 * i + 1]  -= deltaY;
              this.diffusePos[2 * id]     += deltaX;
              this.diffusePos[2 * id + 1] += deltaY;
            }
          }
        }
      }
    }
  }

  // ── handleParticleCollisions ──────────────────────────────────────────────
  // Clamp every particle to the interior of the fluid domain and zero its
  // normal velocity component on contact.  The boundary is inset by one cell
  // width (h) plus the particle radius so particles can never overlap the solid
  // wall cells at the grid boundary.
  handleParticleCollisions(): void {
    const h = 1.0 / this.fInvSpacing; // = this.h
    const r = this.particleRadius;

    // The usable region starts one cell in from each wall (that cell is solid)
    // and the particle must fit entirely inside, hence the ± r margin.
    const minX = h + r;
    const maxX = (this.fNumX - 1) * h - r;
    const minY = h + r;
    const maxY = (this.fNumY - 1) * h - r; // top is open but still clamped here

    for (let i = 0; i < this.numParticles; i++) {
      let x = this.particlePos[2 * i];
      let y = this.particlePos[2 * i + 1];

      if (x < minX) { x = minX; this.particleVel[2 * i]     = 0.0; }
      if (x > maxX) { x = maxX; this.particleVel[2 * i]     = 0.0; }
      if (y < minY) { y = minY; this.particleVel[2 * i + 1] = 0.0; }
      if (y > maxY) { y = maxY; this.particleVel[2 * i + 1] = 0.0; }

      this.particlePos[2 * i]     = x;
      this.particlePos[2 * i + 1] = y;
    }
  }

  // ── updateParticleDensity ─────────────────────────────────────────────────
  // Splat each particle's "mass" (weight = 1) onto the four surrounding cell
  // centres using bilinear interpolation, accumulating a per-cell density field.
  // The interpolation stencil is offset by h/2 so it is centred on cell centres
  // rather than cell corners.
  //
  // On the very first frame (particleRestDensity === 0), the average density
  // over all FLUID cells is computed and stored as particleRestDensity.  This
  // reference value is used by solveIncompressibility to detect and gently
  // resist local compression (drift compensation).
  updateParticleDensity(): void {
    const n  = this.fNumY;
    const h  = this.h;
    const h1 = this.fInvSpacing;
    const h2 = 0.5 * h;     // half-cell offset to centre the stencil
    const d  = this.particleDensity;

    d.fill(0.0);

    for (let i = 0; i < this.numParticles; i++) {
      // Clamp position to the interior of the grid to avoid out-of-bounds access.
      const x = clamp(this.particlePos[2 * i],     h, (this.fNumX - 1) * h);
      const y = clamp(this.particlePos[2 * i + 1], h, (this.fNumY - 1) * h);

      // Bilinear stencil: find the lower-left cell index and interpolation weights.
      const x0 = Math.floor((x - h2) * h1);
      const tx = ((x - h2) - x0 * h) * h1; // fractional offset [0,1)
      const x1 = Math.min(x0 + 1, this.fNumX - 2);

      const y0 = Math.floor((y - h2) * h1);
      const ty = ((y - h2) - y0 * h) * h1;
      const y1 = Math.min(y0 + 1, this.fNumY - 2);

      const sx = 1.0 - tx;
      const sy = 1.0 - ty;

      // Distribute unit mass to the four cell centres with bilinear weights.
      if (x0 < this.fNumX && y0 < this.fNumY) d[x0 * n + y0] += sx * sy;
      if (x1 < this.fNumX && y0 < this.fNumY) d[x1 * n + y0] += tx * sy;
      if (x1 < this.fNumX && y1 < this.fNumY) d[x1 * n + y1] += tx * ty;
      if (x0 < this.fNumX && y1 < this.fNumY) d[x0 * n + y1] += sx * ty;
    }

    // Compute rest density once from the initial (equilibrium) particle layout.
    if (this.particleRestDensity === 0.0) {
      let sum = 0.0;
      let numFluidCells = 0;
      for (let i = 0; i < this.fNumCells; i++) {
        if (this.cellType[i] === FLUID_CELL) {
          sum += d[i];
          numFluidCells++;
        }
      }
      if (numFluidCells > 0) {
        this.particleRestDensity = sum / numFluidCells;
      }
    }
  }

  // ── transferVelocities ────────────────────────────────────────────────────
  // Handles both directions of the particle ↔ grid velocity exchange.
  //
  // toGrid = true  (P→G, "particle-to-grid"):
  //   Splat particle velocities onto the MAC grid using bilinear weights and
  //   normalise by accumulated weights.  Also classifies cells as FLUID or AIR
  //   based on whether any particle centre falls within them.  After the splat,
  //   solid-wall faces are restored to their pre-splat values (no-slip).
  //
  // toGrid = false (G→P, "grid-to-particle"):
  //   Read updated grid velocities back onto particles using a blend of:
  //     PIC  – interpolated post-pressure grid velocity (fully dissipative).
  //     FLIP – particle velocity + pressure-induced correction only (low dissipation).
  //   particleVel = picRatio × PIC  +  (1 − picRatio) × FLIP
  //   picRatio ≈ 0.05 gives mostly FLIP (energetic) with a small PIC component
  //   to suppress high-frequency noise; 1.0 is pure PIC, 0.0 is pure FLIP.
  //
  // The stencil is staggered: u samples are offset by (0, h/2) so they align
  // with left-face midpoints; v samples are offset by (h/2, 0) to align with
  // bottom-face midpoints.  Both components are handled in the same loop body
  // via the `component` index (0 = u, 1 = v).
  transferVelocities(toGrid: boolean, picRatio: number): void {
    const n  = this.fNumY;
    const h  = this.h;
    const h1 = this.fInvSpacing;
    const h2 = 0.5 * h;

    if (toGrid) {
      // Save current grid velocities before overwriting them.
      // prevU is used here for solid-wall restoration (see below) and will be
      // overwritten again by solveIncompressibility for the FLIP G→P correction.
      this.prevU.set(this.u);
      this.prevV.set(this.v);
      this.du.fill(0.0);
      this.dv.fill(0.0);
      this.u.fill(0.0);
      this.v.fill(0.0);

      // Classify cells: start as SOLID (from the s mask) or AIR, then mark any
      // cell that contains a particle as FLUID.
      for (let i = 0; i < this.fNumCells; i++) {
        this.cellType[i] = this.s[i] === 0.0 ? SOLID_CELL : AIR_CELL;
      }
      for (let i = 0; i < this.numParticles; i++) {
        const x  = this.particlePos[2 * i];
        const y  = this.particlePos[2 * i + 1];
        const xi = clamp(Math.floor(x * h1), 0, this.fNumX - 1);
        const yi = clamp(Math.floor(y * h1), 0, this.fNumY - 1);
        const cellNr = xi * n + yi;
        if (this.cellType[cellNr] === AIR_CELL) {
          this.cellType[cellNr] = FLUID_CELL;
        }
      }
    }

    // Process u (component 0) and v (component 1) with the same loop body.
    for (let component = 0; component < 2; component++) {
      // Staggered sample offsets: u faces are at (x, y − h/2); v faces at (x − h/2, y).
      const dx = component === 0 ? 0.0 : h2;
      const dy = component === 0 ? h2  : 0.0;
      const f     = component === 0 ? this.u     : this.v;
      const prevF = component === 0 ? this.prevU : this.prevV;
      const d     = component === 0 ? this.du    : this.dv;

      for (let i = 0; i < this.numParticles; i++) {
        const x = clamp(this.particlePos[2 * i],     h, (this.fNumX - 1) * h);
        const y = clamp(this.particlePos[2 * i + 1], h, (this.fNumY - 1) * h);

        // Bilinear stencil relative to the staggered face position.
        const x0 = Math.min(Math.floor((x - dx) * h1), this.fNumX - 2);
        const tx = ((x - dx) - x0 * h) * h1;
        const x1 = Math.min(x0 + 1, this.fNumX - 2);

        const y0 = Math.min(Math.floor((y - dy) * h1), this.fNumY - 2);
        const ty = ((y - dy) - y0 * h) * h1;
        const y1 = Math.min(y0 + 1, this.fNumY - 2);

        const sx = 1.0 - tx;
        const sy = 1.0 - ty;

        // Four bilinear weights for the surrounding face samples.
        const d0 = sx * sy;
        const d1 = tx * sy;
        const d2 = tx * ty;
        const d3 = sx * ty;

        const nr0 = x0 * n + y0;
        const nr1 = x1 * n + y0;
        const nr2 = x1 * n + y1;
        const nr3 = x0 * n + y1;

        if (toGrid) {
          // ... (toGrid logic remains same)
          const pv = this.particleVel[2 * i + component];
          f[nr0] += pv * d0;  d[nr0] += d0;
          f[nr1] += pv * d1;  d[nr1] += d1;
          f[nr2] += pv * d2;  d[nr2] += d2;
          f[nr3] += pv * d3;  d[nr3] += d3;
        } else {
          // G→P: With extrapolation, we can sample from ANY face that has a
          // valid velocity (splat or extrapolated). We check if the face
          // touches a non-solid cell or has non-zero velocity.
          const offset = component === 0 ? n : 1;
          
          // Simplified validity: if the face touches a fluid cell, or was extrapolated (exists in f)
          const isV0 = (this.cellType[nr0] !== SOLID_CELL && this.cellType[nr0 - offset] !== SOLID_CELL);
          const isV1 = (this.cellType[nr1] !== SOLID_CELL && this.cellType[nr1 - offset] !== SOLID_CELL);
          const isV2 = (this.cellType[nr2] !== SOLID_CELL && this.cellType[nr2 - offset] !== SOLID_CELL);
          const isV3 = (this.cellType[nr3] !== SOLID_CELL && this.cellType[nr3 - offset] !== SOLID_CELL);

          const totalValid = (isV0 ? d0 : 0) + (isV1 ? d1 : 0) + (isV2 ? d2 : 0) + (isV3 ? d3 : 0);

          if (totalValid > 0.0) {
            const picV =
              ((isV0 ? d0 * f[nr0] : 0) +
               (isV1 ? d1 * f[nr1] : 0) +
               (isV2 ? d2 * f[nr2] : 0) +
               (isV3 ? d3 * f[nr3] : 0)) / totalValid;

            const corr =
              ((isV0 ? d0 * (f[nr0] - prevF[nr0]) : 0) +
               (isV1 ? d1 * (f[nr1] - prevF[nr1]) : 0) +
               (isV2 ? d2 * (f[nr2] - prevF[nr2]) : 0) +
               (isV3 ? d3 * (f[nr3] - prevF[nr3]) : 0)) / totalValid;
            
            const flipV = this.particleVel[2 * i + component] + corr;
            this.particleVel[2 * i + component] = picRatio * picV + (1.0 - picRatio) * flipV;
          }
        }
      }

      if (toGrid) {
        // Normalise: divide accumulated velocity by accumulated weight.
        for (let i = 0; i < f.length; i++) {
          if (d[i] > 0.0) f[i] /= d[i];
        }

        // Restore no-slip condition on solid-wall faces.
        // For a static tank, wall-touching faces must be zero.
        for (let i = 0; i < this.fNumX; i++) {
          for (let j = 0; j < this.fNumY; j++) {
            const solid = this.cellType[i * n + j] === SOLID_CELL;
            if (solid || (i > 0 && this.cellType[(i - 1) * n + j] === SOLID_CELL)) {
              this.u[i * n + j] = 0.0;
            }
            if (solid || (j > 0 && this.cellType[i * n + j - 1] === SOLID_CELL)) {
              this.v[i * n + j] = 0.0;
            }
          }
        }
      }
    }
  }

  // ── solveIncompressibility ────────────────────────────────────────────────
  // Gauss-Seidel pressure projection that drives the velocity divergence to zero
  // in every FLUID cell.
  solveIncompressibility(
    numIters: number,
    dt: number,
    overRelaxation: number,
    compensateDrift = true
  ): void {
    this.p.fill(0.0);

    this.prevU.set(this.u);
    this.prevV.set(this.v);

    const n  = this.fNumY;
    const cp = (this.density * this.h) / dt;

    // Drift compensation stiffness (k). Higher = stiffer fluid, lower = more compressible.
    const stiffness = 0.1;

    for (let iter = 0; iter < numIters; iter++) {
      for (let i = 1; i < this.fNumX - 1; i++) {
        for (let j = 1; j < this.fNumY - 1; j++) {
          if (this.cellType[i * n + j] !== FLUID_CELL) continue;

          const center = i * n + j;
          const left   = (i - 1) * n + j;
          const right  = (i + 1) * n + j;
          const bottom = i * n + j - 1;
          const top    = i * n + j + 1;

          const sx0 = this.s[left];
          const sx1 = this.s[right];
          const sy0 = this.s[bottom];
          const sy1 = this.s[top];
          const s   = sx0 + sx1 + sy0 + sy1;
          if (s === 0.0) continue;

          let div = this.u[right] - this.u[center] + this.v[top] - this.v[center];

          if (this.particleRestDensity > 0.0 && compensateDrift) {
            const compression = this.particleDensity[i * n + j] - this.particleRestDensity;
            if (compression > 0.0) {
              // Scale compression by stiffness to prevent violent jitter
              div -= stiffness * compression;
            }
          }

          let p = (-div / s) * overRelaxation;
          this.p[center] += cp * p;

          this.u[center] -= sx0 * p;
          this.u[right]  += sx1 * p;
          this.v[center] -= sy0 * p;
          this.v[top]    += sy1 * p;
        }
      }
    }
  }

  updateParticleColors(): void {
    for (let i = 0; i < this.numParticles; i++) {
      this.particleColor[3 * i]     = this.baseColor.r;
      this.particleColor[3 * i + 1] = this.baseColor.g;
      this.particleColor[3 * i + 2] = this.baseColor.b;
    }
  }

  setWhitewaterSettings(
    enabled: boolean,
    maxParticles: number,
    emissionRate: number,
    minSpeed: number,
    lifetime: number
  ): void {
    const nextMax = Math.max(0, Math.floor(maxParticles));
    if (nextMax !== this.maxDiffuseParticles) {
      this.resizeDiffuseParticleStorage(nextMax);
    }
    this.diffuseEmissionRate = enabled ? Math.max(0, emissionRate) : 0;
    this.diffuseMinSpeed = Math.max(0, minSpeed);
    this.diffuseLifetime = Math.max(0.01, lifetime);
  }

  private resizeDiffuseParticleStorage(nextMax: number): void {
    const keep = Math.min(this.numDiffuseParticles, nextMax);
    const nextPos = new Float32Array(2 * nextMax);
    const nextVel = new Float32Array(2 * nextMax);
    const nextLife = new Float32Array(nextMax);
    const nextType = new Int8Array(nextMax);
    const nextColor = new Float32Array(3 * nextMax);
    nextPos.set(this.diffusePos.subarray(0, 2 * keep));
    nextVel.set(this.diffuseVel.subarray(0, 2 * keep));
    nextLife.set(this.diffuseLife.subarray(0, keep));
    nextType.set(this.diffuseType.subarray(0, keep));
    nextColor.set(this.diffuseColor.subarray(0, 3 * keep));
    this.maxDiffuseParticles = nextMax;
    this.numDiffuseParticles = keep;
    this.diffusePos = nextPos;
    this.diffuseVel = nextVel;
    this.diffuseLife = nextLife;
    this.diffuseType = nextType;
    this.diffuseColor = nextColor;
    this.cellDiffuseIds = new Int32Array(this.maxDiffuseParticles);
  }

  private isNearAirCell(xi: number, yi: number): boolean {
    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        const x = xi + ox;
        const y = yi + oy;
        if (x < 0 || x >= this.fNumX || y < 0 || y >= this.fNumY) continue;
        if (this.cellType[x * this.fNumY + y] === AIR_CELL) return true;
      }
    }
    return false;
  }

  private hasFluidNeighbour(xi: number, yi: number): boolean {
    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        const x = xi + ox;
        const y = yi + oy;
        if (x < 0 || x >= this.fNumX || y < 0 || y >= this.fNumY) continue;
        if (this.cellType[x * this.fNumY + y] === FLUID_CELL) return true;
      }
    }
    return false;
  }

  private sampleVelocity(x: number, y: number): { x: number; y: number } {
    return {
      x: this.sampleComponent(x, y, 0),
      y: this.sampleComponent(x, y, 1),
    };
  }

  private sampleComponent(x: number, y: number, component: 0 | 1): number {
    const n = this.fNumY;
    const h = this.h;
    const h1 = this.fInvSpacing;
    const h2 = 0.5 * h;
    const dx = component === 0 ? 0.0 : h2;
    const dy = component === 0 ? h2 : 0.0;
    const f = component === 0 ? this.u : this.v;

    x = clamp(x, h, (this.fNumX - 1) * h);
    y = clamp(y, h, (this.fNumY - 1) * h);

    const x0 = Math.min(Math.floor((x - dx) * h1), this.fNumX - 2);
    const tx = ((x - dx) - x0 * h) * h1;
    const x1 = Math.min(x0 + 1, this.fNumX - 2);
    const y0 = Math.min(Math.floor((y - dy) * h1), this.fNumY - 2);
    const ty = ((y - dy) - y0 * h) * h1;
    const y1 = Math.min(y0 + 1, this.fNumY - 2);
    const sx = 1.0 - tx;
    const sy = 1.0 - ty;

    const nr0 = x0 * n + y0;
    const nr1 = x1 * n + y0;
    const nr2 = x1 * n + y1;
    const nr3 = x0 * n + y1;

    // Use the same "valid face" logic as transferVelocities (G->P)
    const offset = component === 0 ? n : 1;
    const isV0 = (this.cellType[nr0] !== SOLID_CELL && this.cellType[nr0 - offset] !== SOLID_CELL);
    const isV1 = (this.cellType[nr1] !== SOLID_CELL && this.cellType[nr1 - offset] !== SOLID_CELL);
    const isV2 = (this.cellType[nr2] !== SOLID_CELL && this.cellType[nr2 - offset] !== SOLID_CELL);
    const isV3 = (this.cellType[nr3] !== SOLID_CELL && this.cellType[nr3 - offset] !== SOLID_CELL);

    const d0 = sx * sy;
    const d1 = tx * sy;
    const d2 = tx * ty;
    const d3 = sx * ty;

    const totalValid = (isV0 ? d0 : 0) + (isV1 ? d1 : 0) + (isV2 ? d2 : 0) + (isV3 ? d3 : 0);

    if (totalValid > 0.0) {
      return (
        ((isV0 ? d0 * f[nr0] : 0) +
         (isV1 ? d1 * f[nr1] : 0) +
         (isV2 ? d2 * f[nr2] : 0) +
         (isV3 ? d3 * f[nr3] : 0)) / totalValid
      );
    }

    return 0.0;
  }

  private emitDiffuseParticles(
    dt: number,
    weightTurbulence: number,
    weightWavecrest: number,
    weightKinetic: number,
    bubbleEmissionScale: number,
    foamEmissionScale: number,
    sprayEmissionScale: number
  ): void {
    if (this.diffuseEmissionRate <= 0 || this.maxDiffuseParticles === 0) return;
    const h1 = this.fInvSpacing;
    const h = this.h;

    // Use a fixed search radius for wavecrest/turbulence triggers.
    const searchRadius = 2.0 * this.particleRadius;

    for (let i = 0; i < this.numParticles && this.numDiffuseParticles < this.maxDiffuseParticles; i++) {
      const vx = this.particleVel[2 * i];
      const vy = this.particleVel[2 * i + 1];
      const speed = Math.sqrt(vx * vx + vy * vy);
      if (speed < this.diffuseMinSpeed) continue;

      const x = this.particlePos[2 * i];
      const y = this.particlePos[2 * i + 1];
      const xi = clamp(Math.floor(x * h1), 1, this.fNumX - 2);
      const yi = clamp(Math.floor(y * h1), 1, this.fNumY - 2);
      const cell = xi * this.fNumY + yi;
      const nearAir = this.isNearAirCell(xi, yi);

      // 1. Kinetic Energy Potential
      const energyPotential = Math.min(1.0, (speed - this.diffuseMinSpeed) / 5.0);

      // 2. Turbulence Potential
      const turbulencePotential = Math.min(1.0, this.vorticity[cell] / 20.0);

      // 3. Wavecrest Sharpness Potential
      let avgX = 0, avgY = 0, neighborCount = 0;
      const pxi = Math.floor(x * this.pInvSpacing);
      const pyi = Math.floor(y * this.pInvSpacing);
      for (let ox = -1; ox <= 1; ox++) {
        for (let oy = -1; oy <= 1; oy++) {
          const cxi = clamp(pxi + ox, 0, this.pNumX - 1);
          const cyi = clamp(pyi + oy, 0, this.pNumY - 1);
          const cellNr = cxi * this.pNumY + cyi;
          for (let k = this.firstCellParticle[cellNr]; k < this.firstCellParticle[cellNr + 1]; k++) {
            const id = this.cellParticleIds[k];
            const dx = this.particlePos[2 * id] - x;
            const dy = this.particlePos[2 * id + 1] - y;
            if (dx * dx + dy * dy < searchRadius * searchRadius) {
              avgX += dx;
              avgY += dy;
              neighborCount++;
            }
          }
        }
      }

      const dx = avgX / Math.max(1, neighborCount);
      const dy = avgY / Math.max(1, neighborCount);
      const d = Math.sqrt(dx * dx + dy * dy);
      const normalX = -dx / Math.max(0.001, d);
      const normalY = -dy / Math.max(0.001, d);
      const sharpness = Math.min(1.0, d / this.particleRadius);
      const dot = vx * normalX + vy * normalY;
      const wavecrestPotential = (nearAir && dot > 0) ? sharpness : 0.0;

      // Combined trigger potential
      const combined = (
        weightKinetic * energyPotential +
        weightTurbulence * turbulencePotential +
        weightWavecrest * wavecrestPotential
      );

      // Apply type-specific emission scale.
      // If submerged, it's a bubble. If near surface, it's foam or spray.
      // Foam is generally more likely than spray in high-vorticity surface areas.
      let typeScale = 1.0;
      if (!nearAir) {
        typeScale = bubbleEmissionScale;
      } else {
        // Simple heuristic: if moving fast and outward, it's more likely spray.
        typeScale = dot > 1.0 ? sprayEmissionScale : foamEmissionScale;
      }

      const probability = Math.min(0.95, this.diffuseEmissionRate * dt * combined * typeScale);
      if (Math.random() > probability) continue;

      const r = this.particleRadius * Math.sqrt(Math.random());
      const theta = Math.random() * 2.0 * Math.PI;
      const px = x + r * Math.cos(theta);
      const py = y + r * Math.sin(theta);
      this.addDiffuseParticle(px, py, vx, vy, this.diffuseLifetime * (0.5 + 0.5 * Math.random()));
    }
  }

  private addDiffuseParticle(x: number, y: number, vx: number, vy: number, lifetime: number): void {
    const i = this.numDiffuseParticles++;
    this.diffusePos[2 * i] = x;
    this.diffusePos[2 * i + 1] = y;
    this.diffuseVel[2 * i] = vx;
    this.diffuseVel[2 * i + 1] = vy;
    this.diffuseLife[i] = lifetime;
    this.diffuseType[i] = DIFFUSE_SPRAY;
  }

  private updateDiffuseParticleTypes(): void {
    const h1 = this.fInvSpacing;
    for (let i = 0; i < this.numDiffuseParticles; i++) {
      const xi = clamp(Math.floor(this.diffusePos[2 * i] * h1), 0, this.fNumX - 1);
      const yi = clamp(Math.floor(this.diffusePos[2 * i + 1] * h1), 0, this.fNumY - 1);
      const cellType = this.cellType[xi * this.fNumY + yi];
      if (cellType === FLUID_CELL) {
        this.diffuseType[i] = DIFFUSE_BUBBLE;
      } else if (this.hasFluidNeighbour(xi, yi)) {
        this.diffuseType[i] = DIFFUSE_FOAM;
      } else {
        this.diffuseType[i] = DIFFUSE_SPRAY;
      }
    }
  }

  private advanceDiffuseParticles(
    dt: number,
    gravityX: number,
    gravityY: number,
    bubbleBuoyancy: number,
    foamGravity: number,
    sprayGravity: number
  ): void {
    const minX = this.h;
    const maxX = (this.fNumX - 1) * this.h;
    const minY = this.h;
    const maxY = (this.fNumY - 1) * this.h;

    for (let i = 0; i < this.numDiffuseParticles; i++) {
      const type = this.diffuseType[i];
      let x = this.diffusePos[2 * i];
      let y = this.diffusePos[2 * i + 1];
      let vx = this.diffuseVel[2 * i];
      let vy = this.diffuseVel[2 * i + 1];

      if (type === DIFFUSE_SPRAY) {
        // Purely ballistic: gravity only, no grid coupling.
        // Life burns at 2× to keep spray short-lived (matches GridFluidSim3D
        // _sprayParticleLifetimeModifier = 2.0).
        vx += gravityX * sprayGravity * dt;
        vy += gravityY * sprayGravity * dt;
        this.diffuseLife[i] -= 2.0 * dt;
      } else {
        // Sample grid velocity at the particle's current position.
        // Both BUBBLE and FOAM use this as their advecting field.
        const gridVel = this.sampleVelocity(x, y);

        if (type === DIFFUSE_BUBBLE) {
          // Bubbles: strong drag toward local fluid velocity (drag coeff = 1.0,
          // i.e. instantly match the field each frame, like GridFluidSim3D
          // _bubbleDragCoefficient = 1.0) plus a buoyancy impulse opposite to
          // gravity.  Buoyancy coefficient bubbleBuoyancy (default 4.0) matches
          // the 3D reference; this makes bubbles rise clearly relative to the
          // falling fluid.
          const buoyancyX = -bubbleBuoyancy * gravityX;
          const buoyancyY = -bubbleBuoyancy * gravityY;
          vx = gridVel.x + buoyancyX * dt;
          vy = gridVel.y + buoyancyY * dt;
          // Bubbles live longest (modifier ≈ 1/3, matching _bubbleParticleLifetimeModifier = 0.333).
          this.diffuseLife[i] -= 0.333 * dt;
        } else {
          // Foam: advect position along the velocity field (Euler step).
          // Unlike instant velocity snap (which causes a jarring stop when a
          // falling spray particle lands on the surface), we use a strong but
          // finite drag so that the velocity adjusts over ~2 frames.  This
          // preserves the smoothness of the spray→foam transition while still
          // keeping foam tightly coupled to the surface flow.
          // GridFluidSim3D uses RK2 position advection for foam — the Euler
          // equivalent is setting velocity to the field value, but the drag
          // factor here gives a gentler, visually smoother result in 2D.
          // Follow the MAC grid velocity (matches 3D RK2 advection intent).
          // We include a gravity compensation term (1-drag)*g*dt*foamGravity so
          // that foam accelerates with the fluid even if gridVel (sampled at
          // the surface) is slightly lagged by the 0.5 drag factor.
          vx += (gridVel.x - vx) * 0.5 + 0.5 * gravityX * foamGravity * dt;
          vy += (gridVel.y - vy) * 0.5 + 0.5 * gravityY * foamGravity * dt;
          this.diffuseLife[i] -= 1.0 * dt;
        }
      }

      x += vx * dt;
      y += vy * dt;

      // Spray particles reflect off the floor and side walls instead of
      // dying, matching GridFluidSim3D's solid-cell collision resolution.
      // Particles that exit through the top (open surface) are culled.
      if (type === DIFFUSE_SPRAY) {
        if (x < minX) { x = minX; vx = Math.abs(vx); }
        if (x > maxX) { x = maxX; vx = -Math.abs(vx); }
        if (y < minY) { y = minY; vy = Math.abs(vy); }
        if (y > maxY) { this.diffuseLife[i] = 0.0; }
      } else {
        if (x < minX || x > maxX || y < minY || y > maxY) {
          this.diffuseLife[i] = 0.0;
        }
      }

      this.diffusePos[2 * i] = x;
      this.diffusePos[2 * i + 1] = y;
      this.diffuseVel[2 * i] = vx;
      this.diffuseVel[2 * i + 1] = vy;
    }
  }

  private updateDiffuseParticleColors(): void {
    for (let i = 0; i < this.numDiffuseParticles; i++) {
      // alpha drives the fade-out as the particle ages.  It is allowed to reach
      // 0 so that all three RGB channels can fade together — previously b was
      // pinned at 1.0 while r/g faded, which left dying particles as solid dark-
      // blue disks visible long after they should have disappeared.
      // Normalize against the minimum spawn lifetime (diffuseLifetime * 0.5) so
      // every particle starts at alpha = 1.0 regardless of its random lifespan.
      // Without this, particles spawned near the minimum life start at alpha = 0.5
      // and immediately appear gray, then fade to black as they age.
      const alpha = Math.max(0.0, Math.min(1.0, this.diffuseLife[i] / (this.diffuseLifetime * 0.5)));

      if (this.diffuseType[i] === DIFFUSE_BUBBLE) {
        this.diffuseColor[3 * i]     = this.bubbleColor.r * alpha;
        this.diffuseColor[3 * i + 1] = this.bubbleColor.g * alpha;
        this.diffuseColor[3 * i + 2] = this.bubbleColor.b * alpha;
      } else if (this.diffuseType[i] === DIFFUSE_FOAM) {
        this.diffuseColor[3 * i]     = this.foamColor.r * alpha;
        this.diffuseColor[3 * i + 1] = this.foamColor.g * alpha;
        this.diffuseColor[3 * i + 2] = this.foamColor.b * alpha;
      } else {
        this.diffuseColor[3 * i]     = this.sprayColor.r * alpha;
        this.diffuseColor[3 * i + 1] = this.sprayColor.g * alpha;
        this.diffuseColor[3 * i + 2] = this.sprayColor.b * alpha;
      }
    }
  }

  private removeDeadDiffuseParticles(): void {
    let dst = 0;
    const countGrid = new Int16Array(this.fNumCells);
    for (let src = 0; src < this.numDiffuseParticles; src++) {
      if (this.diffuseLife[src] <= 0.0) continue;
      const xi = clamp(Math.floor(this.diffusePos[2 * src] * this.fInvSpacing), 0, this.fNumX - 1);
      const yi = clamp(Math.floor(this.diffusePos[2 * src + 1] * this.fInvSpacing), 0, this.fNumY - 1);
      const cell = xi * this.fNumY + yi;
      if (countGrid[cell] >= 60) continue;
      countGrid[cell]++;

      if (dst !== src) {
        this.diffusePos[2 * dst] = this.diffusePos[2 * src];
        this.diffusePos[2 * dst + 1] = this.diffusePos[2 * src + 1];
        this.diffuseVel[2 * dst] = this.diffuseVel[2 * src];
        this.diffuseVel[2 * dst + 1] = this.diffuseVel[2 * src + 1];
        this.diffuseLife[dst] = this.diffuseLife[src];
        this.diffuseType[dst] = this.diffuseType[src];
        this.diffuseColor[3 * dst] = this.diffuseColor[3 * src];
        this.diffuseColor[3 * dst + 1] = this.diffuseColor[3 * src + 1];
        this.diffuseColor[3 * dst + 2] = this.diffuseColor[3 * src + 2];
      }
      dst++;
    }
    this.numDiffuseParticles = dst;
  }

  private updateDiffuseParticles(
    dt: number,
    gravityX: number,
    gravityY: number,
    bubbleBuoyancy: number,
    foamGravity: number,
    sprayGravity: number,
    weightTurbulence: number,
    weightWavecrest: number,
    weightKinetic: number,
    bubbleEmissionScale: number,
    foamEmissionScale: number,
    sprayEmissionScale: number
  ): void {
    // Advance and cull existing particles first so that newly-spawned particles
    // are NOT advanced in the same frame they are born.  If we emitted first and
    // then advanced, every new particle would immediately fly speed*dt away from
    // its spawn point — producing the "white particles a bit far from the fluid"
    // visual artefact.  By advancing before emitting, new particles sit exactly
    // at their spawn position until the next frame.
    if (this.numDiffuseParticles > 0) {
      this.updateDiffuseParticleTypes();
      this.advanceDiffuseParticles(dt, gravityX, gravityY, bubbleBuoyancy, foamGravity, sprayGravity);
      this.updateDiffuseParticleTypes();
      this.updateDiffuseParticleColors();
      this.removeDeadDiffuseParticles();
    }
    this.emitDiffuseParticles(
      dt,
      weightTurbulence,
      weightWavecrest,
      weightKinetic,
      bubbleEmissionScale,
      foamEmissionScale,
      sprayEmissionScale
    );
  }

  // ── updateVorticity ───────────────────────────────────────────────────────
  // Computes the magnitude of the 2D vorticity (curl of velocity) at each grid
  // cell center.  Since velocity is staggered (MAC grid), the discrete curl is
  // naturally defined at cell corners: ω = (v_right - v_left)/h - (u_top - u_bottom)/h.
  // We average the four surrounding corner values to obtain a cell-centered ω.
  updateVorticity(): void {
    const n = this.fNumY;
    const h1 = this.fInvSpacing;
    this.vorticity.fill(0.0);

    for (let i = 1; i < this.fNumX - 1; i++) {
      for (let j = 1; j < this.fNumY - 1; j++) {
        // Compute ω at the FOUR corners of cell (i,j).
        // Corner (i,j) is at (i*h, j*h).
        const omega = (cornerI: number, cornerJ: number) => {
          const dv_dx = (this.v[cornerI * n + cornerJ] - this.v[(cornerI - 1) * n + cornerJ]) * h1;
          const du_dy = (this.u[cornerI * n + cornerJ] - this.u[cornerI * n + cornerJ - 1]) * h1;
          return Math.abs(dv_dx - du_dy);
        };

        const w00 = omega(i, j);         // bottom-left corner
        const w10 = omega(i + 1, j);     // bottom-right
        const w11 = omega(i + 1, j + 1); // top-right
        const w01 = omega(i, j + 1);     // top-left

        this.vorticity[i * n + j] = 0.25 * (w00 + w10 + w11 + w01);
      }
    }
  }

  // ── setSciColor ───────────────────────────────────────────────────────────
  // Maps a scalar value in [minVal, maxVal] to a scientific "rainbow" colour
  // (blue → cyan → green → yellow → red) and writes it to cellColor.
  // Used by updateCellColors to visualise the normalised particle density field.
  setSciColor(cellNr: number, val: number, minVal: number, maxVal: number): void {
    val = Math.min(Math.max(val, minVal), maxVal - 0.0001);
    const d   = maxVal - minVal;
    val = d === 0.0 ? 0.5 : (val - minVal) / d; // normalise to [0, 1)
    const m   = 0.25;
    const num = Math.floor(val / m);             // which of the 4 colour segments
    const s   = (val - num * m) / m;             // position within that segment
    let r: number, g: number, b: number;

    switch (num) {
      case 0: r = 0.0; g = s;       b = 1.0;       break; // blue → cyan
      case 1: r = 0.0; g = 1.0;     b = 1.0 - s;   break; // cyan → green
      case 2: r = s;   g = 1.0;     b = 0.0;       break; // green → yellow
      case 3: r = 1.0; g = 1.0 - s; b = 0.0;       break; // yellow → red
      default:r = 1.0; g = 0.0;     b = 0.0;       break;
    }

    this.cellColor[3 * cellNr]     = r;
    this.cellColor[3 * cellNr + 1] = g;
    this.cellColor[3 * cellNr + 2] = b;
  }

  // ── updateCellColors ──────────────────────────────────────────────────────
  // Fills cellColor for the optional grid debug overlay:
  //   • SOLID cells → mid-grey
  //   • FLUID cells → rainbow-mapped normalised density (0 = blue, 2× rest = red)
  //   • AIR cells   → black (cleared at the start)
  updateCellColors(): void {
    this.cellColor.fill(0.0);

    for (let i = 0; i < this.fNumCells; i++) {
      if (this.cellType[i] === SOLID_CELL) {
        this.cellColor[3 * i]     = 0.5;
        this.cellColor[3 * i + 1] = 0.5;
        this.cellColor[3 * i + 2] = 0.5;
      } else if (this.cellType[i] === FLUID_CELL) {
        let d = this.particleDensity[i];
        if (this.particleRestDensity > 0.0) d /= this.particleRestDensity;
        this.setSciColor(i, d, 0.0, 2.0);
      }
    }
  }

  // ── simulate ─────────────────────────────────────────────────────────────
  // Single timestep of the FLIP simulation.  The pipeline is:
  //
  //   1. integrateParticles  – gravity + advection (Lagrangian)
  //   2. pushParticlesApart  – position-level collision response
  //   3. handleParticleCollisions – enforce domain boundary
  //   4. transferVelocities (P→G) – splat to MAC grid, classify cells
  //   5. updateParticleDensity  – compute density field (+ rest density init)
  //   6. solveIncompressibility – pressure projection (∇·u = 0)
  //   7. transferVelocities (G→P) – FLIP/PIC blend back to particles
  //
  // Colour updates happen once per frame outside the substep loop.
  simulate(
    dt: number,
    gravityX: number,
    gravityY: number,
    picRatio: number,
    numPressureIters: number,
    numParticleIters: number,
    overRelaxation: number,
    compensateDrift: boolean,
    separateParticles: boolean,
    damping: number = 1.0,
    numExtrapolationIters = 2,
    maxDiffuseParticles = this.maxDiffuseParticles,
    diffuseEmissionRate = this.diffuseEmissionRate,
    diffuseMinSpeed = this.diffuseMinSpeed,
    diffuseLifetime = this.diffuseLifetime,
    bubbleBuoyancy = 4.0,
    foamGravity = 1.0,
    sprayGravity = 1.0,
    weightTurbulence = 0.5,
    weightWavecrest = 0.8,
    weightKinetic = 0.3,
    bubbleEmissionScale = 0.5,
    foamEmissionScale = 1.0,
    sprayEmissionScale = 1.0,
    diffuseRepulsionStrength = 0.1
  ): void {
    const numSubSteps = 1;
    const sdt = dt / numSubSteps;
    this.setWhitewaterSettings(
      true,
      maxDiffuseParticles,
      diffuseEmissionRate,
      diffuseMinSpeed,
      diffuseLifetime
    );

    for (let step = 0; step < numSubSteps; step++) {
      // 1. Accumulate gravity into particle velocities (Lagrangian)
      this.applyGravity(sdt, gravityX, gravityY, damping);

      // 2. Transfer velocities from particles to grid (P→G)
      this.transferVelocities(true, picRatio);

      // 3. Update density for drift compensation
      this.updateParticleDensity();

      // 4. Eulerian step: solve pressure to make field divergence-free
      this.solveIncompressibility(numPressureIters, sdt, overRelaxation, compensateDrift);

      // 5. Extrapolate velocity into air cells for smooth particle sampling
      this.extrapolateVelocity(numExtrapolationIters);

      // 6. Transfer velocities from grid back to particles (G→P)
      this.transferVelocities(false, picRatio);

      // 7. Advect particles using the final grid velocity (RK2)
      this.advectParticles(sdt);

      // 8. Handle collisions and separation
      if (separateParticles) this.pushParticlesApart(numParticleIters);
      this.handleParticleCollisions();

      // 9. Whitewater & Vorticity
      this.updateVorticity();
      this.updateDiffuseParticles(
        sdt,
        gravityX,
        gravityY,
        bubbleBuoyancy,
        foamGravity,
        sprayGravity,
        weightTurbulence,
        weightWavecrest,
        weightKinetic,
        bubbleEmissionScale,
        foamEmissionScale,
        sprayEmissionScale
      );
      if (diffuseRepulsionStrength > 0) {
        this.pushDiffuseParticlesApart(1, diffuseRepulsionStrength);
      }
    }

    this.updateParticleColors();
    this.updateCellColors();
  }

  // ── Colour setters ────────────────────────────────────────────────────────

  // Resets all particle colours to the new base colour immediately.
  setFluidColor(baseColor: { r: number; g: number; b: number }): void {
    this.baseColor = { ...baseColor };
    for (let i = 0; i < this.maxParticles; i++) {
      this.particleColor[3 * i]     = baseColor.r;
      this.particleColor[3 * i + 1] = baseColor.g;
      this.particleColor[3 * i + 2] = baseColor.b;
    }
  }

  setDiffuseColors(
    foam: { r: number; g: number; b: number },
    spray: { r: number; g: number; b: number },
    bubble: { r: number; g: number; b: number }
  ): void {
    this.foamColor   = { ...foam };
    this.sprayColor  = { ...spray };
    this.bubbleColor = { ...bubble };
  }

  // ── resizeDomain ──────────────────────────────────────────────────────────
  // Adapts the simulation grid to a new world-space domain without resetting
  // the particle simulation.  Particle positions, velocities, colours, and
  // particleRestDensity are all preserved.
  //
  // What changes:
  //   • fNumX / fNumY recomputed from new dimensions using the fixed cell size h.
  //   • All grid arrays (velocities, pressure, density, …) are reallocated and
  //     zeroed — they will be correctly rebuilt from particle data on the very
  //     next call to simulate().
  //   • The solid boundary mask s[] is rebuilt for the new grid extents.
  //   • The particle spatial hash is resized if pNumX or pNumY changed.
  //   • Particles outside the new boundary are clamped to the interior edge
  //     (their velocity component toward the wall is zeroed by the next call to
  //     handleParticleCollisions()).
  //
  // What does NOT change:
  //   • h, fInvSpacing, particleRadius — the physics cell size is fixed.
  //   • particleRestDensity — this is a property of the fluid packing, not the
  //     domain shape; resetting it would corrupt the drift compensation target.
  resizeDomain(newWidth: number, newHeight: number): void {
    const newFNumX = Math.floor(newWidth  / this.h) + 1;
    const newFNumY = Math.floor(newHeight / this.h) + 1;
    if (newFNumX === this.fNumX && newFNumY === this.fNumY) return;

    this.fNumX = newFNumX;
    this.fNumY = newFNumY;
    this.fNumCells = this.fNumX * this.fNumY;

    // Reallocate all grid arrays.  Grid velocities start at zero and are
    // reconstructed from particle data by the next P→G transfer.
    this.u             = new Float32Array(this.fNumCells);
    this.v             = new Float32Array(this.fNumCells);
    this.du            = new Float32Array(this.fNumCells);
    this.dv            = new Float32Array(this.fNumCells);
    this.prevU         = new Float32Array(this.fNumCells);
    this.prevV         = new Float32Array(this.fNumCells);
    this.p             = new Float32Array(this.fNumCells);
    this.tempU         = new Float32Array(this.fNumCells);
    this.tempV         = new Float32Array(this.fNumCells);
    this.s             = new Float32Array(this.fNumCells);
    this.cellType      = new Int32Array(this.fNumCells);
    this.cellColor     = new Float32Array(3 * this.fNumCells);
    this.vorticity     = new Float32Array(this.fNumCells);
    this.particleDensity = new Float32Array(this.fNumCells);

    // Rebuild solid boundaries: left, right, and bottom walls; top is open.
    const n = this.fNumY;
    for (let i = 0; i < this.fNumX; i++) {
      for (let j = 0; j < this.fNumY; j++) {
        this.s[i * n + j] = (i === 0 || i === this.fNumX - 1 || j === 0) ? 0.0 : 1.0;
      }
    }

    // Resize the particle spatial hash if either dimension changed.
    // cellParticleIds is sized by maxParticles and never needs resizing.
    const newPNumX = Math.floor(newWidth  * this.pInvSpacing) + 1;
    const newPNumY = Math.floor(newHeight * this.pInvSpacing) + 1;
    if (newPNumX !== this.pNumX || newPNumY !== this.pNumY) {
      this.pNumX   = newPNumX;
      this.pNumY   = newPNumY;
      this.pNumCells = this.pNumX * this.pNumY;
      this.numCellParticles  = new Int32Array(this.pNumCells);
      this.firstCellParticle = new Int32Array(this.pNumCells + 1);
    }

    // Clamp any particles that fall outside the new (possibly smaller) domain.
    // handleParticleCollisions() will zero the normal velocity on the next frame.
    const maxX = (this.fNumX - 1) * this.h - this.particleRadius;
    const maxY = (this.fNumY - 1) * this.h - this.particleRadius;
    for (let i = 0; i < this.numParticles; i++) {
      if (this.particlePos[2 * i]     > maxX) this.particlePos[2 * i]     = maxX;
      if (this.particlePos[2 * i + 1] > maxY) this.particlePos[2 * i + 1] = maxY;
    }
  }
}
