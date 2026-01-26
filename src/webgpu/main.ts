import './style.css';
import GUI from 'lil-gui';
import Stats from 'stats-gl';
import { createConfig } from '../canvas2d/config.ts';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) {
  throw new Error('Missing #app container');
}

app.innerHTML = '<canvas id="sim-canvas" aria-label="Fluid simulation"></canvas>';

const canvas = document.querySelector<HTMLCanvasElement>('#sim-canvas');
if (!canvas) {
  throw new Error('Missing canvas element');
}

const gui = new GUI({ title: 'Simulation Settings' });
const stats = new Stats({ trackGPU: false, horizontal: true });
stats.dom.style.display = 'none';
document.body.appendChild(stats.dom);

const uiState = { showStats: false };
const config = createConfig();

const particlesFolder = gui.addFolder('Particles');
particlesFolder
  .add(config, 'spawnDensity', 10, 300, 1)
  .name('Spawn Density');
particlesFolder.add(config, 'gravity', -30, 30, 0.1).name('Gravity');
particlesFolder
  .add(config, 'collisionDamping', 0, 1, 0.01)
  .name('Collision Damping');
particlesFolder
  .add(config, 'smoothingRadius', 0.05, 3, 0.01)
  .name('Smoothing Radius');
particlesFolder.add(config, 'targetDensity', 0, 3000, 1).name('Target Density');
particlesFolder
  .add(config, 'pressureMultiplier', 0, 2000, 1)
  .name('Pressure Multiplier');
particlesFolder
  .add(config, 'nearPressureMultiplier', 0, 40, 0.1)
  .name('Near Pressure Multiplier');
particlesFolder
  .add(config, 'viscosityStrength', 0, 0.2, 0.001)
  .name('Viscosity Strength');
particlesFolder.add(config, 'particleRadius', 1, 6, 1).name('Particle Radius');

const obstacleFolder = gui.addFolder('Obstacle');
obstacleFolder.close();
obstacleFolder.add(config.obstacleSize, 'x', 0, 20, 0.01).name('Size X');
obstacleFolder.add(config.obstacleSize, 'y', 0, 20, 0.01).name('Size Y');
obstacleFolder
  .add(config.obstacleCentre, 'x', -10, 10, 0.01)
  .name('Center X');
obstacleFolder
  .add(config.obstacleCentre, 'y', -10, 10, 0.01)
  .name('Center Y');

const interactionFolder = gui.addFolder('Interaction');
interactionFolder.close();
interactionFolder
  .add(config, 'interactionRadius', 0, 10, 0.01)
  .name('Radius');
interactionFolder
  .add(config, 'interactionStrength', 0, 200, 1)
  .name('Strength');

const performanceFolder = gui.addFolder('Performance');
performanceFolder.close();
performanceFolder.add(config, 'timeScale', 0, 2, 0.01).name('Time Scale');
performanceFolder
  .add(config, 'maxTimestepFPS', 0, 120, 1)
  .name('Max Timestep FPS');
performanceFolder
  .add(config, 'iterationsPerFrame', 1, 8, 1)
  .name('Iterations Per Frame');
performanceFolder
  .add(uiState, 'showStats')
  .name('Show FPS')
  .onChange((value: boolean) => {
    stats.dom.style.display = value ? 'block' : 'none';
  });

async function initWebGPU(): Promise<void> {
  if (!navigator.gpu) {
    app.innerHTML = '<p>WebGPU is not supported in this browser.</p>';
    return;
  }

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    app.innerHTML = '<p>Unable to acquire a WebGPU adapter.</p>';
    return;
  }

  const device = await adapter.requestDevice();
  const context = canvas.getContext('webgpu');
  if (!context) {
    app.innerHTML = '<p>Unable to create a WebGPU context.</p>';
    return;
  }

  const format = navigator.gpu.getPreferredCanvasFormat();

  const resize = (): void => {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const nextWidth = Math.max(1, Math.round(rect.width * dpr));
    const nextHeight = Math.max(1, Math.round(rect.height * dpr));

    if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
      canvas.width = nextWidth;
      canvas.height = nextHeight;
      context.configure({
        device,
        format,
        alphaMode: 'opaque',
      });
    }
  };

  resize();
  window.addEventListener('resize', resize);

  const clearColor = { r: 5 / 255, g: 7 / 255, b: 11 / 255, a: 1 };

  const frame = (): void => {
    stats.begin();
    const encoder = device.createCommandEncoder();
    const view = context.getCurrentTexture().createView();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view,
          clearValue: clearColor,
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });
    pass.end();
    device.queue.submit([encoder.finish()]);
    stats.end();
    stats.update();
    requestAnimationFrame(frame);
  };

  requestAnimationFrame(frame);
}

void initWebGPU();
