/**
 * =============================================================================
 * WebGPU 3D Fluid Simulation - Application Entry Point
 * =============================================================================
 *
 * This is the main entry point for the 3D SPH (Smoothed Particle Hydrodynamics)
 * fluid simulation using WebGPU. It orchestrates the initialization and main
 * loop of the application.
 *
 * ## Responsibilities
 *
 * 1. **Canvas Setup**: Creates and configures the HTML canvas for WebGPU rendering
 * 2. **WebGPU Initialization**: Acquires GPU device and configures the rendering context
 * 3. **Input Handling**: Sets up mouse/touch interactions for camera control and
 *    particle manipulation (push/pull forces)
 * 4. **Animation Loop**: Runs the main simulation/render loop at display refresh rate
 *
 * ## Architecture Overview
 *
 * ```
 * main.ts (this file)
 *    │
 *    ├─► FluidSimulation    (simulation orchestrator)
 *    │      ├─► SimulationBuffers   (GPU memory management)
 *    │      ├─► ComputePipelines    (compute shader pipelines)
 *    │      └─► Renderer            (particle visualization)
 *    │
 *    ├─► OrbitCamera        (3D camera controls)
 *    │
 *    └─► GUI                (lil-gui controls panel)
 * ```
 *
 * ## Input System
 *
 * The input system supports three interaction modes:
 * - **Camera Orbit**: Click and drag on empty space to rotate the camera
 * - **Camera Zoom**: Mouse wheel to zoom in/out
 * - **Particle Interaction**: Click and drag inside the bounding box to push/pull particles
 *   - Left click: Pull (attract particles toward cursor)
 *   - Right click: Push (repel particles away from cursor)
 *
 * Ray casting is used to detect whether the user clicked inside the simulation bounds
 * and to convert 2D screen coordinates to 3D world coordinates for particle interaction.
 *
 * @module main
 */

import './style.css';
import { createConfig } from '../common/config.ts';
import { setupGui } from '../common/gui.ts';
import { FluidSimulation } from './fluid_simulation.ts';
import { OrbitCamera } from '../webgpu_particles/orbit_camera.ts';
import { rayBoxIntersection, vec3Add, vec3Scale } from '../webgpu_particles/math_utils.ts';
import {
  initWebGPU,
  configureContext,
  WebGPUInitError,
} from '../webgpu_particles/webgpu_utils.ts';
import type { InputState, SimConfig } from '../common/types.ts';
import type { RaymarchConfig } from './types.ts';

/**
 * Creates and inserts a canvas element into the application container.
 *
 * The canvas is configured with:
 * - An accessibility label for screen readers
 * - An ID for easy querying
 *
 * @param app - The parent container element for the canvas
 * @returns The created canvas element
 * @throws Error if canvas creation fails
 */
function createCanvas(app: HTMLDivElement): HTMLCanvasElement {
  app.innerHTML =
    '<canvas id="sim-canvas" aria-label="Fluid simulation"></canvas>';
  const canvas = document.querySelector<HTMLCanvasElement>('#sim-canvas');
  if (!canvas) {
    throw new Error('Failed to create canvas element');
  }
  return canvas;
}

/**
 * Sets up all mouse/touch input handlers for camera control and particle interaction.
 *
 * ## Input Modes
 *
 * The input system distinguishes between two modes:
 *
 * 1. **Camera Mode** (clicking outside the bounding box or middle mouse):
 *    - Drag to orbit camera around the scene
 *    - Scroll to zoom in/out
 *
 * 2. **Particle Interaction Mode** (clicking inside the bounding box):
 *    - Left click + drag: Pull force (attracts particles)
 *    - Right click + drag: Push force (repels particles)
 *
 * ## Ray Casting
 *
 * To determine where the user clicked in 3D space:
 * 1. Convert mouse position to Normalized Device Coordinates (NDC)
 * 2. Construct a ray from the camera through the clicked point
 * 3. Test ray intersection with the simulation bounding box
 * 4. If hit, compute the 3D world position on a plane facing the camera
 *
 * @param canvas - The canvas element to attach handlers to
 * @param getInput - Function that returns the current input state (may be undefined during initialization)
 * @param camera - The orbit camera instance for controlling view
 * @param config - Simulation configuration containing bounds size
 */
