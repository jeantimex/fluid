/**
 * FLIP Fluid Simulation
 *
 * This is a direct port of the FlipFluid class from the reference implementation.
 * It implements the Fluid-Implicit-Particle (FLIP) method for fluid simulation.
 *
 * The simulation uses a hybrid approach:
 * - Particles carry velocity and are advected through the domain
 * - A background grid is used for pressure projection and incompressibility
 * - Velocities are transferred between particles and grid each time step
 */

// Cell type constants
export const FLUID_CELL = 0;
export const AIR_CELL = 1;
export const SOLID_CELL = 2;

function clamp(x: number, min: number, max: number): number {
  if (x < min) return min;
  if (x > max) return max;
  return x;
}

export class FlipFluid {
  // Fluid grid properties
  density: number;
  fNumX: number;
  fNumY: number;
  h: number;
  fInvSpacing: number;
  fNumCells: number;

  // Grid velocity fields (staggered MAC grid)
  u: Float32Array; // x-velocity at left cell faces
  v: Float32Array; // y-velocity at bottom cell faces
  du: Float32Array; // weights for u
  dv: Float32Array; // weights for v
  prevU: Float32Array; // previous u for FLIP
  prevV: Float32Array; // previous v for FLIP
  p: Float32Array; // pressure
  s: Float32Array; // solid flag (0 = solid, 1 = fluid)
  cellType: Int32Array; // cell type (FLUID, AIR, SOLID)
  cellColor: Float32Array; // RGB colors for visualization

  // Particle properties
  maxParticles: number;
  numParticles: number;
  particlePos: Float32Array; // interleaved x,y positions
  particleVel: Float32Array; // interleaved x,y velocities
  particleColor: Float32Array; // interleaved r,g,b colors
  particleDensity: Float32Array; // per-cell particle density
  particleRestDensity: number;
  particleRadius: number;

  // Spatial hashing for particle-particle interactions
  pInvSpacing: number;
  pNumX: number;
  pNumY: number;
  pNumCells: number;
  numCellParticles: Int32Array;
  firstCellParticle: Int32Array;
  cellParticleIds: Int32Array;

  constructor(
    density: number,
    width: number,
    height: number,
    spacing: number,
    particleRadius: number,
    maxParticles: number
  ) {
    // Fluid grid setup
    this.density = density;
    this.fNumX = Math.floor(width / spacing) + 1;
    this.fNumY = Math.floor(height / spacing) + 1;
    this.h = Math.max(width / this.fNumX, height / this.fNumY);
    this.fInvSpacing = 1.0 / this.h;
    this.fNumCells = this.fNumX * this.fNumY;

    // Allocate grid arrays
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

    // Particle setup
    this.maxParticles = maxParticles;
    this.numParticles = 0;

    this.particlePos = new Float32Array(2 * maxParticles);
    this.particleVel = new Float32Array(2 * maxParticles);
    this.particleColor = new Float32Array(3 * maxParticles);
    // Initialize particle colors to blue
    for (let i = 0; i < maxParticles; i++) {
      this.particleColor[3 * i + 2] = 1.0;
    }

    this.particleDensity = new Float32Array(this.fNumCells);
    this.particleRestDensity = 0.0;
    this.particleRadius = particleRadius;

    // Spatial hash for particle collision detection
    this.pInvSpacing = 1.0 / (2.2 * particleRadius);
    this.pNumX = Math.floor(width * this.pInvSpacing) + 1;
    this.pNumY = Math.floor(height * this.pInvSpacing) + 1;
    this.pNumCells = this.pNumX * this.pNumY;

    this.numCellParticles = new Int32Array(this.pNumCells);
    this.firstCellParticle = new Int32Array(this.pNumCells + 1);
    this.cellParticleIds = new Int32Array(maxParticles);
  }

  /**
   * Integrate particle positions using semi-implicit Euler.
   */
  integrateParticles(dt: number, gravity: number): void {
    for (let i = 0; i < this.numParticles; i++) {
      this.particleVel[2 * i + 1] += dt * gravity;
      this.particlePos[2 * i] += this.particleVel[2 * i] * dt;
      this.particlePos[2 * i + 1] += this.particleVel[2 * i + 1] * dt;
    }
  }

