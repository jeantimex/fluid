import GUI from 'lil-gui';
import type { FluidPalette, SimulationParams } from './types';

export interface HybridFlipGuiState {
  useDeviceMotion: boolean;
  gravity: number;
  fluidColor: string;
  foamColor: string;
  sprayColor: string;
  bubbleColor: string;
  dt: number;
  picRatio: number;
  numPressureIters: number;
  numParticleIters: number;
  numExtrapolationIters: number;
  overRelaxation: number;
  damping: number;
  resolution: number;
  relWaterWidth: number;
  relWaterHeight: number;
  numParticles: number;
  separateParticles: boolean;
  maxDiffuseParticles: number;
  diffuseEmissionRate: number;
  diffuseMinSpeed: number;
  diffuseLifetime: number;
  bubbleBuoyancy: number;
  weightTurbulence: number;
  weightWavecrest: number;
  weightKinetic: number;
  bubbleEmissionScale: number;
  foamEmissionScale: number;
  sprayEmissionScale: number;
  diffuseRepulsionStrength: number;
  showSpray: boolean;
  showFoam: boolean;
  showBubble: boolean;
  showGrid: boolean;
  reset: () => void;
}

export interface HybridFlipGuiCallbacks {
  onUseDeviceMotionChange: (enabled: boolean) => void;
  onGravityChange: (magnitude: number) => void;
  onPaletteChange: (palette: FluidPalette) => void;
  onReset: () => void;
}

export interface HybridFlipGuiHandle {
  gui: GUI;
  destroy: () => void;
  syncGravity: (magnitude: number) => void;
}

function rgbToHex({ r, g, b }: { r: number; g: number; b: number }): string {
  const toByte = (value: number) =>
    Math.max(0, Math.min(255, Math.round(value * 255)))
      .toString(16)
      .padStart(2, '0');

  return `#${toByte(r)}${toByte(g)}${toByte(b)}`;
}

function hexToRgb(hex: string) {
  const normalized = hex.replace('#', '');
  const value = normalized.length === 3
    ? normalized
        .split('')
        .map((char) => char + char)
        .join('')
    : normalized;

  const int = parseInt(value, 16);
  return {
    r: ((int >> 16) & 255) / 255,
    g: ((int >> 8) & 255) / 255,
    b: (int & 255) / 255,
  };
}