function setupInputHandlers(
  canvas: HTMLCanvasElement,
  getInput: () => InputState | undefined,
  camera: OrbitCamera,
  config: SimConfig
) {
  // ==========================================================================
  // State Variables
  // ==========================================================================

  /** True when user is dragging to rotate the camera */
  let isDraggingCamera = false;

  /** True when user is interacting with particles (push/pull) */
  let isInteractingParticle = false;

  /** Last mouse X position for calculating drag delta */
  let lastX = 0;

  /** Last mouse Y position for calculating drag delta */
  let lastY = 0;

  // ==========================================================================
  // Ray Casting Utilities
  // ==========================================================================

  /**
   * Constructs a 3D ray from the camera through a screen point.
   *
   * ## Algorithm
   *
   * 1. Convert screen coordinates to NDC (Normalized Device Coordinates):
   *    - NDC X: (screenX / width) * 2 - 1  → [-1, 1]
   *    - NDC Y: -((screenY / height) * 2 - 1) → [-1, 1] (Y is flipped)
   *
   * 2. Calculate the ray direction in world space:
   *    - Use the camera's basis vectors (right, up, forward)
   *    - Apply perspective correction using FOV and aspect ratio
   *    - direction = forward + right * (ndcX * aspect * tan(fov/2)) + up * (ndcY * tan(fov/2))
   *
   * 3. Normalize the direction vector
   *
   * @param clientX - Mouse X position in client coordinates
   * @param clientY - Mouse Y position in client coordinates
   * @returns Ray object with origin (camera position) and normalized direction
   */
  const getRay = (clientX: number, clientY: number) => {
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    // Convert to NDC (Normalized Device Coordinates)
    // NDC ranges from -1 to 1 in both axes
    const nx = (x / rect.width) * 2 - 1;
    const ny = -((y / rect.height) * 2 - 1); // Flip Y (screen Y is down, NDC Y is up)

    // Perspective projection parameters
    const fov = Math.PI / 3; // 60 degrees field of view (matches renderer)
    const tanFov = Math.tan(fov / 2);
    const aspect = canvas.width / canvas.height;

    // Get camera basis vectors in world space
    const { right, up, forward } = camera.basis;

    // Construct ray direction:
    // Start with forward direction, then offset based on where on screen we clicked
    // The offset is scaled by FOV and aspect ratio for perspective-correct ray
    const dir = vec3Add(
      forward,
      vec3Add(
        vec3Scale(right, nx * aspect * tanFov),
        vec3Scale(up, ny * tanFov)
      )
    );

    // Normalize the direction vector
    const len = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z);
    return {
      origin: camera.position,
      dir: { x: dir.x / len, y: dir.y / len, z: dir.z / len },
    };
  };

  /**
   * Calculates the intersection point between a ray and a plane facing the camera.
   *
   * The plane passes through the scene origin (0,0,0) and faces the camera.
   * This is used to convert 2D mouse position to 3D world coordinates for
   * particle interaction.
   *
   * ## Math
   *
   * Plane equation: dot(P - Origin, Normal) = 0
   * Ray equation: P = RayOrigin + t * RayDirection
   *
   * Substituting ray into plane:
   * dot(RayOrigin + t * RayDir - Origin, Normal) = 0
   * t = dot(Origin - RayOrigin, Normal) / dot(RayDir, Normal)
   *
   * @param ray - The ray to intersect with the plane
   * @returns The 3D intersection point, or null if ray is parallel to plane
   */
  const getPlaneIntersection = (ray: { origin: any; dir: any }) => {
    // Use camera forward as the plane normal
    // The plane faces the camera (perpendicular to view direction)
    const N = camera.basis.forward;

    // Calculate denominator: dot(RayDirection, PlaneNormal)
    // If near zero, ray is parallel to plane
    const denom = ray.dir.x * N.x + ray.dir.y * N.y + ray.dir.z * N.z;
    if (Math.abs(denom) < 1e-6) return null;

    // Calculate numerator: dot(PlaneOrigin - RayOrigin, PlaneNormal)
    // Plane origin is at (0,0,0), so this simplifies to -dot(RayOrigin, Normal)
    const O = ray.origin;
    const numer = -(O.x * N.x + O.y * N.y + O.z * N.z);

    // Calculate t parameter (distance along ray)
    const t = numer / denom;

    // Negative t means intersection is behind the camera
    if (t < 0) return null;

    // Calculate intersection point: RayOrigin + t * RayDirection
    return vec3Add(O, vec3Scale(ray.dir, t));
  };

  /**
   * Updates the interaction point in world coordinates based on current mouse position.
   * Called during particle interaction drag.
   *
   * @param event - Mouse event containing current cursor position
   */
  const updateInteraction = (event: MouseEvent) => {
    const input = getInput();
    if (!input) return;

    const ray = getRay(event.clientX, event.clientY);
    const point = getPlaneIntersection(ray);

    if (point) {
      input.worldX = point.x;
      input.worldY = point.y;
      input.worldZ = point.z;
    }
  };

  // ==========================================================================
  // Event Handlers
  // ==========================================================================

  /**
   * Mouse Down Handler
   *
   * Determines whether to start camera rotation or particle interaction
   * based on whether the click is inside the simulation bounds.
   */
  canvas.addEventListener('mousedown', (e) => {
    const input = getInput();
    if (!input) return;

    const ray = getRay(e.clientX, e.clientY);

    // Define the AABB (Axis-Aligned Bounding Box) for ray intersection test
    const boxMin = {
      x: -config.boundsSize.x / 2,
      y: -config.boundsSize.y / 2,
      z: -config.boundsSize.z / 2,
    };
    const boxMax = {
      x: config.boundsSize.x / 2,
      y: config.boundsSize.y / 2,
      z: config.boundsSize.z / 2,
    };

    // Test if the ray intersects the simulation bounds
    const hit = rayBoxIntersection(ray.origin, ray.dir, boxMin, boxMax);

    if (hit && e.button !== 1) {
      // Left click (0) or Right click (2) inside the box → particle interaction
      isInteractingParticle = true;
      updateInteraction(e);

      // Set push/pull based on which mouse button
      if (e.button === 0) input.pull = true; // Left click = attract
      if (e.button === 2) input.push = true; // Right click = repel
    } else {
      // Click outside box or middle mouse → camera control
      isDraggingCamera = true;
      lastX = e.clientX;
      lastY = e.clientY;
    }
  });

  /**
   * Mouse Move Handler
   *
   * Updates either camera rotation or interaction point based on current mode.
   */
  canvas.addEventListener('mousemove', (e) => {
    const input = getInput();
    if (!input) return;

    if (isInteractingParticle) {
      // Update the 3D position for particle forces
      updateInteraction(e);
    } else if (isDraggingCamera) {
      // Calculate mouse movement delta
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;

      // Apply rotation with sensitivity scaling
      const sensitivity = 0.005;
      camera.rotate(-dx * sensitivity, -dy * sensitivity);
    }
  });

  /**
   * Mouse Up Handler
   *
   * Ends the current interaction mode.
   */
  canvas.addEventListener('mouseup', () => {
    const input = getInput();
    if (!input) return;

    if (isInteractingParticle) {
      isInteractingParticle = false;
      input.pull = false;
      input.push = false;
    }
    isDraggingCamera = false;
  });

  /**
   * Mouse Leave Handler
   *
   * Cancels all interactions when cursor leaves the canvas.
   * This prevents "stuck" states where the mouse up event is missed.
   */
  canvas.addEventListener('mouseleave', () => {
    const input = getInput();
    if (!input) return;
    input.pull = false;
    input.push = false;
    isDraggingCamera = false;
    isInteractingParticle = false;
  });

  /**
   * Mouse Wheel Handler
   *
   * Zooms the camera in/out. Passive: false to allow preventDefault.
   */
  canvas.addEventListener(
    'wheel',
    (e) => {
      camera.zoom(e.deltaY * 0.01);
      e.preventDefault(); // Prevent page scrolling
    },
    { passive: false }
  );

  /**
   * Context Menu Handler
   *
   * Prevents the right-click context menu from appearing,
   * allowing right-click to be used for push interaction.
   */
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
}

