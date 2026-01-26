/**
 * SPH (Smoothed Particle Hydrodynamics) physics engine.
 *
 * This module implements the core fluid simulation using the SPH method.
 * SPH is a Lagrangian particle method that approximates continuous fluid
 * properties by interpolating values from neighboring particles.
 *
 * === SPH Algorithm Overview ===
 *
 * Each simulation step performs these phases:
 *
 * 1. EXTERNAL FORCES (gravity, user interaction)
 *    - Apply gravity to all particles
 *    - Handle mouse push/pull interactions
 *    - Predict particle positions for next step
 *
 * 2. SPATIAL HASHING
 *    - Assign particles to grid cells based on position
 *    - Sort particles by cell for cache-efficient neighbor queries
 *    - This reduces neighbor search from O(n²) to O(n)
 *
 * 3. DENSITY CALCULATION
 *    - For each particle, sum contributions from all neighbors
 *    - ρᵢ = Σⱼ mⱼ W(rᵢⱼ, h) where W is the smoothing kernel
 *    - Also compute "near density" for surface tension
 *
 * 4. PRESSURE FORCES
 *    - Compute pressure from density: P = k(ρ - ρ₀)
 *    - Apply symmetric pressure forces between particle pairs
 *    - Fᵢ = -Σⱼ mⱼ (Pᵢ+Pⱼ)/(2ρⱼ) ∇W(rᵢⱼ, h)
 *
 * 5. VISCOSITY
 *    - Smooth out velocity differences between neighbors
 *    - Fᵢ = μ Σⱼ mⱼ (vⱼ-vᵢ)/ρⱼ ∇²W(rᵢⱼ, h)
 *
 * 6. POSITION UPDATE & COLLISION
 *    - Integrate velocities to update positions
 *    - Handle boundary and obstacle collisions
 *
 * === Key References ===
 * - Müller et al., "Particle-Based Fluid Simulation" (2003)
 * - Clavet et al., "Particle-based Viscoelastic Fluid Simulation" (2005)
 */

import type { Physics, SimConfig, SimState } from './types.ts';
import {
  derivativeSpikyPow2,
  derivativeSpikyPow3,
  smoothingKernelPoly6,
  spikyKernelPow2,
  spikyKernelPow3,
} from './kernels.ts';
import { hashCell2D, neighborOffsets } from './spatial.ts';

/**
 * Creates the physics simulation engine.
 *
 * The physics engine maintains precomputed kernel scaling factors and
 * provides the main simulation step function.
 *
 * @param state - Mutable simulation state (positions, velocities, etc.)
 * @param config - Simulation configuration parameters
 * @param getScale - Function returning current world-to-pixel scale
 * @returns Physics interface with step() and parameter update methods
 */
