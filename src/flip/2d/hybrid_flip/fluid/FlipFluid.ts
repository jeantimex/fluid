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
// Implements the Hybrid FLIP (Fluid-Implicit-Particle) method on a 2-D MAC 
// staggered grid, consistent with GridFluidSim3D logic.
//
// Key Hybrid Improvements:
//   1. RK2 (Midpoint) Advection for more accurate trajectories.
//   2. Velocity Extrapolation into air cells to prevent numerical surface stickiness.
//   3. Scaled Drift Compensation for stable density control.
//   4. Static wall enforcement (faces forced to 0).
export class FlipFluid {
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
  tempU: Float32Array;
  tempV: Float32Array;
  s: Float32Array;
  cellType: Int32Array;    
  cellColor: Float32Array; 
  vorticity: Float32Array; 

  maxParticles: number;         
  particlePos: Float32Array;    
  particleColor: Float32Array;  
  particleVel: Float32Array;    
  particleDensity: Float32Array;
  particleRestDensity: number;
  numParticles: number; 

  baseColor: { r: number; g: number; b: number };
  foamColor: { r: number; g: number; b: number };
  sprayColor: { r: number; g: number; b: number };
  bubbleColor: { r: number; g: number; b: number };

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

  numCellDiffuse: Int32Array;
  firstCellDiffuse: Int32Array;
  cellDiffuseIds: Int32Array;

