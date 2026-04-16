import './style.css';
import { setupGui } from './gui';
import { FLUID_PALETTES } from './palette';
import { MotionController } from './motion';
import { HybridFlipSimulation } from './simulation';
import { createAppShell, renderAppState } from './ui';
import type { AppState, FluidPalette, RGB, SimulationParams, Vec2 } from './types';

const DEFAULT_PARAMS: SimulationParams = {
  dt: 1 / 120,
  picRatio: 0.05,
  numPressureIters: 60,
  numParticleIters: 3,
  overRelaxation: 1.7,
  compensateDrift: true,
  separateParticles: true,
  damping: 1.0,
  numExtrapolationIters: 2,
  maxDiffuseParticles: 12000,
  diffuseEmissionRate: 6,
  diffuseMinSpeed: 1.4,
  diffuseLifetime: 2.4,
  bubbleBuoyancy: 4.0,
  foamGravity: 1.0,
  sprayGravity: 1.0,
  weightTurbulence: 0.5,
  weightWavecrest: 0.8,
  weightKinetic: 0.3,
  bubbleEmissionScale: 0.5,
  foamEmissionScale: 1.0,
  sprayEmissionScale: 1.0,
  diffuseRepulsionStrength: 0.1,
  showSpray: true,
  showFoam: true,
  showBubble: true,
  showParticles: true,
  showGrid: false,
  resolution: 70,
  relWaterWidth: 0.6,
  relWaterHeight: 0.8,
  numParticles: 5000,
};

const COLOR_LERP_SPEED = 4;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpColor(current: RGB, target: RGB, t: number): RGB {
  return {
    r: lerp(current.r, target.r, t),
    g: lerp(current.g, target.g, t),
    b: lerp(current.b, target.b, t),
  };
}

function clonePalette(palette: FluidPalette): FluidPalette {
  return {
    fluidColor:  { ...palette.fluidColor },
    foamColor:   { ...palette.foamColor },
    sprayColor:  { ...palette.sprayColor },
    bubbleColor: { ...palette.bubbleColor },
  };
}

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('Missing #app container');

const elements = createAppShell(root);

let appState: AppState = 'loading';
let gravity: Vec2 = { x: 0, y: -9.81 };
let paletteIndex = 0;
let targetPalette = clonePalette(FLUID_PALETTES[0]);
let currentPalette = clonePalette(FLUID_PALETTES[0]);
let destroyed = false;
let useDeviceMotion = true;

const simulation = new HybridFlipSimulation(
  elements.canvas,
  gravity,
  currentPalette,
  DEFAULT_PARAMS
);

const motion = new MotionController({
  onGravityChange(nextGravity) {
    gravity = nextGravity;
    if (useDeviceMotion) {
      simulation.setGravity(nextGravity);
      gui.syncGravity(nextGravity);
    }
  },
  onShake() {
    paletteIndex = (paletteIndex + 1) % FLUID_PALETTES.length;
    targetPalette = clonePalette(FLUID_PALETTES[paletteIndex]);
  },
  onStateChange(nextState) {
    appState = nextState;
    if (nextState === 'denied' || nextState === 'not-supported') {
      useDeviceMotion = false;
      gui.syncUseDeviceMotion(false);
    }
    if (nextState === 'ready') {
      gui.syncUseDeviceMotion(useDeviceMotion);
    }
    renderAppState(elements, appState);
  },
});

const gui = setupGui(DEFAULT_PARAMS, currentPalette, gravity, {
  onUseDeviceMotionChange(enabled) {
    useDeviceMotion = enabled;
    if (enabled) {
      void motion.requestPermission().then(() => {
        const sensorGravity = motion.getGravity();
        simulation.setGravity(sensorGravity);
        gui.syncGravity(sensorGravity);
      });
    } else {
      simulation.setGravity(gravity);
    }
  },
  onGravityChange(nextGravity) {
    gravity = nextGravity;
    simulation.setGravity(nextGravity);
  },
  onPaletteChange(nextPalette) {
    currentPalette = clonePalette(nextPalette);
    targetPalette = clonePalette(nextPalette);
    simulation.setPalette(currentPalette);
  },
  onReset() {
    simulation.reset();
  },
});

elements.actionButton.addEventListener('click', () => {
  void motion.requestPermission();
});

function animatePaletteTransition(previousTime = performance.now()): void {
  if (destroyed) return;

  const now = performance.now();
  const dt = Math.min(0.05, (now - previousTime) / 1000);
  const t = Math.min(1, dt * COLOR_LERP_SPEED);

  currentPalette = {
    fluidColor:  lerpColor(currentPalette.fluidColor,  targetPalette.fluidColor,  t),
    foamColor:   lerpColor(currentPalette.foamColor,   targetPalette.foamColor,   t),
    sprayColor:  lerpColor(currentPalette.sprayColor,  targetPalette.sprayColor,  t),
    bubbleColor: lerpColor(currentPalette.bubbleColor, targetPalette.bubbleColor, t),
  };

  simulation.setPalette(currentPalette);
  requestAnimationFrame(() => animatePaletteTransition(now));
}

function handleResize(): void {
  simulation.resize();
}

window.addEventListener('resize', handleResize);
window.addEventListener('beforeunload', () => {
  destroyed = true;
  simulation.dispose();
  motion.dispose();
  gui.destroy();
});

renderAppState(elements, appState);
simulation.start();
void motion.initialize();
animatePaletteTransition();