// =============================================================================
// Application Initialization
// =============================================================================

// Get the application container element
const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Missing #app container');

// Create the rendering canvas
const canvas = createCanvas(app);

// Initialize simulation configuration with default values
const config: RaymarchConfig = {
  ...createConfig(),
  densityTextureRes: 150,
  densityOffset: 200,
  densityMultiplier: 0.05,
  stepSize: 0.02,
  maxSteps: 256,
};

// Simulation instance (initialized asynchronously in main())
let simulation: FluidSimulation | null = null;

// Initialize the orbit camera with default view position
const camera = new OrbitCamera();
camera.radius = 30.0; // Distance from target
camera.theta = Math.PI / 6; // 30 degrees horizontal rotation
camera.phi = Math.PI / 2.5; // ~72 degrees from vertical (looking slightly down)

// Set up the GUI controls panel
const { stats, gui } = setupGui(
  config,
  {
    onReset: () => simulation?.reset(),
    onSmoothingRadiusChange: () => {},
  },
  {
    trackGPU: true, // Enable GPU timing statistics
    title: 'WebGPU 3D Fluid Raymarch',
    githubUrl: 'https://github.com/jeantimex/fluid',
  }
);

const raymarchFolder = gui.addFolder('Raymarch');
raymarchFolder.close();
raymarchFolder
  .add(config, 'densityTextureRes', 32, 256, 1)
  .name('Density Texture Res')
  .onFinishChange(() => simulation?.reset());