  /**
   * Push particles apart to enforce minimum separation distance.
   * Also diffuses colors between nearby particles.
   */
  pushParticlesApart(numIters: number): void {
    const colorDiffusionCoeff = 0.001;

    // Count particles per cell
    this.numCellParticles.fill(0);

    for (let i = 0; i < this.numParticles; i++) {
      const x = this.particlePos[2 * i];
      const y = this.particlePos[2 * i + 1];

      const xi = clamp(Math.floor(x * this.pInvSpacing), 0, this.pNumX - 1);
      const yi = clamp(Math.floor(y * this.pInvSpacing), 0, this.pNumY - 1);
      const cellNr = xi * this.pNumY + yi;
      this.numCellParticles[cellNr]++;
    }

    // Compute partial sums (prefix sum)
    let first = 0;
    for (let i = 0; i < this.pNumCells; i++) {
      first += this.numCellParticles[i];
      this.firstCellParticle[i] = first;
    }
    this.firstCellParticle[this.pNumCells] = first; // guard

    // Fill particles into cells (counting sort)
    for (let i = 0; i < this.numParticles; i++) {
      const x = this.particlePos[2 * i];
      const y = this.particlePos[2 * i + 1];

      const xi = clamp(Math.floor(x * this.pInvSpacing), 0, this.pNumX - 1);
      const yi = clamp(Math.floor(y * this.pInvSpacing), 0, this.pNumY - 1);
      const cellNr = xi * this.pNumY + yi;
      this.firstCellParticle[cellNr]--;
      this.cellParticleIds[this.firstCellParticle[cellNr]] = i;
    }

    // Push particles apart
    const minDist = 2.0 * this.particleRadius;
    const minDist2 = minDist * minDist;

    for (let iter = 0; iter < numIters; iter++) {
      for (let i = 0; i < this.numParticles; i++) {
        const px = this.particlePos[2 * i];
        const py = this.particlePos[2 * i + 1];

        const pxi = Math.floor(px * this.pInvSpacing);
        const pyi = Math.floor(py * this.pInvSpacing);
        const x0 = Math.max(pxi - 1, 0);
        const y0 = Math.max(pyi - 1, 0);
        const x1 = Math.min(pxi + 1, this.pNumX - 1);
        const y1 = Math.min(pyi + 1, this.pNumY - 1);

        for (let xi = x0; xi <= x1; xi++) {
          for (let yi = y0; yi <= y1; yi++) {
            const cellNr = xi * this.pNumY + yi;
            const cellFirst = this.firstCellParticle[cellNr];
            const last = this.firstCellParticle[cellNr + 1];

            for (let j = cellFirst; j < last; j++) {
              const id = this.cellParticleIds[j];
              if (id === i) continue;

              const qx = this.particlePos[2 * id];
              const qy = this.particlePos[2 * id + 1];

              let dx = qx - px;
              let dy = qy - py;
              const d2 = dx * dx + dy * dy;

              if (d2 > minDist2 || d2 === 0.0) continue;

              const d = Math.sqrt(d2);
              const s = (0.5 * (minDist - d)) / d;
              dx *= s;
              dy *= s;

              this.particlePos[2 * i] -= dx;
              this.particlePos[2 * i + 1] -= dy;
              this.particlePos[2 * id] += dx;
              this.particlePos[2 * id + 1] += dy;

              // Diffuse colors
              for (let k = 0; k < 3; k++) {
                const color0 = this.particleColor[3 * i + k];
                const color1 = this.particleColor[3 * id + k];
                const color = (color0 + color1) * 0.5;
                this.particleColor[3 * i + k] =
                  color0 + (color - color0) * colorDiffusionCoeff;
                this.particleColor[3 * id + k] =
                  color1 + (color - color1) * colorDiffusionCoeff;
              }
            }
          }
        }
      }
    }
  }

