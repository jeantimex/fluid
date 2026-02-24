import { Utilities } from './utilities';
import { Camera } from './camera';
import { BoxEditor } from './box_editor';
import { generateSphereGeometry } from './renderer';
import { Simulator } from './simulator';
import { GBufferPass } from './render/passes/gbuffer_pass';
import { ShadowPass } from './render/passes/shadow_pass';
import { AOPass } from './render/passes/ao_pass';
import { CompositePass } from './render/passes/composite_pass';
import { FXAAPass } from './render/passes/fxaa_pass';
import { RenderResources } from './render/resources';
import type { SceneConfig } from './render/types';
import { MouseInteractionController } from './input/mouse_interaction';
import { createGui } from './ui/gui';

/**
 * WebGPU 3D FLIP Fluid Simulation - Application Entry Point
 *
 * This file orchestrates a complete GPU-accelerated fluid simulation with:
 * - Real-time FLIP (Fluid-Implicit-Particle) physics
 * - Deferred rendering pipeline with shadows and ambient occlusion
 * - Interactive mouse forces and configurable parameters
 *
 * ## Architecture Overview
 *
 * ```
 * ┌─────────────────────────────────────────────────────────────────┐
 * │                        SIMULATION                               │
 * │  Particles ──> P2G ──> Pressure Solve ──> G2P ──> Advect        │
 * │  (35,000+)    Grid     (50 Jacobi)      Grid     Particles      │
 * └─────────────────────────────────────────────────────────────────┘
 *                              │
 *                              ▼
 * ┌─────────────────────────────────────────────────────────────────┐
 * │                      RENDER PIPELINE                            │
 * │  ┌───────────┐  ┌────────┐  ┌────┐  ┌───────────┐  ┌──────┐     │
 * │  │ G-Buffer  │─▶│ Shadow │─▶│ AO │─▶│ Composite │─▶│ FXAA │     │
 * │  │ (normals) │  │ (depth)│  │    │  │ (lighting)│  │      │     │
 * │  └───────────┘  └────────┘  └────┘  └───────────┘  └──────┘     │
 * └─────────────────────────────────────────────────────────────────┘
 * ```
 *
 * ## Key Components
 *
 * - **Simulator**: GPU compute kernels for FLIP physics
 * - **Render Passes**: Deferred shading with instanced sphere rendering
 * - **Camera**: Orbit camera with mouse drag controls
 * - **GUI**: lil-gui based parameter controls
 *
 * ## Frame Order
 *
 * 1. Update smooth container dimensions (lerp for stability)
 * 2. Compute pass: FLIP simulation (12 dispatch steps)
 * 3. G-buffer pass: Render particle spheres (normals + depth)
 * 4. Shadow pass: Render from light POV
 * 5. AO pass: Screen-space ambient occlusion
 * 6. Composite pass: Final lighting + floor + sky
 * 7. Wireframe pass: Optional container outline
 * 8. FXAA pass: Anti-aliasing
 *
 * @see simulator.ts - FLIP physics driver
 * @see shaders/flip_simulation.wgsl - Compute kernels
 */
