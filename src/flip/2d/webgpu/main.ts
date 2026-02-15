/**
 * FLIP Fluid Simulation - WebGPU Implementation
 *
 * Main entry point that wires together all components:
 * - WebGPU initialization
 * - FlipFluid simulation (CPU)
 * - GPU rendering
 * - User interaction
 * - UI controls
 */

import { initWebGPU } from './webgpu_utils';
import { createScene, SceneConfig } from './scene';
import { FlipFluid } from './flip_fluid';
import { FlipRenderer } from './renderer';
import { Interaction } from './interaction';

/**
 * Setup the fluid simulation with dam break initial conditions.
 */
function setupFluid(simWidth: number, simHeight: number): FlipFluid {
  const res = 100;
  const tankHeight = simHeight;
  const tankWidth = simWidth;
  const h = tankHeight / res;
  const density = 1000.0;

  const relWaterHeight = 0.8;
  const relWaterWidth = 0.6;

  // Particle radius relative to cell size
  const r = 0.3 * h;
  const dx = 2.0 * r;
  const dy = (Math.sqrt(3.0) / 2.0) * dx;

  // Compute number of particles for dam break
  const numX = Math.floor((relWaterWidth * tankWidth - 2.0 * h - 2.0 * r) / dx);
  const numY = Math.floor(
    (relWaterHeight * tankHeight - 2.0 * h - 2.0 * r) / dy
  );
  const maxParticles = numX * numY;

  // Create fluid
  const fluid = new FlipFluid(density, tankWidth, tankHeight, h, r, maxParticles);

  // Place particles in dam-break configuration (hexagonal packing)
  fluid.numParticles = numX * numY;
  let p = 0;
  for (let i = 0; i < numX; i++) {
    for (let j = 0; j < numY; j++) {
      fluid.particlePos[p++] = h + r + dx * i + (j % 2 === 0 ? 0.0 : r);
      fluid.particlePos[p++] = h + r + dy * j;
    }
  }

  // Setup boundary cells (solid walls)
  const n = fluid.fNumY;
  for (let i = 0; i < fluid.fNumX; i++) {
    for (let j = 0; j < fluid.fNumY; j++) {
      let s = 1.0; // fluid
      if (i === 0 || i === fluid.fNumX - 1 || j === 0) {
        s = 0.0; // solid
      }
      fluid.s[i * n + j] = s;
    }
  }

  return fluid;
}

/**
 * Update obstacle cells in the grid based on obstacle position.
 */
function setObstacle(
  fluid: FlipFluid,
  x: number,
  y: number,
  vx: number,
  vy: number,
  radius: number
): void {
  const n = fluid.fNumY;

  for (let i = 1; i < fluid.fNumX - 2; i++) {
    for (let j = 1; j < fluid.fNumY - 2; j++) {
      fluid.s[i * n + j] = 1.0; // Reset to fluid

      const dx = (i + 0.5) * fluid.h - x;
      const dy = (j + 0.5) * fluid.h - y;

      if (dx * dx + dy * dy < radius * radius) {
        fluid.s[i * n + j] = 0.0; // Mark as solid
        fluid.u[i * n + j] = vx;
        fluid.u[(i + 1) * n + j] = vx;
        fluid.v[i * n + j] = vy;
        fluid.v[i * n + j + 1] = vy;
      }
    }
  }
}

/**
 * Setup UI control event handlers.
 */
function setupUIControls(scene: SceneConfig): void {
  const showParticlesEl = document.getElementById(
    'showParticles'
  ) as HTMLInputElement;
  const showGridEl = document.getElementById('showGrid') as HTMLInputElement;
  const compensateDriftEl = document.getElementById(
    'compensateDrift'
  ) as HTMLInputElement;
  const separateParticlesEl = document.getElementById(
    'separateParticles'
  ) as HTMLInputElement;
  const flipRatioEl = document.getElementById('flipRatio') as HTMLInputElement;

  showParticlesEl.addEventListener('change', () => {
    scene.showParticles = showParticlesEl.checked;
  });

  showGridEl.addEventListener('change', () => {
    scene.showGrid = showGridEl.checked;
  });

  compensateDriftEl.addEventListener('change', () => {
    scene.compensateDrift = compensateDriftEl.checked;
  });

  separateParticlesEl.addEventListener('change', () => {
    scene.separateParticles = separateParticlesEl.checked;
  });

  flipRatioEl.addEventListener('input', () => {
    scene.flipRatio = 0.1 * parseInt(flipRatioEl.value);
  });
}

