import GUI from 'lil-gui';
import Stats from 'stats-gl';
import type { SceneConfig } from '../render/types';

export interface SimulationGuiConfig {
  particleRadius: number;
  spacingFactor: number;
  boxWidth: number;
  boxHeight: number;
  boxDepth: number;
  particleCount: number;
  fluidity: number;
  showWireframe: boolean;
}

export interface GuiApi {
  guiState: {
    paused: boolean;
    showStats: boolean;
  };
  stats: Stats;
  setResetHandler: (handler: () => void) => void;
  setParticleCountDisplay: (count: number) => void;
}

function rgbToHex(rgb: number[]): string {
  const r = Math.round(Math.pow(rgb[0], 1 / 2.2) * 255);
  const g = Math.round(Math.pow(rgb[1], 1 / 2.2) * 255);
  const b = Math.round(Math.pow(rgb[2], 1 / 2.2) * 255);
  return '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

function hexToRgb(hex: string): number[] {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return [0, 0, 0];
  return [
    Math.pow(parseInt(result[1], 16) / 255, 2.2),
    Math.pow(parseInt(result[2], 16) / 255, 2.2),
    Math.pow(parseInt(result[3], 16) / 255, 2.2),
  ];
}

export function createGui(params: {
  simConfig: SimulationGuiConfig;
  sceneConfig: SceneConfig;
  maxParticles: number;
  onParticleSpawnRequested: () => void;
}): GuiApi {
  const guiState = {
    paused: false,
    showStats: false,
  };

  const stats = new Stats({ horizontal: true });
  stats.dom.style.position = 'fixed';
  stats.dom.style.bottom = '0px';
  stats.dom.style.left = '0px';
  stats.dom.style.display = 'none';
  document.body.appendChild(stats.dom);

  if (!document.querySelector('link[href*="Material+Icons"]')) {
    const link = document.createElement('link');
    link.href = 'https://fonts.googleapis.com/icon?family=Material+Icons';
    link.rel = 'stylesheet';
    document.head.appendChild(link);
  }

  const guiStyle = document.createElement('style');
  guiStyle.textContent = `
        #gui-container {
            position: fixed;
            top: 10px;
            right: 10px;
            z-index: 10001;
            background: #1a1a1a;
            color: #fff;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            box-sizing: border-box;
            box-shadow: 0 4px 20px rgba(0,0,0,0.5);
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            width: 280px;
            max-width: calc(100vw - 20px);
            height: auto;
            max-height: calc(100vh - 20px);
            display: flex;
            flex-direction: column;
            user-select: none;
            overflow: hidden;
            border-radius: 8px;
        }
        #gui-container.collapsed {
            width: 44px;
            height: 44px;
            border-radius: 22px;
            cursor: pointer;
        }
        #gui-container.collapsed:hover {
            background: #2a2a2a;
        }
        #gui-container .gui-content-wrapper {
            transition: opacity 0.2s ease;
            opacity: 1;
            display: flex;
            flex-direction: column;
            overflow-y: auto;
            flex-grow: 1;
            scrollbar-width: thin;
            scrollbar-color: rgba(255, 255, 255, 0.2) transparent;
        }
        #gui-container .gui-content-wrapper::-webkit-scrollbar {
            width: 6px;
        }
        #gui-container .gui-content-wrapper::-webkit-scrollbar-thumb {
            background-color: rgba(255, 255, 255, 0.2);
            border-radius: 3px;
        }
        #gui-container.collapsed .gui-content-wrapper {
            opacity: 0;
            pointer-events: none;
            display: none;
        }
        #gui-container .gui-toggle-btn {
            background: none;
            border: none;
            color: white;
            cursor: pointer;
            padding: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            opacity: 0.7;
            transition: opacity 0.2s;
            width: 44px;
            height: 44px;
            flex-shrink: 0;
        }
        #gui-container .gui-toggle-btn:hover {
            opacity: 1;
        }
        #gui-container.collapsed .gui-toggle-btn {
            opacity: 1;
        }
        #gui-container .gui-header-main {
            display: flex;
            align-items: center;
            background: #1a1a1a;
            flex-shrink: 0;
        }
        #gui-container .gui-title-area {
            flex-grow: 1;
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding-right: 11px;
            overflow: hidden;
        }
        #gui-container.collapsed .gui-title-area {
            display: none;
        }
        #gui-container .lil-gui.root,
        #gui-container .lil-gui.lil-root {
            width: 100% !important;
            border: none;
            box-shadow: none;
            background: transparent;
        }
        #gui-container .lil-gui.root > .children,
        #gui-container .lil-gui.lil-root > .children {
            border: none;
        }
        @media (max-width: 480px) {
            #gui-container:not(.collapsed) {
                width: calc(100vw - 20px);
                top: 10px;
                right: 10px;
            }
        }
    `;
  document.head.appendChild(guiStyle);

  const guiContainer = document.createElement('div');
  guiContainer.id = 'gui-container';
  if (window.innerWidth <= 480) {
    guiContainer.classList.add('collapsed');
  }
  document.body.appendChild(guiContainer);

  const headerMain = document.createElement('div');
  headerMain.className = 'gui-header-main';
  guiContainer.appendChild(headerMain);

  const toggleBtn = document.createElement('button');
  toggleBtn.className = 'gui-toggle-btn';
  toggleBtn.innerHTML = '<span class="material-icons">menu</span>';
  headerMain.appendChild(toggleBtn);

  const titleArea = document.createElement('div');
  titleArea.className = 'gui-title-area';
  headerMain.appendChild(titleArea);

  const titleSpan = document.createElement('span');
  titleSpan.style.cssText = `
        font-size: 16px;
        font-weight: 600;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    `;
  titleSpan.textContent = 'WebGPU 3D Fluid';
  titleArea.appendChild(titleSpan);

  const githubLink = document.createElement('a');
  githubLink.href = 'https://github.com/jeantimex/fluid';
  githubLink.target = '_blank';
  githubLink.rel = 'noopener noreferrer';
  githubLink.title = 'View on GitHub';
  githubLink.style.cssText = `
        display: flex;
        align-items: center;
        color: #fff;
        opacity: 0.7;
        transition: opacity 0.2s;
        margin-left: 10px;
    `;
  githubLink.onpointerenter = () => (githubLink.style.opacity = '1');
  githubLink.onpointerleave = () => (githubLink.style.opacity = '0.7');
  githubLink.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
        </svg>
    `;
  titleArea.appendChild(githubLink);

  const contentWrapper = document.createElement('div');
  contentWrapper.className = 'gui-content-wrapper';
  guiContainer.appendChild(contentWrapper);

  const toggleCollapse = (e?: Event) => {
    if (e) e.stopPropagation();
    guiContainer.classList.toggle('collapsed');
  };

  toggleBtn.onclick = toggleCollapse;
  guiContainer.onclick = () => {
    if (guiContainer.classList.contains('collapsed')) {
      guiContainer.classList.remove('collapsed');
    }
  };

  const aboutSection = document.createElement('div');
  aboutSection.className = 'custom-gui-folder';
  aboutSection.style.cssText = `
        border-top: 1px solid rgba(255, 255, 255, 0.1);
        background: rgba(255, 255, 255, 0.02);
    `;

  const aboutHeader = document.createElement('div');
  aboutHeader.className = 'custom-gui-folder-header';
  aboutHeader.style.cssText = `
        display: flex;
        align-items: center;
        padding: 1px;
        cursor: pointer;
        user-select: none;
        font-size: 11px;
        font-weight: 700;
        color: rgba(255, 255, 255, 0.9);
    `;
  aboutHeader.innerHTML = `
        <span class="material-icons folder-arrow" style="
            font-family: 'Material Icons';
            font-size: 16px;
            transition: transform 0.2s;
            transform: rotate(90deg);
            text-transform: none;
        ">chevron_right</span>
        About
    `;

  const aboutContent = document.createElement('div');
  aboutContent.className = 'custom-gui-folder-content';
  aboutContent.style.cssText = `
        overflow: hidden;
        max-height: none;
        transition: max-height 0.3s ease-out;
    `;

  let isAboutOpen = true;
  aboutHeader.onclick = () => {
    if (aboutContent.style.maxHeight === 'none') {
      aboutContent.style.maxHeight = aboutContent.scrollHeight + 'px';
      aboutContent.offsetHeight;
    }

    isAboutOpen = !isAboutOpen;
    const arrow = aboutHeader.querySelector('.folder-arrow') as HTMLElement;
    if (isAboutOpen) {
      arrow.style.transform = 'rotate(90deg)';
      aboutContent.style.maxHeight = aboutContent.scrollHeight + 'px';
    } else {
      arrow.style.transform = 'rotate(0deg)';
      aboutContent.style.maxHeight = '0';
    }
  };

  const subtitle = document.createElement('div');
  subtitle.style.cssText = `
        padding: 5px 11px 5px 11px;
        font-size: 11px;
        font-weight: 400;
        opacity: 0.6;
        line-height: 1.4;
        letter-spacing: 0.01em;
        white-space: normal;
        overflow-wrap: break-word;
        max-width: 220px;
    `;
  subtitle.textContent = 'FLIP Fluid • Particle Simulation';
  aboutContent.appendChild(subtitle);

  const author = document.createElement('div');
  author.style.cssText = `
        padding: 0 11px 10px 11px;
        font-size: 10px;
        font-weight: 400;
        opacity: 1.0;
        letter-spacing: 0.01em;
    `;
  author.innerHTML =
    'Original Author: <a href="https://github.com/dli/fluid" target="_blank" rel="noopener noreferrer" style="color: inherit; text-decoration: underline;">David Li</a>';
  aboutContent.appendChild(author);

  const webgpuAuthor = document.createElement('div');
  webgpuAuthor.style.cssText = `
        padding: 0 11px 10px 11px;
        font-size: 10px;
        font-weight: 400;
        opacity: 1.0;
        letter-spacing: 0.01em;
    `;
  webgpuAuthor.innerHTML =
    'WebGPU Author: <a href="https://github.com/jeantimex" target="_blank" rel="noopener noreferrer" style="color: inherit; text-decoration: underline;">jeantimex</a>';
  aboutContent.appendChild(webgpuAuthor);

  const featContainer = document.createElement('div');
  featContainer.style.cssText = `
        padding: 5px 11px 10px 11px;
        border-top: 1px solid rgba(255, 255, 255, 0.1);
    `;

  const featLabel = document.createElement('div');
  featLabel.style.cssText = `
        font-size: 10px;
        font-weight: 600;
        opacity: 0.8;
        text-transform: uppercase;
        margin-bottom: 4px;
    `;
  featLabel.textContent = 'Features:';
  featContainer.appendChild(featLabel);

  const featList = document.createElement('ul');
  featList.style.cssText = `
        margin: 0;
        padding: 0 0 0 14px;
        font-size: 10px;
        opacity: 0.7;
        line-height: 1.4;
    `;
  const features = [
    'FLIP Fluid Simulator (GPU)',
    'Deferred Rendering Pipeline',
    'Dynamic Shadow Mapping',
    'Screen-Space Ambient Occlusion',
    'FXAA Anti-Aliasing',
    'Mouse Interaction',
  ];
  features.forEach((f) => {
    const li = document.createElement('li');
    li.textContent = f;
    featList.appendChild(li);
  });
  featContainer.appendChild(featList);
  aboutContent.appendChild(featContainer);

  const intContainer = document.createElement('div');
  intContainer.style.cssText = `
        padding: 5px 11px 10px 11px;
        border-top: 1px solid rgba(255, 255, 255, 0.1);
    `;

  const intLabel = document.createElement('div');
  intLabel.style.cssText = `
        font-size: 10px;
        font-weight: 600;
        opacity: 0.8;
        text-transform: uppercase;
        margin-bottom: 4px;
    `;
  intLabel.textContent = 'Interactions:';
  intContainer.appendChild(intLabel);

  const intList = document.createElement('ul');
  intList.style.cssText = `
        margin: 0;
        padding: 0 0 0 14px;
        font-size: 10px;
        opacity: 0.7;
        line-height: 1.4;
    `;
  const interactions = [
    'Click & Drag: Orbit Camera',
    'Mouse Move: Push Particles',
    'Mouse Wheel: Zoom In/Out',
  ];
  interactions.forEach((i) => {
    const li = document.createElement('li');
    li.textContent = i;
    intList.appendChild(li);
  });
  intContainer.appendChild(intList);
  aboutContent.appendChild(intContainer);

  aboutSection.appendChild(aboutHeader);
  aboutSection.appendChild(aboutContent);
  contentWrapper.appendChild(aboutSection);

  const gui = new GUI({
    container: contentWrapper,
    title: 'Simulation Settings',
  });

  const simFolder = gui.addFolder('Simulation');
  const simDisplay = { particleCount: 0 };
  const particleCountController = simFolder
    .add(simDisplay, 'particleCount')
    .name('Particle Count')
    .disable();

  const syncSimulator = () => {
    // Properties are applied by the frame loop for smooth transitions.
  };

  let resetHandler: () => void = () => {};
  let pauseController: GUI['controllers'][0] | null = null;

  const controls = {
    togglePause: () => {
      guiState.paused = !guiState.paused;
      if (pauseController) {
        pauseController.name(guiState.paused ? 'Resume' : 'Pause');
      }
    },
    reset: () => {
      resetHandler();
    },
  };

  simFolder
    .add(params.simConfig, 'particleRadius', 0.05, 0.5, 0.01)
    .name('Particle Radius')
    .onChange(() => {
      syncSimulator();
      params.onParticleSpawnRequested();
    });
  simFolder
    .add(params.simConfig, 'spacingFactor', 1.0, 10.0, 0.1)
    .name('Spacing Factor')
    .onChange(params.onParticleSpawnRequested);
  simFolder.add(params.simConfig, 'fluidity', 0.5, 0.99, 0.01).name('Fluidity');
  simFolder
    .add(params.simConfig, 'particleCount', 1000, params.maxParticles, 1000)
    .name('Target Count')
    .onFinishChange(() => {
      controls.reset();
    });
  simFolder.close();

  const containerFolder = gui.addFolder('Container');
  containerFolder.add(params.simConfig, 'boxWidth', 10, 100, 1).name('Box Width');
  containerFolder
    .add(params.simConfig, 'boxHeight', 5, 50, 1)
    .name('Box Height');
  containerFolder.add(params.simConfig, 'boxDepth', 5, 50, 1).name('Box Depth');
  containerFolder.add(params.simConfig, 'showWireframe').name('Show Wireframe');
  containerFolder.close();

  const envFolder = gui.addFolder('Environment');
  const tileColorState = {
    tileCol1: rgbToHex(params.sceneConfig.tileCol1),
    tileCol2: rgbToHex(params.sceneConfig.tileCol2),
    tileCol3: rgbToHex(params.sceneConfig.tileCol3),
    tileCol4: rgbToHex(params.sceneConfig.tileCol4),
  };

  const updateTileColor = (key: keyof SceneConfig) => (value: string) => {
    const rgb = hexToRgb(value);
    const color = params.sceneConfig[key];
    if (Array.isArray(color) && color.length >= 3) {
      (color as number[])[0] = rgb[0];
      (color as number[])[1] = rgb[1];
      (color as number[])[2] = rgb[2];
    }
  };

  envFolder
    .addColor(tileColorState, 'tileCol1')
    .name('Tile Color 1')
    .onChange(updateTileColor('tileCol1'));
  envFolder
    .addColor(tileColorState, 'tileCol2')
    .name('Tile Color 2')
    .onChange(updateTileColor('tileCol2'));
  envFolder
    .addColor(tileColorState, 'tileCol3')
    .name('Tile Color 3')
    .onChange(updateTileColor('tileCol3'));
  envFolder
    .addColor(tileColorState, 'tileCol4')
    .name('Tile Color 4')
    .onChange(updateTileColor('tileCol4'));
  envFolder
    .add(params.sceneConfig, 'sunBrightness', 0, 3, 0.1)
    .name('Sun Brightness');
  envFolder
    .add(params.sceneConfig, 'tileDarkFactor', -1, 0, 0.05)
    .name('Tile Dark Factor');
  envFolder.close();

  const perfFolder = gui.addFolder('Performance');
  perfFolder
    .add(guiState, 'showStats')
    .name('Show FPS')
    .onChange((value: boolean) => {
      stats.dom.style.display = value ? 'block' : 'none';
    });
  perfFolder.close();

  pauseController = gui.add(controls, 'togglePause').name('Pause');
  gui.add(controls, 'reset').name('Reset Simulation');

  window.addEventListener('keydown', (e) => {
    if (
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLTextAreaElement
    ) {
      return;
    }

    if (e.key === 'p' || e.key === 'P') {
      controls.togglePause();
    }
  });

  return {
    guiState,
    stats,
    setResetHandler(handler: () => void) {
      resetHandler = handler;
    },
    setParticleCountDisplay(count: number) {
      simDisplay.particleCount = count;
      particleCountController.updateDisplay();
    },
  };
}
