import GUI from 'lil-gui';
import Stats from 'stats-gl';

export interface GuiCallbacks {
  onReset?: () => void;
}

export interface GuiOptions {
  title?: string;
  subtitle?: string;
  githubUrl?: string;
  features?: string[];
  interactions?: string[];
  buildTimestamp?: string;
}

export interface GuiSetup {
  gui: GUI;
  stats: Stats;
}

export function setupGui(
  scene: any,
  _callbacks: GuiCallbacks = {},
  options: GuiOptions = {}
): GuiSetup {
  // Ensure Material Icons are loaded
  if (!document.querySelector('link[href*="Material+Icons"]')) {
    const link = document.createElement('link');
    link.href = 'https://fonts.googleapis.com/icon?family=Material+Icons';
    link.rel = 'stylesheet';
    document.head.appendChild(link);
  }

  // Add CSS for the collapsible GUI (copied from SPH project)
  const style = document.createElement('style');
  style.textContent = `
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
  document.head.appendChild(style);

  const container = document.createElement('div');
  container.id = 'gui-container';
  if (window.innerWidth <= 480) {
    container.classList.add('collapsed');
  }
  document.body.appendChild(container);

  const headerMain = document.createElement('div');
  headerMain.className = 'gui-header-main';
  container.appendChild(headerMain);

  const toggleBtn = document.createElement('button');
  toggleBtn.className = 'gui-toggle-btn';
  toggleBtn.innerHTML = '<span class="material-icons">menu</span>';
  headerMain.appendChild(toggleBtn);

  const titleArea = document.createElement('div');
  titleArea.className = 'gui-title-area';
  headerMain.appendChild(titleArea);

  const contentWrapper = document.createElement('div');
  contentWrapper.className = 'gui-content-wrapper';
  container.appendChild(contentWrapper);

  const toggleCollapse = (e?: Event) => {
    if (e) e.stopPropagation();
    container.classList.toggle('collapsed');
  };

  toggleBtn.onclick = toggleCollapse;
  container.onclick = () => {
    if (container.classList.contains('collapsed')) {
      container.classList.remove('collapsed');
    }
  };

  if (options.title) {
    const titleSpan = document.createElement('span');
    titleSpan.style.cssText = `
      font-size: 16px;
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    `;
    titleSpan.textContent = options.title;
    titleArea.appendChild(titleSpan);

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
    }

    const header = document.createElement('div');
    header.style.cssText = `
      background: #1a1a1a;
      color: #fff;
      box-sizing: border-box;
    `;

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

    if (options.subtitle) {
      const sub = document.createElement('div');
      sub.style.cssText = `
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
      sub.textContent = options.subtitle;
      aboutContent.appendChild(sub);
    }

    const author = document.createElement('div');
    author.style.cssText = `
      padding: 0 11px 10px 11px;
      font-size: 10px;
      font-weight: 400;
      opacity: 1.0;
      letter-spacing: 0.01em;
    `;
    author.innerHTML =
      'Original Author: <a href="https://www.youtube.com/c/TenMinutePhysics" target="_blank" rel="noopener noreferrer" style="color: inherit; text-decoration: underline;">Ten Minute Physics</a>';
    aboutContent.appendChild(author);

    // Build timestamp
    if (options.buildTimestamp) {
      const buildInfo = document.createElement('div');
      buildInfo.style.cssText = `
        padding: 0 11px 10px 11px;
        font-size: 10px;
        font-weight: 400;
        opacity: 0.6;
        letter-spacing: 0.01em;
      `;
      const buildDate = new Date(options.buildTimestamp);
      buildInfo.textContent = `Build: ${buildDate.toLocaleDateString()} ${buildDate.toLocaleTimeString()}`;
      aboutContent.appendChild(buildInfo);
    }

    if (options.features && options.features.length > 0) {
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

      const list = document.createElement('ul');
      list.style.cssText = `
        margin: 0;
        padding: 0 0 0 14px;
        font-size: 10px;
        opacity: 0.7;
        line-height: 1.4;
      `;
      options.features.forEach((f) => {
        const li = document.createElement('li');
        li.textContent = f;
        list.appendChild(li);
      });
      featContainer.appendChild(list);
      aboutContent.appendChild(featContainer);
    }

    if (options.interactions && options.interactions.length > 0) {
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

      const list = document.createElement('ul');
      list.style.cssText = `
        margin: 0;
        padding: 0 0 0 14px;
        font-size: 10px;
        opacity: 0.7;
        line-height: 1.4;
      `;
      options.interactions.forEach((i) => {
        const li = document.createElement('li');
        li.textContent = i;
        list.appendChild(li);
      });
      intContainer.appendChild(list);
      aboutContent.appendChild(intContainer);
    }

    aboutSection.appendChild(aboutHeader);
    aboutSection.appendChild(aboutContent);
    contentWrapper.appendChild(header);
    contentWrapper.appendChild(aboutSection);
  }

  // Create GUI and append to container
  const gui = new GUI({
    container: contentWrapper,
    title: 'Simulation Settings',
  });

  const stats = new Stats({
    trackGPU: false,
    horizontal: true,
  });
  stats.dom.style.position = 'fixed';
  stats.dom.style.bottom = '10px';
  stats.dom.style.left = '10px';
  stats.dom.style.zIndex = '10000';
  document.body.appendChild(stats.dom);

  const displayFolder = gui.addFolder('Display');
  displayFolder.add(scene, 'showParticles').name('Particles');
  displayFolder.add(scene, 'showGrid').name('Grid');

  const simulationFolder = gui.addFolder('Simulation');
  simulationFolder.add(scene, 'compensateDrift').name('Compensate Drift');
  simulationFolder.add(scene, 'separateParticles').name('Separate Particles');
  simulationFolder.add(scene, 'flipRatio', 0, 1, 0.1).name('FLIP Ratio');
  simulationFolder.add(scene, 'gravity', -20, 20, 0.01).name('Gravity');

  const solverFolder = gui.addFolder('Solver');
  solverFolder.add(scene, 'numPressureIters', 1, 200, 1).name('Pressure Iters');
  solverFolder.add(scene, 'numParticleIters', 1, 5, 1).name('Particle Iters');
  solverFolder.add(scene, 'overRelaxation', 1, 2, 0.01).name('Over Relaxation');

  return { gui, stats };
}
