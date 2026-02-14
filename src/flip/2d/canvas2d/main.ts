import './style.css';

const canvas = document.getElementById("myCanvas") as HTMLCanvasElement;
const gl = canvas.getContext("webgl")!;
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

canvas.focus();

const simHeight = 3.0;
const cScale = canvas.height / simHeight;
const simWidth = canvas.width / cScale;

const FLUID_CELL = 0;
const AIR_CELL = 1;
const SOLID_CELL = 2;

function clamp(x: number, min: number, max: number) {
  if (x < min) return min;
  else if (x > max) return max;
  else return x;
}

// ----------------- start of simulator ------------------------------

class FlipFluid {
  density: number;
  fNumX: number;
  fNumY: number;
  h: number;
  fInvSpacing: number;
  fNumCells: number;
  u: Float32Array;
  v: Float32Array;
  du: Float32Array;
  dv: Float32Array;
  prevU: Float32Array;
  prevV: Float32Array;
  p: Float32Array;
  s: Float32Array;
  cellType: Int32Array;
  cellColor: Float32Array;
  maxParticles: number;
  particlePos: Float32Array;
  particleColor: Float32Array;
  particleVel: Float32Array;
  particleDensity: Float32Array;
  particleRestDensity: number;
  particleRadius: number;
  pInvSpacing: number;
  pNumX: number;
  pNumY: number;
  pNumCells: number;
  numCellParticles: Int32Array;
  firstCellParticle: Int32Array;
  cellParticleIds: Int32Array;
  numParticles: number;

  constructor(
    density: number,
    width: number,
    height: number,
    spacing: number,
    particleRadius: number,
    maxParticles: number
  ) {
    // fluid

    this.density = density;
    this.fNumX = Math.floor(width / spacing) + 1;
    this.fNumY = Math.floor(height / spacing) + 1;
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

    // particles

    this.maxParticles = maxParticles;

    this.particlePos = new Float32Array(2 * this.maxParticles);
    this.particleColor = new Float32Array(3 * this.maxParticles);
    for (let i = 0; i < this.maxParticles; i++)
      this.particleColor[3 * i + 2] = 1.0;

    this.particleVel = new Float32Array(2 * this.maxParticles);
    this.particleDensity = new Float32Array(this.fNumCells);
    this.particleRestDensity = 0.0;

    this.particleRadius = particleRadius;
    this.pInvSpacing = 1.0 / (2.2 * particleRadius);
    this.pNumX = Math.floor(width * this.pInvSpacing) + 1;
    this.pNumY = Math.floor(height * this.pInvSpacing) + 1;
    this.pNumCells = this.pNumX * this.pNumY;

    this.numCellParticles = new Int32Array(this.pNumCells);
    this.firstCellParticle = new Int32Array(this.pNumCells + 1);
    this.cellParticleIds = new Int32Array(maxParticles);

    this.numParticles = 0;
  }

  integrateParticles(dt: number, gravity: number) {
    for (let i = 0; i < this.numParticles; i++) {
      this.particleVel[2 * i + 1] += dt * gravity;
      this.particlePos[2 * i] += this.particleVel[2 * i] * dt;
      this.particlePos[2 * i + 1] += this.particleVel[2 * i + 1] * dt;
    }
  }