/**
 * Setup mouse, touch, and keyboard event handlers.
 */
function setupEventListeners(
  canvas: HTMLCanvasElement,
  interaction: Interaction,
  scene: SceneConfig,
  simulate: () => void
): void {
  // Mouse events
  canvas.addEventListener('mousedown', (event) => {
    interaction.startDrag(event.clientX, event.clientY);
    scene.paused = false;
  });

  canvas.addEventListener('mouseup', () => {
    interaction.endDrag();
  });

  canvas.addEventListener('mousemove', (event) => {
    interaction.drag(event.clientX, event.clientY);
  });

  // Touch events
  canvas.addEventListener('touchstart', (event) => {
    interaction.startDrag(
      event.touches[0].clientX,
      event.touches[0].clientY
    );
    scene.paused = false;
  });

  canvas.addEventListener('touchend', () => {
    interaction.endDrag();
  });

  canvas.addEventListener(
    'touchmove',
    (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      interaction.drag(event.touches[0].clientX, event.touches[0].clientY);
    },
    { passive: false }
  );

  // Keyboard events
  document.addEventListener('keydown', (event) => {
    switch (event.key) {
      case 'p':
        scene.paused = !scene.paused;
        break;
      case 'm':
        scene.paused = false;
        simulate();
        scene.paused = true;
        break;
    }
  });
}

/**
 * Main application entry point.
 */
async function main(): Promise<void> {
  // Get canvas and set size
  const canvas = document.getElementById('myCanvas') as HTMLCanvasElement;
  canvas.width = window.innerWidth - 40;
  canvas.height = window.innerHeight - 100;
  canvas.focus();

  // Initialize WebGPU
  const webgpu = await initWebGPU(canvas);

  // Compute simulation dimensions
  const simHeight = 3.0;
  const cScale = canvas.height / simHeight;
  const simWidth = canvas.width / cScale;

  // Create scene configuration
  const scene = createScene();

  // Setup fluid simulation
  const fluid = setupFluid(simWidth, simHeight);

  // Create renderer
  const renderer = new FlipRenderer(webgpu, fluid, simWidth, simHeight);

  // Setup interaction
  const interaction = new Interaction(canvas, simHeight, scene.dt);
  interaction.setObstaclePosition(3.0, 2.0);

  // Set initial obstacle
  setObstacle(
    fluid,
    interaction.getObstaclePosition().x,
    interaction.getObstaclePosition().y,
    0,
    0,
    scene.obstacleRadius
  );

  // Simulation function
  const simulate = (): void => {
    const obsPos = interaction.getObstaclePosition();
    const obsVel = interaction.getObstacleVelocity();

    // Update obstacle in grid
    setObstacle(
      fluid,
      obsPos.x,
      obsPos.y,
      obsVel.vx,
      obsVel.vy,
      scene.obstacleRadius
    );

    // Run simulation step
    fluid.simulate(
      scene.dt,
      scene.gravity,
      scene.flipRatio,
      scene.numPressureIters,
      scene.numParticleIters,
      scene.overRelaxation,
      scene.compensateDrift,
      scene.separateParticles,
      obsPos.x,
      obsPos.y,
      scene.obstacleRadius,
      obsVel.vx,
      obsVel.vy
    );
  };

  // Setup event listeners
  setupEventListeners(canvas, interaction, scene, simulate);
  setupUIControls(scene);

  // Main render loop
  function update(): void {
    // Simulate if not paused
    if (!scene.paused) {
      simulate();
      scene.frameNr++;
    }

    // Update GPU buffers from CPU simulation
    renderer.updateBuffers(fluid);

    // Get obstacle position for rendering
    const obsPos = interaction.getObstaclePosition();

    // Render
    renderer.render(
      fluid,
      scene.showParticles,
      scene.showGrid,
      obsPos.x,
      obsPos.y,
      scene.obstacleRadius
    );

    requestAnimationFrame(update);
  }

  // Start the render loop
  update();
}

// Run main
main().catch((error) => {
  console.error('Failed to initialize FLIP simulation:', error);
  document.body.innerHTML = `
    <div style="color: red; padding: 20px;">
      <h2>WebGPU Initialization Failed</h2>
      <p>${error.message}</p>
      <p>Make sure you're using a browser that supports WebGPU (Chrome 113+, Edge 113+, or Firefox Nightly with flags).</p>
    </div>
  `;
});