  /**
   * Handle particle collisions with boundaries and obstacles.
   */
  handleParticleCollisions(
    obstacleX: number,
    obstacleY: number,
    obstacleRadius: number,
    obstacleVelX: number,
    obstacleVelY: number
  ): void {
    const h = 1.0 / this.fInvSpacing;
    const r = this.particleRadius;
    const minDist = obstacleRadius + r;
    const minDist2 = minDist * minDist;

    const minX = h + r;
    const maxX = (this.fNumX - 1) * h - r;
    const minY = h + r;
    const maxY = (this.fNumY - 1) * h - r;

    for (let i = 0; i < this.numParticles; i++) {
      let x = this.particlePos[2 * i];
      let y = this.particlePos[2 * i + 1];

      const dx = x - obstacleX;
      const dy = y - obstacleY;
      const d2 = dx * dx + dy * dy;

      // Obstacle collision
      if (d2 < minDist2) {
        this.particleVel[2 * i] = obstacleVelX;
        this.particleVel[2 * i + 1] = obstacleVelY;
      }

      // Wall collisions
      if (x < minX) {
        x = minX;
        this.particleVel[2 * i] = 0.0;
      }
      if (x > maxX) {
        x = maxX;
        this.particleVel[2 * i] = 0.0;
      }
      if (y < minY) {
        y = minY;
        this.particleVel[2 * i + 1] = 0.0;
      }
      if (y > maxY) {
        y = maxY;
        this.particleVel[2 * i + 1] = 0.0;
      }

      this.particlePos[2 * i] = x;
      this.particlePos[2 * i + 1] = y;
    }
  }