raymarchFolder.add(config, 'densityOffset', 0, 400, 1).name('Density Offset');
raymarchFolder
  .add(config, 'densityMultiplier', 0.0, 0.2, 0.001)
  .name('Density Multiplier');
raymarchFolder.add(config, 'stepSize', 0.005, 0.1, 0.001).name('Step Size');
raymarchFolder.add(config, 'maxSteps', 32, 512, 1).name('Max Steps');

/**
 * Main Application Entry Point
 *
 * Initializes WebGPU, creates the simulation, sets up event handlers,
 * and starts the main animation loop.
 *
 * ## Initialization Sequence
 *
 * 1. Initialize WebGPU (device, context, format)
 * 2. Configure the canvas context for rendering
 * 3. Create the FluidSimulation instance
 * 4. Set up input handlers for camera and particle interaction
 * 5. Set up window resize handler
 * 6. Start the animation loop
 *
 * ## Animation Loop
 *
 * Each frame:
 * 1. Calculate delta time (capped at 33ms to prevent instability)
 * 2. Run simulation step (may include multiple substeps)
 * 3. Render the current state
 * 4. Update stats display
 * 5. Request next frame
 */
async function main() {
  let device: GPUDevice;
  let context: GPUCanvasContext;
  let format: GPUTextureFormat;

  // -------------------------------------------------------------------------
  // WebGPU Initialization
  // -------------------------------------------------------------------------

  try {
    ({ device, context, format } = await initWebGPU(canvas));
  } catch (error) {
    if (error instanceof WebGPUInitError) {
      // Display user-friendly error message for WebGPU issues
      app!.innerHTML = `<p>${error.message}</p>`;
      return;
    }
    throw error;
  }

  // Configure the canvas context with the acquired device
  configureContext(context, device, format);

  // -------------------------------------------------------------------------
  // Simulation Setup
  // -------------------------------------------------------------------------

  simulation = new FluidSimulation(device, context, canvas, config, format);

  // Set up input handlers (camera control + particle interaction)
  setupInputHandlers(
    canvas,
    () => simulation?.simulationState.input,
    camera,
    config
  );

  // -------------------------------------------------------------------------
  // Window Resize Handling
  // -------------------------------------------------------------------------

  /**
   * Handles window resize events.
   * Updates canvas dimensions and reconfigures the WebGPU context.
   */
  window.addEventListener('resize', () => {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    configureContext(context, device, format);
  });

  // Set initial canvas size
  const dpr = window.devicePixelRatio || 1;
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  configureContext(context, device, format);

  // -------------------------------------------------------------------------
  // Animation Loop
  // -------------------------------------------------------------------------

  /** Timestamp of the last frame for delta time calculation */
  let lastTime = performance.now();

  /**
   * Main animation loop callback.
   * Called by requestAnimationFrame at display refresh rate (typically 60Hz).
   *
   * @param now - Current timestamp in milliseconds
   */
  const frame = async (now: number) => {
    stats.begin(); // Start frame timing

    // Calculate delta time in seconds
    // Cap at 33ms (~30 FPS minimum) to prevent instability from large time steps
    const dt = Math.min(0.033, (now - lastTime) / 1000);
    lastTime = now;

    if (simulation) {
      // Run physics simulation step(s)
      await simulation.step(dt);

      // Render the current state with the camera transform
      simulation.render(camera);
    }

    stats.end(); // End frame timing
    stats.update(); // Update FPS display

    // Schedule next frame
    requestAnimationFrame(frame);
  };

  // Start the animation loop
  requestAnimationFrame(frame);
}

// Launch the application
main();