  pushParticlesApart(numIters: number) {
    const colorDiffusionCoeff = 0.001;

    // count particles per cell

    this.numCellParticles.fill(0);

    for (let i = 0; i < this.numParticles; i++) {
      const x = this.particlePos[2 * i];
      const y = this.particlePos[2 * i + 1];

      const xi = clamp(Math.floor(x * this.pInvSpacing), 0, this.pNumX - 1);
      const yi = clamp(Math.floor(y * this.pInvSpacing), 0, this.pNumY - 1);
      const cellNr = xi * this.pNumY + yi;
      this.numCellParticles[cellNr]++;
    }

    // partial sums

    let first = 0;

    for (let i = 0; i < this.pNumCells; i++) {
      first += this.numCellParticles[i];
      this.firstCellParticle[i] = first;
    }
    this.firstCellParticle[this.pNumCells] = first; // guard

    // fill particles into cells

    for (let i = 0; i < this.numParticles; i++) {
      const x = this.particlePos[2 * i];
      const y = this.particlePos[2 * i + 1];

      const xi = clamp(Math.floor(x * this.pInvSpacing), 0, this.pNumX - 1);
      const yi = clamp(Math.floor(y * this.pInvSpacing), 0, this.pNumY - 1);
      const cellNr = xi * this.pNumY + yi;
      this.firstCellParticle[cellNr]--;
      this.cellParticleIds[this.firstCellParticle[cellNr]] = i;
    }

    // push particles apart

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
            const firstIdx = this.firstCellParticle[cellNr];
            const lastIdx = this.firstCellParticle[cellNr + 1];
            for (let j = firstIdx; j < lastIdx; j++) {
              const id = this.cellParticleIds[j];
              if (id === i) continue;
              const qx = this.particlePos[2 * id];
              const qy = this.particlePos[2 * id + 1];

              const dx = qx - px;
              const dy = qy - py;
              const d2 = dx * dx + dy * dy;
              if (d2 > minDist2 || d2 === 0.0) continue;
              const d = Math.sqrt(d2);
              const s = (0.5 * (minDist - d)) / d;
              const sdx = dx * s;
              const sdy = dy * s;
              this.particlePos[2 * i] -= sdx;
              this.particlePos[2 * i + 1] -= sdy;
              this.particlePos[2 * id] += sdx;
              this.particlePos[2 * id + 1] += sdy;

              // diffuse colors

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

  handleParticleCollisions(
    obstacleX: number,
    obstacleY: number,
    obstacleRadius: number
  ) {
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

      // obstacle collision

      if (d2 < minDist2) {
        this.particleVel[2 * i] = scene.obstacleVelX;
        this.particleVel[2 * i + 1] = scene.obstacleVelY;
      }

      // wall collisions

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

  updateParticleDensity() {
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
      const tx = (x - h2 - x0 * h) * h1;
      const x1 = Math.min(x0 + 1, this.fNumX - 2);

      const y0 = Math.floor((y - h2) * h1);
      const ty = (y - h2 - y0 * h) * h1;
      const y1 = Math.min(y0 + 1, this.fNumY - 2);

      const sx = 1.0 - tx;
      const sy = 1.0 - ty;

      if (x0 < this.fNumX && y0 < this.fNumY) d[x0 * n + y0] += sx * sy;
      if (x1 < this.fNumX && y0 < this.fNumY) d[x1 * n + y0] += tx * sy;
      if (x1 < this.fNumX && y1 < this.fNumY) d[x1 * n + y1] += tx * ty;
      if (x0 < this.fNumX && y1 < this.fNumY) d[x0 * n + y1] += sx * ty;
    }

    if (this.particleRestDensity === 0.0) {
      let sum = 0.0;
      let numFluidCells = 0;

      for (let i = 0; i < this.fNumCells; i++) {
        if (this.cellType[i] === FLUID_CELL) {
          sum += d[i];
          numFluidCells++;
        }
      }

      if (numFluidCells > 0) this.particleRestDensity = sum / numFluidCells;
    }
  }

  transferVelocities(toGrid: boolean, flipRatio: number = 0) {
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

      for (let i = 0; i < this.fNumCells; i++)
        this.cellType[i] = this.s[i] === 0.0 ? SOLID_CELL : AIR_CELL;

      for (let i = 0; i < this.numParticles; i++) {
        const x = this.particlePos[2 * i];
        const y = this.particlePos[2 * i + 1];
        const xi = clamp(Math.floor(x * h1), 0, this.fNumX - 1);
        const yi = clamp(Math.floor(y * h1), 0, this.fNumY - 1);
        const cellNr = xi * n + yi;
        if (this.cellType[cellNr] === AIR_CELL)
          this.cellType[cellNr] = FLUID_CELL;
      }
    }

    for (let component = 0; component < 2; component++) {
      const dx = component === 0 ? 0.0 : h2;
      const dy = component === 0 ? h2 : 0.0;

      const f_grid = component === 0 ? this.u : this.v;
      const prevF = component === 0 ? this.prevU : this.prevV;
      const d_weights = component === 0 ? this.du : this.dv;

      for (let i = 0; i < this.numParticles; i++) {
        let x = this.particlePos[2 * i];
        let y = this.particlePos[2 * i + 1];

        x = clamp(x, h, (this.fNumX - 1) * h);
        y = clamp(y, h, (this.fNumY - 1) * h);

        const x0 = Math.min(Math.floor((x - dx) * h1), this.fNumX - 2);
        const tx = (x - dx - x0 * h) * h1;
        const x1 = Math.min(x0 + 1, this.fNumX - 2);

        const y0 = Math.min(Math.floor((y - dy) * h1), this.fNumY - 2);
        const ty = (y - dy - y0 * h) * h1;
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
          f_grid[nr0] += pv * d0;
          d_weights[nr0] += d0;
          f_grid[nr1] += pv * d1;
          d_weights[nr1] += d1;
          f_grid[nr2] += pv * d2;
          d_weights[nr2] += d2;
          f_grid[nr3] += pv * d3;
          d_weights[nr3] += d3;
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
          const d_val = valid0 * d0 + valid1 * d1 + valid2 * d2 + valid3 * d3;

          if (d_val > 0.0) {
            const picV =
              (valid0 * d0 * f_grid[nr0] +
                valid1 * d1 * f_grid[nr1] +
                valid2 * d2 * f_grid[nr2] +
                valid3 * d3 * f_grid[nr3]) /
              d_val;
            const corr =
              (valid0 * d0 * (f_grid[nr0] - prevF[nr0]) +
                valid1 * d1 * (f_grid[nr1] - prevF[nr1]) +
                valid2 * d2 * (f_grid[nr2] - prevF[nr2]) +
                valid3 * d3 * (f_grid[nr3] - prevF[nr3])) /
              d_val;
            const flipV = v + corr;

            this.particleVel[2 * i + component] =
              (1.0 - flipRatio) * picV + flipRatio * flipV;
          }
        }
      }

      if (toGrid) {
        for (let i = 0; i < f_grid.length; i++) {
          if (d_weights[i] > 0.0) f_grid[i] /= d_weights[i];
        }

        // restore solid cells

        for (let i = 0; i < this.fNumX; i++) {
          for (let j = 0; j < this.fNumY; j++) {
            const solid = this.cellType[i * n + j] === SOLID_CELL;
            if (solid || (i > 0 && this.cellType[(i - 1) * n + j] === SOLID_CELL))
              this.u[i * n + j] = this.prevU[i * n + j];
            if (solid || (j > 0 && this.cellType[i * n + j - 1] === SOLID_CELL))
              this.v[i * n + j] = this.prevV[i * n + j];
          }
        }
      }
    }
  }