export function createPhysics(
  state: SimState,
  config: SimConfig,
  getScale: () => number
): Physics {
  /**
   * Base parameters captured at creation time.
   * Used to scale physics parameters when particle radius changes.
   */
  const baseParams = {
    particleRadius: config.particleRadius,
    smoothingRadius: config.smoothingRadius,
    targetDensity: config.targetDensity,
    pressureMultiplier: config.pressureMultiplier,
    nearPressureMultiplier: config.nearPressureMultiplier,
    viscosityStrength: config.viscosityStrength,
  };

  // === Precomputed Kernel Scaling Factors ===
  // These are normalization constants that depend only on the smoothing radius.
  // Precomputing them avoids repeated Math.pow() calls during simulation.

  let radius = config.smoothingRadius;
  let radiusSq = radius * radius;

  // Poly6 kernel: W(r,h) = (4/πh⁸)(h²-r²)³
  let poly6Scale = 4 / (Math.PI * Math.pow(radius, 8));

  // Spiky kernel (cubic): W(r,h) = (10/πh⁵)(h-r)³
  let spikyPow3Scale = 10 / (Math.PI * Math.pow(radius, 5));

  // Spiky kernel (quadratic): W(r,h) = (6/πh⁴)(h-r)²
  let spikyPow2Scale = 6 / (Math.PI * Math.pow(radius, 4));

  // Spiky gradient (cubic): ∇W = (30/πh⁵)(h-r)²
  let spikyPow3DerivScale = 30 / (Math.PI * Math.pow(radius, 5));

  // Spiky gradient (quadratic): ∇W = (12/πh⁴)(h-r)
  let spikyPow2DerivScale = 12 / (Math.PI * Math.pow(radius, 4));

  /**
   * Recalculates kernel scaling factors after smoothing radius changes.
   *
   * Must be called whenever config.smoothingRadius is modified to keep
   * the precomputed values in sync.
   */
  function refreshSettings(): void {
    radius = config.smoothingRadius;
    radiusSq = radius * radius;
    poly6Scale = 4 / (Math.PI * Math.pow(radius, 8));
    spikyPow3Scale = 10 / (Math.PI * Math.pow(radius, 5));
    spikyPow2Scale = 6 / (Math.PI * Math.pow(radius, 4));
    spikyPow3DerivScale = 30 / (Math.PI * Math.pow(radius, 5));
    spikyPow2DerivScale = 12 / (Math.PI * Math.pow(radius, 4));
  }

  /**
   * Applies heuristic scaling when particle radius changes.
   *
   * When the visual particle size changes, we want the fluid behavior to
   * remain similar. This requires scaling several interdependent parameters:
   *
   * - smoothingRadius ∝ particleRadius (interaction range scales with size)
   * - targetDensity ∝ particleRadius² (2D: density ~ 1/area)
   * - pressureMultiplier ∝ 1/particleRadius² (maintain pressure response)
   * - nearPressureMultiplier ∝ 1/particleRadius² (maintain near-field forces)
   * - viscosityStrength ∝ 1/particleRadius (maintain viscous behavior)
   *
   * These relationships are empirical and produce visually consistent behavior.
   */
  function applyParticleScale(): void {
    const baseRadius = Math.max(0.0001, baseParams.particleRadius);
    const scaleFactor = config.particleRadius / baseRadius;
    const scaleSq = scaleFactor * scaleFactor;

    config.smoothingRadius = baseParams.smoothingRadius * scaleFactor;
    config.targetDensity = baseParams.targetDensity * scaleSq;
    config.pressureMultiplier = baseParams.pressureMultiplier / scaleSq;
    config.nearPressureMultiplier = baseParams.nearPressureMultiplier / scaleSq;
    config.viscosityStrength = baseParams.viscosityStrength / scaleFactor;

    refreshSettings();
  }

  /**
   * Applies external forces (gravity and user interaction) to all particles.
   *
   * This is the first phase of each simulation step. It:
   * 1. Applies gravitational acceleration to velocities
   * 2. Handles mouse push/pull forces with distance falloff
   * 3. Computes predicted positions for density calculation
   *
   * The predicted position is used instead of current position for density
   * calculation. This "position prediction" technique improves stability by
   * accounting for where particles will be, not just where they are.
   *
   * Mouse interaction uses a radial force field:
   * - Force strength decreases from center to edge of interaction radius
   * - Pull (left click) attracts particles toward cursor
   * - Push (right click) repels particles away from cursor
   * - A damping term reduces velocity near the cursor for smoother control
   *
   * @param dt - Time step in seconds
   */
  function externalForcesStep(dt: number): void {
    const positions = state.positions;
    const predicted = state.predicted;
    const velocities = state.velocities;

    // Determine interaction mode
    const pull = state.input.pull;
    const push = state.input.push;
    const interactionStrength = push
      ? -config.interactionStrength // Negative for push (repel)
      : pull
        ? config.interactionStrength // Positive for pull (attract)
        : 0; // No interaction

    const inputX = state.input.worldX;
    const inputY = state.input.worldY;
    const inputRadius = config.interactionRadius;
    const inputRadiusSq = inputRadius * inputRadius;

    for (let i = 0; i < state.count; i += 1) {
      const idx = i * 2;
      let vx = velocities[idx];
      let vy = velocities[idx + 1];

      // Start with gravity (constant downward acceleration)
      let ax = 0;
      let ay = -config.gravity;

      // Apply mouse interaction force if active
      if (interactionStrength !== 0) {
        const dx = inputX - positions[idx];
        const dy = inputY - positions[idx + 1];
        const sqrDst = dx * dx + dy * dy;

        // Only affect particles within interaction radius
        if (sqrDst < inputRadiusSq) {
          const dst = Math.sqrt(sqrDst);

          // Edge-to-center interpolation factors
          const edgeT = dst / inputRadius; // 0 at center, 1 at edge
          const centreT = 1 - edgeT; // 1 at center, 0 at edge

          // Direction from particle to cursor
          const invDst = dst > 0 ? 1 / dst : 0;
          const dirX = dx * invDst;
          const dirY = dy * invDst;

          // Reduce gravity influence near cursor center
          const gravityWeight =
            1 - centreT * Math.min(1, interactionStrength / 10);

          // Combined acceleration: scaled gravity + directional force + velocity damping
          ax =
            ax * gravityWeight +
            dirX * centreT * interactionStrength -
            vx * centreT; // Damping term
          ay =
            ay * gravityWeight +
            dirY * centreT * interactionStrength -
            vy * centreT;
        }
      }

      // Euler integration: v += a * dt
      vx += ax * dt;
      vy += ay * dt;

      velocities[idx] = vx;
      velocities[idx + 1] = vy;

      // Predict position for density calculation
      // Using a fixed prediction factor (1/120s) for stability
      const predictionFactor = 1 / 120;
      predicted[idx] = positions[idx] + vx * predictionFactor;
      predicted[idx + 1] = positions[idx + 1] + vy * predictionFactor;
    }
  }

  /**
   * Predicts positions based on current velocities without applying forces.
   *
   * This is used when external forces are handled elsewhere (e.g. GPU).
   */
  function predictPositions(): void {
    const positions = state.positions;
    const predicted = state.predicted;
    const velocities = state.velocities;
    const predictionFactor = 1 / 120;

    for (let i = 0; i < state.count; i += 1) {
      const idx = i * 2;
      predicted[idx] = positions[idx] + velocities[idx] * predictionFactor;
      predicted[idx + 1] = positions[idx + 1] + velocities[idx + 1] * predictionFactor;
    }
  }

  /**
   * Sorts particles by spatial hash for cache-efficient neighbor queries.
   *
   * This is a critical optimization that transforms neighbor search from
   * O(n²) to approximately O(n). The algorithm:
   *
   * 1. HASH: Compute spatial hash key for each particle based on grid cell
   *    - Cell coordinates = floor(position / smoothingRadius)
   *    - Hash maps 2D cell to 1D key using the hashCell2D function
   *    - Key is reduced to [0, count) range via modulo
   *
   * 2. COUNT: Count particles in each hash bucket (counting sort step 1)
   *
   * 3. PREFIX SUM: Convert counts to starting offsets (counting sort step 2)
   *
   * 4. SCATTER: Place particles in sorted order (counting sort step 3)
   *
   * 5. REORDER DATA: Copy position/velocity data to sorted order
   *    - Uses double-buffering to avoid allocation
   *    - Swaps buffer pointers after copy
   *
   * 6. BUILD OFFSETS: Record where each hash bucket starts in sorted array
   *    - spatialOffsets[key] = first index with that key
   *    - Used for O(1) neighbor lookup
   *
   * After this step, particles with the same spatial hash are contiguous
   * in memory, enabling efficient iteration during density/force calculation.
   */
  function runSpatialHash(): void {
    const count = state.count;
    const predicted = state.predicted;
    const keys = state.keys;
    const sortedKeys = state.sortedKeys;
    const indices = state.indices;
    const sortOffsets = state.sortOffsets;

    // === Step 1: Compute hash keys and count bucket sizes ===
    sortOffsets.fill(0);
    for (let i = 0; i < count; i += 1) {
      const idx = i * 2;
      // Convert position to grid cell coordinates
      const cellX = Math.floor(predicted[idx] / radius);
      const cellY = Math.floor(predicted[idx + 1] / radius);

      // Hash cell to key and reduce to table size
      const hash = hashCell2D(cellX, cellY);
      const key = hash % count;
      keys[i] = key;
      sortOffsets[key] += 1; // Count particles in this bucket
    }

    // === Step 2: Compute prefix sum (exclusive scan) ===
    // Transforms counts into starting indices
    let sum = 0;
    for (let k = 0; k < count; k += 1) {
      const c = sortOffsets[k];
      sortOffsets[k] = sum;
      sum += c;
    }

    // === Step 3: Scatter particles to sorted positions ===
    for (let i = 0; i < count; i += 1) {
      const key = keys[i];
      const dest = sortOffsets[key];
      sortOffsets[key] = dest + 1; // Increment for next particle with same key
      indices[dest] = i; // Record original index
      sortedKeys[dest] = key; // Record key at sorted position
    }

    // === Step 4: Reorder particle data to sorted order ===
    const positions = state.positions;
    const velocities = state.velocities;
    const positionsSorted = state.positionsSorted;
    const predictedSorted = state.predictedSorted;
    const velocitiesSorted = state.velocitiesSorted;

    for (let i = 0; i < count; i += 1) {
      const src = indices[i] * 2;
      const dst = i * 2;

      // Copy from original to sorted position
      positionsSorted[dst] = positions[src];
      positionsSorted[dst + 1] = positions[src + 1];
      predictedSorted[dst] = predicted[src];
      predictedSorted[dst + 1] = predicted[src + 1];
      velocitiesSorted[dst] = velocities[src];
      velocitiesSorted[dst + 1] = velocities[src + 1];
    }

    // Swap buffer pointers (double-buffering to avoid allocation)
    state.positions = positionsSorted;
    state.predicted = predictedSorted;
    state.velocities = velocitiesSorted;
    state.positionsSorted = positions;
    state.predictedSorted = predicted;
    state.velocitiesSorted = velocities;

    // === Step 5: Build spatial offset lookup table ===
    // spatialOffsets[key] = first sorted index with that key
    const spatialOffsets = state.spatialOffsets;
    spatialOffsets.fill(count); // Initialize to "no particles" sentinel

    for (let i = 0; i < count; i += 1) {
      // Record offset at first occurrence of each key
      if (i === 0 || sortedKeys[i] !== sortedKeys[i - 1]) {
        spatialOffsets[sortedKeys[i]] = i;
      }
    }
  }

  /**
   * Calculates density at each particle location.
   *
   * This implements the SPH density summation:
   *   ρᵢ = Σⱼ mⱼ W(|rᵢ - rⱼ|, h)
   *
   * Since all particles have equal mass (implicit m=1), this simplifies to
   * summing kernel values over all neighbors within the smoothing radius.
   *
   * Two densities are computed:
   * - Standard density (using spikyPow2 kernel) for pressure forces
   * - Near density (using spikyPow3 kernel) for surface tension
   *
   * The near density uses a sharper kernel that peaks more strongly at
   * small distances, creating additional repulsion that prevents particle
   * clumping and approximates surface tension effects.
   *
   * Neighbor iteration uses the spatial hash:
   * 1. Determine which cell the particle is in
   * 2. For each of the 9 neighboring cells (including self):
   *    a. Look up where that cell's particles start in sorted array
   *    b. Iterate through particles until key changes
   *    c. Check distance and accumulate kernel contribution
   */
  function calculateDensities(): void {
    const count = state.count;
    const predicted = state.predicted;
    const densities = state.densities;
    const sortedKeys = state.sortedKeys;
    const spatialOffsets = state.spatialOffsets;

    for (let i = 0; i < count; i += 1) {
      const idx = i * 2;
      const posX = predicted[idx];
      const posY = predicted[idx + 1];

      // Grid cell containing this particle
      const originCellX = Math.floor(posX / radius);
      const originCellY = Math.floor(posY / radius);

      let density = 0;
      let nearDensity = 0;

      // Iterate over all 9 neighboring cells
      for (let n = 0; n < neighborOffsets.length; n += 1) {
        const offset = neighborOffsets[n];
        const cellX = originCellX + offset[0];
        const cellY = originCellY + offset[1];

        // Get starting index for this cell in sorted array
        const key = hashCell2D(cellX, cellY) % count;
        let currIndex = spatialOffsets[key];

        // Iterate through particles with matching key
        while (currIndex < count) {
          const neighbourKey = sortedKeys[currIndex];
          if (neighbourKey !== key) break; // Moved to different bucket

          const nIdx = currIndex * 2;
          const dx = predicted[nIdx] - posX;
          const dy = predicted[nIdx + 1] - posY;
          const sqrDst = dx * dx + dy * dy;

          // Only include neighbors within smoothing radius
          if (sqrDst <= radiusSq) {
            const dst = Math.sqrt(sqrDst);

            // Accumulate kernel contributions
            density += spikyKernelPow2(dst, radius, spikyPow2Scale);
            nearDensity += spikyKernelPow3(dst, radius, spikyPow3Scale);
          }

          currIndex += 1;
        }
      }

      // Store both densities (interleaved)
      densities[idx] = density;
      densities[idx + 1] = nearDensity;
    }
  }

  /**
   * Calculates and applies pressure forces.
   *
   * Pressure forces arise from density differences and act to restore
   * the fluid to its rest density (incompressibility).
   *
   * The pressure at each particle is computed from its density:
   *   P = k(ρ - ρ₀)
   *
   * where k is the pressure stiffness and ρ₀ is the target density.
   *
   * Forces between particles are computed using the gradient of the
   * smoothing kernel (symmetric formulation):
   *   Fᵢⱼ = -mⱼ (Pᵢ + Pⱼ)/(2ρⱼ) ∇W(rᵢⱼ, h)
   *
   * The symmetric formulation (Pᵢ + Pⱼ)/2 ensures Newton's third law
   * is satisfied (equal and opposite forces).
   *
   * Two pressure terms are computed:
   * - Standard pressure: prevents overall compression
   * - Near pressure: provides close-range repulsion (surface tension)
   *
   * @param dt - Time step in seconds
   */
  function calculatePressure(dt: number): void {
    const count = state.count;
    const predicted = state.predicted;
    const velocities = state.velocities;
    const densities = state.densities;
    const sortedKeys = state.sortedKeys;
    const spatialOffsets = state.spatialOffsets;

    for (let i = 0; i < count; i += 1) {
      const idx = i * 2;
      const density = densities[idx];
      const nearDensity = densities[idx + 1];

      // Skip particles with zero density (shouldn't happen, but safety check)
      if (density <= 0) continue;

      // Compute pressure from density deviation
      // Positive when compressed (ρ > ρ₀), negative when expanded
      const pressure =
        (density - config.targetDensity) * config.pressureMultiplier;
      const nearPressure = config.nearPressureMultiplier * nearDensity;

      const posX = predicted[idx];
      const posY = predicted[idx + 1];
      const originCellX = Math.floor(posX / radius);
      const originCellY = Math.floor(posY / radius);

      let forceX = 0;
      let forceY = 0;

      // Iterate over neighboring particles
      for (let n = 0; n < neighborOffsets.length; n += 1) {
        const offset = neighborOffsets[n];
        const cellX = originCellX + offset[0];
        const cellY = originCellY + offset[1];
        const key = hashCell2D(cellX, cellY) % count;
        let currIndex = spatialOffsets[key];

        while (currIndex < count) {
          const neighbourKey = sortedKeys[currIndex];
          if (neighbourKey !== key) break;

          // Skip self-interaction
          if (currIndex !== i) {
            const nIdx = currIndex * 2;
            const dx = predicted[nIdx] - posX;
            const dy = predicted[nIdx + 1] - posY;
            const sqrDst = dx * dx + dy * dy;

            if (sqrDst <= radiusSq) {
              const dst = Math.sqrt(sqrDst);

              // Direction from particle i to neighbor j
              const invDst = dst > 0 ? 1 / dst : 0;
              const dirX = dx * invDst;
              const dirY = dy * invDst;

              // Neighbor's pressure values
              const neighbourDensity = densities[nIdx];
              const neighbourNearDensity = densities[nIdx + 1];
              const neighbourPressure =
                (neighbourDensity - config.targetDensity) *
                config.pressureMultiplier;
              const neighbourNearPressure =
                config.nearPressureMultiplier * neighbourNearDensity;

              // Symmetric pressure (average of both particles)
              const sharedPressure = (pressure + neighbourPressure) * 0.5;
              const sharedNearPressure =
                (nearPressure + neighbourNearPressure) * 0.5;

              // Accumulate pressure force (using kernel gradient)
              if (neighbourDensity > 0) {
                const scale =
                  derivativeSpikyPow2(dst, radius, spikyPow2DerivScale) *
                  (sharedPressure / neighbourDensity);
                forceX += dirX * scale;
                forceY += dirY * scale;
              }

              // Accumulate near-pressure force (stronger at close range)
              if (neighbourNearDensity > 0) {
                const scale =
                  derivativeSpikyPow3(dst, radius, spikyPow3DerivScale) *
                  (sharedNearPressure / neighbourNearDensity);
                forceX += dirX * scale;
                forceY += dirY * scale;
              }
            }
          }

          currIndex += 1;
        }
      }

      // Apply acceleration: a = F/ρ (F = ma, so a = F/m, with ρ ~ m here)
      velocities[idx] += (forceX / density) * dt;
      velocities[idx + 1] += (forceY / density) * dt;
    }
  }

  /**
   * Calculates and applies viscosity forces.
   *
   * Viscosity represents internal friction in the fluid. It smooths out
   * velocity differences between neighboring particles, creating a more
   * cohesive flow.
   *
   * The viscosity force is computed as:
   *   Fᵢ = μ Σⱼ mⱼ (vⱼ - vᵢ)/ρⱼ W(rᵢⱼ, h)
   *
   * where μ is the viscosity coefficient. This pulls each particle's
   * velocity toward the average of its neighbors.
   *
   * Higher viscosity values create thicker fluids (like honey) while
   * lower values create thinner fluids (like water).
   *
   * The Poly6 kernel is used for viscosity because it's smooth and
   * doesn't introduce numerical artifacts at close range.
   *
   * @param dt - Time step in seconds
   */
  function calculateViscosity(dt: number): void {
    const count = state.count;
    const predicted = state.predicted;
    const velocities = state.velocities;
    const sortedKeys = state.sortedKeys;
    const spatialOffsets = state.spatialOffsets;

    for (let i = 0; i < count; i += 1) {
      const idx = i * 2;
      const posX = predicted[idx];
      const posY = predicted[idx + 1];
      const originCellX = Math.floor(posX / radius);
      const originCellY = Math.floor(posY / radius);

      let forceX = 0;
      let forceY = 0;
      const velX = velocities[idx];
      const velY = velocities[idx + 1];

      // Iterate over neighboring particles
      for (let n = 0; n < neighborOffsets.length; n += 1) {
        const offset = neighborOffsets[n];
        const cellX = originCellX + offset[0];
        const cellY = originCellY + offset[1];
        const key = hashCell2D(cellX, cellY) % count;
        let currIndex = spatialOffsets[key];

        while (currIndex < count) {
          const neighbourKey = sortedKeys[currIndex];
          if (neighbourKey !== key) break;

          // Skip self-interaction
          if (currIndex !== i) {
            const nIdx = currIndex * 2;
            const dx = predicted[nIdx] - posX;
            const dy = predicted[nIdx + 1] - posY;
            const sqrDst = dx * dx + dy * dy;

            if (sqrDst <= radiusSq) {
              const dst = Math.sqrt(sqrDst);

              // Weight by Poly6 kernel (smooth, good for viscosity)
              const weight = smoothingKernelPoly6(dst, radius, poly6Scale);

              // Accumulate velocity difference (pulls toward neighbor's velocity)
              forceX += (velocities[nIdx] - velX) * weight;
              forceY += (velocities[nIdx + 1] - velY) * weight;
            }
          }

          currIndex += 1;
        }
      }

      // Apply viscosity force
      velocities[idx] += forceX * config.viscosityStrength * dt;
      velocities[idx + 1] += forceY * config.viscosityStrength * dt;
    }
  }

  /**
   * Handles collisions with boundaries and obstacles.
   *
   * When a particle crosses a boundary, this function:
   * 1. Clamps the position back inside the boundary
   * 2. Reflects and damps the velocity component perpendicular to the boundary
   *
   * The collision damping factor (0-1) controls energy loss:
   * - 1.0 = perfectly elastic (no energy loss)
   * - 0.0 = perfectly inelastic (particle stops)
   * - 0.95 = slight energy loss (realistic)
   *
   * Both the outer boundary (simulation bounds) and an optional inner
   * obstacle (rectangular) are supported.
   *
   * The boundary includes padding to account for:
   * - Visual particle radius (so particles don't overlap the edge visually)
   * - Configurable padding for aesthetics
   */
  function handleCollisions(): void {
    const positions = state.positions;
    const velocities = state.velocities;

    // Calculate boundary padding in world units
    const paddingPx =
      Math.max(1, Math.round(config.particleRadius)) + config.boundsPaddingPx;
    const padding = paddingPx / getScale();

    // Half-extents of the collision boundary (centered at origin)
    const halfX = Math.max(0, config.boundsSize.x * 0.5 - padding);
    const halfY = Math.max(0, config.boundsSize.y * 0.5 - padding);

    // Obstacle parameters
    const obstacleHalfX = config.obstacleSize.x * 0.5;
    const obstacleHalfY = config.obstacleSize.y * 0.5;
    const hasObstacle = config.obstacleSize.x > 0 && config.obstacleSize.y > 0;

    for (let i = 0; i < state.count; i += 1) {
      const idx = i * 2;
      let px = positions[idx];
      let py = positions[idx + 1];
      let vx = velocities[idx];
      let vy = velocities[idx + 1];

      // === Outer boundary collision ===
      // Distance from center to boundary edge
      const edgeDstX = halfX - Math.abs(px);
      const edgeDstY = halfY - Math.abs(py);

      // X boundary collision
      if (edgeDstX <= 0) {
        px = halfX * Math.sign(px); // Clamp to boundary
        vx *= -config.collisionDamping; // Reflect and damp
      }

      // Y boundary collision
      if (edgeDstY <= 0) {
        py = halfY * Math.sign(py);
        vy *= -config.collisionDamping;
      }

      // === Inner obstacle collision ===
      if (hasObstacle) {
        // Position relative to obstacle center
        const ox = px - config.obstacleCentre.x;
        const oy = py - config.obstacleCentre.y;

        // Distance from obstacle center to edge
        const obstacleEdgeX = obstacleHalfX - Math.abs(ox);
        const obstacleEdgeY = obstacleHalfY - Math.abs(oy);

        // If inside obstacle, push out along shortest axis
        if (obstacleEdgeX >= 0 && obstacleEdgeY >= 0) {
          if (obstacleEdgeX < obstacleEdgeY) {
            // Closer to X edge, push out horizontally
            px = obstacleHalfX * Math.sign(ox) + config.obstacleCentre.x;
            vx *= -config.collisionDamping;
          } else {
            // Closer to Y edge, push out vertically
            py = obstacleHalfY * Math.sign(oy) + config.obstacleCentre.y;
            vy *= -config.collisionDamping;
          }
        }
      }

      positions[idx] = px;
      positions[idx + 1] = py;
      velocities[idx] = vx;
      velocities[idx + 1] = vy;
    }
  }

  /**
   * Updates particle positions based on velocities (Euler integration).
   *
   * This is the final step of the physics update:
   *   position += velocity * dt
   *
   * After position update, collision handling is applied to keep
   * particles within bounds.
   *
   * @param dt - Time step in seconds
   */
  function updatePositions(dt: number): void {
    const positions = state.positions;
    const velocities = state.velocities;

    for (let i = 0; i < state.count; i += 1) {
      const idx = i * 2;
      positions[idx] += velocities[idx] * dt;
      positions[idx + 1] += velocities[idx + 1] * dt;
    }

    handleCollisions();
  }

  /**
   * Advances the simulation by one frame.
   *
   * The frame time is divided into multiple substeps (iterations) for
   * stability. More substeps = more accurate but slower simulation.
   *
   * Time step limiting prevents instability when frame rate drops:
   * - maxTimestepFPS caps the maximum simulated time per frame
   * - timeScale allows slow-motion or fast-forward effects
   *
   * Each substep performs the complete SPH algorithm:
   * 1. External forces (gravity, interaction)
   * 2. Spatial hashing (for efficient neighbor queries)
   * 3. Density calculation
   * 4. Pressure forces
   * 5. Viscosity forces
   * 6. Position update and collision handling
   *
   * @param dt - Real-world time since last frame (seconds)
   */
  function substep(dt: number, includeExternalForces: boolean): void {
    if (includeExternalForces) {
      externalForcesStep(dt);
    } else {
      predictPositions();
    }
    runSpatialHash();
    calculateDensities();
    calculatePressure(dt);
    calculateViscosity(dt);
    updatePositions(dt);
  }

  function step(dt: number): void {
    // Limit timestep for stability (avoid simulation explosion)
    const maxDeltaTime = config.maxTimestepFPS
      ? 1 / config.maxTimestepFPS
      : Number.POSITIVE_INFINITY;

    // Apply time scale and cap
    const frameTime = Math.min(dt * config.timeScale, maxDeltaTime);

    // Divide into substeps
    const timeStep = frameTime / config.iterationsPerFrame;

    // Run multiple iterations per frame for stability
    for (let i = 0; i < config.iterationsPerFrame; i += 1) {
      substep(timeStep, true);
    }
  }

  return {
    step,
    substep,
    predictPositions,
    runSpatialHash,
    calculateDensities,
    calculatePressure,
    calculateViscosity,
    updatePositions,
    refreshSettings,
    applyParticleScale,
  };
}
