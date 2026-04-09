// ─── Cell type constants ──────────────────────────────────────────────────────
// Every cell in the MAC grid is tagged with one of these three types each frame.
// FLUID  – at least one particle centre falls inside this cell.
// AIR    – no particle, and the cell is not a boundary wall.
// SOLID  – a boundary wall; velocity on its face is forced to zero (no-slip).
export const FLUID_CELL = 0;
export const AIR_CELL = 1;
export const SOLID_CELL = 2;

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
  // Solid mask: s[i*fNumY+j] = 0.0 for SOLID cells, 1.0 for everything else.
  // Used in solveIncompressibility to count and weight open neighbours so that
  // the pressure update never pushes velocity into a wall.
  s: Float32Array;
  cellType: Int32Array;    // per-cell type (FLUID_CELL / AIR_CELL / SOLID_CELL)
  cellColor: Float32Array; // packed RGB [0,1] for grid debug visualisation (3 floats per cell)

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
  foamColor: { r: number; g: number; b: number }; // colour for low-density surface particles
  colorDiffusionCoeff: number; // how quickly neighbours exchange colour on contact (0–1)
  foamReturnRate: number;      // speed at which foam particles fade back to baseColor [1/s]

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
    baseColor?: { r: number; g: number; b: number },
    foamColor?: { r: number; g: number; b: number },
    colorDiffusionCoeff: number = 0.01,
    foamReturnRate: number = 1.0
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
    this.s = new Float32Array(this.fNumCells);
    this.cellType = new Int32Array(this.fNumCells);
    this.cellColor = new Float32Array(3 * this.fNumCells);

    this.maxParticles = maxParticles;
    this.particlePos = new Float32Array(2 * this.maxParticles);
    this.particleColor = new Float32Array(3 * this.maxParticles);

    const defaultColor = { r: 0.06, g: 0.45, b: 0.9 };
    const color = baseColor || defaultColor;
    this.baseColor = { ...color };
    this.foamColor = foamColor || { r: 0.7, g: 0.9, b: 1.0 };
    this.colorDiffusionCoeff = colorDiffusionCoeff;
    this.foamReturnRate = foamReturnRate;

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
  }

  // ── integrateParticles ────────────────────────────────────────────────────
  // Semi-implicit Euler step: accumulate gravity, apply optional velocity
  // damping, then advance positions.  Damping < 1 is a simple energy drain that
  // prevents unbounded velocity growth and acts as a proxy for viscosity.
  integrateParticles(
    dt: number,
    gravityX: number,
    gravityY: number,
    damping: number
  ): void {
    for (let i = 0; i < this.numParticles; i++) {
      this.particleVel[2 * i]     += dt * gravityX;
      this.particleVel[2 * i + 1] += dt * gravityY;

      // Apply damping after gravity so the damping factor multiplies the full
      // updated velocity (gravity included).
      this.particleVel[2 * i]     *= damping;
      this.particleVel[2 * i + 1] *= damping;

      this.particlePos[2 * i]     += this.particleVel[2 * i]     * dt;
      this.particlePos[2 * i + 1] += this.particleVel[2 * i + 1] * dt;
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
  //   3. While pushing, mix the two particles' colours slightly (colour
  //      diffusion), which creates the foam-spreading visual effect.
  //
  // The spatial hash uses a compact CSR (Compressed Sparse Row) structure
  // built in two passes:
  //   Pass 1 – count particles per cell  → numCellParticles
  //   Pass 2 – convert to suffix sum, then fill cellParticleIds by decrementing
  //             each cell's start pointer as particles are inserted.
  pushParticlesApart(numIters: number): void {
    const colorDiffusionCoeff = this.colorDiffusionCoeff;

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

              // Colour diffusion: nudge each particle's colour a small step
              // toward the midpoint of the two colours.  This creates a subtle
              // ink-mixing look when particles collide.
              for (let k = 0; k < 3; k++) {
                const color0 = this.particleColor[3 * i  + k];
                const color1 = this.particleColor[3 * id + k];
                const color  = (color0 + color1) * 0.5;
                this.particleColor[3 * i  + k] = color0 + (color - color0) * colorDiffusionCoeff;
                this.particleColor[3 * id + k] = color1 + (color - color1) * colorDiffusionCoeff;
              }
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
  //   particleVel = (1 − flipRatio) × PIC  +  flipRatio × FLIP
  //   flipRatio ≈ 0.95 gives mostly FLIP (energetic) with a small PIC component
  //   to suppress high-frequency noise.
  //
  // The stencil is staggered: u samples are offset by (0, h/2) so they align
  // with left-face midpoints; v samples are offset by (h/2, 0) to align with
  // bottom-face midpoints.  Both components are handled in the same loop body
  // via the `component` index (0 = u, 1 = v).
  transferVelocities(toGrid: boolean, flipRatio: number): void {
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
          // Accumulate weighted particle velocity onto surrounding grid faces.
          const pv = this.particleVel[2 * i + component];
          f[nr0] += pv * d0;  d[nr0] += d0;
          f[nr1] += pv * d1;  d[nr1] += d1;
          f[nr2] += pv * d2;  d[nr2] += d2;
          f[nr3] += pv * d3;  d[nr3] += d3;
        } else {
          // G→P: a face velocity is only valid if at least one of the two cells
          // sharing that face is non-air (i.e. has actual velocity data).
          // `offset` is the stride to reach the cell on the "negative" side of
          // the face: n (= fNumY) for u faces (step in the i direction),
          // 1 for v faces (step in the j direction).
          const offset = component === 0 ? n : 1;
          const valid0 = (this.cellType[nr0] !== AIR_CELL || this.cellType[nr0 - offset] !== AIR_CELL) ? 1.0 : 0.0;
          const valid1 = (this.cellType[nr1] !== AIR_CELL || this.cellType[nr1 - offset] !== AIR_CELL) ? 1.0 : 0.0;
          const valid2 = (this.cellType[nr2] !== AIR_CELL || this.cellType[nr2 - offset] !== AIR_CELL) ? 1.0 : 0.0;
          const valid3 = (this.cellType[nr3] !== AIR_CELL || this.cellType[nr3 - offset] !== AIR_CELL) ? 1.0 : 0.0;

          const v = this.particleVel[2 * i + component];
          const totalValid = valid0 * d0 + valid1 * d1 + valid2 * d2 + valid3 * d3;

          if (totalValid > 0.0) {
            // PIC: interpolate the post-pressure grid velocity directly.
            const picV =
              (valid0 * d0 * f[nr0] +
               valid1 * d1 * f[nr1] +
               valid2 * d2 * f[nr2] +
               valid3 * d3 * f[nr3]) / totalValid;

            // FLIP correction: interpolate only the pressure-induced velocity
            // change (f − prevF, where prevF was set to post-P2G by
            // solveIncompressibility).  Add that delta to the particle's own
            // carried velocity to recover the low-dissipation FLIP update.
            const corr =
              (valid0 * d0 * (f[nr0] - prevF[nr0]) +
               valid1 * d1 * (f[nr1] - prevF[nr1]) +
               valid2 * d2 * (f[nr2] - prevF[nr2]) +
               valid3 * d3 * (f[nr3] - prevF[nr3])) / totalValid;
            const flipV = v + corr;

            this.particleVel[2 * i + component] = (1.0 - flipRatio) * picV + flipRatio * flipV;
          }
        }
      }

      if (toGrid) {
        // Normalise: divide accumulated velocity by accumulated weight.
        for (let i = 0; i < f.length; i++) {
          if (d[i] > 0.0) f[i] /= d[i];
        }

        // Restore no-slip condition on solid-wall faces.  Any face that touches
        // a SOLID cell is forced back to its pre-splat value (prevU/prevV),
        // which is zero for stationary walls.  This must happen after the splat
        // normalisation so that the surrounding fluid faces are unaffected.
        for (let i = 0; i < this.fNumX; i++) {
          for (let j = 0; j < this.fNumY; j++) {
            const solid = this.cellType[i * n + j] === SOLID_CELL;
            if (solid || (i > 0 && this.cellType[(i - 1) * n + j] === SOLID_CELL)) {
              this.u[i * n + j] = this.prevU[i * n + j];
            }
            if (solid || (j > 0 && this.cellType[i * n + j - 1] === SOLID_CELL)) {
              this.v[i * n + j] = this.prevV[i * n + j];
            }
          }
        }
      }
    }
  }

  // ── solveIncompressibility ────────────────────────────────────────────────
  // Gauss-Seidel pressure projection that drives the velocity divergence to zero
  // in every FLUID cell.  This is the core of the Eulerian incompressible-flow
  // solver and is responsible for all pressure-driven effects (buoyancy,
  // splashing, wave propagation).
  //
  // For each FLUID cell we compute the discrete divergence:
  //   div = u[right] − u[center] + v[top] − v[center]
  // and add a pressure correction that removes it:
  //   p += cp × (−div / numOpenNeighbours)
  // where cp = ρ h / dt is the pressure coefficient that makes units consistent.
  //
  // The solid mask s[*] gates each direction: a 0.0 entry means the neighbour
  // in that direction is a wall, so we neither push velocity into it nor count
  // it as an open face.
  //
  // Optional drift compensation: if a cell is over-compressed relative to
  // particleRestDensity, an extra positive term is added to div so the solver
  // generates an outward pressure impulse that disperses the excess.
  //
  // NOTE: prevU/prevV are overwritten here (after the P→G step has already used
  // them for wall restoration) to snapshot the pre-pressure velocities.  The
  // G→P transfer uses this snapshot to compute the FLIP correction (Δu from
  // pressure only).
  solveIncompressibility(
    numIters: number,
    dt: number,
    overRelaxation: number,
    compensateDrift = true
  ): void {
    this.p.fill(0.0);

    // Snapshot velocities before modification so G→P can isolate the pressure
    // delta.  This overwrites the wall-restoration snapshot from transferVelocities,
    // which is no longer needed at this point.
    this.prevU.set(this.u);
    this.prevV.set(this.v);

    const n  = this.fNumY;
    const cp = (this.density * this.h) / dt; // pressure scaling coefficient

    for (let iter = 0; iter < numIters; iter++) {
      for (let i = 1; i < this.fNumX - 1; i++) {
        for (let j = 1; j < this.fNumY - 1; j++) {
          if (this.cellType[i * n + j] !== FLUID_CELL) continue;

          const center = i * n + j;
          const left   = (i - 1) * n + j;
          const right  = (i + 1) * n + j;
          const bottom = i * n + j - 1;
          const top    = i * n + j + 1;

          // s values of neighbours (0 = solid wall, 1 = open).
          const sx0 = this.s[left];
          const sx1 = this.s[right];
          const sy0 = this.s[bottom];
          const sy1 = this.s[top];
          const s   = sx0 + sx1 + sy0 + sy1; // number of open neighbours
          if (s === 0.0) continue;            // fully surrounded by walls

          // Discrete divergence of the velocity field at this cell.
          let div = this.u[right] - this.u[center] + this.v[top] - this.v[center];

          // Drift compensation: treat over-compression as additional divergence
          // so the solver pushes particles outward to relieve the excess density.
          if (this.particleRestDensity > 0.0 && compensateDrift) {
            const compression = this.particleDensity[i * n + j] - this.particleRestDensity;
            if (compression > 0.0) {
              div -= compression;
            }
          }

          // Pressure correction scaled by overRelaxation (> 1 accelerates
          // convergence at the cost of some stability; 1.7 is a common choice).
          let p = (-div / s) * overRelaxation;
          this.p[center] += cp * p;

          // Push the face velocities of open neighbours to zero divergence.
          this.u[center] -= sx0 * p;
          this.u[right]  += sx1 * p;
          this.v[center] -= sy0 * p;
          this.v[top]    += sy1 * p;
        }
      }
    }
  }

  // ── updateParticleColors ──────────────────────────────────────────────────
  // Two-state colouring model based on local particle density:
  //
  //   • Low density (< 70 % of rest density) → snap to foamColor.
  //     These particles sit at the free surface or in splash regions where the
  //     fluid is rarified, visually representing foam and spray.
  //
  //   • Normal / high density → lerp back toward baseColor at a rate of
  //     foamReturnRate per second, so foam particles smoothly regain their
  //     fluid colour once they re-enter the bulk.
  updateParticleColors(dt: number): void {
    const h1 = this.fInvSpacing;
    // Pre-compute the lerp factor for this timestep, clamped to [0, 1].
    const t = Math.max(0, Math.min(1, this.foamReturnRate * dt));

    for (let i = 0; i < this.numParticles; i++) {
      const x  = this.particlePos[2 * i];
      const y  = this.particlePos[2 * i + 1];
      const xi = clamp(Math.floor(x * h1), 1, this.fNumX - 1);
      const yi = clamp(Math.floor(y * h1), 1, this.fNumY - 1);
      const cellNr = xi * this.fNumY + yi;

      // Classify as foam if this cell's density is well below rest density.
      let applyFoam = false;
      const d0 = this.particleRestDensity;
      if (d0 > 0.0) {
        const relDensity = this.particleDensity[cellNr] / d0;
        if (relDensity < 0.7) applyFoam = true;
      }

      if (applyFoam) {
        this.particleColor[3 * i]     = this.foamColor.r;
        this.particleColor[3 * i + 1] = this.foamColor.g;
        this.particleColor[3 * i + 2] = this.foamColor.b;
      } else {
        // Gradually return to baseColor.
        const cr = this.particleColor[3 * i];
        const cg = this.particleColor[3 * i + 1];
        const cb = this.particleColor[3 * i + 2];
        this.particleColor[3 * i]     = cr + (this.baseColor.r - cr) * t;
        this.particleColor[3 * i + 1] = cg + (this.baseColor.g - cg) * t;
        this.particleColor[3 * i + 2] = cb + (this.baseColor.b - cb) * t;
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
    flipRatio: number,
    numPressureIters: number,
    numParticleIters: number,
    overRelaxation: number,
    compensateDrift: boolean,
    separateParticles: boolean,
    damping: number = 1.0
  ): void {
    const numSubSteps = 1;
    const sdt = dt / numSubSteps;

    for (let step = 0; step < numSubSteps; step++) {
      this.integrateParticles(sdt, gravityX, gravityY, damping);
      if (separateParticles) this.pushParticlesApart(numParticleIters);
      this.handleParticleCollisions();
      this.transferVelocities(true, flipRatio);
      this.updateParticleDensity();
      this.solveIncompressibility(numPressureIters, sdt, overRelaxation, compensateDrift);
      this.transferVelocities(false, flipRatio);
    }

    this.updateParticleColors(sdt);
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

  setFoamColor(foamColor: { r: number; g: number; b: number }): void {
    this.foamColor = { ...foamColor };
  }

  setColorDiffusionCoeff(coeff: number): void {
    this.colorDiffusionCoeff = Math.max(0, Math.min(1, coeff));
  }

  setFoamReturnRate(rate: number): void {
    this.foamReturnRate = Math.max(0, rate);
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
    this.s             = new Float32Array(this.fNumCells);
    this.cellType      = new Int32Array(this.fNumCells);
    this.cellColor     = new Float32Array(3 * this.fNumCells);
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