  solveIncompressibility(
    numIters: number,
    dt: number,
    overRelaxation: number,
    compensateDrift: boolean = true
  ) {
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
          const s_sum = sx0 + sx1 + sy0 + sy1;
          if (s_sum === 0.0) continue;

          let div =
            this.u[right] - this.u[center] + this.v[top] - this.v[center];

          if (this.particleRestDensity > 0.0 && compensateDrift) {
            const k = 1.0;
            const compression =
              this.particleDensity[i * n + j] - this.particleRestDensity;
            if (compression > 0.0) div = div - k * compression;
          }

          const p_val = -div / s_sum;
          const overRelaxedP = p_val * overRelaxation;
          this.p[center] += cp * overRelaxedP;

          this.u[center] -= sx0 * overRelaxedP;
          this.u[right] += sx1 * overRelaxedP;
          this.v[center] -= sy0 * overRelaxedP;
          this.v[top] += sy1 * overRelaxedP;
        }
      }
    }
  }

  updateParticleColors() {
    const h1 = this.fInvSpacing;

    for (let i = 0; i < this.numParticles; i++) {
      const s_step = 0.01;

      this.particleColor[3 * i] = clamp(this.particleColor[3 * i] - s_step, 0.0, 1.0);
      this.particleColor[3 * i + 1] = clamp(
        this.particleColor[3 * i + 1] - s_step,
        0.0,
        1.0
      );
      this.particleColor[3 * i + 2] = clamp(
        this.particleColor[3 * i + 2] + s_step,
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
          const s_val = 0.8;
          this.particleColor[3 * i] = s_val;
          this.particleColor[3 * i + 1] = s_val;
          this.particleColor[3 * i + 2] = 1.0;
        }
      }
    }
  }

  setSciColor(cellNr: number, val: number, minVal: number, maxVal: number) {
    val = Math.min(Math.max(val, minVal), maxVal - 0.0001);
    const d_range = maxVal - minVal;
    val = d_range === 0.0 ? 0.5 : (val - minVal) / d_range;
    const m_segment = 0.25;
    const num = Math.floor(val / m_segment);
    const s_interp = (val - num * m_segment) / m_segment;
    let r, g, b;

    switch (num) {
      case 0:
        r = 0.0;
        g = s_interp;
        b = 1.0;
        break;
      case 1:
        r = 0.0;
        g = 1.0;
        b = 1.0 - s_interp;
        break;
      case 2:
        r = s_interp;
        g = 1.0;
        b = 0.0;
        break;
      case 3:
        r = 1.0;
        g = 1.0 - s_interp;
        b = 0.0;
        break;
      default:
        r = 0.0;
        g = 0.0;
        b = 0.0;
    }

    this.cellColor[3 * cellNr] = r;
    this.cellColor[3 * cellNr + 1] = g;
    this.cellColor[3 * cellNr + 2] = b;
  }

  updateCellColors() {
    this.cellColor.fill(0.0);

    for (let i = 0; i < this.fNumCells; i++) {
      if (this.cellType[i] === SOLID_CELL) {
        this.cellColor[3 * i] = 0.5;
        this.cellColor[3 * i + 1] = 0.5;
        this.cellColor[3 * i + 2] = 0.5;
      } else if (this.cellType[i] === FLUID_CELL) {
        let d_val = this.particleDensity[i];
        if (this.particleRestDensity > 0.0) d_val /= this.particleRestDensity;
        this.setSciColor(i, d_val, 0.0, 2.0);
      }
    }
  }

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
    obstacleRadius: number
  ) {
    const numSubSteps = 1;
    const sdt = dt / numSubSteps;

    for (let step = 0; step < numSubSteps; step++) {
      this.integrateParticles(sdt, gravity);
      if (separateParticles) this.pushParticlesApart(numParticleIters);
      this.handleParticleCollisions(obstacleX, obstacleY, obstacleRadius);
      this.transferVelocities(true);
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

// ----------------- end of simulator ------------------------------

interface Scene {
  gravity: number;
  dt: number;
  flipRatio: number;
  numPressureIters: number;
  numParticleIters: number;
  overRelaxation: number;
  compensateDrift: boolean;
  separateParticles: boolean;
  obstacleX: number;
  obstacleY: number;
  obstacleRadius: number;
  paused: boolean;
  obstacleVelX: number;
  obstacleVelY: number;
  showParticles: boolean;
  showGrid: boolean;
  fluid: FlipFluid | null;
}

const scene: Scene = {
  gravity: -9.81,
  dt: 1.0 / 120.0,
  flipRatio: 0.9,
  numPressureIters: 100,
  numParticleIters: 2,
  overRelaxation: 1.9,
  compensateDrift: true,
  separateParticles: true,
  obstacleX: 0.0,
  obstacleY: 0.0,
  obstacleRadius: 0.15,
  paused: true,
  obstacleVelX: 0.0,
  obstacleVelY: 0.0,
  showParticles: true,
  showGrid: false,
  fluid: null,
};

function setupScene() {
  scene.obstacleRadius = 0.15;
  scene.overRelaxation = 1.9;

  scene.dt = 1.0 / 60.0;
  scene.numPressureIters = 50;
  scene.numParticleIters = 2;

  const res = 100;

  const tankHeight = 1.0 * simHeight;
  const tankWidth = 1.0 * simWidth;
  const h = tankHeight / res;
  const density = 1000.0;

  const relWaterHeight = 0.8;
  const relWaterWidth = 0.6;

  // dam break

  // compute number of particles

  const r = 0.3 * h; // particle radius w.r.t. cell size
  const dx_spawn = 2.0 * r;
  const dy_spawn = (Math.sqrt(3.0) / 2.0) * dx_spawn;

  const numX = Math.floor(
    (relWaterWidth * tankWidth - 2.0 * h - 2.0 * r) / dx_spawn
  );
  const numY = Math.floor(
    (relWaterHeight * tankHeight - 2.0 * h - 2.0 * r) / dy_spawn
  );
  const maxParticles = numX * numY;

  // create fluid

  const f_sim = new FlipFluid(
    density,
    tankWidth,
    tankHeight,
    h,
    r,
    maxParticles
  );
  scene.fluid = f_sim;

  // create particles

  f_sim.numParticles = numX * numY;
  let p_idx = 0;
  for (let i = 0; i < numX; i++) {
    for (let j = 0; j < numY; j++) {
      f_sim.particlePos[p_idx++] = h + r + dx_spawn * i + (j % 2 === 0 ? 0.0 : r);
      f_sim.particlePos[p_idx++] = h + r + dy_spawn * j;
    }
  }

  // setup grid cells for tank

  const n_cells_y = f_sim.fNumY;

  for (let i = 0; i < f_sim.fNumX; i++) {
    for (let j = 0; j < f_sim.fNumY; j++) {
      let s_val = 1.0; // fluid
      if (i === 0 || i === f_sim.fNumX - 1 || j === 0) s_val = 0.0; // solid
      f_sim.s[i * n_cells_y + j] = s_val;
    }
  }

  setObstacle(3.0, 2.0, true);
}

// draw -------------------------------------------------------

const pointVertexShader = `
		attribute vec2 attrPosition;
		attribute vec3 attrColor;
		uniform vec2 domainSize;
		uniform float pointSize;
		uniform float drawDisk;

		varying vec3 fragColor;
		varying float fragDrawDisk;

		void main() {
		vec4 screenTransform = 
			vec4(2.0 / domainSize.x, 2.0 / domainSize.y, -1.0, -1.0);
		gl_Position =
			vec4(attrPosition * screenTransform.xy + screenTransform.zw, 0.0, 1.0);

		gl_PointSize = pointSize;
		fragColor = attrColor;
		fragDrawDisk = drawDisk;
		}
	`;

const pointFragmentShader = `
		precision mediump float;
		varying vec3 fragColor;
		varying float fragDrawDisk;

		void main() {
			if (fragDrawDisk == 1.0) {
				float rx = 0.5 - gl_PointCoord.x;
				float ry = 0.5 - gl_PointCoord.y;
				float r2 = rx * rx + ry * ry;
				if (r2 > 0.25)
					discard;
			}
			gl_FragColor = vec4(fragColor, 1.0);
		}
	`;

const meshVertexShader = `
		attribute vec2 attrPosition;
		uniform vec2 domainSize;
		uniform vec3 color;
		uniform vec2 translation;
		uniform float scale;

		varying vec3 fragColor;

		void main() {
			vec2 v = translation + attrPosition * scale;
		vec4 screenTransform = 
			vec4(2.0 / domainSize.x, 2.0 / domainSize.y, -1.0, -1.0);
		gl_Position =
			vec4(v * screenTransform.xy + screenTransform.zw, 0.0, 1.0);

		fragColor = color;
		}
	`;

const meshFragmentShader = `
		precision mediump float;
		varying vec3 fragColor;

		void main() {
			gl_FragColor = vec4(fragColor, 1.0);
		}
	`;

function createShader(gl_ctx: WebGLRenderingContext, vsSource: string, fsSource: string) {
  const vsShader = gl_ctx.createShader(gl_ctx.VERTEX_SHADER)!;
  gl_ctx.shaderSource(vsShader, vsSource);
  gl_ctx.compileShader(vsShader);
  if (!gl_ctx.getShaderParameter(vsShader, gl_ctx.COMPILE_STATUS))
    console.log("vertex shader compile error: " + gl_ctx.getShaderInfoLog(vsShader));

  const fsShader = gl_ctx.createShader(gl_ctx.FRAGMENT_SHADER)!;
  gl_ctx.shaderSource(fsShader, fsSource);
  gl_ctx.compileShader(fsShader);
  if (!gl_ctx.getShaderParameter(fsShader, gl_ctx.COMPILE_STATUS))
    console.log("fragment shader compile error: " + gl_ctx.getShaderInfoLog(fsShader));

  const shader_prog = gl_ctx.createProgram()!;
  gl_ctx.attachShader(shader_prog, vsShader);
  gl_ctx.attachShader(shader_prog, fsShader);
  gl_ctx.linkProgram(shader_prog);

  return shader_prog;
}

let pointShader: WebGLProgram | null = null;
let meshShader: WebGLProgram | null = null;

let pointVertexBuffer: WebGLBuffer | null = null;
let pointColorBuffer: WebGLBuffer | null = null;

let gridVertBuffer: WebGLBuffer | null = null;
let gridColorBuffer: WebGLBuffer | null = null;

let diskVertBuffer: WebGLBuffer | null = null;
let diskIdBuffer: WebGLBuffer | null = null;

function draw() {
  gl.clearColor(0.0, 0.0, 0.0, 1.0);
  gl.clear(gl.COLOR_BUFFER_BIT);

  gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

  // prepare shaders

  if (pointShader == null)
    pointShader = createShader(gl, pointVertexShader, pointFragmentShader);
  if (meshShader == null)
    meshShader = createShader(gl, meshVertexShader, meshFragmentShader);

  // grid

  if (gridVertBuffer == null) {
    const f_val = scene.fluid!;
    gridVertBuffer = gl.createBuffer();
    const cellCenters = new Float32Array(2 * f_val.fNumCells);
    let p_idx = 0;

    for (let i = 0; i < f_val.fNumX; i++) {
      for (let j = 0; j < f_val.fNumY; j++) {
        cellCenters[p_idx++] = (i + 0.5) * f_val.h;
        cellCenters[p_idx++] = (j + 0.5) * f_val.h;
      }
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, gridVertBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, cellCenters, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  if (gridColorBuffer == null) gridColorBuffer = gl.createBuffer();

  if (scene.showGrid) {
    const pointSize = (0.9 * scene.fluid!.h) / simWidth * canvas.width;

    gl.useProgram(pointShader);
    gl.uniform2f(
      gl.getUniformLocation(pointShader!, "domainSize"),
      simWidth,
      simHeight
    );
    gl.uniform1f(gl.getUniformLocation(pointShader!, "pointSize"), pointSize);
    gl.uniform1f(gl.getUniformLocation(pointShader!, "drawDisk"), 0.0);

    gl.bindBuffer(gl.ARRAY_BUFFER, gridVertBuffer);
    const posLoc = gl.getAttribLocation(pointShader!, "attrPosition");
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, gridColorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, scene.fluid!.cellColor, gl.DYNAMIC_DRAW);

    const colorLoc = gl.getAttribLocation(pointShader!, "attrColor");
    gl.enableVertexAttribArray(colorLoc);
    gl.vertexAttribPointer(colorLoc, 3, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.POINTS, 0, scene.fluid!.fNumCells);

    gl.disableVertexAttribArray(posLoc);
    gl.disableVertexAttribArray(colorLoc);

    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  // water

  if (scene.showParticles) {
    gl.clear(gl.DEPTH_BUFFER_BIT);

    const pointSize = (2.0 * scene.fluid!.particleRadius) / simWidth * canvas.width;

    gl.useProgram(pointShader);
    gl.uniform2f(
      gl.getUniformLocation(pointShader!, "domainSize"),
      simWidth,
      simHeight
    );
    gl.uniform1f(gl.getUniformLocation(pointShader!, "pointSize"), pointSize);
    gl.uniform1f(gl.getUniformLocation(pointShader!, "drawDisk"), 1.0);

    if (pointVertexBuffer == null) pointVertexBuffer = gl.createBuffer();
    if (pointColorBuffer == null) pointColorBuffer = gl.createBuffer();

    gl.bindBuffer(gl.ARRAY_BUFFER, pointVertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, scene.fluid!.particlePos, gl.DYNAMIC_DRAW);

    const posLoc = gl.getAttribLocation(pointShader!, "attrPosition");
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, pointColorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, scene.fluid!.particleColor, gl.DYNAMIC_DRAW);

    const colorLoc = gl.getAttribLocation(pointShader!, "attrColor");
    gl.enableVertexAttribArray(colorLoc);
    gl.vertexAttribPointer(colorLoc, 3, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.POINTS, 0, scene.fluid!.numParticles);

    gl.disableVertexAttribArray(posLoc);
    gl.disableVertexAttribArray(colorLoc);

    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  // disk

  // prepare disk mesh

  const numSegs = 50;

  if (diskVertBuffer == null) {
    diskVertBuffer = gl.createBuffer();
    const dphi = (2.0 * Math.PI) / numSegs;
    const diskVerts = new Float32Array(2 * numSegs + 2);
    let p_idx = 0;
    diskVerts[p_idx++] = 0.0;
    diskVerts[p_idx++] = 0.0;
    for (let i = 0; i < numSegs; i++) {
      diskVerts[p_idx++] = Math.cos(i * dphi);
      diskVerts[p_idx++] = Math.sin(i * dphi);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, diskVertBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, diskVerts, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    diskIdBuffer = gl.createBuffer();
    const diskIds = new Uint16Array(3 * numSegs);
    p_idx = 0;
    for (let i = 0; i < numSegs; i++) {
      diskIds[p_idx++] = 0;
      diskIds[p_idx++] = 1 + i;
      diskIds[p_idx++] = 1 + ((i + 1) % numSegs);
    }

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, diskIdBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, diskIds, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
  }

  gl.clear(gl.DEPTH_BUFFER_BIT);

  const diskColor = [1.0, 0.0, 0.0];

  gl.useProgram(meshShader);
  gl.uniform2f(
    gl.getUniformLocation(meshShader!, "domainSize"),
    simWidth,
    simHeight
  );
  gl.uniform3f(
    gl.getUniformLocation(meshShader!, "color"),
    diskColor[0],
    diskColor[1],
    diskColor[2]
  );
  gl.uniform2f(
    gl.getUniformLocation(meshShader!, "translation"),
    scene.obstacleX,
    scene.obstacleY
  );
  gl.uniform1f(
    gl.getUniformLocation(meshShader!, "scale"),
    scene.obstacleRadius + scene.fluid!.particleRadius
  );

  const meshPosLoc = gl.getAttribLocation(meshShader!, "attrPosition");
  gl.enableVertexAttribArray(meshPosLoc);
  gl.bindBuffer(gl.ARRAY_BUFFER, diskVertBuffer);
  gl.vertexAttribPointer(meshPosLoc, 2, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, diskIdBuffer);
  gl.drawElements(gl.TRIANGLES, 3 * numSegs, gl.UNSIGNED_SHORT, 0);

  gl.disableVertexAttribArray(meshPosLoc);
}

function setObstacle(x: number, y: number, reset: boolean) {
  let vx = 0.0;
  let vy = 0.0;

  if (!reset) {
    vx = (x - scene.obstacleX) / scene.dt;
    vy = (y - scene.obstacleY) / scene.dt;
  }

  scene.obstacleX = x;
  scene.obstacleY = y;
  const r_obstacle = scene.obstacleRadius;
  const f_val = scene.fluid!;
  const n_y = f_val.fNumY;

  for (let i = 1; i < f_val.fNumX - 2; i++) {
    for (let j = 1; j < f_val.fNumY - 2; j++) {
      f_val.s[i * n_y + j] = 1.0;

      const dx = (i + 0.5) * f_val.h - x;
      const dy = (j + 0.5) * f_val.h - y;

      if (dx * dx + dy * dy < r_obstacle * r_obstacle) {
        f_val.s[i * n_y + j] = 0.0;
        f_val.u[i * n_y + j] = vx;
        f_val.u[(i + 1) * n_y + j] = vx;
        f_val.v[i * n_y + j] = vy;
        f_val.v[i * n_y + j + 1] = vy;
      }
    }
  }

  scene.obstacleVelX = vx;
  scene.obstacleVelY = vy;
}

// interaction -------------------------------------------------------

let mouseDown = false;

function startDrag(x: number, y: number) {
  const bounds = canvas.getBoundingClientRect();

  const mx = x - bounds.left - canvas.clientLeft;
  const my = y - bounds.top - canvas.clientTop;
  mouseDown = true;

  const x_world = mx / cScale;
  const y_world = (canvas.height - my) / cScale;

  setObstacle(x_world, y_world, true);
  scene.paused = false;
}

function drag(x: number, y: number) {
  if (mouseDown) {
    const bounds = canvas.getBoundingClientRect();
    const mx = x - bounds.left - canvas.clientLeft;
    const my = y - bounds.top - canvas.clientTop;
    const x_world = mx / cScale;
    const y_world = (canvas.height - my) / cScale;
    setObstacle(x_world, y_world, false);
  }
}

function endDrag() {
  mouseDown = false;
  scene.obstacleVelX = 0.0;
  scene.obstacleVelY = 0.0;
}

canvas.addEventListener("mousedown", (event) => {
  startDrag(event.clientX, event.clientY);
});

canvas.addEventListener("mouseup", (_event) => {
  endDrag();
});

canvas.addEventListener("mousemove", (event) => {
  drag(event.clientX, event.clientY);
});

canvas.addEventListener("touchstart", (event) => {
  startDrag(event.touches[0].clientX, event.touches[0].clientY);
});

canvas.addEventListener("touchend", (_event) => {
  endDrag();
});

canvas.addEventListener(
  "touchmove",
  (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    drag(event.touches[0].clientX, event.touches[0].clientY);
  },
  { passive: false }
);

document.addEventListener("keydown", (event) => {
  switch (event.key) {
    case "p":
      scene.paused = !scene.paused;
      break;
    case "m":
      scene.paused = false;
      simulate();
      scene.paused = true;
      break;
  }
});

// UI elements listeners
document.getElementById('showParticles')!.onchange = function(e) {
    scene.showParticles = (e.target as HTMLInputElement).checked;
};
document.getElementById('showGrid')!.onchange = function(e) {
    scene.showGrid = (e.target as HTMLInputElement).checked;
};
document.getElementById('compensateDrift')!.onchange = function(e) {
    scene.compensateDrift = (e.target as HTMLInputElement).checked;
};
document.getElementById('separateParticles')!.onchange = function(e) {
    scene.separateParticles = (e.target as HTMLInputElement).checked;
};
document.getElementById('flipRatio')!.onchange = function(e) {
    scene.flipRatio = 0.1 * parseFloat((e.target as HTMLInputElement).value);
};

// main -------------------------------------------------------

function simulate() {
  if (!scene.paused && scene.fluid)
    scene.fluid.simulate(
      scene.dt,
      scene.gravity,
      scene.flipRatio,
      scene.numPressureIters,
      scene.numParticleIters,
      scene.overRelaxation,
      scene.compensateDrift,
      scene.separateParticles,
      scene.obstacleX,
      scene.obstacleY,
      scene.obstacleRadius
    );
}

function update() {
  simulate();
  draw();
  requestAnimationFrame(update);
}

setupScene();
update();
