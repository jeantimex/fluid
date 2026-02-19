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
import type { SceneConfig } from './render/types';
import { MouseInteractionController } from './input/mouse_interaction';
import GUI from 'lil-gui';
import Stats from 'stats-gl';

/**
 * Application entry point.
 *
 * Responsibilities in this file:
 * 1) Initialize WebGPU device/context and GPU resources.
 * 2) Configure simulation state + UI controls.
 * 3) Build render/compute pipelines and bind groups.
 * 4) Execute per-frame compute + multi-pass rendering.
 *
 * Frame order (when particles exist):
 * compute FLIP -> G-buffer -> shadow -> AO -> composite -> wireframe -> FXAA.
 */
// Helper functions for color conversion
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
      maxStorageBuffersPerShaderStage: 10,
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

  let depthTexture = device.createTexture({
    size: [canvas.width, canvas.height],
    format: 'depth24plus',
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });

  // --- Simulation config ---
  // World-space fluid/container tuning values surfaced to GUI.
  const BASE_PARTICLE_RADIUS = 0.22;
  const simConfig = {
    particleRadius: 0.12,
    spacingFactor: 3.0,
    boxWidth: 24,
    boxHeight: 10,
    boxDepth: 15,
    particleCount: 35000,
    fluidity: 0.99,
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

  const RESOLUTION_X = 32;
  const RESOLUTION_Y = 16;
  const RESOLUTION_Z = 16;

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
    RESOLUTION_Y,
    RESOLUTION_Z,
    getInternalGridWidth(),
    getInternalGridHeight(),
    getInternalGridDepth(),
    particlePositionBuffer,
    particleVelocityBuffer,
    particleRandomBuffer
  );

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

  // Create G-buffer texture (normal.xy, speed, depth) - using rgba16float
  let gBufferTexture = device.createTexture({
    size: [canvas.width, canvas.height],
    format: 'rgba16float',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });

  // Occlusion texture
  let occlusionTexture = device.createTexture({
    size: [canvas.width, canvas.height],
    format: 'r16float',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });

  // Compositing texture (for FXAA input)
  let compositingTexture = device.createTexture({
    size: [canvas.width, canvas.height],
    format: presentationFormat,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });

  // Shadow map depth texture
  const shadowDepthTexture = device.createTexture({
    size: [SHADOW_MAP_SIZE, SHADOW_MAP_SIZE],
    format: 'depth32float',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });

  // Cache texture views (avoid creating every frame)
  let depthTextureView = depthTexture.createView();
  let gBufferTextureView = gBufferTexture.createView();
  let occlusionTextureView = occlusionTexture.createView();
  let compositingTextureView = compositingTexture.createView();
  const shadowDepthTextureView = shadowDepthTexture.createView();

  // Create samplers
  const linearSampler = device.createSampler({
    magFilter: 'linear',
    minFilter: 'linear',
  });

  const shadowSampler = device.createSampler({
    magFilter: 'linear',
    minFilter: 'linear',
    compare: 'less',
  });

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

  // ============ GUI SETUP ============
  // GUI mutates config objects; render/sim read them each frame.
  // GUI state
  const guiState = {
    paused: false,
    showStats: false,
  };

  // Stats for FPS display
  const stats = new Stats({ horizontal: true });
  stats.dom.style.position = 'fixed';
  stats.dom.style.bottom = '0px';
  stats.dom.style.left = '0px';
  stats.dom.style.display = 'none';
  document.body.appendChild(stats.dom);

  // Ensure Material Icons are loaded
  if (!document.querySelector('link[href*="Material+Icons"]')) {
    const link = document.createElement('link');
    link.href = 'https://fonts.googleapis.com/icon?family=Material+Icons';
    link.rel = 'stylesheet';
    document.head.appendChild(link);
  }

  // Add CSS for the collapsible GUI
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

  // Create GUI container
  const guiContainer = document.createElement('div');
  guiContainer.id = 'gui-container';
  if (window.innerWidth <= 480) {
    guiContainer.classList.add('collapsed');
  }
  document.body.appendChild(guiContainer);

  // Header with toggle button
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

  // GitHub link
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

  // Content wrapper
  const contentWrapper = document.createElement('div');
  contentWrapper.className = 'gui-content-wrapper';
  guiContainer.appendChild(contentWrapper);

  // Toggle collapse functionality
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

  // --- Custom Collapsible About Section ---
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
      aboutContent.offsetHeight; // force reflow
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

  // Subtitle
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

  // Original Author
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

  // WebGPU Author
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

  // Features
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

  // Interactions
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

  // Create GUI inside the container
  const gui = new GUI({
    container: contentWrapper,
    title: 'Simulation Settings',
  });

  // Simulation folder
  const simFolder = gui.addFolder('Simulation');
  const simDisplay = { particleCount: 0 };
  const particleCountController = simFolder
    .add(simDisplay, 'particleCount')
    .name('Particle Count')
    .disable();

  const syncSimulator = () => {
    // Properties will be updated in the frame loop for smooth transition
  };

  simFolder
    .add(simConfig, 'particleRadius', 0.05, 0.5, 0.01)
    .name('Particle Radius')
    .onChange(() => {
      syncSimulator();
      spawnParticles();
    });
  simFolder
    .add(simConfig, 'spacingFactor', 1.0, 10.0, 0.1)
    .name('Spacing Factor')
    .onChange(spawnParticles);
  simFolder.add(simConfig, 'fluidity', 0.5, 0.99, 0.01).name('Fluidity');
  simFolder
    .add(simConfig, 'particleCount', 1000, MAX_PARTICLES, 1000)
    .name('Target Count')
    .onFinishChange(() => {
      controls.reset();
    });
  simFolder.close();

  // Container folder
  const containerFolder = gui.addFolder('Container');
  containerFolder.add(simConfig, 'boxWidth', 10, 100, 1).name('Box Width');
  containerFolder.add(simConfig, 'boxHeight', 5, 50, 1).name('Box Height');
  containerFolder.add(simConfig, 'boxDepth', 5, 50, 1).name('Box Depth');
  containerFolder.add(simConfig, 'showWireframe').name('Show Wireframe');
  containerFolder.close();

  // Environment folder
  const envFolder = gui.addFolder('Environment');

  // Tile colors with hex conversion
  const tileColorState = {
    tileCol1: rgbToHex(sceneConfig.tileCol1),
    tileCol2: rgbToHex(sceneConfig.tileCol2),
    tileCol3: rgbToHex(sceneConfig.tileCol3),
    tileCol4: rgbToHex(sceneConfig.tileCol4),
  };

  const updateTileColor =
    (key: keyof typeof sceneConfig) => (value: string) => {
      const rgb = hexToRgb(value);
      (sceneConfig[key] as number[])[0] = rgb[0];
      (sceneConfig[key] as number[])[1] = rgb[1];
      (sceneConfig[key] as number[])[2] = rgb[2];
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
  envFolder.add(sceneConfig, 'sunBrightness', 0, 3, 0.1).name('Sun Brightness');
  envFolder
    .add(sceneConfig, 'tileDarkFactor', -1, 0, 0.05)
    .name('Tile Dark Factor');
  envFolder.close();

  // Performance folder
  const perfFolder = gui.addFolder('Performance');
  perfFolder
    .add(guiState, 'showStats')
    .name('Show FPS')
    .onChange((value: boolean) => {
      stats.dom.style.display = value ? 'block' : 'none';
    });
  perfFolder.close();

  // Pause/Reset controls
  let pauseController: GUI['controllers'][0] | null = null;
  const controls = {
    togglePause: () => {
      guiState.paused = !guiState.paused;
      if (pauseController) {
        pauseController.name(guiState.paused ? 'Resume' : 'Pause');
      }
    },
    reset: () => {
      // Will be defined after spawnParticles is available
    },
  };

  pauseController = gui.add(controls, 'togglePause').name('Pause');
  gui.add(controls, 'reset').name('Reset Simulation');

  // Add keydown listener for keyboard shortcuts
  window.addEventListener('keydown', (e) => {
    // Ignore if typing in an input/textarea
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
  const aoPass = new AOPass(device, particlePositionBuffer, linearSampler);
  const compositePass = new CompositePass(
    device,
    presentationFormat,
    linearSampler,
    shadowSampler
  );
  const fxaaPass = new FXAAPass(device, presentationFormat, linearSampler);

  function updateSizeDependentBindings() {
    aoPass.updateSizeDependentBindings(gBufferTextureView);
    compositePass.updateSizeDependentBindings(
      gBufferTextureView,
      occlusionTextureView,
      shadowDepthTextureView
    );
    fxaaPass.updateSizeDependentBindings(compositingTextureView);
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

    simDisplay.particleCount = particleCount;
    particleCountController.updateDisplay();
  }

  spawnParticles();

  // Update reset callback now that spawnParticles is defined
  controls.reset = () => {
    spawnParticles();
    console.log('Simulation reset');
  };

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

  function frame() {
    stats.begin();
    const commandEncoder = device.createCommandEncoder();

    // Interpolate GUI target dimensions -> simulation dimensions.
    // This avoids abrupt pressure shocks when container size changes.
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

    const interaction = mouseInteraction.sample(FOV, [
      getSimOffsetX(),
      getSimOffsetY(),
      getSimOffsetZ(),
    ]);
    const viewMatrix = interaction.viewMatrix;
    const inverseViewMatrix = interaction.inverseViewMatrix;

    // Compute Pass (skip if paused)
    if (!guiState.paused) {
      const computePass = commandEncoder.beginComputePass();
      const gravity = 40.0; // Fixed gravity for 1:1 world scale

      // Derive rest-density estimate from current cell size and spacing.
      const cellSize = smoothConfig.boxWidth / 32.0;
      const targetSpacing = simConfig.spacingFactor * simConfig.particleRadius;
      // Clamp to keep pressure solve stable across extreme slider values.
      const targetDensity = Math.max(
        0.5,
        Math.min(500.0, Math.pow(cellSize / targetSpacing, 3.0))
      );

      simulator.step(
        computePass,
        particleCount,
        simConfig.fluidity,
        gravity,
        targetDensity,
        interaction.mouseVelocity,
        interaction.simMouseRayOrigin,
        interaction.worldSpaceMouseRay
      );
      computePass.end();
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
        colorView: gBufferTextureView,
        depthView: depthTextureView,
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
        depthView: shadowDepthTextureView,
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
        colorView: occlusionTextureView,
        depthView: depthTextureView,
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
        targetView: compositingTextureView,
      });

      // ============ 4.1 WIREFRAME PASS ============
      // Optional debug/authoring overlay for container bounds.
      if (simConfig.showWireframe) {
        const wireframePass = commandEncoder.beginRenderPass({
          colorAttachments: [
            {
              view: compositingTextureView,
              loadOp: 'load',
              storeOp: 'store',
            },
          ],
          depthStencilAttachment: {
            view: depthTextureView,
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
    stats.end();
    stats.update();
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);

  window.addEventListener('resize', () => {
    // Recreate all size-dependent attachments and rebuild dependent bind groups.
    canvas.width = window.innerWidth * devicePixelRatio;
    canvas.height = window.innerHeight * devicePixelRatio;

    depthTexture.destroy();
    depthTexture = device.createTexture({
      size: [canvas.width, canvas.height],
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    depthTextureView = depthTexture.createView();

    gBufferTexture.destroy();
    gBufferTexture = device.createTexture({
      size: [canvas.width, canvas.height],
      format: 'rgba16float',
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    gBufferTextureView = gBufferTexture.createView();

    occlusionTexture.destroy();
    occlusionTexture = device.createTexture({
      size: [canvas.width, canvas.height],
      format: 'r16float',
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    occlusionTextureView = occlusionTexture.createView();

    compositingTexture.destroy();
    compositingTexture = device.createTexture({
      size: [canvas.width, canvas.height],
      format: presentationFormat,
      usage:
        GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    compositingTextureView = compositingTexture.createView();

    updateSizeDependentBindings();
    updateProjectionMatrix();
  });
}

init();
