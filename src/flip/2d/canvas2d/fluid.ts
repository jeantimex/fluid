import { FLUID_CELL, AIR_CELL, SOLID_CELL } from './types';
import { clamp, getSciColor } from './utils';

/**
 * FlipFluid implements a hybrid FLIP (Fluid-Implicit Particle) and 
 * PIC (Particle-In-Cell) fluid simulator.
 * 
 * The algorithm works by combining the stability of PIC with the 
 * detail-preserving nature of FLIP:
 * 1. Particles carry velocity and position.
 * 2. Velocity is transferred to a staggered grid (MAC grid).
 * 3. Incompressibility is enforced on the grid (Pressure solver).
 * 4. The change in velocity is transferred back to particles.
 */
export class FlipFluid {
  // --- Simulation Constants ---
  density: number;
  cellSize: number;       // Formerly 'h'
  invCellSize: number;    // Formerly 'fInvSpacing'
  
  // --- Fluid Grid (MAC Grid) ---
  numX: number;           // Number of cells in X
  numY: number;           // Number of cells in Y
  totalCells: number;
  
  velocityX: Float32Array;      // Horizontal velocity (staggered)
  velocityY: Float32Array;      // Vertical velocity (staggered)
  velocityXDiff: Float32Array;  // Velocity change after solver (X)
  velocityYDiff: Float32Array;  // Velocity change after solver (Y)
  velocityXOld: Float32Array;   // Previous velocity (X)
  velocityYOld: Float32Array;   // Previous velocity (Y)
  
  pressure: Float32Array;       // Pressure field
  solidMask: Float32Array;      // 0.0 for solid, 1.0 for fluid/air (formerly 's')
  cellType: Int32Array;         // FLUID_CELL, AIR_CELL, or SOLID_CELL
  cellColor: Float32Array;      // Visual color of grid cells
  
  // --- Particles ---
  numParticles: number;
  maxParticles: number;
  particlePos: Float32Array;    // [x0, y0, x1, y1, ...]
  particleVel: Float32Array;    // [vx0, vy0, vx1, vy1, ...]
  particleColor: Float32Array;  // [r0, g0, b0, r1, g1, b1, ...]
  particleDensity: Float32Array;
  particleRestDensity: number;
  particleRadius: number;

  // --- Spatial Hashing (for particle-particle interaction) ---
  spatialGridInvSpacing: number;
  spatialGridNumX: number;
  spatialGridNumY: number;
  spatialGridTotalCells: number;
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
    this.density = density;
    this.numX = Math.floor(width / spacing) + 1;
    this.numY = Math.floor(height / spacing) + 1;
    this.cellSize = Math.max(width / this.numX, height / this.numY);
    this.invCellSize = 1.0 / this.cellSize;
    this.totalCells = this.numX * this.numY;

    // Initialize Grid Arrays
    this.velocityX = new Float32Array(this.totalCells);
    this.velocityY = new Float32Array(this.totalCells);
    this.velocityXDiff = new Float32Array(this.totalCells);
    this.velocityYDiff = new Float32Array(this.totalCells);
    this.velocityXOld = new Float32Array(this.totalCells);
    this.velocityYOld = new Float32Array(this.totalCells);
    this.pressure = new Float32Array(this.totalCells);
    this.solidMask = new Float32Array(this.totalCells);
    this.cellType = new Int32Array(this.totalCells);
    this.cellColor = new Float32Array(3 * this.totalCells);

    // Initialize Particle Arrays
    this.maxParticles = maxParticles;
    this.numParticles = 0;
    this.particlePos = new Float32Array(2 * this.maxParticles);
    this.particleVel = new Float32Array(2 * this.maxParticles);
    this.particleColor = new Float32Array(3 * this.maxParticles);
    for (let i = 0; i < this.maxParticles; i++) {
      this.particleColor[3 * i + 2] = 1.0; // Default to blue
    }
    
