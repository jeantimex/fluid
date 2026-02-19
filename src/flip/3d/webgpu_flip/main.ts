import { Utilities } from './utilities';
import { Camera } from './camera';
import { BoxEditor } from './box_editor';
import { generateSphereGeometry } from './renderer';
import { Simulator } from './simulator';
import GUI from 'lil-gui';
import Stats from 'stats-gl';

// Helper functions for color conversion
function rgbToHex(rgb: number[]): string {
    const r = Math.round(Math.pow(rgb[0], 1/2.2) * 255);
    const g = Math.round(Math.pow(rgb[1], 1/2.2) * 255);
    const b = Math.round(Math.pow(rgb[2], 1/2.2) * 255);
    return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
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
        alert("WebGPU is not supported in this browser.");
        return;
    }

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
        alert("No appropriate GPU adapter found.");
        return;
    }

    const device = await adapter.requestDevice({
        requiredLimits: {
            maxStorageBuffersPerShaderStage: 10,
        }
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
    const BASE_PARTICLE_RADIUS = 0.22;
    const simConfig = {
        particleRadius: 0.12,
        spacingFactor: 3.0,
        boxWidth: 24,
        boxHeight: 10,
        boxDepth: 15,
        particleCount: 35000,
        fluidity: 0.99,
    };
    
    // Smooth configuration for gradual transitions
    const smoothConfig = {
        boxWidth: simConfig.boxWidth,
        boxHeight: simConfig.boxHeight,
        boxDepth: simConfig.boxDepth,
    };
    
    const getPositionScale = () => simConfig.particleRadius / BASE_PARTICLE_RADIUS;

    // Simulation offset to center fluid on tiles (world origin)
    const getSimOffsetX = () => -smoothConfig.boxWidth / 2;
    const getSimOffsetY = () => 0;
    const getSimOffsetZ = () => -smoothConfig.boxDepth / 2;

    const getInternalGridWidth = () => smoothConfig.boxWidth;
    const getInternalGridHeight = () => smoothConfig.boxHeight;
    const getInternalGridDepth = () => smoothConfig.boxDepth;

    const RESOLUTION_X = 32;
    const RESOLUTION_Y = 16;
    const RESOLUTION_Z = 16;

    const PARTICLES_PER_CELL = 10;

    const camera = new Camera(canvas, [0, 0, 0]);  // Orbit around world origin
    const boxEditor = new BoxEditor(device, presentationFormat, [simConfig.boxWidth, simConfig.boxHeight, simConfig.boxDepth]);

    // --- Particle Setup ---
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

    const simulator = new Simulator(device, RESOLUTION_X, RESOLUTION_Y, RESOLUTION_Z, getInternalGridWidth(), getInternalGridHeight(), getInternalGridDepth(), particlePositionBuffer, particleVelocityBuffer, particleRandomBuffer);

    // Generate sphere geometry (2 iterations) for G-buffer - good balance of quality and performance
    const sphereGeom = generateSphereGeometry(2);
    const sphereVertexBuffer = device.createBuffer({
        size: sphereGeom.vertices.byteLength,
        usage: GPUBufferUsage.VERTEX,
        mappedAtCreation: true,
    });
    new Float32Array(sphereVertexBuffer.getMappedRange()).set(sphereGeom.vertices);
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
    new Float32Array(aoSphereVertexBuffer.getMappedRange()).set(aoSphereGeom.vertices);
    aoSphereVertexBuffer.unmap();

    const aoSphereIndexBuffer = device.createBuffer({
        size: aoSphereGeom.indices.byteLength,
        usage: GPUBufferUsage.INDEX,
        mappedAtCreation: true,
    });
    new Uint16Array(aoSphereIndexBuffer.getMappedRange()).set(aoSphereGeom.indices);
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
    const sceneConfig = {
        dirToSun: [-0.83, 0.42, -0.36],
        floorY: 0.0,  // Floor at bottom of simulation
        skyColorHorizon: [1.0, 1.0, 1.0],
        sunPower: 500.0,
        skyColorZenith: [0.08, 0.37, 0.73],
        sunBrightness: 1.0,
        skyColorGround: [0.55, 0.5, 0.55],
        floorSize: 100.0,
        tileCol1: [0.20392157, 0.5176471, 0.7764706],  // Light Blue
        tileScale: 1.0,
        tileCol2: [0.6081319, 0.36850303, 0.8584906],   // Purple
        tileDarkFactor: -0.35,
        tileCol3: [0.3019758, 0.735849, 0.45801795],    // Green
        tileCol4: [0.8018868, 0.6434483, 0.36690104],   // Yellow/Brown
    };

    // ============ GUI SETUP ============
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
    author.innerHTML = 'Original Author: <a href="https://github.com/dli/fluid" target="_blank" rel="noopener noreferrer" style="color: inherit; text-decoration: underline;">David Li</a>';
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
    webgpuAuthor.innerHTML = 'WebGPU Author: <a href="https://github.com/jeantimex" target="_blank" rel="noopener noreferrer" style="color: inherit; text-decoration: underline;">jeantimex</a>';
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
    const gui = new GUI({ container: contentWrapper, title: 'Simulation Settings' });

    // Simulation folder
    const simFolder = gui.addFolder('Simulation');
    const simDisplay = { particleCount: 0 };
    const particleCountController = simFolder.add(simDisplay, 'particleCount').name('Particle Count').disable();
    
    const syncSimulator = () => {
        // Properties will be updated in the frame loop for smooth transition
    };

    simFolder.add(simConfig, 'particleRadius', 0.05, 0.5, 0.01).name('Particle Radius').onChange(() => {
        syncSimulator();
        spawnParticles();
    });
    simFolder.add(simConfig, 'spacingFactor', 1.0, 10.0, 0.1).name('Spacing Factor').onChange(spawnParticles);
    simFolder.add(simConfig, 'fluidity', 0.5, 0.99, 0.01).name('Fluidity');
    simFolder.add(simConfig, 'particleCount', 1000, MAX_PARTICLES, 1000).name('Target Count').onFinishChange(() => {
        controls.reset();
    });
    simFolder.add(simConfig, 'boxWidth', 10, 100, 1).name('Box Width');
    simFolder.add(simConfig, 'boxHeight', 5, 50, 1).name('Box Height');
    simFolder.add(simConfig, 'boxDepth', 5, 50, 1).name('Box Depth');
    simFolder.close();

    // Environment folder
    const envFolder = gui.addFolder('Environment');

    // Tile colors with hex conversion
    const tileColorState = {
        tileCol1: rgbToHex(sceneConfig.tileCol1),
        tileCol2: rgbToHex(sceneConfig.tileCol2),
        tileCol3: rgbToHex(sceneConfig.tileCol3),
        tileCol4: rgbToHex(sceneConfig.tileCol4),
    };

    const updateTileColor = (key: keyof typeof sceneConfig) => (value: string) => {
        const rgb = hexToRgb(value);
        (sceneConfig[key] as number[])[0] = rgb[0];
        (sceneConfig[key] as number[])[1] = rgb[1];
        (sceneConfig[key] as number[])[2] = rgb[2];
    };

    envFolder.addColor(tileColorState, 'tileCol1').name('Tile Color 1').onChange(updateTileColor('tileCol1'));
    envFolder.addColor(tileColorState, 'tileCol2').name('Tile Color 2').onChange(updateTileColor('tileCol2'));
    envFolder.addColor(tileColorState, 'tileCol3').name('Tile Color 3').onChange(updateTileColor('tileCol3'));
    envFolder.addColor(tileColorState, 'tileCol4').name('Tile Color 4').onChange(updateTileColor('tileCol4'));
    envFolder.add(sceneConfig, 'sunBrightness', 0, 3, 0.1).name('Sun Brightness');
    envFolder.add(sceneConfig, 'tileDarkFactor', -1, 0, 0.05).name('Tile Dark Factor');
    envFolder.close();

    // Performance folder
    const perfFolder = gui.addFolder('Performance');
    perfFolder.add(guiState, 'showStats').name('Show FPS').onChange((value: boolean) => {
        stats.dom.style.display = value ? 'block' : 'none';
    });
    perfFolder.close();

    // Pause/Reset controls
    let pauseController: GUI["controllers"][0] | null = null;
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
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
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
        sunDir[2] * lightDistance
    ];
    
    const lightViewMatrix = Utilities.makeLookAtMatrix(
        new Float32Array(16),
        lightPos,
        [0, 0, 0],  // Look at floor center
        [0.0, 1.0, 0.0] // Standard Y-up for slanted light
    );
    
    // Orthographic projection covering the simulation area from the light's POV
    const orthoSize = 40.0;
    const lightProjectionMatrix = Utilities.makeOrthographicMatrixWebGPU(
        new Float32Array(16),
        -orthoSize, orthoSize,
        -orthoSize, orthoSize,
        0.1, lightDistance * 2.0
    );
    const lightProjectionViewMatrix = new Float32Array(16);
    Utilities.premultiplyMatrix(lightProjectionViewMatrix, lightViewMatrix, lightProjectionMatrix);

    // ============ G-BUFFER PASS SHADER ============
    const gBufferShaderModule = device.createShaderModule({
        code: `
            struct Uniforms {
                projectionMatrix: mat4x4<f32>,
                viewMatrix: mat4x4<f32>,
                sphereRadius: f32,
                positionScale: f32,
                simOffsetX: f32,
                simOffsetY: f32,
                simOffsetZ: f32,
                _pad: f32,
            };

            @group(0) @binding(0) var<uniform> uniforms: Uniforms;
            @group(0) @binding(1) var<storage, read> positions: array<vec4<f32>>;
            @group(0) @binding(2) var<storage, read> velocities: array<vec4<f32>>;

            struct VertexOutput {
                @builtin(position) position: vec4<f32>,
                @location(0) viewSpaceNormal: vec3<f32>,
                @location(1) viewSpaceZ: f32,
                @location(2) speed: f32,
            };

            @vertex
            fn vs_main(
                @location(0) vertexPos: vec3<f32>,
                @location(1) vertexNormal: vec3<f32>,
                @builtin(instance_index) instanceIndex: u32
            ) -> VertexOutput {
                let spherePos = positions[instanceIndex].xyz * uniforms.positionScale;
                let velocity = velocities[instanceIndex].xyz;
                let simOffset = vec3<f32>(uniforms.simOffsetX, uniforms.simOffsetY, uniforms.simOffsetZ);
                let worldPos = vertexPos * uniforms.sphereRadius + spherePos + simOffset;
                let viewPos = uniforms.viewMatrix * vec4<f32>(worldPos, 1.0);

                var out: VertexOutput;
                out.position = uniforms.projectionMatrix * viewPos;
                out.viewSpaceNormal = (uniforms.viewMatrix * vec4<f32>(vertexNormal, 0.0)).xyz;
                out.viewSpaceZ = viewPos.z;
                out.speed = length(velocity);
                return out;
            }

            @fragment
            fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
                let n = normalize(in.viewSpaceNormal);
                return vec4<f32>(n.x, n.y, in.speed, in.viewSpaceZ);
            }
        `
    });

    // ============ SHADOW PASS SHADER ============
    const shadowShaderModule = device.createShaderModule({
        code: `
            struct Uniforms {
                projectionViewMatrix: mat4x4<f32>,
                sphereRadius: f32,
                positionScale: f32,
                simOffsetX: f32,
                simOffsetY: f32,
                simOffsetZ: f32,
                _pad: vec3<f32>,
            };

            @group(0) @binding(0) var<uniform> uniforms: Uniforms;
            @group(0) @binding(1) var<storage, read> positions: array<vec4<f32>>;

            @vertex
            fn vs_main(
                @location(0) vertexPos: vec3<f32>,
                @builtin(instance_index) instanceIndex: u32
            ) -> @builtin(position) vec4<f32> {
                let spherePos = positions[instanceIndex].xyz * uniforms.positionScale;
                let simOffset = vec3<f32>(uniforms.simOffsetX, uniforms.simOffsetY, uniforms.simOffsetZ);
                let worldPos = vertexPos * uniforms.sphereRadius + spherePos + simOffset;
                return uniforms.projectionViewMatrix * vec4<f32>(worldPos, 1.0);
            }

            @fragment
            fn fs_main() {}
        `
    });

    // ============ COMPOSITE PASS SHADER (with Unity Scene) ============
    const compositeShaderModule = device.createShaderModule({
        code: `
            struct Uniforms {
                inverseViewMatrix: mat4x4<f32>,
                lightProjectionViewMatrix: mat4x4<f32>,
                resolution: vec2<f32>,
                fov: f32,
                shadowResolution: f32,
                // Camera position for ray casting
                cameraPos: vec3<f32>,
                _pad0: f32,
                // Scene parameters
                dirToSun: vec3<f32>,
                floorY: f32,
                skyColorHorizon: vec3<f32>,
                sunPower: f32,
                skyColorZenith: vec3<f32>,
                sunBrightness: f32,
                skyColorGround: vec3<f32>,
                floorSize: f32,
                tileCol1: vec3<f32>,
                tileScale: f32,
                tileCol2: vec3<f32>,
                tileDarkFactor: f32,
                tileCol3: vec3<f32>,
                _pad1: f32,
                tileCol4: vec3<f32>,
                _pad2: f32,
            };

            @group(0) @binding(0) var<uniform> uniforms: Uniforms;
            @group(0) @binding(1) var gBufferTex: texture_2d<f32>;
            @group(0) @binding(2) var occlusionTex: texture_2d<f32>;
            @group(0) @binding(3) var shadowTex: texture_depth_2d;
            @group(0) @binding(4) var linearSamp: sampler;
            @group(0) @binding(5) var shadowSamp: sampler_comparison;

            struct VertexOutput {
                @builtin(position) position: vec4<f32>,
                @location(0) uv: vec2<f32>,
            };

            @vertex
            fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
                var pos = array<vec2<f32>, 4>(
                    vec2<f32>(-1.0, -1.0),
                    vec2<f32>(1.0, -1.0),
                    vec2<f32>(-1.0, 1.0),
                    vec2<f32>(1.0, 1.0)
                );
                var out: VertexOutput;
                out.position = vec4<f32>(pos[vertexIndex], 0.0, 1.0);
                out.uv = vec2<f32>(pos[vertexIndex].x * 0.5 + 0.5, 0.5 - pos[vertexIndex].y * 0.5);
                return out;
            }

            fn hsvToRGB(c: vec3<f32>) -> vec3<f32> {
                let K = vec4<f32>(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
                let p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
                return c.z * mix(K.xxx, clamp(p - K.xxx, vec3<f32>(0.0), vec3<f32>(1.0)), c.y);
            }

            fn rgbToHsv(rgb: vec3<f32>) -> vec3<f32> {
                let K = vec4<f32>(0.0, -1.0/3.0, 2.0/3.0, -1.0);
                let p = select(vec4<f32>(rgb.gb, K.xy), vec4<f32>(rgb.bg, K.wz), rgb.g < rgb.b);
                let q = select(vec4<f32>(rgb.r, p.yzx), vec4<f32>(p.xyw, rgb.r), rgb.r < p.x);
                let d = q.x - min(q.w, q.y);
                let e = 1.0e-10;
                return vec3<f32>(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
            }

            fn tweakHsv(col: vec3<f32>, shift: vec3<f32>) -> vec3<f32> {
                return clamp(hsvToRGB(rgbToHsv(col) + shift), vec3<f32>(0.0), vec3<f32>(1.0));
            }

            fn modulo(x: f32, y: f32) -> f32 { return x - y * floor(x / y); }

            fn linearToSrgb(c: vec3<f32>) -> vec3<f32> { return pow(c, vec3<f32>(1.0/2.2)); }

            fn hashInt2(v: vec2<i32>) -> u32 { return u32(v.x) * 5023u + u32(v.y) * 96456u; }

            fn randomValue(state: ptr<function, u32>) -> f32 {
                *state = *state * 747796405u + 2891336453u;
                let word = ((*state >> ((*state >> 28u) + 4u)) ^ *state) * 277803737u;
                return f32((word >> 22u) ^ word) / 4294967295.0;
            }

            fn randomSNorm3(state: ptr<function, u32>) -> vec3<f32> {
                return vec3<f32>(
                    randomValue(state) * 2.0 - 1.0,
                    randomValue(state) * 2.0 - 1.0,
                    randomValue(state) * 2.0 - 1.0
                );
            }

            fn getSkyColor(dir: vec3<f32>) -> vec3<f32> {
                let sun = pow(max(0.0, dot(dir, uniforms.dirToSun)), uniforms.sunPower);
                let skyGradientT = pow(smoothstep(0.0, 0.4, dir.y), 0.35);
                let groundToSkyT = smoothstep(-0.01, 0.0, dir.y);
                let skyGradient = mix(uniforms.skyColorHorizon, uniforms.skyColorZenith, skyGradientT);
                var res = mix(uniforms.skyColorGround, skyGradient, groundToSkyT);
                if (dir.y >= -0.01) { res += sun * uniforms.sunBrightness; }
                return res;
            }

            fn rayPlaneIntersect(ro: vec3<f32>, rd: vec3<f32>, planeY: f32) -> f32 {
                if (abs(rd.y) < 0.0001) { return -1.0; }
                let t = (planeY - ro.y) / rd.y;
                return select(-1.0, t, t > 0.0);
            }

            // Sample shadow map with PCF for soft shadows
            fn sampleFloorShadow(worldPos: vec3<f32>) -> f32 {
                var lightSpacePos = uniforms.lightProjectionViewMatrix * vec4<f32>(worldPos, 1.0);
                lightSpacePos = lightSpacePos / lightSpacePos.w;
                // Note: Y is flipped for WebGPU texture coordinates
                let lightCoords = vec2<f32>(lightSpacePos.x * 0.5 + 0.5, 0.5 - lightSpacePos.y * 0.5);
                let lightDepth = lightSpacePos.z;

                // PCF shadow sampling (3x3 kernel)
                var shadow = 0.0;
                let texelSize = 1.0 / uniforms.shadowResolution;
                for (var x = -1; x <= 1; x++) {
                    for (var y = -1; y <= 1; y++) {
                        let offset = vec2<f32>(f32(x), f32(y)) * texelSize;
                        let sampleCoord = lightCoords + offset;
                        shadow += textureSampleCompare(shadowTex, shadowSamp, sampleCoord, lightDepth - 0.002);
                    }
                }
                shadow = shadow / 9.0;

                // Return no shadow (1.0) if outside light frustum bounds
                let inBounds = lightCoords.x >= 0.0 && lightCoords.x <= 1.0 &&
                               lightCoords.y >= 0.0 && lightCoords.y <= 1.0 &&
                               lightDepth >= 0.0 && lightDepth <= 1.0;
                return select(1.0, shadow, inBounds);
            }

            fn getSceneBackground(rayDir: vec3<f32>, floorShadow: f32) -> vec3<f32> {
                let t = rayPlaneIntersect(uniforms.cameraPos, rayDir, uniforms.floorY);

                if (t > 0.0) {
                    let hitPos = uniforms.cameraPos + rayDir * t;
                    let halfSize = uniforms.floorSize * 0.5;
                    if (abs(hitPos.x) < halfSize && abs(hitPos.z) < halfSize) {
                        let rotatedPos = vec2<f32>(-hitPos.z, hitPos.x);

                        var tileCol: vec3<f32>;
                        if (rotatedPos.x < 0.0) { tileCol = uniforms.tileCol1; }
                        else { tileCol = uniforms.tileCol2; }
                        if (rotatedPos.y < 0.0) {
                            if (rotatedPos.x < 0.0) { tileCol = uniforms.tileCol3; }
                            else { tileCol = uniforms.tileCol4; }
                        }

                        tileCol = linearToSrgb(tileCol);
                        let tileCoord = floor(rotatedPos * uniforms.tileScale);

                        // Random variation per tile
                        var rngState = hashInt2(vec2<i32>(i32(tileCoord.x), i32(tileCoord.y)));
                        let rv = randomSNorm3(&rngState) * vec3<f32>(0.2, 0.0, 0.73) * 0.1;
                        tileCol = tweakHsv(tileCol, rv);

                        // Checkerboard pattern
                        let isDarkTile = modulo(tileCoord.x, 2.0) == modulo(tileCoord.y, 2.0);
                        if (isDarkTile) {
                            tileCol = tweakHsv(tileCol, vec3<f32>(0.0, 0.0, uniforms.tileDarkFactor));
                        }

                        // Apply particle shadow to floor (passed in from uniform control flow)
                        let ambient = 0.4;  // Ambient light in shadow
                        let shadowFactor = ambient + (1.0 - ambient) * floorShadow;
                        tileCol *= shadowFactor;

                        return tileCol;
                    }
                }

                return getSkyColor(rayDir);
            }

            @fragment
            fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
                let data = textureSample(gBufferTex, linearSamp, in.uv);
                let occlusion = textureSample(occlusionTex, linearSamp, in.uv).r;

                let speed = data.b;
                let viewSpaceZ = data.a;

                let nx = data.r;
                let ny = data.g;
                let nz = sqrt(max(0.0, 1.0 - nx * nx - ny * ny));

                let tanHalfFov = tan(uniforms.fov / 2.0);
                let viewRay = vec3<f32>(
                    (in.uv.x * 2.0 - 1.0) * tanHalfFov * uniforms.resolution.x / uniforms.resolution.y,
                    (1.0 - 2.0 * in.uv.y) * tanHalfFov,
                    -1.0
                );
                let viewSpacePos = viewRay * max(-viewSpaceZ, 0.01);
                let worldSpacePos = (uniforms.inverseViewMatrix * vec4<f32>(viewSpacePos, 1.0)).xyz;

                // Shadow calculation with PCF
                var lightSpacePos = uniforms.lightProjectionViewMatrix * vec4<f32>(worldSpacePos, 1.0);
                lightSpacePos = lightSpacePos / lightSpacePos.w;
                // Note: Y is flipped for WebGPU texture coordinates
                let lightCoords = vec2<f32>(lightSpacePos.x * 0.5 + 0.5, 0.5 - lightSpacePos.y * 0.5);
                let lightDepth = lightSpacePos.z;

                var shadow = 0.0;
                let texelSize = 1.0 / uniforms.shadowResolution;
                for (var x = -1; x <= 1; x++) {
                    for (var y = -1; y <= 1; y++) {
                        let offset = vec2<f32>(f32(x), f32(y)) * texelSize;
                        shadow += textureSampleCompare(shadowTex, shadowSamp, lightCoords + offset, lightDepth - 0.002);
                    }
                }
                shadow /= 9.0;

                let isBackground = speed < 0.0 || viewSpaceZ > -0.01;

                // Compute ray direction for background
                let rayDirNorm = normalize((uniforms.inverseViewMatrix * vec4<f32>(viewRay, 0.0)).xyz);

                // Compute floor shadow in uniform control flow (before any conditionals)
                let floorT = rayPlaneIntersect(uniforms.cameraPos, rayDirNorm, uniforms.floorY);
                let floorHitPos = uniforms.cameraPos + rayDirNorm * max(floorT, 0.0);
                let floorShadow = sampleFloorShadow(floorHitPos);

                let bgColor = getSceneBackground(rayDirNorm, floorShadow);

                // Particle color from speed
                let hue = max(0.6 - speed * 0.0025, 0.52);
                var particleColor = hsvToRGB(vec3<f32>(hue, 0.75, 1.0));

                let clampedOcclusion = min(occlusion * 0.5, 1.0);
                let ambient = 1.0 - clampedOcclusion * 0.7;
                let direct = 1.0 - (1.0 - shadow) * 0.8;
                particleColor *= ambient * direct;

                let finalColor = select(particleColor, bgColor, isBackground);
                return vec4<f32>(finalColor, 1.0);
            }
        `
    });

    // ============ FXAA PASS SHADER ============
    const fxaaShaderModule = device.createShaderModule({
        code: `
            struct Uniforms {
                resolution: vec2<f32>,
            };

            @group(0) @binding(0) var<uniform> uniforms: Uniforms;
            @group(0) @binding(1) var inputTex: texture_2d<f32>;
            @group(0) @binding(2) var linearSamp: sampler;

            struct VertexOutput {
                @builtin(position) position: vec4<f32>,
                @location(0) uv: vec2<f32>,
            };

            const FXAA_SPAN_MAX: f32 = 8.0;
            const FXAA_REDUCE_MUL: f32 = 1.0 / 8.0;
            const FXAA_REDUCE_MIN: f32 = 1.0 / 128.0;

            @vertex
            fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
                var pos = array<vec2<f32>, 4>(
                    vec2<f32>(-1.0, -1.0),
                    vec2<f32>(1.0, -1.0),
                    vec2<f32>(-1.0, 1.0),
                    vec2<f32>(1.0, 1.0)
                );
                var out: VertexOutput;
                out.position = vec4<f32>(pos[vertexIndex], 0.0, 1.0);
                out.uv = vec2<f32>(pos[vertexIndex].x * 0.5 + 0.5, 0.5 - pos[vertexIndex].y * 0.5);
                return out;
            }

            @fragment
            fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
                let delta = 1.0 / uniforms.resolution;

                let rgbNW = textureSample(inputTex, linearSamp, in.uv + vec2<f32>(-1.0, -1.0) * delta).rgb;
                let rgbNE = textureSample(inputTex, linearSamp, in.uv + vec2<f32>(1.0, -1.0) * delta).rgb;
                let rgbSW = textureSample(inputTex, linearSamp, in.uv + vec2<f32>(-1.0, 1.0) * delta).rgb;
                let rgbSE = textureSample(inputTex, linearSamp, in.uv + vec2<f32>(1.0, 1.0) * delta).rgb;
                let rgbM = textureSample(inputTex, linearSamp, in.uv).rgb;

                let luma = vec3<f32>(0.299, 0.587, 0.114);
                let lumaNW = dot(rgbNW, luma);
                let lumaNE = dot(rgbNE, luma);
                let lumaSW = dot(rgbSW, luma);
                let lumaSE = dot(rgbSE, luma);
                let lumaM = dot(rgbM, luma);

                let lumaMin = min(lumaM, min(min(lumaNW, lumaNE), min(lumaSW, lumaSE)));
                let lumaMax = max(lumaM, max(max(lumaNW, lumaNE), max(lumaSW, lumaSE)));

                var dir = vec2<f32>(
                    -((lumaNW + lumaNE) - (lumaSW + lumaSE)),
                    ((lumaNW + lumaSW) - (lumaNE + lumaSE))
                );

                let dirReduce = max((lumaNW + lumaNE + lumaSW + lumaSE) * (0.25 * FXAA_REDUCE_MUL), FXAA_REDUCE_MIN);
                let rcpDirMin = 1.0 / (min(abs(dir.x), abs(dir.y)) + dirReduce);
                dir = min(vec2<f32>(FXAA_SPAN_MAX), max(vec2<f32>(-FXAA_SPAN_MAX), dir * rcpDirMin)) * delta;

                let rgbA = 0.5 * (
                    textureSample(inputTex, linearSamp, in.uv + dir * (1.0 / 3.0 - 0.5)).rgb +
                    textureSample(inputTex, linearSamp, in.uv + dir * (2.0 / 3.0 - 0.5)).rgb
                );
                let rgbB = rgbA * 0.5 + 0.25 * (
                    textureSample(inputTex, linearSamp, in.uv + dir * -0.5).rgb +
                    textureSample(inputTex, linearSamp, in.uv + dir * 0.5).rgb
                );
                let lumaB = dot(rgbB, luma);

                if (lumaB < lumaMin || lumaB > lumaMax) {
                    return vec4<f32>(rgbA, 1.0);
                } else {
                    return vec4<f32>(rgbB, 1.0);
                }
            }
        `
    });

    // ============ AMBIENT OCCLUSION PASS SHADER ============
    const aoShaderModule = device.createShaderModule({
        code: `
            struct Uniforms {
                projectionMatrix: mat4x4<f32>,
                viewMatrix: mat4x4<f32>,
                resolution: vec2<f32>,
                fov: f32,
                sphereRadius: f32,
                positionScale: f32,
                simOffsetX: f32,
                simOffsetY: f32,
                simOffsetZ: f32,
                _pad: vec3<f32>,
            };

            @group(0) @binding(0) var<uniform> uniforms: Uniforms;
            @group(0) @binding(1) var<storage, read> positions: array<vec4<f32>>;
            @group(0) @binding(2) var gBufferTex: texture_2d<f32>;
            @group(0) @binding(3) var linearSamp: sampler;

            struct VertexOutput {
                @builtin(position) position: vec4<f32>,
                @location(0) viewSpaceSpherePos: vec3<f32>,
                @location(1) sphereRadius: f32,
            };

            const PI: f32 = 3.14159265;

            @vertex
            fn vs_main(
                @location(0) vertexPos: vec3<f32>,
                @builtin(instance_index) instanceIndex: u32
            ) -> VertexOutput {
                let spherePos = positions[instanceIndex].xyz * uniforms.positionScale;
                let simOffset = vec3<f32>(uniforms.simOffsetX, uniforms.simOffsetY, uniforms.simOffsetZ);
                let worldSpherePos = spherePos + simOffset;
                let viewSpherPos = (uniforms.viewMatrix * vec4<f32>(worldSpherePos, 1.0)).xyz;

                // Extrude sphere 3x for AO range (reduced for performance)
                let extrudedRadius = uniforms.sphereRadius * 3.0;
                let worldPos = vertexPos * extrudedRadius + worldSpherePos;

                var out: VertexOutput;
                out.position = uniforms.projectionMatrix * uniforms.viewMatrix * vec4<f32>(worldPos, 1.0);
                out.viewSpaceSpherePos = viewSpherPos;
                out.sphereRadius = uniforms.sphereRadius;
                return out;
            }

            @fragment
            fn fs_main(in: VertexOutput) -> @location(0) f32 {
                let coords = in.position.xy / uniforms.resolution;
                let data = textureSample(gBufferTex, linearSamp, coords);

                let viewSpaceZ = data.a;
                if (viewSpaceZ > -0.01) { return 0.0; }

                // Reconstruct view space position
                let nx = data.r;
                let ny = data.g;
                let nz = sqrt(max(0.0, 1.0 - nx * nx - ny * ny));
                let viewSpaceNormal = vec3<f32>(nx, ny, nz);

                let tanHalfFov = tan(uniforms.fov / 2.0);
                let viewRay = vec3<f32>(
                    (coords.x * 2.0 - 1.0) * tanHalfFov * uniforms.resolution.x / uniforms.resolution.y,
                    (1.0 - 2.0 * coords.y) * tanHalfFov,  // Adjusted for WebGPU screen coords (Y=0 at top)
                    -1.0
                );
                let viewSpacePos = viewRay * -viewSpaceZ;

                // Calculate occlusion from this sphere
                let di = in.viewSpaceSpherePos - viewSpacePos;
                let l = length(di);
                if (l < 0.001) { return 0.0; }

                let nl = dot(viewSpaceNormal, di / l);
                let h = l / in.sphereRadius;
                let h2 = h * h;
                let k2 = 1.0 - h2 * nl * nl;

                var result = max(0.0, nl) / h2;

                if (k2 > 0.0 && l > in.sphereRadius) {
                    result = nl * acos(-nl * sqrt((h2 - 1.0) / (1.0 - nl * nl))) - sqrt(k2 * (h2 - 1.0));
                    result = result / h2 + atan(sqrt(k2 / (h2 - 1.0)));
                    result /= PI;
                }

                return result;
            }
        `
    });

    // Create pipelines
    const gBufferPipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: {
            module: gBufferShaderModule,
            entryPoint: 'vs_main',
            buffers: [
                { arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] },
                { arrayStride: 12, attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x3' }] },
            ]
        },
        fragment: {
            module: gBufferShaderModule,
            entryPoint: 'fs_main',
            targets: [{ format: 'rgba16float' }]
        },
        primitive: { topology: 'triangle-list', cullMode: 'back' },
        depthStencil: { depthWriteEnabled: true, depthCompare: 'less', format: 'depth24plus' }
    });

    const shadowPipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: {
            module: shadowShaderModule,
            entryPoint: 'vs_main',
            buffers: [{ arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] }]
        },
        fragment: { module: shadowShaderModule, entryPoint: 'fs_main', targets: [] },
        primitive: { topology: 'triangle-list', cullMode: 'back' },
        depthStencil: { depthWriteEnabled: true, depthCompare: 'less', format: 'depth32float' }
    });

    const aoPipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: {
            module: aoShaderModule,
            entryPoint: 'vs_main',
            buffers: [{ arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] }]
        },
        fragment: {
            module: aoShaderModule,
            entryPoint: 'fs_main',
            targets: [{
                format: 'r16float',
                blend: {
                    color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
                    alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' }
                }
            }]
        },
        primitive: { topology: 'triangle-list', cullMode: 'back' },
        depthStencil: { depthWriteEnabled: false, depthCompare: 'less', format: 'depth24plus' }
    });

    const compositePipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: { module: compositeShaderModule, entryPoint: 'vs_main' },
        fragment: {
            module: compositeShaderModule,
            entryPoint: 'fs_main',
            targets: [{ format: presentationFormat }]
        },
        primitive: { topology: 'triangle-strip' }
    });

    const fxaaPipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: { module: fxaaShaderModule, entryPoint: 'vs_main' },
        fragment: {
            module: fxaaShaderModule,
            entryPoint: 'fs_main',
            targets: [{ format: presentationFormat }]
        },
        primitive: { topology: 'triangle-strip' }
    });

    // Create uniform buffers
    const gBufferUniformBuffer = device.createBuffer({
        size: 160,  // projMatrix(64) + viewMatrix(64) + sphereRadius/positionScale/simOffset/pad(32)
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const shadowUniformBuffer = device.createBuffer({
        size: 112,  // projViewMatrix(64) + sphereRadius/positionScale/simOffset/pad(48) - vec3 pad needs 16-byte alignment
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const aoUniformBuffer = device.createBuffer({
        size: 192,  // projMatrix(64) + viewMatrix(64) + resolution/fov/radius/scale/simOffset/pad(64)
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const compositeUniformBuffer = device.createBuffer({
        size: 320, // Expanded for scene uniforms
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const fxaaUniformBuffer = device.createBuffer({
        size: 16, // vec2 + padding
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Create bind groups
    const gBufferBindGroup = device.createBindGroup({
        layout: gBufferPipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: gBufferUniformBuffer } },
            { binding: 1, resource: { buffer: particlePositionBuffer } },
            { binding: 2, resource: { buffer: particleVelocityBuffer } },
        ]
    });

    const shadowBindGroup = device.createBindGroup({
        layout: shadowPipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: shadowUniformBuffer } },
            { binding: 1, resource: { buffer: particlePositionBuffer } },
        ]
    });

    let aoBindGroup: GPUBindGroup;
    let compositeBindGroup: GPUBindGroup;
    let fxaaBindGroup: GPUBindGroup;

    function createSizeDepedentBindGroups() {
        aoBindGroup = device.createBindGroup({
            layout: aoPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: aoUniformBuffer } },
                { binding: 1, resource: { buffer: particlePositionBuffer } },
                { binding: 2, resource: gBufferTexture.createView() },
                { binding: 3, resource: linearSampler },
            ]
        });

        compositeBindGroup = device.createBindGroup({
            layout: compositePipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: compositeUniformBuffer } },
                { binding: 1, resource: gBufferTexture.createView() },
                { binding: 2, resource: occlusionTexture.createView() },
                { binding: 3, resource: shadowDepthTexture.createView() },
                { binding: 4, resource: linearSampler },
                { binding: 5, resource: shadowSampler },
            ]
        });

        fxaaBindGroup = device.createBindGroup({
            layout: fxaaPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: fxaaUniformBuffer } },
                { binding: 1, resource: compositingTexture.createView() },
                { binding: 2, resource: linearSampler },
            ]
        });
    }
    createSizeDepedentBindGroups();

    let particleCount = 0;
    function spawnParticles() {
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
            const naturalSpacingWorld = simConfig.spacingFactor * simConfig.particleRadius;
            const naturalVolumeWorld = particleCount * Math.pow(naturalSpacingWorld, 3);
            
            // Fill ratio determines how much of the user's boxes we fill to maintain this density
            const fillRatio = Math.min(1.0, naturalVolumeWorld / totalBoxVolumeWorld);
            const linearFillRatio = Math.pow(fillRatio, 1/3);
            
            console.log(`Spawning ${particleCount} particles (S: ${positionScale.toFixed(3)}, Fill: ${(fillRatio * 100).toFixed(1)}%)`);

            let particlesCreated = 0;
            for (let boxIdx = 0; boxIdx < boxEditor.boxes.length; boxIdx++) {
                const box = boxEditor.boxes[boxIdx];
                const boxVolumeWorld = box.computeVolume();

                let particlesInBox: number;
                if (boxIdx < boxEditor.boxes.length - 1) {
                    particlesInBox = Math.floor(particleCount * boxVolumeWorld / totalBoxVolumeWorld);
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

                const cellsTarget = Math.pow(particlesInBox, 1/3);
                const nx = Math.max(1, Math.round(cellsTarget * Math.pow(spawnW / spawnH, 1/3)));
                const ny = Math.max(1, Math.round(cellsTarget * Math.pow(spawnH / spawnD, 1/3)));
                const nz = Math.max(1, Math.ceil(particlesInBox / (nx * ny)));

                for (let i = 0; i < particlesInBox; i++) {
                    const idx = particlesCreated + i;
                    const ix = i % nx;
                    const iy = Math.floor(i / nx) % ny;
                    const iz = Math.floor(i / (nx * ny));

                    // Jittered grid position in world space
                    const px = box.min[0] + offX + (ix + 0.5 + (Math.random() - 0.5) * 0.5) * (spawnW / nx);
                    const py = box.min[1] + offY + (iy + 0.5 + (Math.random() - 0.5) * 0.5) * (spawnH / ny);
                    const pz = box.min[2] + offZ + (iz + 0.5 + (Math.random() - 0.5) * 0.5) * (spawnD / nz);

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

    // Mouse interaction state (matching WebGL simulatorrenderer.js)
    let mouseX = 0;  // Normalized mouse position in [-1, 1]
    let mouseY = 0;
    let lastMousePlaneX = 0;
    let lastMousePlaneY = 0;

    canvas.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        camera.onMouseDown(e);
    });
    document.addEventListener('pointerup', (e) => {
        e.preventDefault();
        camera.onMouseUp();
    });
    canvas.addEventListener('pointermove', (e) => {
        e.preventDefault();

        const position = Utilities.getMousePosition(e, canvas);
        // Use CSS dimensions (getBoundingClientRect), not canvas device pixel dimensions
        const rect = canvas.getBoundingClientRect();
        const normalizedX = position.x / rect.width;
        const normalizedY = position.y / rect.height;

        mouseX = normalizedX * 2.0 - 1.0;
        mouseY = (1.0 - normalizedY) * 2.0 - 1.0;

        camera.onMouseMove(e);
    });

    console.log("WebGPU Initialized with Particles");

    // Pre-allocated arrays for uniform writes (avoid allocations every frame)
    // gBuffer: [sphereRadius, positionScale, simOffsetX, simOffsetY, simOffsetZ, pad]
    const gBufferUniformData = new Float32Array(8);
    gBufferUniformData[0] = simConfig.particleRadius;
    gBufferUniformData[1] = 1.0; // positionScale removed from position calculation
    gBufferUniformData[2] = getSimOffsetX();
    gBufferUniformData[3] = getSimOffsetY();
    gBufferUniformData[4] = getSimOffsetZ();

    // shadow: [sphereRadius, positionScale, simOffsetX, simOffsetY, simOffsetZ, pad, pad, pad]
    const shadowUniformData = new Float32Array(8);
    shadowUniformData[0] = simConfig.particleRadius;
    shadowUniformData[1] = 1.0;
    shadowUniformData[2] = getSimOffsetX();
    shadowUniformData[3] = getSimOffsetY();
    shadowUniformData[4] = getSimOffsetZ();

    // ao: [width, height, FOV, sphereRadius, positionScale, simOffsetX, simOffsetY, simOffsetZ, pad, pad, pad]
    const aoUniformData = new Float32Array(12);
    aoUniformData[3] = simConfig.particleRadius;
    aoUniformData[4] = 1.0;
    aoUniformData[5] = getSimOffsetX();
    aoUniformData[6] = getSimOffsetY();
    aoUniformData[7] = getSimOffsetZ();
    const compositeUniformData = new Float32Array(40);  // Extended for scene uniforms (160 bytes)

    const fxaaUniformData = new Float32Array(2);  // [width, height]

    function frame() {
        stats.begin();
        const commandEncoder = device.createCommandEncoder();

        // Interpolate box dimensions for smooth transition (ease-out)
        const lerpSpeed = 0.1;
        smoothConfig.boxWidth += (simConfig.boxWidth - smoothConfig.boxWidth) * lerpSpeed;
        smoothConfig.boxHeight += (simConfig.boxHeight - smoothConfig.boxHeight) * lerpSpeed;
        smoothConfig.boxDepth += (simConfig.boxDepth - smoothConfig.boxDepth) * lerpSpeed;

        // Sync simulator properties every frame for smooth physics reaction
        simulator.gridWidth = getInternalGridWidth();
        simulator.gridHeight = getInternalGridHeight();
        simulator.gridDepth = getInternalGridDepth();

        // Compute mouse interaction (matching WebGL simulatorrenderer.js)
        const tanHalfFov = Math.tan(FOV / 2.0);
        const aspect = canvas.width / canvas.height;

        // View space mouse ray
        const viewSpaceMouseRay = [
            mouseX * tanHalfFov * aspect,
            mouseY * tanHalfFov,
            -1.0
        ];

        // Mouse plane position at camera distance (orbit point)
        const mousePlaneX = viewSpaceMouseRay[0] * camera.distance;
        const mousePlaneY = viewSpaceMouseRay[1] * camera.distance;

        // Mouse velocity (delta from last frame)
        let mouseVelocityX = mousePlaneX - lastMousePlaneX;
        let mouseVelocityY = mousePlaneY - lastMousePlaneY;

        // If camera is being dragged, zero out mouse velocity
        if (camera.isMouseDown()) {
            mouseVelocityX = 0.0;
            mouseVelocityY = 0.0;
        }

        lastMousePlaneX = mousePlaneX;
        lastMousePlaneY = mousePlaneY;

        // Transform mouse ray to world space
        const viewMatrix = camera.getViewMatrix();
        const inverseViewMatrix = Utilities.invertMatrix(new Float32Array(16), viewMatrix) || new Float32Array(16);
        const worldSpaceMouseRay: number[] = [0, 0, 0];
        Utilities.transformDirectionByMatrix(worldSpaceMouseRay, viewSpaceMouseRay, inverseViewMatrix);
        Utilities.normalizeVector(worldSpaceMouseRay, worldSpaceMouseRay);

        // Get camera right and up vectors from view matrix
        const cameraRight = [viewMatrix[0], viewMatrix[4], viewMatrix[8]];
        const cameraUp = [viewMatrix[1], viewMatrix[5], viewMatrix[9]];

        // Compute world space mouse velocity
        const mouseVelocity = [
            mouseVelocityX * cameraRight[0] + mouseVelocityY * cameraUp[0],
            mouseVelocityX * cameraRight[1] + mouseVelocityY * cameraUp[1],
            mouseVelocityX * cameraRight[2] + mouseVelocityY * cameraUp[2]
        ];

        // Mouse ray origin is camera position
        const mouseRayOrigin = camera.getPosition();
        // Transform mouse ray origin to simulation space
        const simMouseRayOrigin = [
            mouseRayOrigin[0] - getSimOffsetX(),
            mouseRayOrigin[1] - getSimOffsetY(),
            mouseRayOrigin[2] - getSimOffsetZ()
        ];

        // Compute Pass (skip if paused)
        if (!guiState.paused) {
            const computePass = commandEncoder.beginComputePass();
            const gravity = 40.0; // Fixed gravity for 1:1 world scale
            
            // Calculate natural density for consistency
            const cellSize = smoothConfig.boxWidth / 32.0;
            const targetSpacing = simConfig.spacingFactor * simConfig.particleRadius;
            // Ensure targetDensity doesn't drop too low to maintain solver stability
            const targetDensity = Math.max(0.5, Math.min(500.0, Math.pow(cellSize / targetSpacing, 3.0)));
            
            simulator.step(computePass, particleCount, simConfig.fluidity, gravity, targetDensity, mouseVelocity, simMouseRayOrigin, worldSpaceMouseRay);
            computePass.end();
        }

        if (particleCount > 0) {
            // Update particle radius and offsets from current config
            const currentSimOffsetX = getSimOffsetX();
            const currentSimOffsetY = getSimOffsetY();
            const currentSimOffsetZ = getSimOffsetZ();

            gBufferUniformData[0] = simConfig.particleRadius;
            gBufferUniformData[1] = 1.0;
            gBufferUniformData[2] = currentSimOffsetX;
            gBufferUniformData[3] = currentSimOffsetY;
            gBufferUniformData[4] = currentSimOffsetZ;

            shadowUniformData[0] = simConfig.particleRadius;
            shadowUniformData[1] = 1.0;
            shadowUniformData[2] = currentSimOffsetX;
            shadowUniformData[3] = currentSimOffsetY;
            shadowUniformData[4] = currentSimOffsetZ;

            aoUniformData[3] = simConfig.particleRadius;
            aoUniformData[4] = 1.0;
            aoUniformData[5] = currentSimOffsetX;
            aoUniformData[6] = currentSimOffsetY;
            aoUniformData[7] = currentSimOffsetZ;

            // ============ 1. G-BUFFER PASS ============
            device.queue.writeBuffer(gBufferUniformBuffer, 0, projectionMatrix);
            device.queue.writeBuffer(gBufferUniformBuffer, 64, viewMatrix);
            device.queue.writeBuffer(gBufferUniformBuffer, 128, gBufferUniformData);

            const gBufferPass = commandEncoder.beginRenderPass({
                colorAttachments: [{
                    view: gBufferTextureView,
                    clearValue: { r: 0, g: 0, b: -1, a: 0 },
                    loadOp: 'clear',
                    storeOp: 'store',
                }],
                depthStencilAttachment: {
                    view: depthTextureView,
                    depthClearValue: 1.0,
                    depthLoadOp: 'clear',
                    depthStoreOp: 'store',
                },
            });
            gBufferPass.setPipeline(gBufferPipeline);
            gBufferPass.setBindGroup(0, gBufferBindGroup);
            gBufferPass.setVertexBuffer(0, sphereVertexBuffer);
            gBufferPass.setVertexBuffer(1, sphereNormalBuffer);
            gBufferPass.setIndexBuffer(sphereIndexBuffer, 'uint16');
            gBufferPass.drawIndexed(sphereGeom.indices.length, particleCount);
            gBufferPass.end();

            // ============ 2. SHADOW PASS ============
            device.queue.writeBuffer(shadowUniformBuffer, 0, lightProjectionViewMatrix);
            device.queue.writeBuffer(shadowUniformBuffer, 64, shadowUniformData);

            const shadowPass = commandEncoder.beginRenderPass({
                colorAttachments: [],
                depthStencilAttachment: {
                    view: shadowDepthTextureView,
                    depthClearValue: 1.0,
                    depthLoadOp: 'clear',
                    depthStoreOp: 'store',
                },
            });
            shadowPass.setPipeline(shadowPipeline);
            shadowPass.setBindGroup(0, shadowBindGroup);
            shadowPass.setVertexBuffer(0, aoSphereVertexBuffer);  // Use low-poly for shadow map
            shadowPass.setIndexBuffer(aoSphereIndexBuffer, 'uint16');
            shadowPass.drawIndexed(aoSphereGeom.indices.length, particleCount);
            shadowPass.end();

            // ============ 3. AMBIENT OCCLUSION PASS ============
            device.queue.writeBuffer(aoUniformBuffer, 0, projectionMatrix);
            device.queue.writeBuffer(aoUniformBuffer, 64, viewMatrix);
            aoUniformData[0] = canvas.width; aoUniformData[1] = canvas.height; aoUniformData[2] = FOV;
            // aoUniformData[3-7] are pre-set with sphereRadius and simOffset
            device.queue.writeBuffer(aoUniformBuffer, 128, aoUniformData);

            const aoPass = commandEncoder.beginRenderPass({
                colorAttachments: [{
                    view: occlusionTextureView,
                    clearValue: { r: 0, g: 0, b: 0, a: 0 },
                    loadOp: 'clear',
                    storeOp: 'store',
                }],
                depthStencilAttachment: {
                    view: depthTextureView,
                    depthLoadOp: 'load',
                    depthStoreOp: 'store',
                },
            });
            aoPass.setPipeline(aoPipeline);
            aoPass.setBindGroup(0, aoBindGroup);
            aoPass.setVertexBuffer(0, aoSphereVertexBuffer);
            aoPass.setIndexBuffer(aoSphereIndexBuffer, 'uint16');
            aoPass.drawIndexed(aoSphereGeom.indices.length, particleCount);
            aoPass.end();

            // ============ 4. COMPOSITE PASS ============
            device.queue.writeBuffer(compositeUniformBuffer, 0, inverseViewMatrix);
            device.queue.writeBuffer(compositeUniformBuffer, 64, lightProjectionViewMatrix);

            // Build extended composite uniforms including scene data
            let cIdx = 0;
            // resolution, fov, shadowResolution (offset 128)
            compositeUniformData[cIdx++] = canvas.width;
            compositeUniformData[cIdx++] = canvas.height;
            compositeUniformData[cIdx++] = FOV;
            compositeUniformData[cIdx++] = SHADOW_MAP_SIZE;
            // cameraPos + pad (offset 144)
            const camPos = camera.getPosition();
            compositeUniformData[cIdx++] = camPos[0];
            compositeUniformData[cIdx++] = camPos[1];
            compositeUniformData[cIdx++] = camPos[2];
            compositeUniformData[cIdx++] = 0;
            // dirToSun + floorY (offset 160)
            compositeUniformData[cIdx++] = sceneConfig.dirToSun[0];
            compositeUniformData[cIdx++] = sceneConfig.dirToSun[1];
            compositeUniformData[cIdx++] = sceneConfig.dirToSun[2];
            compositeUniformData[cIdx++] = sceneConfig.floorY;
            // skyColorHorizon + sunPower (offset 176)
            compositeUniformData[cIdx++] = sceneConfig.skyColorHorizon[0];
            compositeUniformData[cIdx++] = sceneConfig.skyColorHorizon[1];
            compositeUniformData[cIdx++] = sceneConfig.skyColorHorizon[2];
            compositeUniformData[cIdx++] = sceneConfig.sunPower;
            // skyColorZenith + sunBrightness (offset 192)
            compositeUniformData[cIdx++] = sceneConfig.skyColorZenith[0];
            compositeUniformData[cIdx++] = sceneConfig.skyColorZenith[1];
            compositeUniformData[cIdx++] = sceneConfig.skyColorZenith[2];
            compositeUniformData[cIdx++] = sceneConfig.sunBrightness;
            // skyColorGround + floorSize (offset 208)
            compositeUniformData[cIdx++] = sceneConfig.skyColorGround[0];
            compositeUniformData[cIdx++] = sceneConfig.skyColorGround[1];
            compositeUniformData[cIdx++] = sceneConfig.skyColorGround[2];
            compositeUniformData[cIdx++] = sceneConfig.floorSize;
            // tileCol1 + tileScale (offset 224)
            compositeUniformData[cIdx++] = sceneConfig.tileCol1[0];
            compositeUniformData[cIdx++] = sceneConfig.tileCol1[1];
            compositeUniformData[cIdx++] = sceneConfig.tileCol1[2];
            compositeUniformData[cIdx++] = sceneConfig.tileScale;
            // tileCol2 + tileDarkFactor (offset 240)
            compositeUniformData[cIdx++] = sceneConfig.tileCol2[0];
            compositeUniformData[cIdx++] = sceneConfig.tileCol2[1];
            compositeUniformData[cIdx++] = sceneConfig.tileCol2[2];
            compositeUniformData[cIdx++] = sceneConfig.tileDarkFactor;
            // tileCol3 + pad (offset 256)
            compositeUniformData[cIdx++] = sceneConfig.tileCol3[0];
            compositeUniformData[cIdx++] = sceneConfig.tileCol3[1];
            compositeUniformData[cIdx++] = sceneConfig.tileCol3[2];
            compositeUniformData[cIdx++] = 0;
            // tileCol4 + pad (offset 272)
            compositeUniformData[cIdx++] = sceneConfig.tileCol4[0];
            compositeUniformData[cIdx++] = sceneConfig.tileCol4[1];
            compositeUniformData[cIdx++] = sceneConfig.tileCol4[2];
            compositeUniformData[cIdx++] = 0;

            device.queue.writeBuffer(compositeUniformBuffer, 128, compositeUniformData);

            const compositePass = commandEncoder.beginRenderPass({
                colorAttachments: [{
                    view: compositingTextureView,
                    clearValue: { r: 0.9, g: 0.9, b: 0.9, a: 1.0 },
                    loadOp: 'clear',
                    storeOp: 'store',
                }],
            });
            compositePass.setPipeline(compositePipeline);
            compositePass.setBindGroup(0, compositeBindGroup);
            compositePass.draw(4);
            compositePass.end();

            // ============ 4.1 WIREFRAME PASS ============
            const wireframePass = commandEncoder.beginRenderPass({
                colorAttachments: [{
                    view: compositingTextureView,
                    loadOp: 'load',
                    storeOp: 'store',
                }],
                depthStencilAttachment: {
                    view: depthTextureView,
                    depthLoadOp: 'load',
                    depthStoreOp: 'store',
                },
            });
            boxEditor.draw(wireframePass, projectionMatrix, camera, [currentSimOffsetX, currentSimOffsetY, currentSimOffsetZ], [smoothConfig.boxWidth, smoothConfig.boxHeight, smoothConfig.boxDepth]);
            wireframePass.end();

            // ============ 5. FXAA PASS ============
            fxaaUniformData[0] = canvas.width; fxaaUniformData[1] = canvas.height;
            device.queue.writeBuffer(fxaaUniformBuffer, 0, fxaaUniformData);

            const fxaaPass = commandEncoder.beginRenderPass({
                colorAttachments: [{
                    view: context.getCurrentTexture().createView(),
                    clearValue: { r: 0.9, g: 0.9, b: 0.9, a: 1.0 },
                    loadOp: 'clear',
                    storeOp: 'store',
                }],
            });
            fxaaPass.setPipeline(fxaaPipeline);
            fxaaPass.setBindGroup(0, fxaaBindGroup);
            fxaaPass.draw(4);
            fxaaPass.end();
        } else {
            // No particles - just clear
            const passEncoder = commandEncoder.beginRenderPass({
                colorAttachments: [{
                    view: context.getCurrentTexture().createView(),
                    clearValue: { r: 0.9, g: 0.9, b: 0.9, a: 1.0 },
                    loadOp: 'clear',
                    storeOp: 'store',
                }],
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
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        });
        gBufferTextureView = gBufferTexture.createView();

        occlusionTexture.destroy();
        occlusionTexture = device.createTexture({
            size: [canvas.width, canvas.height],
            format: 'r16float',
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        });
        occlusionTextureView = occlusionTexture.createView();

        compositingTexture.destroy();
        compositingTexture = device.createTexture({
            size: [canvas.width, canvas.height],
            format: presentationFormat,
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        });
        compositingTextureView = compositingTexture.createView();

        createSizeDepedentBindGroups();
        updateProjectionMatrix();
    });
}

init();
