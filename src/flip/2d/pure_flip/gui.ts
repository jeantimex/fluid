import GUI from 'lil-gui';
import type { FluidPalette, SimulationParams, Vec2 } from './types';

export interface PureFlipGuiState {
  useDeviceMotion: boolean;
  gravityX: number;
  gravityY: number;
  fluidColor: string;
  foamColor: string;
  colorDiffusionCoeff: number;
  foamReturnRate: number;
  dt: number;
  flipRatio: number;
  numPressureIters: number;
  numParticleIters: number;
  overRelaxation: number;
  damping: number;
  resolution: number;
  relWaterWidth: number;
  relWaterHeight: number;
  separateParticles: boolean;
  showGrid: boolean;
  reset: () => void;
}

export interface PureFlipGuiCallbacks {
  onUseDeviceMotionChange: (enabled: boolean) => void;
  onGravityChange: (gravity: Vec2) => void;
  onPaletteChange: (palette: FluidPalette) => void;
  onReset: () => void;
}

export interface PureFlipGuiHandle {
  gui: GUI;
  destroy: () => void;
  syncGravity: (gravity: Vec2) => void;
  syncUseDeviceMotion: (enabled: boolean) => void;
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
  initialGravity: Vec2,
  callbacks: PureFlipGuiCallbacks
): PureFlipGuiHandle {
  const state: PureFlipGuiState = {
    useDeviceMotion: true,
    gravityX: initialGravity.x,
    gravityY: initialGravity.y,
    fluidColor: rgbToHex(palette.fluidColor),
    foamColor: rgbToHex(palette.foamColor),
    colorDiffusionCoeff: palette.colorDiffusionCoeff,
    foamReturnRate: palette.foamReturnRate,
    dt: params.dt,
    flipRatio: params.flipRatio,
    numPressureIters: params.numPressureIters,
    numParticleIters: params.numParticleIters,
    overRelaxation: params.overRelaxation,
    damping: params.damping,
    resolution: params.resolution,
    relWaterWidth: params.relWaterWidth,
    relWaterHeight: params.relWaterHeight,
    separateParticles: params.separateParticles,
    showGrid: params.showGrid,
    reset: callbacks.onReset,
  };

  const gui = new GUI({ title: 'Pure FLIP Controls' });
  gui.close();

  const gravityFolder = gui.addFolder('Gravity');
  const gravityControllers = {
    x: gravityFolder.add(state, 'gravityX', -9.81, 9.81, 0.01).name('X'),
    y: gravityFolder.add(state, 'gravityY', -9.81, 9.81, 0.01).name('Y'),
  };

  gui
    .add(state, 'useDeviceMotion')
    .name('Use Device Motion')
    .onChange((enabled: boolean) => {
      callbacks.onUseDeviceMotionChange(enabled);
      if (!enabled) {
        callbacks.onGravityChange({ x: state.gravityX, y: state.gravityY });
      }
    });

  gravityControllers.x.onChange((value: number) => {
    if (!state.useDeviceMotion) {
      callbacks.onGravityChange({ x: value, y: state.gravityY });
    }
  });
  gravityControllers.y.onChange((value: number) => {
    if (!state.useDeviceMotion) {
      callbacks.onGravityChange({ x: state.gravityX, y: value });
    }
  });

  const simulationFolder = gui.addFolder('Simulation');
  simulationFolder
    .add(state, 'dt', 1 / 240, 1 / 30, 1 / 240)
    .name('Delta Time')
    .onChange((value: number) => {
      params.dt = value;
    });
  simulationFolder
    .add(state, 'flipRatio', 0, 1, 0.01)
    .name('FLIP Ratio')
    .onChange((value: number) => {
      params.flipRatio = value;
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

  const fluidFolder = gui.addFolder('Fluid');
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

  const colorFolder = gui.addFolder('Color');
  const emitPaletteChange = () => {
    palette.fluidColor = hexToRgb(state.fluidColor);
    palette.foamColor = hexToRgb(state.foamColor);
    palette.colorDiffusionCoeff = state.colorDiffusionCoeff;
    palette.foamReturnRate = state.foamReturnRate;
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
    .add(state, 'colorDiffusionCoeff', 0, 0.01, 0.0001)
    .name('Color Diffusion')
    .onChange(emitPaletteChange);
  colorFolder
    .add(state, 'foamReturnRate', 0, 2, 0.01)
    .name('Foam Return')
    .onChange(emitPaletteChange);

  gui.add(state, 'reset').name('Reset Simulation');

  return {
    gui,
    destroy: () => gui.destroy(),
    syncGravity: (gravity) => {
      state.gravityX = gravity.x;
      state.gravityY = gravity.y;
      gravityControllers.x.updateDisplay();
      gravityControllers.y.updateDisplay();
    },
    syncUseDeviceMotion: (enabled) => {
      state.useDeviceMotion = enabled;
      gui.controllersRecursive().forEach((controller) => {
        if (controller.property === 'useDeviceMotion') {
          controller.updateDisplay();
        }
      });
    },
  };
}
