import './style.css';
import { setupGui } from './gui';
import { FLUID_PALETTES } from './palette';
import { MotionController } from './motion';
import { HybridFlipSimulation } from './simulation';
import { createAppShell, renderAppState } from './ui';
import type { AppState, FluidPalette, RGB, SimulationParams } from './types';

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
let gravityMagnitude = 9.81;
let paletteIndex = 0;
let targetPalette = clonePalette(FLUID_PALETTES[0]);
let currentPalette = clonePalette(FLUID_PALETTES[0]);
let destroyed = false;
let useDeviceMotion = false;

const simulation = new HybridFlipSimulation(
  elements.canvas,
  { x: 0, y: -gravityMagnitude },
  currentPalette,
  DEFAULT_PARAMS
);

function updateHintVisibility(): void {
  elements.hint.hidden = !(useDeviceMotion && motion.hasMotionSupport());
}

const motion = new MotionController({
  onGravityChange(nextGravity) {
    if (useDeviceMotion) {
      simulation.setGravity(nextGravity);
    }
  },
  onShake() {
    if (useDeviceMotion) {
      paletteIndex = (paletteIndex + 1) % FLUID_PALETTES.length;
      targetPalette = clonePalette(FLUID_PALETTES[paletteIndex]);
    }
  },
  onStateChange(nextState) {
    appState = nextState;
    renderAppState(elements, appState);
    updateHintVisibility();
  },
});

const gui = setupGui(DEFAULT_PARAMS, currentPalette, gravityMagnitude, {
  onUseDeviceMotionChange(enabled) {
    useDeviceMotion = enabled;
    if (enabled && motion.hasMotionSupport()) {
      motion.setGravityMagnitude(gravityMagnitude);
    } else {
      simulation.setGravity({ x: 0, y: -gravityMagnitude });
    }
    updateHintVisibility();
  },
  onGravityChange(magnitude) {
    gravityMagnitude = magnitude;
    if (useDeviceMotion && motion.hasMotionSupport()) {
      motion.setGravityMagnitude(magnitude);
    } else {
      simulation.setGravity({ x: 0, y: -magnitude });
    }
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
