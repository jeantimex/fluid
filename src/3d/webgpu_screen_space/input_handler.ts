/**
 * =============================================================================
 * Input Handler - Mouse/Touch Input for Camera and Particle Interaction
 * =============================================================================
 *
 * Handles all user input for the simulation:
 * - **Camera Orbit**: Click and drag on empty space to rotate the camera
 * - **Camera Zoom**: Mouse wheel to zoom in/out
 * - **Particle Interaction**: Click and drag inside the bounding box to push/pull particles
 *   - Left click: Pull (attract particles toward cursor)
 *   - Right click: Push (repel particles away from cursor)
 *
 * Ray casting is used to detect whether the user clicked inside the simulation bounds
 * and to convert 2D screen coordinates to 3D world coordinates for particle interaction.
 *
 * @module input_handler
 */

import { rayBoxIntersection, vec3Add, vec3Scale } from './math_utils.ts';
import type { OrbitCamera } from './orbit_camera.ts';
import type { InputState, SimConfig } from '../common_old/types.ts';

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
export function setupInputHandlers(
  canvas: HTMLCanvasElement,
  getInput: () => InputState | undefined,
  camera: OrbitCamera,
  config: SimConfig
): void {
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