  /**
   * Update particle density field for drift compensation.
   */
  updateParticleDensity(): void {
    const n = this.fNumY;
    const h = this.h;
    const h1 = this.fInvSpacing;
    const h2 = 0.5 * h;

    const d = this.particleDensity;
    d.fill(0.0);

    for (let i = 0; i < this.numParticles; i++) {
      let x = this.particlePos[2 * i];
      let y = this.particlePos[2 * i + 1];

      x = clamp(x, h, (this.fNumX - 1) * h);
      y = clamp(y, h, (this.fNumY - 1) * h);

      const x0 = Math.floor((x - h2) * h1);
      const tx = ((x - h2) - x0 * h) * h1;
      const x1 = Math.min(x0 + 1, this.fNumX - 2);

      const y0 = Math.floor((y - h2) * h1);
      const ty = ((y - h2) - y0 * h) * h1;
      const y1 = Math.min(y0 + 1, this.fNumY - 2);

      const sx = 1.0 - tx;
      const sy = 1.0 - ty;

      if (x0 < this.fNumX && y0 < this.fNumY) d[x0 * n + y0] += sx * sy;
      if (x1 < this.fNumX && y0 < this.fNumY) d[x1 * n + y0] += tx * sy;
      if (x1 < this.fNumX && y1 < this.fNumY) d[x1 * n + y1] += tx * ty;
      if (x0 < this.fNumX && y1 < this.fNumY) d[x0 * n + y1] += sx * ty;
    }

    // Compute rest density on first frame
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

  /**
   * Transfer velocities between particles and grid.
   * @param toGrid - true for P2G (particle to grid), false for G2P (grid to particle)
   * @param flipRatio - blend factor between FLIP (1.0) and PIC (0.0)
   */
  transferVelocities(toGrid: boolean, flipRatio: number = 0.9): void {
    const n = this.fNumY;
    const h = this.h;
    const h1 = this.fInvSpacing;
    const h2 = 0.5 * h;

    if (toGrid) {
      this.prevU.set(this.u);
      this.prevV.set(this.v);

      this.du.fill(0.0);
      this.dv.fill(0.0);
      this.u.fill(0.0);
      this.v.fill(0.0);

      // Mark cell types based on solid flag and particle presence
      for (let i = 0; i < this.fNumCells; i++) {
        this.cellType[i] = this.s[i] === 0.0 ? SOLID_CELL : AIR_CELL;
      }

      for (let i = 0; i < this.numParticles; i++) {
        const x = this.particlePos[2 * i];
        const y = this.particlePos[2 * i + 1];
        const xi = clamp(Math.floor(x * h1), 0, this.fNumX - 1);
        const yi = clamp(Math.floor(y * h1), 0, this.fNumY - 1);
        const cellNr = xi * n + yi;
        if (this.cellType[cellNr] === AIR_CELL) {
          this.cellType[cellNr] = FLUID_CELL;
        }
      }
    }

    // Process both velocity components
    for (let component = 0; component < 2; component++) {
      const dx = component === 0 ? 0.0 : h2;
      const dy = component === 0 ? h2 : 0.0;

      const f = component === 0 ? this.u : this.v;
      const prevF = component === 0 ? this.prevU : this.prevV;
      const weights = component === 0 ? this.du : this.dv;

      for (let i = 0; i < this.numParticles; i++) {
        let x = this.particlePos[2 * i];
        let y = this.particlePos[2 * i + 1];

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

        const d0 = sx * sy;
        const d1 = tx * sy;
        const d2 = tx * ty;
        const d3 = sx * ty;

        const nr0 = x0 * n + y0;
        const nr1 = x1 * n + y0;
        const nr2 = x1 * n + y1;
        const nr3 = x0 * n + y1;

        if (toGrid) {
          const pv = this.particleVel[2 * i + component];
          f[nr0] += pv * d0;
          weights[nr0] += d0;
          f[nr1] += pv * d1;
          weights[nr1] += d1;
          f[nr2] += pv * d2;
          weights[nr2] += d2;
          f[nr3] += pv * d3;
          weights[nr3] += d3;
        } else {
          const offset = component === 0 ? n : 1;
          const valid0 =
            this.cellType[nr0] !== AIR_CELL ||
            this.cellType[nr0 - offset] !== AIR_CELL
              ? 1.0
              : 0.0;
          const valid1 =
            this.cellType[nr1] !== AIR_CELL ||
            this.cellType[nr1 - offset] !== AIR_CELL
              ? 1.0
              : 0.0;
          const valid2 =
            this.cellType[nr2] !== AIR_CELL ||
            this.cellType[nr2 - offset] !== AIR_CELL
              ? 1.0
              : 0.0;
          const valid3 =
            this.cellType[nr3] !== AIR_CELL ||
            this.cellType[nr3 - offset] !== AIR_CELL
              ? 1.0
              : 0.0;

          const v = this.particleVel[2 * i + component];
          const totalWeight =
            valid0 * d0 + valid1 * d1 + valid2 * d2 + valid3 * d3;

          if (totalWeight > 0.0) {
            const picV =
              (valid0 * d0 * f[nr0] +
                valid1 * d1 * f[nr1] +
                valid2 * d2 * f[nr2] +
                valid3 * d3 * f[nr3]) /
              totalWeight;
            const corr =
              (valid0 * d0 * (f[nr0] - prevF[nr0]) +
                valid1 * d1 * (f[nr1] - prevF[nr1]) +
                valid2 * d2 * (f[nr2] - prevF[nr2]) +
                valid3 * d3 * (f[nr3] - prevF[nr3])) /
              totalWeight;
            const flipV = v + corr;

            this.particleVel[2 * i + component] =
              (1.0 - flipRatio) * picV + flipRatio * flipV;
          }
        }
      }

      if (toGrid) {
        // Normalize by weights
        for (let i = 0; i < f.length; i++) {
          if (weights[i] > 0.0) {
            f[i] /= weights[i];
          }
        }

        // Restore solid cell velocities
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

  /**
   * Solve for pressure to enforce incompressibility.
   */
  solveIncompressibility(
    numIters: number,
    dt: number,
    overRelaxation: number,
    compensateDrift: boolean = true
  ): void {
    this.p.fill(0.0);
    this.prevU.set(this.u);
    this.prevV.set(this.v);

    const n = this.fNumY;
    const cp = (this.density * this.h) / dt;

    for (let iter = 0; iter < numIters; iter++) {
      for (let i = 1; i < this.fNumX - 1; i++) {
        for (let j = 1; j < this.fNumY - 1; j++) {
          if (this.cellType[i * n + j] !== FLUID_CELL) continue;

          const center = i * n + j;
          const left = (i - 1) * n + j;
          const right = (i + 1) * n + j;
          const bottom = i * n + j - 1;
          const top = i * n + j + 1;

          const sx0 = this.s[left];
          const sx1 = this.s[right];
          const sy0 = this.s[bottom];
          const sy1 = this.s[top];
          const s = sx0 + sx1 + sy0 + sy1;

          if (s === 0.0) continue;

          let div =
            this.u[right] - this.u[center] + this.v[top] - this.v[center];

          if (this.particleRestDensity > 0.0 && compensateDrift) {
            const k = 1.0;
            const compression =
              this.particleDensity[i * n + j] - this.particleRestDensity;
            if (compression > 0.0) {
              div = div - k * compression;
            }
          }

          let pressure = -div / s;
          pressure *= overRelaxation;
          this.p[center] += cp * pressure;

          this.u[center] -= sx0 * pressure;
          this.u[right] += sx1 * pressure;
          this.v[center] -= sy0 * pressure;
          this.v[top] += sy1 * pressure;
        }
      }
    }
  }

  /**
   * Update particle colors based on local density.
   */
  updateParticleColors(): void {
    const h1 = this.fInvSpacing;

    for (let i = 0; i < this.numParticles; i++) {
      const s = 0.01;

      this.particleColor[3 * i] = clamp(
        this.particleColor[3 * i] - s,
        0.0,
        1.0
      );
      this.particleColor[3 * i + 1] = clamp(
        this.particleColor[3 * i + 1] - s,
        0.0,
        1.0
      );
      this.particleColor[3 * i + 2] = clamp(
        this.particleColor[3 * i + 2] + s,
        0.0,
        1.0
      );

      const x = this.particlePos[2 * i];
      const y = this.particlePos[2 * i + 1];
      const xi = clamp(Math.floor(x * h1), 1, this.fNumX - 1);
      const yi = clamp(Math.floor(y * h1), 1, this.fNumY - 1);
      const cellNr = xi * this.fNumY + yi;

      const d0 = this.particleRestDensity;

      if (d0 > 0.0) {
        const relDensity = this.particleDensity[cellNr] / d0;
        if (relDensity < 0.7) {
          const brightness = 0.8;
          this.particleColor[3 * i] = brightness;
          this.particleColor[3 * i + 1] = brightness;
          this.particleColor[3 * i + 2] = 1.0;
        }
      }
    }
  }

  /**
   * Set scientific color for visualization.
   */
  setSciColor(cellNr: number, val: number, minVal: number, maxVal: number): void {
    val = Math.min(Math.max(val, minVal), maxVal - 0.0001);
    const d = maxVal - minVal;
    val = d === 0.0 ? 0.5 : (val - minVal) / d;
    const m = 0.25;
    const num = Math.floor(val / m);
    const s = (val - num * m) / m;
    let r = 0,
      g = 0,
      b = 0;

    switch (num) {
      case 0:
        r = 0.0;
        g = s;
        b = 1.0;
        break;
      case 1:
        r = 0.0;
        g = 1.0;
        b = 1.0 - s;
        break;
      case 2:
        r = s;
        g = 1.0;
        b = 0.0;
        break;
      case 3:
        r = 1.0;
        g = 1.0 - s;
        b = 0.0;
        break;
    }

    this.cellColor[3 * cellNr] = r;
    this.cellColor[3 * cellNr + 1] = g;
    this.cellColor[3 * cellNr + 2] = b;
  }

  /**
   * Update cell colors for grid visualization.
   */
  updateCellColors(): void {
    this.cellColor.fill(0.0);

    for (let i = 0; i < this.fNumCells; i++) {
      if (this.cellType[i] === SOLID_CELL) {
        this.cellColor[3 * i] = 0.5;
        this.cellColor[3 * i + 1] = 0.5;
        this.cellColor[3 * i + 2] = 0.5;
      } else if (this.cellType[i] === FLUID_CELL) {
        let d = this.particleDensity[i];
        if (this.particleRestDensity > 0.0) {
          d /= this.particleRestDensity;
        }
        this.setSciColor(i, d, 0.0, 2.0);
      }
    }
  }

  /**
   * Run one simulation step.
   */
  simulate(
    dt: number,
    gravity: number,
    flipRatio: number,
    numPressureIters: number,
    numParticleIters: number,
    overRelaxation: number,
    compensateDrift: boolean,
    separateParticles: boolean,
    obstacleX: number,
    obstacleY: number,
    obstacleRadius: number,
    obstacleVelX: number,
    obstacleVelY: number
  ): void {
    const numSubSteps = 1;
    const sdt = dt / numSubSteps;

    for (let step = 0; step < numSubSteps; step++) {
      this.integrateParticles(sdt, gravity);
      if (separateParticles) {
        this.pushParticlesApart(numParticleIters);
      }
      this.handleParticleCollisions(
        obstacleX,
        obstacleY,
        obstacleRadius,
        obstacleVelX,
        obstacleVelY
      );
      this.transferVelocities(true, flipRatio);
      this.updateParticleDensity();
      this.solveIncompressibility(
        numPressureIters,
        sdt,
        overRelaxation,
        compensateDrift
      );
      this.transferVelocities(false, flipRatio);
    }

    this.updateParticleColors();
    this.updateCellColors();
  }
}
