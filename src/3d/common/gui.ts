import GUI, { Controller } from 'lil-gui';
import Stats from 'stats-gl';
import type { SimConfig } from './types.ts';
import { rgbToHex, hexToRgb } from './color_utils.ts';

function calculateParticleCount(config: SimConfig): number {
  let total = 0;
  for (const region of config.spawnRegions) {
    const volume = region.size.x * region.size.y * region.size.z;
    const targetTotal = Math.ceil(volume * config.spawnDensity);
    total += targetTotal;
  }
  return total;
}

export interface GuiCallbacks {
  onReset: () => void;
  onSmoothingRadiusChange: () => void;
}

export interface GuiOptions {
  trackGPU?: boolean;
  title?: string;
  githubUrl?: string;
}

export interface GuiSetup {
  gui: GUI;
  stats: Stats;
  uiState: { showStats: boolean };
}

export function setupGui(
  config: SimConfig,
  callbacks: GuiCallbacks,
  options: GuiOptions = {},
  parentGui?: GUI,
  parentStats?: Stats
): GuiSetup {
  let gui: GUI;
  let stats: Stats;

  if (parentGui) {
    gui = parentGui;
  } else {
    const container = document.createElement('div');
    container.style.cssText = `
      position: fixed;
      top: 0;
      right: 0;
      z-index: 1000;
    `;
    document.body.appendChild(container);

    if (options.title) {
      const heading = document.createElement('div');
      heading.style.cssText = `
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 11px;
        background: #1a1a1a;
        color: #fff;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 16px;
        font-weight: 600;
        box-sizing: border-box;
      `;

      const titleSpan = document.createElement('span');
      titleSpan.textContent = options.title;
      heading.appendChild(titleSpan);

      if (options.githubUrl) {
        const githubLink = document.createElement('a');
        githubLink.href = options.githubUrl;
        githubLink.target = '_blank';
        githubLink.rel = 'noopener noreferrer';
        githubLink.title = 'View on GitHub';
        githubLink.style.cssText = `
          display: flex;
          align-items: center;
          color: #fff;
          opacity: 0.7;
          transition: opacity 0.2s;
        `;
        githubLink.onmouseenter = () => (githubLink.style.opacity = '1');
        githubLink.onmouseleave = () => (githubLink.style.opacity = '0.7');
        githubLink.innerHTML = `
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
          </svg>
        `;
        heading.appendChild(githubLink);
      }

      container.appendChild(heading);
    }

    gui = new GUI({ container, title: 'Simulation Settings' });
  }

  if (parentStats) {
    stats = parentStats;
  } else {
    stats = new Stats({
      trackGPU: options.trackGPU ?? false,
      horizontal: true,
    });
    stats.dom.style.display = 'block';
    document.body.appendChild(stats.dom);
  }

  const uiState = { showStats: true };

  // Environment Controls
  const envFolder = gui.addFolder('Environment');
  envFolder.close();

  if ('floorAmbient' in config) {
    // Cast config to any to access EnvironmentConfig properties
    // since SimConfig might not explicitly include them in all contexts
    const envConfig = config as any;

    envFolder.add(envConfig, 'floorAmbient', 0, 1, 0.01).name('Ambient Light');
    envFolder.add(envConfig, 'sceneExposure', 0.1, 5, 0.1).name('Exposure');
    envFolder.add(envConfig, 'sunBrightness', 0, 5, 0.1).name('Sun Brightness');
    
    envFolder.add(envConfig, 'debugFloorMode', {
      Normal: 0,
      'Red Hit': 1,
      'Flat Colors': 2,
    }).name('Floor Mode');

    // Tile Colors
    const tileColorState = {
      tileCol1: rgbToHex(envConfig.tileCol1),
      tileCol2: rgbToHex(envConfig.tileCol2),
      tileCol3: rgbToHex(envConfig.tileCol3),
      tileCol4: rgbToHex(envConfig.tileCol4),
    };

    const updateTileColor = (key: string) => (value: string) => {
      const rgb = hexToRgb(value);
      envConfig[key].r = rgb.r / 255;
      envConfig[key].g = rgb.g / 255;
      envConfig[key].b = rgb.b / 255;
    };

    envFolder.addColor(tileColorState, 'tileCol1').name('Tile Color 1').onChange(updateTileColor('tileCol1'));
    envFolder.addColor(tileColorState, 'tileCol2').name('Tile Color 2').onChange(updateTileColor('tileCol2'));
    envFolder.addColor(tileColorState, 'tileCol3').name('Tile Color 3').onChange(updateTileColor('tileCol3'));
    envFolder.addColor(tileColorState, 'tileCol4').name('Tile Color 4').onChange(updateTileColor('tileCol4'));
  }

  const particlesFolder = gui.addFolder('Particles');
  particlesFolder.close();

  const display = { particleCount: calculateParticleCount(config) };

  const updateParticleCount = (): void => {
    display.particleCount = calculateParticleCount(config);
    particleCountController.updateDisplay();
  };

  particlesFolder
    .add(config, 'spawnDensity', 100, 2000, 10)
    .name('Spawn Density')
    .onFinishChange(() => {
      updateParticleCount();
      callbacks.onReset();
    });

  const particleCountController: Controller = particlesFolder
    .add(display, 'particleCount')
    .name('Particle Count')
    .disable();

  particlesFolder.add(config, 'gravity', -30, 30, 1).name('Gravity');

  particlesFolder
    .add(config, 'collisionDamping', 0, 1, 0.01)
    .name('Collision Damping');

  particlesFolder
    .add(config, 'smoothingRadius', 0.05, 1.0, 0.01)
    .name('Smoothing Radius')
    .onChange(() => callbacks.onSmoothingRadiusChange());

  particlesFolder
    .add(config, 'targetDensity', 0, 3000, 10)
    .name('Target Density');

  particlesFolder
    .add(config, 'pressureMultiplier', 0, 2000, 10)
    .name('Pressure Multiplier');

  particlesFolder
    .add(config, 'nearPressureMultiplier', 0, 40, 0.1)
    .name('Near Pressure Multiplier');

  particlesFolder
    .add(config, 'viscosityStrength', 0, 0.5, 0.001)
    .name('Viscosity Strength');

  particlesFolder
    .add(config, 'jitterStr', 0, 0.1, 0.001)
    .name('Jitter Strength')
    .onFinishChange(() => callbacks.onReset());

  const containerFolder = gui.addFolder('Container');
  containerFolder.close();

  containerFolder.add(config.boundsSize, 'x', 1, 50, 0.1).name('Size X');

  containerFolder.add(config.boundsSize, 'y', 1, 50, 0.1).name('Size Y');

  containerFolder.add(config.boundsSize, 'z', 1, 50, 0.1).name('Size Z');

  const obstacleFolder = gui.addFolder('Obstacle');
  obstacleFolder.close();

  obstacleFolder.add(config.obstacleSize, 'x', 0, 10, 0.1).name('Size X');
  obstacleFolder.add(config.obstacleSize, 'y', 0, 10, 0.1).name('Size Y');
  obstacleFolder.add(config.obstacleSize, 'z', 0, 10, 0.1).name('Size Z');

  obstacleFolder.add(config.obstacleCentre, 'x', -10, 10, 0.1).name('Center X');
  obstacleFolder.add(config.obstacleCentre, 'y', -10, 10, 0.1).name('Center Y');
  obstacleFolder.add(config.obstacleCentre, 'z', -10, 10, 0.1).name('Center Z');

  obstacleFolder
    .add(config.obstacleRotation, 'x', -180, 180, 1)
    .name('Rotation X');
  obstacleFolder
    .add(config.obstacleRotation, 'y', -180, 180, 1)
    .name('Rotation Y');
  obstacleFolder
    .add(config.obstacleRotation, 'z', -180, 180, 1)
    .name('Rotation Z');

  if (config.obstacleColor) {
    obstacleFolder.addColor(config, 'obstacleColor').name('Color');
  }

  if (typeof config.obstacleAlpha === 'number') {
    obstacleFolder.add(config, 'obstacleAlpha', 0, 1, 0.01).name('Alpha');
  }

  const interactionFolder = gui.addFolder('Interaction');
  interactionFolder.close();

  interactionFolder.add(config, 'interactionRadius', 0, 2, 0.01).name('Radius');
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

  return { gui, stats, uiState };
}