export function setupGui(
  params: SimulationParams,
  palette: FluidPalette,
  initialGravityMagnitude: number,
  callbacks: HybridFlipGuiCallbacks
): HybridFlipGuiHandle {
  const state: HybridFlipGuiState = {
    useDeviceMotion: false,
    gravity: initialGravityMagnitude,
    fluidColor: rgbToHex(palette.fluidColor),
    foamColor: rgbToHex(palette.foamColor),
    sprayColor: rgbToHex(palette.sprayColor),
    bubbleColor: rgbToHex(palette.bubbleColor),
    dt: params.dt,
    picRatio: params.picRatio,
    numPressureIters: params.numPressureIters,
    numParticleIters: params.numParticleIters,
    numExtrapolationIters: params.numExtrapolationIters,
    overRelaxation: params.overRelaxation,
    damping: params.damping,
    resolution: params.resolution,
    relWaterWidth: params.relWaterWidth,
    relWaterHeight: params.relWaterHeight,
    numParticles: params.numParticles,
    separateParticles: params.separateParticles,
    maxDiffuseParticles: params.maxDiffuseParticles,
    diffuseEmissionRate: params.diffuseEmissionRate,
    diffuseMinSpeed: params.diffuseMinSpeed,
    diffuseLifetime: params.diffuseLifetime,
    bubbleBuoyancy: params.bubbleBuoyancy,
    weightTurbulence: params.weightTurbulence,
    weightWavecrest: params.weightWavecrest,
    weightKinetic: params.weightKinetic,
    bubbleEmissionScale: params.bubbleEmissionScale,
    foamEmissionScale: params.foamEmissionScale,
    sprayEmissionScale: params.sprayEmissionScale,
    diffuseRepulsionStrength: params.diffuseRepulsionStrength,
    showSpray: params.showSpray,
    showFoam: params.showFoam,
    showBubble: params.showBubble,
    showGrid: params.showGrid,
    reset: callbacks.onReset,
  };

  const gui = new GUI({ title: 'Hybrid FLIP Controls' });
  gui.close();

  const simulationFolder = gui.addFolder('Simulation').close();
  simulationFolder
    .add(state, 'dt', 1 / 240, 1 / 30, 1 / 240)
    .name('Delta Time')
    .onChange((value: number) => {
      params.dt = value;
    });
  simulationFolder
    .add(state, 'picRatio', 0, 1, 0.01)
    .name('PIC Blend')
    .onChange((value: number) => {
      params.picRatio = value;
    });
  simulationFolder
    .add(state, 'numPressureIters', 1, 120, 1)
    .name('Pressure Iters')
    .onChange((value: number) => {
      params.numPressureIters = value;
    });
  simulationFolder
    .add(state, 'numParticleIters', 0, 8, 1)
    .name('Separation Iters')
    .onChange((value: number) => {
      params.numParticleIters = value;
    });
  simulationFolder
    .add(state, 'numExtrapolationIters', 0, 10, 1)
    .name('Extrapolation Iters')
    .onChange((value: number) => {
      params.numExtrapolationIters = value;
    });
  simulationFolder
    .add(state, 'overRelaxation', 1, 2, 0.01)
    .name('Over Relaxation')
    .onChange((value: number) => {
      params.overRelaxation = value;
    });
  simulationFolder
    .add(state, 'damping', 0.9, 1, 0.001)
    .name('Damping')
    .onChange((value: number) => {
      params.damping = value;
    });
  simulationFolder
    .add(state, 'separateParticles')
    .name('Separate Particles')
    .onChange((value: boolean) => {
      params.separateParticles = value;
    });
  simulationFolder
    .add(state, 'showGrid')
    .name('Show Grid')
    .onChange((value: boolean) => {
      params.showGrid = value;
    });

  const fluidFolder = gui.addFolder('Fluid').close();
  const gravityController = fluidFolder
    .add(state, 'gravity', -20, 20, 0.1)
    .name('Gravity')
    .onChange((value: number) => {
      callbacks.onGravityChange(value);
    });
  fluidFolder
    .add(state, 'useDeviceMotion')
    .name('Use Device Tilt')
    .onChange((enabled: boolean) => {
      callbacks.onUseDeviceMotionChange(enabled);
    });
  fluidFolder
    .add(state, 'resolution', 20, 140, 1)
    .name('Resolution')
    .onFinishChange((value: number) => {
      params.resolution = value;
      callbacks.onReset();
    });
  fluidFolder
    .add(state, 'relWaterWidth', 0.2, 0.95, 0.01)
    .name('Water Width')
    .onFinishChange((value: number) => {
      params.relWaterWidth = value;
      callbacks.onReset();
    });
  fluidFolder
    .add(state, 'relWaterHeight', 0.2, 0.95, 0.01)
    .name('Water Height')
    .onFinishChange((value: number) => {
      params.relWaterHeight = value;
      callbacks.onReset();
    });
  fluidFolder
    .add(state, 'numParticles', 500, 20000, 100)
    .name('Particle Count')
    .onFinishChange((value: number) => {
      params.numParticles = value;
      callbacks.onReset();
    });

  const whitewaterFolder = gui.addFolder('Whitewater').close();
  whitewaterFolder
    .add(state, 'maxDiffuseParticles', 0, 50000, 500)
    .name('Max Particles')
    .onFinishChange((value: number) => {
      params.maxDiffuseParticles = value;
    });
  whitewaterFolder
    .add(state, 'diffuseEmissionRate', 0, 40, 0.1)
    .name('Emission Rate')
    .onChange((value: number) => {
      params.diffuseEmissionRate = value;
    });
  whitewaterFolder
    .add(state, 'diffuseMinSpeed', 0, 8, 0.05)
    .name('Min Speed')
    .onChange((value: number) => {
      params.diffuseMinSpeed = value;
    });
  whitewaterFolder
    .add(state, 'diffuseLifetime', 0.1, 8, 0.1)
    .name('Lifetime')
    .onChange((value: number) => {
      params.diffuseLifetime = value;
    });
  whitewaterFolder
    .add(state, 'bubbleBuoyancy', 0, 10, 0.1)
    .name('Bubble Buoyancy')
    .onChange((value: number) => {
      params.bubbleBuoyancy = value;
    });
  whitewaterFolder
    .add(state, 'weightTurbulence', 0, 5, 0.05)
    .name('Turbulence Weight')
    .onChange((value: number) => {
      params.weightTurbulence = value;
    });
  whitewaterFolder
    .add(state, 'weightWavecrest', 0, 5, 0.05)
    .name('Wavecrest Weight')
    .onChange((value: number) => {
      params.weightWavecrest = value;
    });
  whitewaterFolder
    .add(state, 'weightKinetic', 0, 5, 0.05)
    .name('Kinetic Weight')
    .onChange((value: number) => {
      params.weightKinetic = value;
    });
  whitewaterFolder
    .add(state, 'bubbleEmissionScale', 0, 10, 0.1)
    .name('Bubble Emission')
    .onChange((value: number) => {
      params.bubbleEmissionScale = value;
    });
  whitewaterFolder
    .add(state, 'foamEmissionScale', 0, 10, 0.1)
    .name('Foam Emission')
    .onChange((value: number) => {
      params.foamEmissionScale = value;
    });
  whitewaterFolder
    .add(state, 'sprayEmissionScale', 0, 10, 0.1)
    .name('Spray Emission')
    .onChange((value: number) => {
      params.sprayEmissionScale = value;
    });
  whitewaterFolder
    .add(state, 'diffuseRepulsionStrength', 0, 1, 0.01)
    .name('Repulsion Strength')
    .onChange((value: number) => {
      params.diffuseRepulsionStrength = value;
    });
  whitewaterFolder
    .add(state, 'showSpray')
    .name('Show Spray')
    .onChange((value: boolean) => {
      params.showSpray = value;
    });
  whitewaterFolder
    .add(state, 'showFoam')
    .name('Show Foam')
    .onChange((value: boolean) => {
      params.showFoam = value;
    });
  whitewaterFolder
    .add(state, 'showBubble')
    .name('Show Bubble')
    .onChange((value: boolean) => {
      params.showBubble = value;
    });

  const colorFolder = gui.addFolder('Color').close();
  const emitPaletteChange = () => {
    palette.fluidColor  = hexToRgb(state.fluidColor);
    palette.foamColor   = hexToRgb(state.foamColor);
    palette.sprayColor  = hexToRgb(state.sprayColor);
    palette.bubbleColor = hexToRgb(state.bubbleColor);
    callbacks.onPaletteChange(palette);
  };

  colorFolder
    .addColor(state, 'fluidColor')
    .name('Fluid Color')
    .onChange(emitPaletteChange);
  colorFolder
    .addColor(state, 'foamColor')
    .name('Foam Color')
    .onChange(emitPaletteChange);
  colorFolder
    .addColor(state, 'sprayColor')
    .name('Spray Color')
    .onChange(emitPaletteChange);
  colorFolder
    .addColor(state, 'bubbleColor')
    .name('Bubble Color')
    .onChange(emitPaletteChange);

  gui.add(state, 'reset').name('Reset Simulation');

  return {
    gui,
    destroy: () => gui.destroy(),
    syncGravity: (magnitude) => {
      state.gravity = magnitude;
      gravityController.updateDisplay();
    },
  };
}
