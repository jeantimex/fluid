import './style.css';
import { createConfig } from '../common/config.ts';
import { setupGui } from '../common/gui.ts';
import { FluidSimulation } from './fluid_simulation.ts';
import { OrbitCamera } from './orbit_camera.ts';
import { rayBoxIntersection, vec3Add, vec3Scale } from './math_utils.ts';
import {
  initWebGPU,
  configureContext,
  WebGPUInitError,
} from './webgpu_utils.ts';
import type { InputState, SimConfig } from '../common/types.ts';

function createCanvas(app: HTMLDivElement): HTMLCanvasElement {
  app.innerHTML =
    '<canvas id="sim-canvas" aria-label="Fluid simulation"></canvas>';
  const canvas = document.querySelector<HTMLCanvasElement>('#sim-canvas');
  if (!canvas) {
    throw new Error('Failed to create canvas element');
  }
  return canvas;
}

function setupInputHandlers(
  canvas: HTMLCanvasElement,
  getInput: () => InputState | undefined,
  camera: OrbitCamera,
  config: SimConfig
) {
  let isDraggingCamera = false;
  let isInteractingParticle = false;
  let lastX = 0;
  let lastY = 0;

  const getRay = (clientX: number, clientY: number) => {
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    // NDC
    const nx = (x / rect.width) * 2 - 1;
    const ny = -((y / rect.height) * 2 - 1);

    const fov = Math.PI / 3;
    const tanFov = Math.tan(fov / 2);
    const aspect = canvas.width / canvas.height;

    // Ray Dir in Camera Space
    // Right * x * w + Up * y * h + Forward
    // But we have basis vectors.
    const { right, up, forward } = camera.basis;

    // d = Forward + Right * nx * aspect * tanFov + Up * ny * tanFov
    const dir = vec3Add(
      forward,
      vec3Add(
        vec3Scale(right, nx * aspect * tanFov),
        vec3Scale(up, ny * tanFov)
      )
    );

    // Normalize logic is separate/implicit? No, vector math needs normalize.
    // I need to import normalize or implement it.
    const len = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z);
    return {
      origin: camera.position,
      dir: { x: dir.x / len, y: dir.y / len, z: dir.z / len },
    };
  };

  const getPlaneIntersection = (ray: { origin: any; dir: any }) => {
    // Plane passing through 0,0,0 with normal -camera.forward (facing camera)
    // dot(P, N) = 0. P = O + tD.
    // dot(O + tD, N) = 0 => t = -dot(O, N) / dot(D, N)

    // Use camera forward as normal (it points INTO screen, so facing away from camera?
    // Wait, forward is -Z in view space.
    // Camera looks at target. Forward vector in basis is (Target - Eye).
    // So Forward points FROM Eye TO Target.
    // Plane normal should be -Forward (pointing to eye).
    // Or just dot(P - Target, Forward) = 0.
    // Plane passing through Target (0,0,0). Normal = -Forward.

    // dot(O + tD - Target, -Forward) = 0
    // dot(O - Target, -Forward) + t * dot(D, -Forward) = 0
    // t = -dot(O - Target, -Forward) / dot(D, -Forward)
    //   = dot(O - Target, Forward) / dot(D, Forward) (signs cancel)
    //   = dot(O, Forward) / dot(D, Forward) (if Target is 0)

    const N = camera.basis.forward; // Points TO target.
    // Denom = dot(D, N)
    const denom = ray.dir.x * N.x + ray.dir.y * N.y + ray.dir.z * N.z;
    if (Math.abs(denom) < 1e-6) return null;

    const O = ray.origin;
    // Numer = dot(Target - O, N). Target is 0. So -dot(O, N).
    const numer = -(O.x * N.x + O.y * N.y + O.z * N.z);

    const t = numer / denom;
    if (t < 0) return null;

    return vec3Add(O, vec3Scale(ray.dir, t));
  };

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

  canvas.addEventListener('mousedown', (e) => {
    const input = getInput();
    if (!input) return;

    const ray = getRay(e.clientX, e.clientY);

    // Check box intersection
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

    const hit = rayBoxIntersection(ray.origin, ray.dir, boxMin, boxMax);

    if (hit && e.button !== 1) {
      // Left or Right click on box
      isInteractingParticle = true;
      updateInteraction(e);
      if (e.button === 0) input.pull = true;
      if (e.button === 2) input.push = true;
    } else {
      isDraggingCamera = true;
      lastX = e.clientX;
      lastY = e.clientY;
    }
  });

  canvas.addEventListener('mousemove', (e) => {
    const input = getInput();
    if (!input) return;

    if (isInteractingParticle) {
      updateInteraction(e);
    } else if (isDraggingCamera) {
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;

      const sensitivity = 0.005;
      camera.rotate(-dx * sensitivity, -dy * sensitivity);
    }
  });

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

  canvas.addEventListener('mouseleave', () => {
    const input = getInput();
    if (!input) return;
    input.pull = false;
    input.push = false;
    isDraggingCamera = false;
    isInteractingParticle = false;
  });

  canvas.addEventListener(
    'wheel',
    (e) => {
      camera.zoom(e.deltaY * 0.01);
      e.preventDefault();
    },
    { passive: false }
  );

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
}

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Missing #app container');

const canvas = createCanvas(app);
const config = createConfig();
let simulation: FluidSimulation | null = null;
const camera = new OrbitCamera();

const { stats } = setupGui(
  config,
  {
    onReset: () => simulation?.reset(),
    onSmoothingRadiusChange: () => {},
  },
  {
    trackGPU: true,
    title: 'WebGPU 3D Fluid',
    githubUrl: 'https://github.com/jeantimex/fluid',
  }
);

async function main() {
  let device: GPUDevice;
  let context: GPUCanvasContext;
  let format: GPUTextureFormat;

  try {
    ({ device, context, format } = await initWebGPU(canvas));
  } catch (error) {
    if (error instanceof WebGPUInitError) {
      app!.innerHTML = `<p>${error.message}</p>`;
      return;
    }
    throw error;
  }

  configureContext(context, device, format);

  simulation = new FluidSimulation(device, context, canvas, config, format);

  // Setup inputs
  setupInputHandlers(
    canvas,
    () => simulation?.simulationState.input,
    camera,
    config
  );

  window.addEventListener('resize', () => {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    configureContext(context, device, format);
  });
  const dpr = window.devicePixelRatio || 1;
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  configureContext(context, device, format);

  let lastTime = performance.now();

  const frame = async (now: number) => {
    stats.begin();

    const dt = Math.min(0.033, (now - lastTime) / 1000);
    lastTime = now;

    if (simulation) {
      await simulation.step(dt);
      simulation.render(camera.viewMatrix);
    }

    stats.end();
    stats.update();

    requestAnimationFrame(frame);
  };

  requestAnimationFrame(frame);
}

main();