    this.particleDensity = new Float32Array(this.totalCells);
    this.particleRestDensity = 0.0;
    this.particleRadius = particleRadius;

    // Spatial Grid for Neighbor Searches
    this.spatialGridInvSpacing = 1.0 / (2.2 * particleRadius);
    this.spatialGridNumX = Math.floor(width * this.spatialGridInvSpacing) + 1;
    this.spatialGridNumY = Math.floor(height * this.spatialGridInvSpacing) + 1;
    this.spatialGridTotalCells = this.spatialGridNumX * this.spatialGridNumY;

    this.numCellParticles = new Int32Array(this.spatialGridTotalCells);
    this.firstCellParticle = new Int32Array(this.spatialGridTotalCells + 1);
    this.cellParticleIds = new Int32Array(maxParticles);
  }

  /**
   * Advances particle positions using current velocities.
   */
  integrateParticles(dt: number, gravity: number) {
    for (let i = 0; i < this.numParticles; i++) {
      this.particleVel[2 * i + 1] += dt * gravity;
      this.particlePos[2 * i] += this.particleVel[2 * i] * dt;
      this.particlePos[2 * i + 1] += this.particleVel[2 * i + 1] * dt;
    }
  }

  /**
   * Prevents particles from overlapping by pushing them apart.
   * Uses a spatial grid to efficiently find neighbors.
   */
  pushParticlesApart(numIters: number) {
    const colorDiffusionCoeff = 0.001;
    this.numCellParticles.fill(0);

    // 1. Sort particles into spatial grid cells
    for (let i = 0; i < this.numParticles; i++) {
      const x = this.particlePos[2 * i];
      const y = this.particlePos[2 * i + 1];
      const xi = clamp(Math.floor(x * this.spatialGridInvSpacing), 0, this.spatialGridNumX - 1);
      const yi = clamp(Math.floor(y * this.spatialGridInvSpacing), 0, this.spatialGridNumY - 1);
      const cellNr = xi * this.spatialGridNumY + yi;
      this.numCellParticles[cellNr]++;
    }

    // 2. Build prefix sums for fast cell access
    let first = 0;
    for (let i = 0; i < this.spatialGridTotalCells; i++) {
      first += this.numCellParticles[i];
      this.firstCellParticle[i] = first;
    }
    this.firstCellParticle[this.spatialGridTotalCells] = first;

    // 3. Fill the sorted ID array
    for (let i = 0; i < this.numParticles; i++) {
      const x = this.particlePos[2 * i];
      const y = this.particlePos[2 * i + 1];
      const xi = clamp(Math.floor(x * this.spatialGridInvSpacing), 0, this.spatialGridNumX - 1);
      const yi = clamp(Math.floor(y * this.spatialGridInvSpacing), 0, this.spatialGridNumY - 1);
      const cellNr = xi * this.spatialGridNumY + yi;
      this.firstCellParticle[cellNr]--;
      this.cellParticleIds[this.firstCellParticle[cellNr]] = i;
    }

    // 4. Resolve collisions iteratively
    const minDist = 2.0 * this.particleRadius;
    const minDist2 = minDist * minDist;

    for (let iter = 0; iter < numIters; iter++) {
      for (let i = 0; i < this.numParticles; i++) {
        const px = this.particlePos[2 * i];
        const py = this.particlePos[2 * i + 1];
        
        const pxi = Math.floor(px * this.spatialGridInvSpacing);
        const pyi = Math.floor(py * this.spatialGridInvSpacing);
        const x0 = Math.max(pxi - 1, 0);
        const y0 = Math.max(pyi - 1, 0);
        const x1 = Math.min(pxi + 1, this.spatialGridNumX - 1);
        const y1 = Math.min(pyi + 1, this.spatialGridNumY - 1);

        // Search neighboring spatial cells
        for (let xi = x0; xi <= x1; xi++) {
          for (let yi = y0; yi <= y1; yi++) {
            const cellNr = xi * this.spatialGridNumY + yi;
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
              const correction = (0.5 * (minDist - d)) / d;
              const sdx = dx * correction;
              const sdy = dy * correction;
              
              this.particlePos[2 * i] -= sdx;
              this.particlePos[2 * i + 1] -= sdy;
              this.particlePos[2 * id] += sdx;
              this.particlePos[2 * id + 1] += sdy;

              // Softly diffuse colors between contacting particles
              for (let k = 0; k < 3; k++) {
                const colorA = this.particleColor[3 * i + k];
                const colorB = this.particleColor[3 * id + k];
                const avgColor = (colorA + colorB) * 0.5;
                this.particleColor[3 * i + k] = colorA + (avgColor - colorA) * colorDiffusionCoeff;
                this.particleColor[3 * id + k] = colorB + (avgColor - colorB) * colorDiffusionCoeff;
              }
            }
          }
        }
      }
    }
  }

  /**
   * Keeps particles within world bounds and resolves obstacle collisions.
   */
  handleParticleCollisions(
    obsX: number, obsY: number, obsR: number, 
    obsVelX: number, obsVelY: number,
    enableWallCollisions: boolean = true
  ) {
    const r = this.particleRadius;
    const minDist = obsR + r;
    const minDist2 = minDist * minDist;
    
    const minX = this.cellSize + r;
    const maxX = (this.numX - 1) * this.cellSize - r;
    const minY = this.cellSize + r;
    const maxY = (this.numY - 1) * this.cellSize - r;

    for (let i = 0; i < this.numParticles; i++) {
      let x = this.particlePos[2 * i];
      let y = this.particlePos[2 * i + 1];
      
      const dx = x - obsX;
      const dy = y - obsY;
      const d2 = dx * dx + dy * dy;

      // Obstacle collision (push out and match velocity)
      if (d2 < minDist2) {
        const d = Math.sqrt(d2);
        const s = (minDist - d) / d;
        x += dx * s;
        y += dy * s;
        this.particleVel[2 * i] = obsVelX;
        this.particleVel[2 * i + 1] = obsVelY;
      }

      if (enableWallCollisions) {
        // Wall collisions (clamp position and kill perpendicular velocity)
        if (x < minX) { x = minX; this.particleVel[2 * i] = 0.0; }
        if (x > maxX) { x = maxX; this.particleVel[2 * i] = 0.0; }
        if (y < minY) { y = minY; this.particleVel[2 * i + 1] = 0.0; }
        if (y > maxY) { y = maxY; this.particleVel[2 * i + 1] = 0.0; }
      }
      
      this.particlePos[2 * i] = x;
      this.particlePos[2 * i + 1] = y;
    }
  }

  /**
   * Accumulates particle counts in each grid cell to calculate local density.
   */
  updateParticleDensity() {
    const nY = this.numY;
    const h = this.cellSize;
    const hInv = this.invCellSize;
    const h2 = 0.5 * h;
    const dField = this.particleDensity;
    dField.fill(0.0);

    for (let i = 0; i < this.numParticles; i++) {
      let x = this.particlePos[2 * i];
      let y = this.particlePos[2 * i + 1];
      
      x = clamp(x, h, (this.numX - 1) * h);
      y = clamp(y, h, (this.numY - 1) * h);
      
      // Calculate bilinear weights
      const x0 = Math.floor((x - h2) * hInv);
      const tx = (x - h2 - x0 * h) * hInv;
      const x1 = Math.min(x0 + 1, this.numX - 2);
      const y0 = Math.floor((y - h2) * hInv);
      const ty = (y - h2 - y0 * h) * hInv;
      const y1 = Math.min(y0 + 1, this.numY - 2);
      
      const sx = 1.0 - tx;
      const sy = 1.0 - ty;

      if (x0 < this.numX && y0 < this.numY) dField[x0 * nY + y0] += sx * sy;
      if (x1 < this.numX && y0 < this.numY) dField[x1 * nY + y0] += tx * sy;
      if (x1 < this.numX && y1 < this.numY) dField[x1 * nY + y1] += tx * ty;
      if (x0 < this.numX && y1 < this.numY) dField[x0 * nY + y1] += sx * ty;
    }

    // Set rest density based on initial fluid distribution if not yet set
    if (this.particleRestDensity === 0.0) {
      let sum = 0.0;
      let numFluidCells = 0;
      for (let i = 0; i < this.totalCells; i++) {
        if (this.cellType[i] === FLUID_CELL) { sum += dField[i]; numFluidCells++; }
      }
      if (numFluidCells > 0) this.particleRestDensity = sum / numFluidCells;
    }
  }

  /**
   * Transfers velocity between particles and the MAC grid.
   * @param toGrid If true, particles -> grid. If false, grid -> particles (FLIP/PIC).
   */
  transferVelocities(toGrid: boolean, flipRatio: number = 0) {
    const nY = this.numY;
    const h = this.cellSize;
    const hInv = this.invCellSize;
    const h2 = 0.5 * h;

    if (toGrid) {
      // Prepare grid for accumulation
      this.velocityXOld.set(this.velocityX);
      this.velocityYOld.set(this.velocityY);
      this.velocityXDiff.fill(0.0);
      this.velocityYDiff.fill(0.0);
      this.velocityX.fill(0.0);
      this.velocityY.fill(0.0);

      // Identify cell types based on solid status and particle occupancy
      for (let i = 0; i < this.totalCells; i++)
        this.cellType[i] = this.solidMask[i] === 0.0 ? SOLID_CELL : AIR_CELL;

      for (let i = 0; i < this.numParticles; i++) {
        const x = this.particlePos[2 * i];
        const y = this.particlePos[2 * i + 1];
        const xi = clamp(Math.floor(x * hInv), 0, this.numX - 1);
        const yi = clamp(Math.floor(y * hInv), 0, this.numY - 1);
        const cellNr = xi * nY + yi;
        if (this.cellType[cellNr] === AIR_CELL) this.cellType[cellNr] = FLUID_CELL;
      }
    }

    // Process X and Y components separately
    for (let component = 0; component < 2; component++) {
      const dx = component === 0 ? 0.0 : h2;
      const dy = component === 0 ? h2 : 0.0;
      const gridVel = component === 0 ? this.velocityX : this.velocityY;
      const oldVel = component === 0 ? this.velocityXOld : this.velocityYOld;
      const weights = component === 0 ? this.velocityXDiff : this.velocityYDiff;

      for (let i = 0; i < this.numParticles; i++) {
        let x = this.particlePos[2 * i];
        let y = this.particlePos[2 * i + 1];
        x = clamp(x, h, (this.numX - 1) * h);
        y = clamp(y, h, (this.numY - 1) * h);
        
        const x0 = Math.min(Math.floor((x - dx) * hInv), this.numX - 2);
        const tx = (x - dx - x0 * h) * hInv;
        const x1 = Math.min(x0 + 1, this.numX - 2);
        const y0 = Math.min(Math.floor((y - dy) * hInv), this.numY - 2);
        const ty = (y - dy - y0 * h) * hInv;
        const y1 = Math.min(y0 + 1, this.numY - 2);
        
        const sx = 1.0 - tx;
        const sy = 1.0 - ty;
        const d0 = sx * sy; const d1 = tx * sy; const d2 = tx * ty; const d3 = sx * ty;
        const nr0 = x0 * nY + y0; const nr1 = x1 * nY + y0; const nr2 = x1 * nY + y1; const nr3 = x0 * nY + y1;

        if (toGrid) {
          const pv = this.particleVel[2 * i + component];
          gridVel[nr0] += pv * d0; weights[nr0] += d0;
          gridVel[nr1] += pv * d1; weights[nr1] += d1;
          gridVel[nr2] += pv * d2; weights[nr2] += d2;
          gridVel[nr3] += pv * d3; weights[nr3] += d3;
        } else {
          const offset = component === 0 ? nY : 1;
          const valid0 = this.cellType[nr0] !== AIR_CELL || this.cellType[nr0 - offset] !== AIR_CELL ? 1.0 : 0.0;
          const valid1 = this.cellType[nr1] !== AIR_CELL || this.cellType[nr1 - offset] !== AIR_CELL ? 1.0 : 0.0;
          const valid2 = this.cellType[nr2] !== AIR_CELL || this.cellType[nr2 - offset] !== AIR_CELL ? 1.0 : 0.0;
          const valid3 = this.cellType[nr3] !== AIR_CELL || this.cellType[nr3 - offset] !== AIR_CELL ? 1.0 : 0.0;
          
          const pVel = this.particleVel[2 * i + component];
          const totalWeight = valid0 * d0 + valid1 * d1 + valid2 * d2 + valid3 * d3;

          if (totalWeight > 0.0) {
            // PIC Velocity: Pure interpolation from the grid
            const picVel = (valid0 * d0 * gridVel[nr0] + valid1 * d1 * gridVel[nr1] + valid2 * d2 * gridVel[nr2] + valid3 * d3 * gridVel[nr3]) / totalWeight;
            
            // FLIP Velocity: Particle velocity + interpolated grid velocity delta
            const deltaVel = (valid0 * d0 * (gridVel[nr0] - oldVel[nr0]) + valid1 * d1 * (gridVel[nr1] - oldVel[nr1]) + valid2 * d2 * (gridVel[nr2] - oldVel[nr2]) + valid3 * d3 * (gridVel[nr3] - oldVel[nr3])) / totalWeight;
            const flipVel = pVel + deltaVel;
            
            // Blend FLIP and PIC
            this.particleVel[2 * i + component] = (1.0 - flipRatio) * picVel + flipRatio * flipVel;
          }
        }
      }

      if (toGrid) {
        // Normalize accumulated grid velocities
        for (let i = 0; i < gridVel.length; i++) { if (weights[i] > 0.0) gridVel[i] /= weights[i]; }
        
        // Ensure solid cells maintain their boundary velocities
        for (let i = 0; i < this.numX; i++) {
          for (let j = 0; j < this.numY; j++) {
            const solid = this.cellType[i * nY + j] === SOLID_CELL;
            if (solid || (i > 0 && this.cellType[(i - 1) * nY + j] === SOLID_CELL)) this.velocityX[i * nY + j] = this.velocityXOld[i * nY + j];
            if (solid || (j > 0 && this.cellType[i * nY + j - 1] === SOLID_CELL)) this.velocityY[i * nY + j] = this.velocityYOld[i * nY + j];
          }
        }
      }
    }
  }

  /**
   * Enforces incompressibility using Jacobi iteration.
   */
  solveIncompressibility(numIters: number, dt: number, overRelaxation: number, compensateDrift: boolean = true) {
    this.pressure.fill(0.0);
    this.velocityXOld.set(this.velocityX);
    this.velocityYOld.set(this.velocityY);
    const nY = this.numY;
    const pressureScale = (this.density * this.cellSize) / dt;

    for (let iter = 0; iter < numIters; iter++) {
      for (let i = 1; i < this.numX - 1; i++) {
        for (let j = 1; j < this.numY - 1; j++) {
          if (this.cellType[i * nY + j] !== FLUID_CELL) continue;
          
          const center = i * nY + j; 
          const left = (i - 1) * nY + j; 
          const right = (i + 1) * nY + j; 
          const bottom = i * nY + j - 1; 
          const top = i * nY + j + 1;
          
          const sx0 = this.solidMask[left]; 
          const sx1 = this.solidMask[right]; 
          const sy0 = this.solidMask[bottom]; 
          const sy1 = this.solidMask[top];
          const sSum = sx0 + sx1 + sy0 + sy1;
          if (sSum === 0.0) continue;
          
          // Calculate divergence
          let divergence = this.velocityX[right] - this.velocityX[center] + this.velocityY[top] - this.velocityY[center];

          // Density compensation to prevent volume loss
          if (this.particleRestDensity > 0.0 && compensateDrift) {
            const stiffness = 1.0;
            const compression = this.particleDensity[i * nY + j] - this.particleRestDensity;
            if (compression > 0.0) divergence = divergence - stiffness * compression;
          }
          
          const p = -divergence / sSum;
          const relaxedP = p * overRelaxation;
          
          this.pressure[center] += pressureScale * relaxedP;
          this.velocityX[center] -= sx0 * relaxedP;
          this.velocityX[right] += sx1 * relaxedP;
          this.velocityY[center] -= sy0 * relaxedP;
          this.velocityY[top] += sy1 * relaxedP;
        }
      }
    }
  }

  /**
   * Updates particle visual colors based on age/density.
   */
  updateParticleColors() {
    const hInv = this.invCellSize;
    for (let i = 0; i < this.numParticles; i++) {
      const step = 0.01;
      this.particleColor[3 * i] = clamp(this.particleColor[3 * i] - step, 0.0, 1.0);
      this.particleColor[3 * i + 1] = clamp(this.particleColor[3 * i + 1] - step, 0.0, 1.0);
      this.particleColor[3 * i + 2] = clamp(this.particleColor[3 * i + 2] + step, 0.0, 1.0);

      const x = this.particlePos[2 * i];
      const y = this.particlePos[2 * i + 1];
      const xi = clamp(Math.floor(x * hInv), 1, this.numX - 1);
      const yi = clamp(Math.floor(y * hInv), 1, this.numY - 1);
      const cellNr = xi * this.numY + yi;
      const d0 = this.particleRestDensity;

      if (d0 > 0.0) {
        const relDensity = this.particleDensity[cellNr] / d0;
        if (relDensity < 0.7) { // Identify "surface" particles
          const bright = 0.8;
          this.particleColor[3 * i] = bright;
          this.particleColor[3 * i + 1] = bright;
          this.particleColor[3 * i + 2] = 1.0;
        }
      }
    }
  }

  updateCellColors() {
    this.cellColor.fill(0.0);
    for (let i = 0; i < this.totalCells; i++) {
      if (this.cellType[i] === SOLID_CELL) {
        this.cellColor[3 * i] = 0.5; this.cellColor[3 * i + 1] = 0.5; this.cellColor[3 * i + 2] = 0.5;
      } else if (this.cellType[i] === FLUID_CELL) {
        let d = this.particleDensity[i];
        if (this.particleRestDensity > 0.0) d /= this.particleRestDensity;
        const [r, g, b] = getSciColor(d, 0.0, 2.0);
        this.cellColor[3 * i] = r;
        this.cellColor[3 * i + 1] = g;
        this.cellColor[3 * i + 2] = b;
      }
    }
  }

  /**
   * Executes a single simulation step.
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
    obstacleVelY: number,
    enableWallCollisions: boolean = true
  ) {
    const numSubSteps = 1;
    const sdt = dt / numSubSteps;

    for (let step = 0; step < numSubSteps; step++) {
      // 1. Prediction (Euler integration)
      this.integrateParticles(sdt, gravity);
      
      // 2. Neighbor Search & Particle-Particle collision
      if (separateParticles) this.pushParticlesApart(numParticleIters);
      
      // 3. Boundary handling
      this.handleParticleCollisions(
        obstacleX,
        obstacleY,
        obstacleRadius,
        obstacleVelX,
        obstacleVelY,
        enableWallCollisions
      );
      
      // 4. Particle-to-Grid transfer
      this.transferVelocities(true);
      
      // 5. Enforce incompressibility (Pressure solve)
      this.updateParticleDensity();
      this.solveIncompressibility(numPressureIters, sdt, overRelaxation, compensateDrift);
      
      // 6. Grid-to-Particle transfer (FLIP/PIC update)
      this.transferVelocities(false, flipRatio);
    }

    this.updateParticleColors();
    this.updateCellColors();
  }
}