  particleRadius: number;
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
    maxParticles: number,
    baseColor?: { r: number; g: number; b: number }
  ) {
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

    for (let i = 0; i < this.maxParticles; i++) {
      this.particleColor[3 * i] = color.r;
      this.particleColor[3 * i + 1] = color.g;
      this.particleColor[3 * i + 2] = color.b;
    }

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
  // Extends velocity field into AIR cells so particles sample meaningful values.
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
            const isValid =
              (idx < this.fNumCells && this.cellType[idx] === FLUID_CELL) ||
              (idx >= offset && this.cellType[idx - offset] === FLUID_CELL);

            if (!isValid) {
              let sum = 0.0;
              let count = 0;
              if (i > 0) { const nIdx = (i - 1) * n + j; if (f[nIdx] !== 0) { sum += f[nIdx]; count++; } }
              if (i < this.fNumX - 1) { const nIdx = (i + 1) * n + j; if (f[nIdx] !== 0) { sum += f[nIdx]; count++; } }
              if (j > 0) { const nIdx = i * n + (j - 1); if (f[nIdx] !== 0) { sum += f[nIdx]; count++; } }
              if (j < this.fNumY - 1) { const nIdx = i * n + (j + 1); if (f[nIdx] !== 0) { sum += f[nIdx]; count++; } }

              if (count > 0) {
                tempF[idx] = sum / count;
              }
            }
          }
        }
        f.set(tempF);
      }

      // Sync prevF to zero the FLIP correction in extrapolated air
      for (let i = 0; i < this.fNumCells; i++) {
        const isValid =
          (i < this.fNumCells && this.cellType[i] === FLUID_CELL) ||
          (i >= offset && this.cellType[i - offset] === FLUID_CELL);
        if (!isValid) {
          prevF[i] = f[i];
        }
      }
    }
  }

  applyGravity(dt: number, gravityX: number, gravityY: number, damping: number): void {
    for (let i = 0; i < this.numParticles; i++) {
      this.particleVel[2 * i]     += dt * gravityX;
      this.particleVel[2 * i + 1] += dt * gravityY;
      this.particleVel[2 * i]     *= damping;
      this.particleVel[2 * i + 1] *= damping;
    }
  }

  advectParticles(dt: number, gravityX: number, gravityY: number): void {
    const h1 = this.fInvSpacing;
    const n = this.fNumY;

    for (let i = 0; i < this.numParticles; i++) {
      const x = this.particlePos[2 * i];
      const y = this.particlePos[2 * i + 1];

      const xi = clamp(Math.floor(x * h1), 0, this.fNumX - 1);
      const yi = clamp(Math.floor(y * h1), 0, this.fNumY - 1);
      const isAir = this.cellType[xi * n + yi] === AIR_CELL;

      let v1 = this.sampleVelocity(x, y);
      
      if (v1.x === 0 && v1.y === 0) {
        if (isAir) {
          this.particleVel[2 * i]     += dt * gravityX;
          this.particleVel[2 * i]     *= 0.95; // air drag
          this.particleVel[2 * i + 1] += dt * gravityY;
        }
        v1.x = this.particleVel[2 * i];
        v1.y = this.particleVel[2 * i + 1];
      }

      const xMid = x + v1.x * dt * 0.5;
      const yMid = y + v1.y * dt * 0.5;

      let vMid = this.sampleVelocity(xMid, yMid);
      if (vMid.x === 0 && vMid.y === 0) vMid = v1;

      this.particlePos[2 * i]     += vMid.x * dt;
      this.particlePos[2 * i + 1] += vMid.y * dt;
    }
  }

  pushParticlesApart(numIters: number): void {
    this.numCellParticles.fill(0);
    for (let i = 0; i < this.numParticles; i++) {
      const x = this.particlePos[2 * i];
      const y = this.particlePos[2 * i + 1];
      const xi = clamp(Math.floor(x * this.pInvSpacing), 0, this.pNumX - 1);
      const yi = clamp(Math.floor(y * this.pInvSpacing), 0, this.pNumY - 1);
      this.numCellParticles[xi * this.pNumY + yi]++;
    }

    let first = 0;
    for (let i = 0; i < this.pNumCells; i++) {
      first += this.numCellParticles[i];
      this.firstCellParticle[i] = first;
    }
    this.firstCellParticle[this.pNumCells] = first;

    for (let i = 0; i < this.numParticles; i++) {
      const x = this.particlePos[2 * i];
      const y = this.particlePos[2 * i + 1];
      const xi = clamp(Math.floor(x * this.pInvSpacing), 0, this.pNumX - 1);
      const yi = clamp(Math.floor(y * this.pInvSpacing), 0, this.pNumY - 1);
      const cellNr = xi * this.pNumY + yi;
      this.firstCellParticle[cellNr]--;
      this.cellParticleIds[this.firstCellParticle[cellNr]] = i;
    }

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
            for (let j = this.firstCellParticle[cellNr]; j < this.firstCellParticle[cellNr + 1]; j++) {
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
              const deltaX = dx * s;
              const deltaY = dy * s;
              this.particlePos[2 * i] -= deltaX;
              this.particlePos[2 * i + 1] -= deltaY;
              this.particlePos[2 * id] += deltaX;
              this.particlePos[2 * id + 1] += deltaY;
            }
          }
        }
      }
    }
  }

  pushDiffuseParticlesApart(numIters: number, strength: number): void {
    if (this.numDiffuseParticles === 0 || strength <= 0) return;
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
    const minDist = 1.0 * this.particleRadius;
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
              const s = (0.5 * strength * (minDist - d)) / d;
              const deltaX = dx * s;
              const deltaY = dy * s;
              this.diffusePos[2 * i] -= deltaX;
              this.diffusePos[2 * i + 1] -= deltaY;
              this.diffusePos[2 * id] += deltaX;
              this.diffusePos[2 * id + 1] += deltaY;
            }
          }
        }
      }
    }
  }

  handleParticleCollisions(): void {
    const h = this.h;
    const r = this.particleRadius;
    const minX = h + r;
    const maxX = (this.fNumX - 1) * h - r;
    const minY = h + r;
    const maxY = (this.fNumY - 1) * h - r;

    for (let i = 0; i < this.numParticles; i++) {
      let x = this.particlePos[2 * i];
      let y = this.particlePos[2 * i + 1];
      if (x < minX) { x = minX; this.particleVel[2 * i] = 0.0; }
      if (x > maxX) { x = maxX; this.particleVel[2 * i] = 0.0; }
      if (y < minY) { y = minY; this.particleVel[2 * i + 1] = 0.0; }
      if (y > maxY) { y = maxY; this.particleVel[2 * i + 1] = 0.0; }
      this.particlePos[2 * i] = x;
      this.particlePos[2 * i + 1] = y;
    }
  }

  updateParticleDensity(): void {
    const n = this.fNumY;
    const h = this.h;
    const h1 = this.fInvSpacing;
    const h2 = 0.5 * h;
    const d = this.particleDensity;
    d.fill(0.0);
    for (let i = 0; i < this.numParticles; i++) {
      const x = clamp(this.particlePos[2 * i], h, (this.fNumX - 1) * h);
      const y = clamp(this.particlePos[2 * i + 1], h, (this.fNumY - 1) * h);
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
    if (this.particleRestDensity === 0.0) {
      let sum = 0.0;
      let numFluidCells = 0;
      for (let i = 0; i < this.fNumCells; i++) {
        if (this.cellType[i] === FLUID_CELL) { sum += d[i]; numFluidCells++; }
      }
      if (numFluidCells > 0) this.particleRestDensity = sum / numFluidCells;
    }
  }

  transferVelocities(toGrid: boolean, picRatio: number): void {
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
      for (let i = 0; i < this.fNumCells; i++) this.cellType[i] = this.s[i] === 0.0 ? SOLID_CELL : AIR_CELL;
      for (let i = 0; i < this.numParticles; i++) {
        const x = this.particlePos[2 * i];
        const y = this.particlePos[2 * i + 1];
        const xi = clamp(Math.floor(x * h1), 0, this.fNumX - 1);
        const yi = clamp(Math.floor(y * h1), 0, this.fNumY - 1);
        const cellNr = xi * n + yi;
        if (this.cellType[cellNr] === AIR_CELL) this.cellType[cellNr] = FLUID_CELL;
      }
    }

    for (let component = 0; component < 2; component++) {
      const dx = component === 0 ? 0.0 : h2;
      const dy = component === 0 ? h2 : 0.0;
      const f = component === 0 ? this.u : this.v;
      const prevF = component === 0 ? this.prevU : this.prevV;
      const d = component === 0 ? this.du : this.dv;

      for (let i = 0; i < this.numParticles; i++) {
        const x = clamp(this.particlePos[2 * i], h, (this.fNumX - 1) * h);
        const y = clamp(this.particlePos[2 * i + 1], h, (this.fNumY - 1) * h);
        const x0 = Math.min(Math.floor((x - dx) * h1), this.fNumX - 2);
        const tx = ((x - dx) - x0 * h) * h1;
        const x1 = Math.min(x0 + 1, this.fNumX - 2);
        const y0 = Math.min(Math.floor((y - dy) * h1), this.fNumY - 2);
        const ty = ((y - dy) - y0 * h) * h1;
        const y1 = Math.min(y0 + 1, this.fNumY - 2);
        const sx = 1.0 - tx;
        const sy = 1.0 - ty;
        const d0 = sx * sy; const d1 = tx * sy; const d2 = tx * ty; const d3 = sx * ty;
        const nr0 = x0 * n + y0; const nr1 = x1 * n + y0; const nr2 = x1 * n + y1; const nr3 = x0 * n + y1;

        if (toGrid) {
          const pv = this.particleVel[2 * i + component];
          f[nr0] += pv * d0; d[nr0] += d0;
          f[nr1] += pv * d1; d[nr1] += d1;
          f[nr2] += pv * d2; d[nr2] += d2;
          f[nr3] += pv * d3; d[nr3] += d3;
        } else {
          const offset = component === 0 ? n : 1;
          const isV0 = (this.cellType[nr0] !== SOLID_CELL && this.cellType[nr0 - offset] !== SOLID_CELL);
          const isV1 = (this.cellType[nr1] !== SOLID_CELL && this.cellType[nr1 - offset] !== SOLID_CELL);
          const isV2 = (this.cellType[nr2] !== SOLID_CELL && this.cellType[nr2 - offset] !== SOLID_CELL);
          const isV3 = (this.cellType[nr3] !== SOLID_CELL && this.cellType[nr3 - offset] !== SOLID_CELL);
          const totalValid = (isV0 ? d0 : 0) + (isV1 ? d1 : 0) + (isV2 ? d2 : 0) + (isV3 ? d3 : 0);
          if (totalValid > 0.0) {
            const picV = ((isV0 ? d0 * f[nr0] : 0) + (isV1 ? d1 * f[nr1] : 0) + (isV2 ? d2 * f[nr2] : 0) + (isV3 ? d3 * f[nr3] : 0)) / totalValid;
            const corr = ((isV0 ? d0 * (f[nr0] - prevF[nr0]) : 0) + (isV1 ? d1 * (f[nr1] - prevF[nr1]) : 0) + (isV2 ? d2 * (f[nr2] - prevF[nr2]) : 0) + (isV3 ? d3 * (f[nr3] - prevF[nr3]) : 0)) / totalValid;
            const flipV = this.particleVel[2 * i + component] + corr;
            this.particleVel[2 * i + component] = picRatio * picV + (1.0 - picRatio) * flipV;
          }
        }
      }

      if (toGrid) {
        for (let i = 0; i < f.length; i++) if (d[i] > 0.0) f[i] /= d[i];
        for (let i = 0; i < this.fNumX; i++) {
          for (let j = 0; j < this.fNumY; j++) {
            const solid = this.cellType[i * n + j] === SOLID_CELL;
            if (solid || (i > 0 && this.cellType[(i - 1) * n + j] === SOLID_CELL)) this.u[i * n + j] = 0.0;
            if (solid || (j > 0 && this.cellType[i * n + j - 1] === SOLID_CELL)) this.v[i * n + j] = 0.0;
          }
        }
      }
    }
  }

  solveIncompressibility(numIters: number, dt: number, overRelaxation: number, compensateDrift = true): void {
    this.p.fill(0.0);
    this.prevU.set(this.u);
    this.prevV.set(this.v);
    const n = this.fNumY;
    const cp = (this.density * this.h) / dt;
    const stiffness = 0.1;
    for (let iter = 0; iter < numIters; iter++) {
      for (let i = 1; i < this.fNumX - 1; i++) {
        for (let j = 1; j < this.fNumY - 1; j++) {
          if (this.cellType[i * n + j] !== FLUID_CELL) continue;
          const center = i * n + j;
          const sx0 = this.s[center - n]; const sx1 = this.s[center + n];
          const sy0 = this.s[center - 1]; const sy1 = this.s[center + 1];
          const s = sx0 + sx1 + sy0 + sy1;
          if (s === 0.0) continue;
          let div = this.u[center + n] - this.u[center] + this.v[center + 1] - this.v[center];
          if (this.particleRestDensity > 0.0 && compensateDrift) {
            const compression = this.particleDensity[center] - this.particleRestDensity;
            if (compression > 0.0) div -= stiffness * compression;
          }
          let p = (-div / s) * overRelaxation;
          this.p[center] += cp * p;
          this.u[center] -= sx0 * p; this.u[center + n] += sx1 * p;
          this.v[center] -= sy0 * p; this.v[center + 1] += sy1 * p;
        }
      }
    }
  }

  updateParticleColors(): void {
    for (let i = 0; i < this.numParticles; i++) {
      this.particleColor[3 * i] = this.baseColor.r;
      this.particleColor[3 * i + 1] = this.baseColor.g;
      this.particleColor[3 * i + 2] = this.baseColor.b;
    }
  }

  setWhitewaterSettings(enabled: boolean, max: number, rate: number, minSpeed: number, life: number): void {
    const next = Math.max(0, Math.floor(max));
    if (next !== this.maxDiffuseParticles) this.resizeDiffuseParticleStorage(next);
    this.diffuseEmissionRate = enabled ? Math.max(0, rate) : 0;
    this.diffuseMinSpeed = Math.max(0, minSpeed);
    this.diffuseLifetime = Math.max(0.01, life);
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
        const x = xi + ox; const y = yi + oy;
        if (x < 0 || x >= this.fNumX || y < 0 || y >= this.fNumY) continue;
        if (this.cellType[x * this.fNumY + y] === AIR_CELL) return true;
      }
    }
    return false;
  }

  private hasFluidNeighbour(xi: number, yi: number): boolean {
    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        const x = xi + ox; const y = yi + oy;
        if (x < 0 || x >= this.fNumX || y < 0 || y >= this.fNumY) continue;
        if (this.cellType[x * this.fNumY + y] === FLUID_CELL) return true;
      }
    }
    return false;
  }

  private sampleVelocity(x: number, y: number): { x: number; y: number } {
    return { x: this.sampleComponent(x, y, 0), y: this.sampleComponent(x, y, 1) };
  }

  private sampleComponent(x: number, y: number, component: 0 | 1): number {
    const n = this.fNumY; const h = this.h; const h1 = this.fInvSpacing; const h2 = 0.5 * h;
    const dx = component === 0 ? 0.0 : h2; const dy = component === 0 ? h2 : 0.0;
    const f = component === 0 ? this.u : this.v;
    x = clamp(x, h, (this.fNumX - 1) * h); y = clamp(y, h, (this.fNumY - 1) * h);
    const x0 = Math.min(Math.floor((x - dx) * h1), this.fNumX - 2);
    const tx = ((x - dx) - x0 * h) * h1; const x1 = x0 + 1;
    const y0 = Math.min(Math.floor((y - dy) * h1), this.fNumY - 2);
    const ty = ((y - dy) - y0 * h) * h1; const y1 = y0 + 1;
    const sx = 1.0 - tx; const sy = 1.0 - ty;
    const d0 = sx * sy; const d1 = tx * sy; const d2 = tx * ty; const d3 = sx * ty;
    const nr0 = x0 * n + y0; const nr1 = x1 * n + y0; const nr2 = x1 * n + y1; const nr3 = x0 * n + y1;
    const offset = component === 0 ? n : 1;
    const isV0 = (this.cellType[nr0] !== SOLID_CELL && this.cellType[nr0 - offset] !== SOLID_CELL);
    const isV1 = (this.cellType[nr1] !== SOLID_CELL && this.cellType[nr1 - offset] !== SOLID_CELL);
    const isV2 = (this.cellType[nr2] !== SOLID_CELL && this.cellType[nr2 - offset] !== SOLID_CELL);
    const isV3 = (this.cellType[nr3] !== SOLID_CELL && this.cellType[nr3 - offset] !== SOLID_CELL);
    const totalValid = (isV0 ? d0 : 0) + (isV1 ? d1 : 0) + (isV2 ? d2 : 0) + (isV3 ? d3 : 0);
    if (totalValid > 0.0) {
      return ((isV0 ? d0 * f[nr0] : 0) + (isV1 ? d1 * f[nr1] : 0) + (isV2 ? d2 * f[nr2] : 0) + (isV3 ? d3 * f[nr3] : 0)) / totalValid;
    }
    return 0.0;
  }

  private emitDiffuseParticles(dt: number, wT: number, wW: number, wK: number, bS: number, fS: number, sS: number): void {
    if (this.diffuseEmissionRate <= 0 || this.maxDiffuseParticles === 0) return;
    const h1 = this.fInvSpacing;
    const searchRadius = 2.0 * this.particleRadius;
    for (let i = 0; i < this.numParticles && this.numDiffuseParticles < this.maxDiffuseParticles; i++) {
      const vx = this.particleVel[2 * i]; const vy = this.particleVel[2 * i + 1];
      const speed = Math.sqrt(vx * vx + vy * vy);
      if (speed < this.diffuseMinSpeed) continue;
      const x = this.particlePos[2 * i]; const y = this.particlePos[2 * i + 1];
      const xi = clamp(Math.floor(x * h1), 1, this.fNumX - 2); const yi = clamp(Math.floor(y * h1), 1, this.fNumY - 2);
      const cell = xi * this.fNumY + yi; const nearAir = this.isNearAirCell(xi, yi);
      const ePot = Math.min(1.0, (speed - this.diffuseMinSpeed) / 5.0);
      const tPot = Math.min(1.0, this.vorticity[cell] / 20.0);
      let avgX = 0, avgY = 0, count = 0;
      const pxi = Math.floor(x * this.pInvSpacing); const pyi = Math.floor(y * this.pInvSpacing);
      for (let ox = -1; ox <= 1; ox++) {
        for (let oy = -1; oy <= 1; oy++) {
          const cxi = clamp(pxi + ox, 0, this.pNumX - 1); const cyi = clamp(pyi + oy, 0, this.pNumY - 1);
          const cellNr = cxi * this.pNumY + cyi;
          for (let k = this.firstCellParticle[cellNr]; k < this.firstCellParticle[cellNr + 1]; k++) {
            const id = this.cellParticleIds[k];
            const dx = this.particlePos[2 * id] - x; const dy = this.particlePos[2 * id + 1] - y;
            if (dx * dx + dy * dy < searchRadius * searchRadius) { avgX += dx; avgY += dy; count++; }
          }
        }
      }
      const dx = avgX / Math.max(1, count); const dy = avgY / Math.max(1, count);
      const d = Math.sqrt(dx * dx + dy * dy); const nx = -dx / Math.max(0.001, d); const ny = -dy / Math.max(0.001, d);
      const wPot = (nearAir && (vx * nx + vy * ny) > 0) ? Math.min(1.0, d / this.particleRadius) : 0.0;
      const comb = wK * ePot + wT * tPot + wW * wPot;
      const typeS = !nearAir ? bS : ((vx * nx + vy * ny) > 1.0 ? sS : fS);
      if (Math.random() > Math.min(0.95, this.diffuseEmissionRate * dt * comb * typeS)) continue;
      const r = this.particleRadius * Math.sqrt(Math.random()); const th = Math.random() * 2.0 * Math.PI;
      this.addDiffuseParticle(x + r * Math.cos(th), y + r * Math.sin(th), vx, vy, this.diffuseLifetime * (0.5 + 0.5 * Math.random()));
    }
  }

  private addDiffuseParticle(x: number, y: number, vx: number, vy: number, life: number): void {
    if (this.numDiffuseParticles >= this.maxDiffuseParticles) return;
    const i = this.numDiffuseParticles++;
    this.diffusePos[2 * i] = x; this.diffusePos[2 * i + 1] = y;
    this.diffuseVel[2 * i] = vx; this.diffuseVel[2 * i + 1] = vy;
    this.diffuseLife[i] = life; this.diffuseType[i] = DIFFUSE_SPRAY;
  }

  private updateDiffuseParticleTypes(): void {
    const h1 = this.fInvSpacing;
    for (let i = 0; i < this.numDiffuseParticles; i++) {
      const xi = clamp(Math.floor(this.diffusePos[2 * i] * h1), 0, this.fNumX - 1);
      const yi = clamp(Math.floor(this.diffusePos[2 * i + 1] * h1), 0, this.fNumY - 1);
      const type = this.cellType[xi * this.fNumY + yi];
      if (type === FLUID_CELL) this.diffuseType[i] = DIFFUSE_BUBBLE;
      else if (this.hasFluidNeighbour(xi, yi)) this.diffuseType[i] = DIFFUSE_FOAM;
      else this.diffuseType[i] = DIFFUSE_SPRAY;
    }
  }

  private advanceDiffuseParticles(dt: number, gX: number, gY: number, bB: number): void {
    const h = this.h; const minX = h; const maxX = (this.fNumX - 1) * h; const minY = h; const maxY = (this.fNumY - 1) * h;
    for (let i = 0; i < this.numDiffuseParticles; i++) {
      const t = this.diffuseType[i]; let x = this.diffusePos[2 * i]; let y = this.diffusePos[2 * i + 1];
      let vx = this.diffuseVel[2 * i]; let vy = this.diffuseVel[2 * i + 1];
      if (t === DIFFUSE_SPRAY) { vx += gX * dt; vy += gY * dt; this.diffuseLife[i] -= 2.0 * dt; }
      else {
        const gV = this.sampleVelocity(x, y);
        if (t === DIFFUSE_BUBBLE) { vx = gV.x - bB * gX * dt; vy = gV.y - bB * gY * dt; this.diffuseLife[i] -= 0.333 * dt; }
        else { vx += (gV.x - vx) * 0.5 + 0.5 * gX * dt; vy += (gV.y - vy) * 0.5 + 0.5 * gY * dt; this.diffuseLife[i] -= 1.0 * dt; }
      }
      x += vx * dt; y += vy * dt;
      if (t === DIFFUSE_SPRAY) {
        if (x < minX) { x = minX; vx = Math.abs(vx); } if (x > maxX) { x = maxX; vx = -Math.abs(vx); }
        if (y < minY) { y = minY; vy = Math.abs(vy); } if (y > maxY) this.diffuseLife[i] = 0.0;
      } else if (x < minX || x > maxX || y < minY || y > maxY) this.diffuseLife[i] = 0.0;
      this.diffusePos[2 * i] = x; this.diffusePos[2 * i + 1] = y; this.diffuseVel[2 * i] = vx; this.diffuseVel[2 * i + 1] = vy;
    }
  }

  private updateDiffuseParticleColors(): void {
    for (let i = 0; i < this.numDiffuseParticles; i++) {
      const alpha = Math.max(0.0, Math.min(1.0, this.diffuseLife[i] / (this.diffuseLifetime * 0.5)));
      const c = this.diffuseType[i] === DIFFUSE_BUBBLE ? this.bubbleColor : (this.diffuseType[i] === DIFFUSE_FOAM ? this.foamColor : this.sprayColor);
      this.diffuseColor[3 * i] = c.r * alpha; this.diffuseColor[3 * i + 1] = c.g * alpha; this.diffuseColor[3 * i + 2] = c.b * alpha;
    }
  }

  private removeDeadDiffuseParticles(): void {
    let dst = 0; const countGrid = new Int16Array(this.fNumCells);
    for (let src = 0; src < this.numDiffuseParticles; src++) {
      if (this.diffuseLife[src] <= 0.0) continue;
      const xi = clamp(Math.floor(this.diffusePos[2 * src] * this.fInvSpacing), 0, this.fNumX - 1);
      const yi = clamp(Math.floor(this.diffusePos[2 * src + 1] * this.fInvSpacing), 0, this.fNumY - 1);
      const cell = xi * this.fNumY + yi;
      if (countGrid[cell] >= 60) continue;
      countGrid[cell]++;
      if (dst !== src) {
        this.diffusePos[2 * dst] = this.diffusePos[2 * src]; this.diffusePos[2 * dst + 1] = this.diffusePos[2 * src + 1];
        this.diffuseVel[2 * dst] = this.diffuseVel[2 * src]; this.diffuseVel[2 * dst + 1] = this.diffuseVel[2 * src + 1];
        this.diffuseLife[dst] = this.diffuseLife[src]; this.diffuseType[dst] = this.diffuseType[src];
        this.diffuseColor[3 * dst] = this.diffuseColor[3 * src]; this.diffuseColor[3 * dst + 1] = this.diffuseColor[3 * src + 1]; this.diffuseColor[3 * dst + 2] = this.diffuseColor[3 * src + 2];
      }
      dst++;
    }
    this.numDiffuseParticles = dst;
  }

  private updateDiffuseParticles(dt: number, gX: number, gY: number, bB: number, wT: number, wW: number, wK: number, bES: number, fES: number, sES: number): void {
    if (this.numDiffuseParticles > 0) {
      this.updateDiffuseParticleTypes();
      this.advanceDiffuseParticles(dt, gX, gY, bB);
      this.updateDiffuseParticleTypes();
      this.updateDiffuseParticleColors();
      this.removeDeadDiffuseParticles();
    }
    this.emitDiffuseParticles(dt, wT, wW, wK, bES, fES, sES);
  }

  updateVorticity(): void {
    const n = this.fNumY; const h1 = this.fInvSpacing; this.vorticity.fill(0.0);
    for (let i = 1; i < this.fNumX - 1; i++) {
      for (let j = 1; j < this.fNumY - 1; j++) {
        const center = i * n + j;
        const dv_dx = (this.v[center + n] - this.v[center]) * h1;
        const du_dy = (this.u[center + 1] - this.u[center]) * h1;
        this.vorticity[center] = Math.abs(dv_dx - du_dy);
      }
    }
  }

  setSciColor(cellNr: number, val: number, minVal: number, maxVal: number): void {
    val = Math.min(Math.max(val, minVal), maxVal - 0.0001);
    const d = maxVal - minVal; val = d === 0.0 ? 0.5 : (val - minVal) / d;
    const m = 0.25; const num = Math.floor(val / m); const s = (val - num * m) / m;
    let r, g, b;
    switch (num) {
      case 0: r = 0.0; g = s; b = 1.0; break; case 1: r = 0.0; g = 1.0; b = 1.0 - s; break;
      case 2: r = s; g = 1.0; b = 0.0; break; case 3: r = 1.0; g = 1.0 - s; b = 0.0; break;
      default: r = 1.0; g = 0.0; b = 0.0; break;
    }
    this.cellColor[3 * cellNr] = r; this.cellColor[3 * cellNr + 1] = g; this.cellColor[3 * cellNr + 2] = b;
  }

  updateCellColors(): void {
    this.cellColor.fill(0.0);
    for (let i = 0; i < this.fNumCells; i++) {
      if (this.cellType[i] === SOLID_CELL) { this.cellColor[3 * i] = 0.5; this.cellColor[3 * i + 1] = 0.5; this.cellColor[3 * i + 2] = 0.5; }
      else if (this.cellType[i] === FLUID_CELL) {
        let d = this.particleDensity[i]; if (this.particleRestDensity > 0.0) d /= this.particleRestDensity;
        this.setSciColor(i, d, 0.0, 2.0);
      }
    }
  }

  simulate(dt: number, gX: number, gY: number, pR: number, pI: number, paI: number, oR: number, cD: boolean, sP: boolean, damp = 1.0, eI = 2, maxDP = this.maxDiffuseParticles, dER = this.diffuseEmissionRate, dMS = this.diffuseMinSpeed, dL = this.diffuseLifetime, bB = 4.0, wT = 0.5, wW = 0.8, wK = 0.3, bES = 0.5, fES = 1.0, sES = 1.0, dRS = 0.1): void {
    const numSubSteps = 1; const sdt = dt / numSubSteps;
    this.setWhitewaterSettings(true, maxDP, dER, dMS, dL);
    for (let step = 0; step < numSubSteps; step++) {
      this.applyGravity(sdt, gX, gY, damp);
      this.transferVelocities(true, pR);
      this.updateParticleDensity();
      this.solveIncompressibility(pI, sdt, oR, cD);
      this.extrapolateVelocity(eI);
      this.transferVelocities(false, pR);
      this.advectParticles(sdt, gX, gY);
      if (sP) this.pushParticlesApart(paI);
      this.handleParticleCollisions();
      this.updateVorticity();
      this.updateDiffuseParticles(sdt, gX, gY, bB, wT, wW, wK, bES, fES, sES);
      if (dRS > 0) this.pushDiffuseParticlesApart(1, dRS);
    }
    this.updateParticleColors(); this.updateCellColors();
  }

  setFluidColor(c: { r: number; g: number; b: number }): void {
    this.baseColor = { ...c };
    for (let i = 0; i < this.maxParticles; i++) { this.particleColor[3 * i] = c.r; this.particleColor[3 * i + 1] = c.g; this.particleColor[3 * i + 2] = c.b; }
  }

  setDiffuseColors(f: { r: number; g: number; b: number }, s: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }): void {
    this.foamColor = { ...f }; this.sprayColor = { ...s }; this.bubbleColor = { ...b };
  }

  resizeDomain(w: number, h: number): void {
    const newX = Math.floor(w / this.h) + 1; const newY = Math.floor(h / this.h) + 1;
    if (newX === this.fNumX && newY === this.fNumY) return;
    this.fNumX = newX; this.fNumY = newY; this.fNumCells = newX * newY;
    this.u = new Float32Array(this.fNumCells); this.v = new Float32Array(this.fNumCells);
    this.du = new Float32Array(this.fNumCells); this.dv = new Float32Array(this.fNumCells);
    this.prevU = new Float32Array(this.fNumCells); this.prevV = new Float32Array(this.fNumCells);
    this.p = new Float32Array(this.fNumCells); this.tempU = new Float32Array(this.fNumCells);
    this.tempV = new Float32Array(this.fNumCells); this.s = new Float32Array(this.fNumCells);
    this.cellType = new Int32Array(this.fNumCells); this.cellColor = new Float32Array(3 * this.fNumCells);
    this.vorticity = new Float32Array(this.fNumCells); this.particleDensity = new Float32Array(this.fNumCells);
    const n = this.fNumY;
    for (let i = 0; i < this.fNumX; i++) {
      for (let j = 0; j < this.fNumY; j++) this.s[i * n + j] = (i === 0 || i === this.fNumX - 1 || j === 0) ? 0.0 : 1.0;
    }
    const newPX = Math.floor(w * this.pInvSpacing) + 1; const newPY = Math.floor(h * this.pInvSpacing) + 1;
    if (newPX !== this.pNumX || newPY !== this.pNumY) {
      this.pNumX = newPX; this.pNumY = newPY; this.pNumCells = newPX * newPY;
      this.numCellParticles = new Int32Array(this.pNumCells); this.firstCellParticle = new Int32Array(this.pNumCells + 1);
    }
    const maxX = (this.fNumX - 1) * this.h - this.particleRadius; const maxY = (this.fNumY - 1) * this.h - this.particleRadius;
    for (let i = 0; i < this.numParticles; i++) {
      if (this.particlePos[2 * i] > maxX) this.particlePos[2 * i] = maxX;
      if (this.particlePos[2 * i + 1] > maxY) this.particlePos[2 * i + 1] = maxY;
    }
  }
}