async function init() {
  if (!navigator.gpu) {
    alert('WebGPU is not supported in this browser.');
    return;
  }

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    alert('No appropriate GPU adapter found.');
    return;
  }

  const device = await adapter.requestDevice({
    requiredLimits: {
      maxStorageBuffersPerShaderStage: 10, // Hardware limit on many GPUs
    },
  });
  const canvas = document.getElementById('canvas') as HTMLCanvasElement;
  const context = canvas.getContext('webgpu') as GPUCanvasContext;

  const devicePixelRatio = window.devicePixelRatio || 1;
  canvas.width = window.innerWidth * devicePixelRatio;
  canvas.height = window.innerHeight * devicePixelRatio;

  const presentationFormat = navigator.gpu.getPreferredCanvasFormat();
  context.configure({
    device,
    format: presentationFormat,
    alphaMode: 'premultiplied',
  });

  // =========================================================================
  // SIMULATION CONFIGURATION
  // =========================================================================
  // These parameters control fluid behavior and are exposed via GUI controls.

  /** Reference radius for position scaling (maintains visual consistency). */
  const BASE_PARTICLE_RADIUS = 0.22;

  const simConfig = {
    /** Visual radius of each fluid particle (world units). */
    particleRadius: 0.12,

    /** Multiplier for particle spacing during spawn (higher = sparser fluid). */
    spacingFactor: 3.0,

    /** Container dimensions in world units. */
    boxWidth: 24,
    boxHeight: 10,
    boxDepth: 15,

    /** Target number of particles (capped at MAX_PARTICLES). */
    particleCount: 35000,

    /**
     * PIC/FLIP blend factor (0-1).
     * - 0.0: Pure PIC (stable but viscous)
     * - 1.0: Pure FLIP (energetic but may be noisy)
     * - 0.95: Matches Blender FLIP Fluids default (5% PIC / 95% FLIP)
     */
    fluidity: 0.95,

    /**
     * Gravity magnitude (-50 to 50).
     * - Positive: Downward gravity (normal)
     * - Negative: Upward gravity (anti-gravity)
     * - 0: Zero gravity (floating)
     */
    gravity: 40,

    /**
     * Number of pressure solver iterations (1-100).
     * - Higher: More accurate incompressibility, slower
     * - Lower: Faster but may have compression artifacts
     * - With Jacobi: 50 is conservative; 25-30 often sufficient
     * - With Red-Black GS: Can use ~half the iterations for same quality
     */
    jacobiIterations: 50,

    /**
     * Use Red-Black Gauss-Seidel instead of Jacobi for pressure solve.
     * - Red-Black GS converges ~2x faster than Jacobi
     * - Can reduce iterations to 25 with similar quality to 50 Jacobi
     */
    useRedBlackGS: true,

    /**
     * Workgroup size for particle compute kernels.
     * - 32: Smaller, may help on some GPUs
     * - 64: Default, good baseline
     * - 128: Often better occupancy
     * - 256: Best for modern GPUs with many cores
     */
    particleWorkgroupSize: 64,

    /** Toggle wireframe rendering of container bounds. */
    showWireframe: true,
  };

  // Smooth configuration for gradual transitions
  // Keeps container changes visually/physically stable over several frames.
  const smoothConfig = {
    boxWidth: simConfig.boxWidth,
    boxHeight: simConfig.boxHeight,
    boxDepth: simConfig.boxDepth,
  };

  const getPositionScale = () =>
    simConfig.particleRadius / BASE_PARTICLE_RADIUS;

  // Simulation offset to center fluid on tiles (world origin)
  // Simulation uses positive [0,width] coordinates; render space is centered.
  const getSimOffsetX = () => -smoothConfig.boxWidth / 2;
  const getSimOffsetY = () => 0;
  const getSimOffsetZ = () => -smoothConfig.boxDepth / 2;

  const getInternalGridWidth = () => smoothConfig.boxWidth;
  const getInternalGridHeight = () => smoothConfig.boxHeight;
  const getInternalGridDepth = () => smoothConfig.boxDepth;

  // =========================================================================
  // GRID RESOLUTION
  // =========================================================================
  // The simulation grid resolution determines:
  // - Detail level of pressure/velocity fields
  // - Cell size = containerWidth / RESOLUTION_X
  // - Memory usage: O(nx * ny * nz) for grid buffers
  // - Performance: More cells = more work per frame
  //
  // Typical values: 16-64 per axis for real-time simulation

  const RESOLUTION_X = 32; // Cells along width
  const BASE_BOX_HEIGHT = simConfig.boxHeight;
  const RESOLUTION_Y_BASE = 16; // Baseline cells along height at BASE_BOX_HEIGHT
  // Match lil-gui max to reserve enough Y-cells for tall containers.
  const MAX_BOX_HEIGHT = 50;
  const RESOLUTION_Y_MAX = Math.ceil(
    (MAX_BOX_HEIGHT / BASE_BOX_HEIGHT) * RESOLUTION_Y_BASE
  );
  const RESOLUTION_Z = 16; // Cells along depth

  const camera = new Camera(canvas, [0, 0, 0]); // Orbit around world origin
  const boxEditor = new BoxEditor(device, presentationFormat, [
    simConfig.boxWidth,
    simConfig.boxHeight,
    simConfig.boxDepth,
  ]);

  // --- Particle Setup ---
  // Buffers are allocated for max capacity once, then subranges are used.
  const MAX_PARTICLES = 200000;
  const particlePositionBuffer = device.createBuffer({
    size: MAX_PARTICLES * 16,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const particleVelocityBuffer = device.createBuffer({
    size: MAX_PARTICLES * 16,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });

  // Pre-computed random directions (uniform on sphere, matching WebGL)
  const particleRandomBuffer = device.createBuffer({
    size: MAX_PARTICLES * 16,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const randomData = new Float32Array(MAX_PARTICLES * 4);
  for (let i = 0; i < MAX_PARTICLES; i++) {
    // Uniform distribution on sphere (same as WebGL)
    const theta = Math.random() * 2.0 * Math.PI;
    const u = Math.random() * 2.0 - 1.0;
    randomData[i * 4 + 0] = Math.sqrt(1.0 - u * u) * Math.cos(theta);
    randomData[i * 4 + 1] = Math.sqrt(1.0 - u * u) * Math.sin(theta);
    randomData[i * 4 + 2] = u;
    randomData[i * 4 + 3] = 0.0;
  }
  device.queue.writeBuffer(particleRandomBuffer, 0, randomData);

  const simulator = new Simulator(
    device,
    RESOLUTION_X,
    RESOLUTION_Y_MAX,
    RESOLUTION_Z,
    getInternalGridWidth(),
    getInternalGridHeight(),
    getInternalGridDepth(),
    particlePositionBuffer,
    particleVelocityBuffer,
    particleRandomBuffer,
    simConfig.particleWorkgroupSize
  );

  // =========================================================================
  // PHYSICS DIAGNOSTICS
  // =========================================================================
  // Reads GPU buffers to verify simulation quality:
  // 1. Particle density (particles per fluid cell)
  // 2. Divergence (pressure solve quality - should be near zero)
  // 3. Velocity magnitude (should be reasonable, not exploding)

  const scalarBufferSize = RESOLUTION_X * RESOLUTION_Y_MAX * RESOLUTION_Z * 4;
  const velGridSize =
    (RESOLUTION_X + 1) * (RESOLUTION_Y_MAX + 1) * (RESOLUTION_Z + 1);
  const velBufferSize = velGridSize * 16; // vec4<f32>

  const markerStagingBuffer = device.createBuffer({
    size: scalarBufferSize,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const divergenceStagingBuffer = device.createBuffer({
    size: scalarBufferSize,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const velocityStagingBuffer = device.createBuffer({
    size: velBufferSize,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const sdfStagingBuffer = device.createBuffer({
    size: scalarBufferSize,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });

  // Emission potential staging buffers
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

  let isDiagnosticPending = false;
  let diagnosticFrameCount = 0;
  const DIAGNOSTIC_INTERVAL = 60; // Run every 60 frames

  async function runPhysicsDiagnostic() {
    if (isDiagnosticPending) return;
    isDiagnosticPending = true;

    // Copy all diagnostic buffers
    const commandEncoder = device.createCommandEncoder();
    commandEncoder.copyBufferToBuffer(
      simulator.gridMarkerBuffer,
      0,
      markerStagingBuffer,
      0,
      scalarBufferSize
    );
    commandEncoder.copyBufferToBuffer(
      simulator.pressureTempBuffer,
      0, // Contains divergence after computeDivergence
      divergenceStagingBuffer,
      0,
      scalarBufferSize
    );
    commandEncoder.copyBufferToBuffer(
      simulator.gridVelocityFloatBuffer,
      0,
      velocityStagingBuffer,
      0,
      velBufferSize
    );
    commandEncoder.copyBufferToBuffer(
      simulator.surfaceSDFBuffer,
      0,
      sdfStagingBuffer,
      0,
      scalarBufferSize
    );
    // Emission potential buffers
    commandEncoder.copyBufferToBuffer(
      simulator.trappedAirPotentialBuffer,
      0,
      trappedAirStagingBuffer,
      0,
      scalarBufferSize
    );
    commandEncoder.copyBufferToBuffer(
      simulator.waveCrestPotentialBuffer,
      0,
      waveCrestStagingBuffer,
      0,
      scalarBufferSize
    );
    commandEncoder.copyBufferToBuffer(
      simulator.kineticEnergyPotentialBuffer,
      0,
      kineticEnergyStagingBuffer,
      0,
      scalarBufferSize
    );
    device.queue.submit([commandEncoder.finish()]);

    // Read back all data
    await Promise.all([
      markerStagingBuffer.mapAsync(GPUMapMode.READ),
      divergenceStagingBuffer.mapAsync(GPUMapMode.READ),
      velocityStagingBuffer.mapAsync(GPUMapMode.READ),
      sdfStagingBuffer.mapAsync(GPUMapMode.READ),
      trappedAirStagingBuffer.mapAsync(GPUMapMode.READ),
      waveCrestStagingBuffer.mapAsync(GPUMapMode.READ),
      kineticEnergyStagingBuffer.mapAsync(GPUMapMode.READ),
    ]);

    const markerData = new Uint32Array(
      markerStagingBuffer.getMappedRange().slice(0)
    );
    const divergenceData = new Float32Array(
      divergenceStagingBuffer.getMappedRange().slice(0)
    );
    const velocityData = new Float32Array(
      velocityStagingBuffer.getMappedRange().slice(0)
    );
    const sdfData = new Float32Array(
      sdfStagingBuffer.getMappedRange().slice(0)
    );
    const trappedAirData = new Float32Array(
      trappedAirStagingBuffer.getMappedRange().slice(0)
    );
    const waveCrestData = new Float32Array(
      waveCrestStagingBuffer.getMappedRange().slice(0)
    );
    const kineticEnergyData = new Float32Array(
      kineticEnergyStagingBuffer.getMappedRange().slice(0)
    );

    markerStagingBuffer.unmap();
    divergenceStagingBuffer.unmap();
    velocityStagingBuffer.unmap();
    sdfStagingBuffer.unmap();
    trappedAirStagingBuffer.unmap();
    waveCrestStagingBuffer.unmap();
    kineticEnergyStagingBuffer.unmap();

    // Get actual grid dimensions
    const nx = RESOLUTION_X;
    const ny = simulator.ny;
    const nz = RESOLUTION_Z;

    // -------------------------------------------------------------------------
    // 1. Particle Density
    // -------------------------------------------------------------------------
    let fluidCells = 0;
    for (let z = 0; z < nz; z++) {
      for (let y = 0; y < ny; y++) {
        for (let x = 0; x < nx; x++) {
          const idx = x + y * nx + z * nx * ny;
          if (markerData[idx] === 1) {
            fluidCells++;
          }
        }
      }
    }
    const particlesPerCell = fluidCells > 0 ? particleCount / fluidCells : 0;

    let densityStatus = '✓ Good';
    if (particlesPerCell < 4) {
      densityStatus = '⚠ Very low';
    } else if (particlesPerCell < 6) {
      densityStatus = '⚠ Low';
    } else if (particlesPerCell > 20) {
      densityStatus = '⚠ Very high';
    } else if (particlesPerCell > 16) {
      densityStatus = '○ High';
    }

    // -------------------------------------------------------------------------
    // 2. Pre-Projection Divergence
    // -------------------------------------------------------------------------
    // NOTE: This is the divergence BEFORE pressure solve (what the solver tries to eliminate).
    // Pre-projection divergence of 10-50 is normal for active fluid.
    // After 50 Jacobi iterations, actual divergence should be ~100x smaller.
    let maxDivergence = 0;
    let avgDivergence = 0;
    let divergenceCount = 0;

    for (let z = 0; z < nz; z++) {
      for (let y = 0; y < ny; y++) {
        for (let x = 0; x < nx; x++) {
          const idx = x + y * nx + z * nx * ny;
          if (markerData[idx] === 1) {
            const div = Math.abs(divergenceData[idx]);
            maxDivergence = Math.max(maxDivergence, div);
            avgDivergence += div;
            divergenceCount++;
          }
        }
      }
    }
    avgDivergence = divergenceCount > 0 ? avgDivergence / divergenceCount : 0;

    // Pre-projection divergence thresholds (these values are expected to be high)
    // With gravity=40 and active motion, max ~10-50 is normal
    let divergenceStatus = '✓ Normal';
    if (maxDivergence > 100) {
      divergenceStatus = '⚠ Very high (may need more iterations)';
    } else if (maxDivergence > 50) {
      divergenceStatus = '○ High (active motion)';
    } else if (maxDivergence < 5) {
      divergenceStatus = '✓ Low (settling)';
    }

    // -------------------------------------------------------------------------
    // 3. Velocity Magnitude
    // -------------------------------------------------------------------------
    // Check velocity field for reasonable values
    let maxVelocity = 0;
    let avgVelocity = 0;
    let velCount = 0;

    const vnx = nx + 1;
    const vny = ny + 1;
    const vnz = nz + 1;

    for (let z = 0; z < vnz; z++) {
      for (let y = 0; y < vny; y++) {
        for (let x = 0; x < vnx; x++) {
          const idx = (x + y * vnx + z * vnx * vny) * 4;
          const vx = velocityData[idx];
          const vy = velocityData[idx + 1];
          const vz = velocityData[idx + 2];
          const mag = Math.sqrt(vx * vx + vy * vy + vz * vz);
          if (mag > 0.001) {
            // Only count non-zero velocities
            maxVelocity = Math.max(maxVelocity, mag);
            avgVelocity += mag;
            velCount++;
          }
        }
      }
    }
    avgVelocity = velCount > 0 ? avgVelocity / velCount : 0;

    // Velocity thresholds (world units per second)
    let velocityStatus = '✓ Good';
    if (maxVelocity > 100) {
      velocityStatus = '⚠ Exploding!';
    } else if (maxVelocity > 50) {
      velocityStatus = '○ High (fast motion)';
    } else if (maxVelocity < 0.1 && particleCount > 0) {
      velocityStatus = '○ Low (settling)';
    }

    // -------------------------------------------------------------------------
    // 4. Surface SDF Verification
    // -------------------------------------------------------------------------
    // Check SDF values and verify JFA propagated proper distances
    let sdfInsideCount = 0; // SDF < 0 (inside fluid)
    let sdfOutsideCount = 0; // SDF > 0 (outside fluid)
    let sdfMismatchCount = 0; // Cells where SDF sign doesn't match marker
    let minSDF = Infinity;
    let maxSDF = -Infinity;
    let surfaceCells = 0; // Cells near surface (|SDF| < 1)

    for (let z = 0; z < nz; z++) {
      for (let y = 0; y < ny; y++) {
        for (let x = 0; x < nx; x++) {
          const idx = x + y * nx + z * nx * ny;
          const isFluid = markerData[idx] === 1;
          const sdf = sdfData[idx];

          minSDF = Math.min(minSDF, sdf);
          maxSDF = Math.max(maxSDF, sdf);

          if (Math.abs(sdf) < 1.0) {
            surfaceCells++;
          }

          if (sdf < 0) {
            sdfInsideCount++;
          } else {
            sdfOutsideCount++;
          }

          // Check for mismatches
          if (isFluid && sdf > 0) {
            sdfMismatchCount++; // Fluid cell but SDF says outside
          } else if (!isFluid && sdf < 0) {
            sdfMismatchCount++; // Air cell but SDF says inside
          }
        }
      }
    }

    let sdfStatus = '✓ Good';
    if (sdfMismatchCount > 0) {
      sdfStatus = `⚠ ${sdfMismatchCount} mismatches`;
    }
    if (sdfInsideCount === 0 && fluidCells > 0) {
      sdfStatus = '⚠ No inside cells (SDF not initialized?)';
    }
    // Check if JFA propagated (distances should be < 1000)
    const jfaWorking = maxSDF < 500 && minSDF > -500;

    // -------------------------------------------------------------------------
    // 5. Surface Normal Quality (from SDF gradient)
    // -------------------------------------------------------------------------
    // Compute gradient of SDF at surface cells to verify normals are usable
    // for wave crest potential (velocity · normal)
    let normalSampleCount = 0;
    let normalMagSum = 0;
    let normalMagMin = Infinity;
    let normalMagMax = 0;
    let degenerateNormals = 0; // Normals with magnitude < 0.1 or > 2.0

    // Helper to get SDF value with bounds checking
    const getSDF = (x: number, y: number, z: number): number => {
      if (x < 0 || x >= nx || y < 0 || y >= ny || z < 0 || z >= nz) {
        return 1000.0; // Outside domain = far outside fluid
      }
      return sdfData[x + y * nx + z * nx * ny];
    };

    // Sample surface cells (not at boundaries to allow gradient computation)
    for (let z = 1; z < nz - 1; z++) {
      for (let y = 1; y < ny - 1; y++) {
        for (let x = 1; x < nx - 1; x++) {
          const idx = x + y * nx + z * nx * ny;
          const sdf = sdfData[idx];

          // Only check surface cells (|SDF| < 1.5)
          if (Math.abs(sdf) > 1.5) continue;

          // Compute gradient using central differences
          const gradX = (getSDF(x + 1, y, z) - getSDF(x - 1, y, z)) * 0.5;
          const gradY = (getSDF(x, y + 1, z) - getSDF(x, y - 1, z)) * 0.5;
          const gradZ = (getSDF(x, y, z + 1) - getSDF(x, y, z - 1)) * 0.5;

          // Gradient magnitude (should be ~1 for a proper distance field)
          const mag = Math.sqrt(gradX * gradX + gradY * gradY + gradZ * gradZ);

          normalSampleCount++;
          normalMagSum += mag;
          normalMagMin = Math.min(normalMagMin, mag);
          normalMagMax = Math.max(normalMagMax, mag);

          // Check for degenerate normals
          if (mag < 0.1 || mag > 2.0) {
            degenerateNormals++;
          }
        }
      }
    }

    const normalMagAvg =
      normalSampleCount > 0 ? normalMagSum / normalSampleCount : 0;
    const degeneratePercent =
      normalSampleCount > 0
        ? ((degenerateNormals / normalSampleCount) * 100).toFixed(1)
        : '0';

    let normalStatus = '✓ Good';
    if (normalSampleCount === 0) {
      normalStatus = '⚠ No surface cells to sample';
    } else if (degenerateNormals > normalSampleCount * 0.1) {
      normalStatus = `⚠ ${degeneratePercent}% degenerate`;
    } else if (normalMagAvg < 0.5 || normalMagAvg > 1.5) {
      normalStatus = `○ Avg magnitude off (${normalMagAvg.toFixed(2)})`;
    }

    // -------------------------------------------------------------------------
    // 6. Emission Potentials (Ita, Iwc, Ike)
    // -------------------------------------------------------------------------
    // Analyze emission potentials at surface cells (|SDF| < 2)
    let itaMin = Infinity,
      itaMax = 0,
      itaSum = 0,
      itaCount = 0;
    let iwcMin = Infinity,
      iwcMax = 0,
      iwcSum = 0,
      iwcCount = 0;
    let ikeMin = Infinity,
      ikeMax = 0,
      ikeSum = 0,
      ikeCount = 0;
    let activeCells = 0; // Cells with any non-zero potential
    const totalCells = nx * ny * nz;

    for (let i = 0; i < totalCells; i++) {
      const sdf = sdfData[i];
      // Only check near-surface cells
      if (Math.abs(sdf) > 3.0) continue;

      const ita = trappedAirData[i];
      const iwc = waveCrestData[i];
      const ike = kineticEnergyData[i];

      if (ita > 0 || iwc > 0 || ike > 0) {
        activeCells++;
      }

      if (ita > 0) {
        itaMin = Math.min(itaMin, ita);
        itaMax = Math.max(itaMax, ita);
        itaSum += ita;
        itaCount++;
      }
      if (iwc > 0) {
        iwcMin = Math.min(iwcMin, iwc);
        iwcMax = Math.max(iwcMax, iwc);
        iwcSum += iwc;
        iwcCount++;
      }
      if (ike > 0) {
        ikeMin = Math.min(ikeMin, ike);
        ikeMax = Math.max(ikeMax, ike);
        ikeSum += ike;
        ikeCount++;
      }
    }

    const itaAvg = itaCount > 0 ? itaSum / itaCount : 0;
    const iwcAvg = iwcCount > 0 ? iwcSum / iwcCount : 0;
    const ikeAvg = ikeCount > 0 ? ikeSum / ikeCount : 0;

    let emissionStatus = '✓ Good';
    if (activeCells === 0) {
      emissionStatus = '○ No active cells (fluid settling)';
    } else if (itaMax > 100 || iwcMax > 100 || ikeMax > 10000) {
      emissionStatus = '⚠ Values very high';
    }

    // -------------------------------------------------------------------------
    // Output
    // -------------------------------------------------------------------------
    console.log(`[Physics Diagnostic]
  ┌─ Particle Density ─────────────────────────
  │ Grid: ${nx}×${ny}×${nz} (${nx * ny * nz} cells)
  │ Fluid Cells: ${fluidCells} | Particles: ${particleCount}
  │ Particles/Cell: ${particlesPerCell.toFixed(2)} (target: 8) ${densityStatus}
  │
  ├─ Pre-Projection Divergence ─────────────────
  │ Max: ${maxDivergence.toFixed(2)} | Avg: ${avgDivergence.toFixed(2)}
  │ (Input to solver; post-solve ~100x lower)
  │ Status: ${divergenceStatus}
  │
  ├─ Velocity Field ───────────────────────────
  │ Max: ${maxVelocity.toFixed(2)} | Avg: ${avgVelocity.toFixed(2)} (units/s)
  │ Status: ${velocityStatus}
  │
  ├─ Surface SDF ──────────────────────────────
  │ Inside (SDF<0): ${sdfInsideCount} | Outside (SDF>0): ${sdfOutsideCount}
  │ Expected: Inside=${fluidCells}, Outside=${nx * ny * nz - fluidCells}
  │ SDF Range: [${minSDF.toFixed(2)}, ${maxSDF.toFixed(2)}]
  │ Surface Cells (|SDF|<1): ${surfaceCells}
  │ JFA Status: ${jfaWorking ? '✓ Propagated' : '⚠ Not propagated (values still ±1000)'}
  │ Status: ${sdfStatus}
  │
  ├─ Surface Normals (∇SDF) ─────────────────
  │ Sampled: ${normalSampleCount} surface cells
  │ Gradient Mag: [${normalMagMin.toFixed(2)}, ${normalMagMax.toFixed(2)}] avg=${normalMagAvg.toFixed(2)}
  │ (Expected: ~1.0 for proper distance field)
  │ Degenerate (<0.1 or >2.0): ${degenerateNormals} (${degeneratePercent}%)
  │ Status: ${normalStatus}
  │
  ├─ Emission Potentials ───────────────────
  │ Active Cells: ${activeCells} (near surface with potential > 0)
  │ Trapped Air (Ita): [${itaCount > 0 ? itaMin.toFixed(2) : '0'}, ${itaMax.toFixed(2)}] avg=${itaAvg.toFixed(2)} (${itaCount} cells)
  │ Wave Crest (Iwc):  [${iwcCount > 0 ? iwcMin.toFixed(2) : '0'}, ${iwcMax.toFixed(2)}] avg=${iwcAvg.toFixed(2)} (${iwcCount} cells)
  │ Kinetic (Ike):     [${ikeCount > 0 ? ikeMin.toFixed(2) : '0'}, ${ikeMax.toFixed(2)}] avg=${ikeAvg.toFixed(2)} (${ikeCount} cells)
  │ Status: ${emissionStatus}
  └────────────────────────────────────────────`);

    isDiagnosticPending = false;
  }

  // Generate sphere geometry (2 iterations) for G-buffer - good balance of quality and performance
  const sphereGeom = generateSphereGeometry(2);
  const sphereVertexBuffer = device.createBuffer({
    size: sphereGeom.vertices.byteLength,
    usage: GPUBufferUsage.VERTEX,
    mappedAtCreation: true,
  });
  new Float32Array(sphereVertexBuffer.getMappedRange()).set(
    sphereGeom.vertices
  );
  sphereVertexBuffer.unmap();

  const sphereNormalBuffer = device.createBuffer({
    size: sphereGeom.normals.byteLength,
    usage: GPUBufferUsage.VERTEX,
    mappedAtCreation: true,
  });
  new Float32Array(sphereNormalBuffer.getMappedRange()).set(sphereGeom.normals);
  sphereNormalBuffer.unmap();

  const sphereIndexBuffer = device.createBuffer({
    size: sphereGeom.indices.byteLength,
    usage: GPUBufferUsage.INDEX,
    mappedAtCreation: true,
  });
  new Uint16Array(sphereIndexBuffer.getMappedRange()).set(sphereGeom.indices);
  sphereIndexBuffer.unmap();

  // Generate low-poly sphere geometry (1 iteration) for AO pass - soft effect doesn't need detail
  const aoSphereGeom = generateSphereGeometry(1);
  const aoSphereVertexBuffer = device.createBuffer({
    size: aoSphereGeom.vertices.byteLength,
    usage: GPUBufferUsage.VERTEX,
    mappedAtCreation: true,
  });
  new Float32Array(aoSphereVertexBuffer.getMappedRange()).set(
    aoSphereGeom.vertices
  );
  aoSphereVertexBuffer.unmap();

  const aoSphereIndexBuffer = device.createBuffer({
    size: aoSphereGeom.indices.byteLength,
    usage: GPUBufferUsage.INDEX,
    mappedAtCreation: true,
  });
  new Uint16Array(aoSphereIndexBuffer.getMappedRange()).set(
    aoSphereGeom.indices
  );
  aoSphereIndexBuffer.unmap();

  // Shadow map dimensions
  const SHADOW_MAP_SIZE = 1024;

  const resources = new RenderResources(
    device,
    presentationFormat,
    canvas.width,
    canvas.height,
    SHADOW_MAP_SIZE
  );

  // Scene configuration (Unity-style)
  const sceneConfig: SceneConfig = {
    dirToSun: [-0.83, 0.42, -0.36],
    floorY: 0.0, // Floor at bottom of simulation
    skyColorHorizon: [1.0, 1.0, 1.0],
    sunPower: 500.0,
    skyColorZenith: [0.08, 0.37, 0.73],
    sunBrightness: 1.0,
    skyColorGround: [0.55, 0.5, 0.55],
    floorSize: 100.0,
    tileCol1: [0.20392157, 0.5176471, 0.7764706], // Light Blue
    tileScale: 1.0,
    tileCol2: [0.6081319, 0.36850303, 0.8584906], // Purple
    tileDarkFactor: -0.35,
    tileCol3: [0.3019758, 0.735849, 0.45801795], // Green
    tileCol4: [0.8018868, 0.6434483, 0.36690104], // Yellow/Brown
  };

  const guiApi = createGui({
    simConfig,
    sceneConfig,
    maxParticles: MAX_PARTICLES,
    onParticleSpawnRequested: () => {
      spawnParticles();
    },
    onWorkgroupSizeChanged: () => {
      // Recreate pipelines with new workgroup size
      simulator.updateWorkgroupSize(simConfig.particleWorkgroupSize);
    },
  });
  const guiState = guiApi.guiState;

  // Calculate light matrices (aligned with scene sun direction)
  const sunDir = sceneConfig.dirToSun;
  const lightDistance = 50.0;
  const lightPos = [
    sunDir[0] * lightDistance,
    sunDir[1] * lightDistance,
    sunDir[2] * lightDistance,
  ];

  const lightViewMatrix = Utilities.makeLookAtMatrix(
    new Float32Array(16),
    lightPos,
    [0, 0, 0], // Look at floor center
    [0.0, 1.0, 0.0] // Standard Y-up for slanted light
  );

  // Orthographic projection covering the simulation area from the light's POV
  const orthoSize = 40.0;
  const lightProjectionMatrix = Utilities.makeOrthographicMatrixWebGPU(
    new Float32Array(16),
    -orthoSize,
    orthoSize,
    -orthoSize,
    orthoSize,
    0.1,
    lightDistance * 2.0
  );
  const lightProjectionViewMatrix = new Float32Array(16);
  Utilities.premultiplyMatrix(
    lightProjectionViewMatrix,
    lightViewMatrix,
    lightProjectionMatrix
  );

  const gBufferPass = new GBufferPass(
    device,
    particlePositionBuffer,
    particleVelocityBuffer
  );
  const shadowPass = new ShadowPass(device, particlePositionBuffer);
  const aoPass = new AOPass(
    device,
    particlePositionBuffer,
    resources.linearSampler
  );
  const compositePass = new CompositePass(
    device,
    presentationFormat,
    resources.linearSampler,
    resources.shadowSampler
  );
  const fxaaPass = new FXAAPass(
    device,
    presentationFormat,
    resources.linearSampler
  );

  function updateSizeDependentBindings() {
    aoPass.updateSizeDependentBindings(resources.gBufferView);
    compositePass.updateSizeDependentBindings(
      resources.gBufferView,
      resources.occlusionView,
      resources.shadowDepthView
    );
    fxaaPass.updateSizeDependentBindings(resources.compositingView);
  }
  updateSizeDependentBindings();

  let particleCount = 0;
  function spawnParticles() {
    // Rebuild particle state from current box layout + target count.
    // Positions/velocities are rewritten from scratch.
    const positions = new Float32Array(MAX_PARTICLES * 4);
    const velocities = new Float32Array(MAX_PARTICLES * 4);
    const positionScale = getPositionScale();

    if (boxEditor.boxes.length > 0) {
      particleCount = Math.min(simConfig.particleCount, MAX_PARTICLES);

      // Calculate total volume of all boxes in world space
      let totalBoxVolumeWorld = 0;
      for (const box of boxEditor.boxes) {
        totalBoxVolumeWorld += box.computeVolume();
      }

      // Natural packing: we want particles to be ~spacingFactor*radius apart in world space
      const naturalSpacingWorld =
        simConfig.spacingFactor * simConfig.particleRadius;
      const naturalVolumeWorld =
        particleCount * Math.pow(naturalSpacingWorld, 3);

      // Fill ratio determines how much of the user's boxes we fill to maintain this density
      const fillRatio = Math.min(1.0, naturalVolumeWorld / totalBoxVolumeWorld);
      const linearFillRatio = Math.pow(fillRatio, 1 / 3);

      console.log(
        `Spawning ${particleCount} particles (S: ${positionScale.toFixed(3)}, Fill: ${(fillRatio * 100).toFixed(1)}%)`
      );

      let particlesCreated = 0;
      for (let boxIdx = 0; boxIdx < boxEditor.boxes.length; boxIdx++) {
        const box = boxEditor.boxes[boxIdx];
        const boxVolumeWorld = box.computeVolume();

        let particlesInBox: number;
        if (boxIdx < boxEditor.boxes.length - 1) {
          particlesInBox = Math.floor(
            (particleCount * boxVolumeWorld) / totalBoxVolumeWorld
          );
        } else {
          particlesInBox = particleCount - particlesCreated;
        }

        // Center the spawning volume within each box
        const boxW = box.max[0] - box.min[0];
        const boxH = box.max[1] - box.min[1];
        const boxD = box.max[2] - box.min[2];

        const spawnW = boxW * linearFillRatio;
        const spawnH = boxH * linearFillRatio;
        const spawnD = boxD * linearFillRatio;

        const offX = (boxW - spawnW) / 2;
        const offY = 0; // Always start from bottom
        const offZ = (boxD - spawnD) / 2;

        const cellsTarget = Math.pow(particlesInBox, 1 / 3);
        const nx = Math.max(
          1,
          Math.round(cellsTarget * Math.pow(spawnW / spawnH, 1 / 3))
        );
        const ny = Math.max(
          1,
          Math.round(cellsTarget * Math.pow(spawnH / spawnD, 1 / 3))
        );
        const nz = Math.max(1, Math.ceil(particlesInBox / (nx * ny)));

        for (let i = 0; i < particlesInBox; i++) {
          const idx = particlesCreated + i;
          const ix = i % nx;
          const iy = Math.floor(i / nx) % ny;
          const iz = Math.floor(i / (nx * ny));

          // Jittered grid position in world space
          const px =
            box.min[0] +
            offX +
            (ix + 0.5 + (Math.random() - 0.5) * 0.5) * (spawnW / nx);
          const py =
            box.min[1] +
            offY +
            (iy + 0.5 + (Math.random() - 0.5) * 0.5) * (spawnH / ny);
          const pz =
            box.min[2] +
            offZ +
            (iz + 0.5 + (Math.random() - 0.5) * 0.5) * (spawnD / nz);

          // Map to simulation space: WorldPos - ContainerOffset
          positions[idx * 4 + 0] = px - getSimOffsetX();
          positions[idx * 4 + 1] = py - getSimOffsetY();
          positions[idx * 4 + 2] = pz - getSimOffsetZ();
          positions[idx * 4 + 3] = 1.0;

          velocities[idx * 4 + 0] = 0.0;
          velocities[idx * 4 + 1] = 0.0;
          velocities[idx * 4 + 2] = 0.0;
          velocities[idx * 4 + 3] = 0.0;
        }
        particlesCreated += particlesInBox;
      }

      device.queue.writeBuffer(particlePositionBuffer, 0, positions);
      device.queue.writeBuffer(particleVelocityBuffer, 0, velocities);
    }

    guiApi.setParticleCountDisplay(particleCount);
  }

  spawnParticles();

  // Update reset callback now that spawnParticles is defined.
  guiApi.setResetHandler(() => {
    spawnParticles();
    console.log('Simulation reset');
  });

  // --- End Particle Setup ---

  const projectionMatrix = new Float32Array(16);
  const FOV = Math.PI / 3;

  function updateProjectionMatrix() {
    const aspect = canvas.width / canvas.height;
    Utilities.makePerspectiveMatrix(projectionMatrix, FOV, aspect, 0.1, 100.0);
  }
  updateProjectionMatrix();

  const mouseInteraction = new MouseInteractionController(canvas, camera);

  console.log('WebGPU Initialized with Particles');

  /**
   * Main render/simulation loop.
   *
   * Executes every frame via requestAnimationFrame:
   * 1. Smooth container dimensions to prevent pressure shocks
   * 2. Run FLIP simulation (if not paused)
   * 3. Render particles via deferred pipeline
   * 4. Present to screen
   */
  function frame() {
    guiApi.stats.begin();
    let commandEncoder = device.createCommandEncoder();

    // =========================================================================
    // SMOOTH CONTAINER TRANSITIONS
    // =========================================================================
    // When the user changes container size via GUI, we don't apply it instantly.
    // Abrupt size changes cause pressure spikes as particles suddenly compress.
    // Instead, we lerp smoothly toward the target dimensions.
    const lerpSpeed = 0.1;
    smoothConfig.boxWidth +=
      (simConfig.boxWidth - smoothConfig.boxWidth) * lerpSpeed;
    smoothConfig.boxHeight +=
      (simConfig.boxHeight - smoothConfig.boxHeight) * lerpSpeed;
    smoothConfig.boxDepth +=
      (simConfig.boxDepth - smoothConfig.boxDepth) * lerpSpeed;

    // Solver reads these values from uniforms each dispatch.
    simulator.gridWidth = getInternalGridWidth();
    simulator.gridHeight = getInternalGridHeight();
    simulator.gridDepth = getInternalGridDepth();

    // Keep vertical cell size approximately constant as height changes.
    // This avoids artificial flattening when only container height increases.
    const desiredNy = Math.max(
      1,
      Math.min(
        RESOLUTION_Y_MAX,
        Math.round(
          (smoothConfig.boxHeight / BASE_BOX_HEIGHT) * RESOLUTION_Y_BASE
        )
      )
    );
    simulator.ny = desiredNy;

    const interaction = mouseInteraction.sample(FOV, [
      getSimOffsetX(),
      getSimOffsetY(),
      getSimOffsetZ(),
    ]);
    const viewMatrix = interaction.viewMatrix;
    const inverseViewMatrix = interaction.inverseViewMatrix;

    // =========================================================================
    // COMPUTE PASS: FLIP Fluid Simulation
    // =========================================================================
    // Runs the 12-step FLIP simulation loop on the GPU.
    // All particle physics happens here before rendering.
    if (!guiState.paused) {
      const computePass = commandEncoder.beginComputePass();

      // -----------------------------------------------------------------------
      // Target Density Calculation
      // -----------------------------------------------------------------------
      // The "target density" controls how compressed particles are allowed to be.
      // It's derived from:
      //   - cellVolume: The physical volume of a single grid cell (dx * dy * dz)
      //   - targetSpacing: How far apart particles "want" to be in world units
      //
      // When density exceeds target, the pressure solver adds artificial
      // divergence to push particles apart, preventing unnatural clustering.
      const dx = smoothConfig.boxWidth / RESOLUTION_X;
      const dy = smoothConfig.boxHeight / simulator.ny;
      const dz = smoothConfig.boxDepth / RESOLUTION_Z;
      const cellVolume = dx * dy * dz;

      const targetSpacing = simConfig.spacingFactor * simConfig.particleRadius;
      const targetDensity = Math.max(
        0.5,
        Math.min(500.0, cellVolume / Math.pow(targetSpacing, 3.0))
      );

      simulator.step(
        computePass,
        particleCount,
        simConfig.fluidity,
        simConfig.gravity,
        targetDensity,
        simConfig.jacobiIterations,
        simConfig.useRedBlackGS, // Use Red-Black Gauss-Seidel for ~2x faster convergence
        interaction.mouseVelocity,
        interaction.simMouseRayOrigin,
        interaction.worldSpaceMouseRay
      );
      computePass.end();

      // Submit simulation work before running JFA (JFA needs initSDF to be complete)
      device.queue.submit([commandEncoder.finish()]);

      // Run JFA to propagate SDF distances (separate submissions for uniform updates)
      simulator.runJFA();

      // Compute whitewater emission potentials (Ita, Iwc, Ike)
      simulator.computeEmissionPotentials();

      // Create new command encoder for rendering passes
      commandEncoder = device.createCommandEncoder();
    }

    if (particleCount > 0) {
      // Update particle radius and offsets from current config
      const currentSimOffsetX = getSimOffsetX();
      const currentSimOffsetY = getSimOffsetY();
      const currentSimOffsetZ = getSimOffsetZ();
      const simOffset: [number, number, number] = [
        currentSimOffsetX,
        currentSimOffsetY,
        currentSimOffsetZ,
      ];

      gBufferPass.record({
        encoder: commandEncoder,
        projectionMatrix,
        viewMatrix,
        particleRadius: simConfig.particleRadius,
        simOffset,
        particleCount,
        colorView: resources.gBufferView,
        depthView: resources.depthView,
        sphereVertexBuffer,
        sphereNormalBuffer,
        sphereIndexBuffer,
        sphereIndexCount: sphereGeom.indices.length,
      });

      shadowPass.record({
        encoder: commandEncoder,
        lightProjectionViewMatrix,
        particleRadius: simConfig.particleRadius,
        simOffset,
        particleCount,
        depthView: resources.shadowDepthView,
        sphereVertexBuffer: aoSphereVertexBuffer,
        sphereIndexBuffer: aoSphereIndexBuffer,
        sphereIndexCount: aoSphereGeom.indices.length,
      });

      aoPass.record({
        encoder: commandEncoder,
        projectionMatrix,
        viewMatrix,
        width: canvas.width,
        height: canvas.height,
        fov: FOV,
        particleRadius: simConfig.particleRadius,
        simOffset,
        particleCount,
        colorView: resources.occlusionView,
        depthView: resources.depthView,
        sphereVertexBuffer: aoSphereVertexBuffer,
        sphereIndexBuffer: aoSphereIndexBuffer,
        sphereIndexCount: aoSphereGeom.indices.length,
      });

      compositePass.record({
        encoder: commandEncoder,
        inverseViewMatrix,
        lightProjectionViewMatrix,
        width: canvas.width,
        height: canvas.height,
        fov: FOV,
        shadowMapSize: SHADOW_MAP_SIZE,
        cameraPosition: camera.getPosition(),
        sceneConfig,
        targetView: resources.compositingView,
      });

      // ============ 4.1 WIREFRAME PASS ============
      // Optional debug/authoring overlay for container bounds.
      if (simConfig.showWireframe) {
        const wireframePass = commandEncoder.beginRenderPass({
          colorAttachments: [
            {
              view: resources.compositingView,
              loadOp: 'load',
              storeOp: 'store',
            },
          ],
          depthStencilAttachment: {
            view: resources.depthView,
            depthLoadOp: 'load',
            depthStoreOp: 'store',
          },
        });
        boxEditor.draw(
          wireframePass,
          projectionMatrix,
          camera,
          [currentSimOffsetX, currentSimOffsetY, currentSimOffsetZ],
          [smoothConfig.boxWidth, smoothConfig.boxHeight, smoothConfig.boxDepth]
        );
        wireframePass.end();
      }

      fxaaPass.record({
        encoder: commandEncoder,
        width: canvas.width,
        height: canvas.height,
        targetView: context.getCurrentTexture().createView(),
      });
    } else {
      // No particles - just clear
      const passEncoder = commandEncoder.beginRenderPass({
        colorAttachments: [
          {
            view: context.getCurrentTexture().createView(),
            clearValue: { r: 0.9, g: 0.9, b: 0.9, a: 1.0 },
            loadOp: 'clear',
            storeOp: 'store',
          },
        ],
      });
      passEncoder.end();
    }

    device.queue.submit([commandEncoder.finish()]);
    guiApi.stats.end();
    guiApi.stats.update();

    // Run physics diagnostic periodically
    // Wait until frame 10 for simulation to stabilize, then every 60 frames
    diagnosticFrameCount++;
    if (
      diagnosticFrameCount === 10 ||
      diagnosticFrameCount % DIAGNOSTIC_INTERVAL === 0
    ) {
      runPhysicsDiagnostic();
    }

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);

  window.addEventListener('resize', () => {
    canvas.width = window.innerWidth * devicePixelRatio;
    canvas.height = window.innerHeight * devicePixelRatio;
    resources.resize(canvas.width, canvas.height);
    updateSizeDependentBindings();
    updateProjectionMatrix();
  });
}

init();
