import { FluidRenderer, setupFluidScene } from './fluid';
import type { FluidPalette, SimulationParams, Vec2 } from './types';

// SIM_HEIGHT is the reference domain height used to compute the physics cell
// size (h = SIM_HEIGHT / resolution). It never changes. The actual visible
// domain height (simHeight) adapts to the canvas while keeping the same scale.
const SIM_HEIGHT = 3.0;

export class PicFlipSimulation {
  private renderer: FluidRenderer;
  private fluid;
  private simWidth: number;
  private simHeight: number;
  private pixelsPerUnit: number; // px per world unit, fixed at construction
  private animationId = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private gravity: Vec2,
    private palette: FluidPalette,
    private params: SimulationParams
  ) {
    this.renderer = new FluidRenderer(canvas);

    // Establish the visual scale from the initial canvas size. Every subsequent
    // resize keeps pixelsPerUnit constant — only the domain bounds change.
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const pixW = Math.max(1, Math.round(rect.width * dpr));
    const pixH = Math.max(1, Math.round(rect.height * dpr));
    this.pixelsPerUnit = pixH / SIM_HEIGHT;
    this.simWidth = pixW / this.pixelsPerUnit;
    this.simHeight = SIM_HEIGHT; // pixH / pixelsPerUnit === SIM_HEIGHT by construction
    this.renderer.resize(pixW, pixH);

    this.fluid = this.createFluid();
  }

  start(): void {
    this.stop();
    this.tick();
  }

  stop(): void {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = 0;
    }
  }

  dispose(): void {
    this.stop();
  }

  setGravity(gravity: Vec2): void {
    this.gravity = gravity;
  }

  setPalette(palette: FluidPalette): void {
    this.palette = palette;
    this.applyPalette();
  }

  reset(): void {
    // createFluid always uses SIM_HEIGHT so h = SIM_HEIGHT/resolution stays
    // constant regardless of the current domain height. resizeDomain then
    // expands/contracts the grid to match the actual domain without changing h.
    this.fluid = this.createFluid();
    this.applyPalette();
    this.fluid.resizeDomain(this.simWidth, this.simHeight);
    this.renderer.invalidateGridBuffer();
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));

    this.renderer.resize(width, height);

    const newSimWidth = width / this.pixelsPerUnit;
    const newSimHeight = height / this.pixelsPerUnit;
    if (newSimWidth !== this.simWidth || newSimHeight !== this.simHeight) {
      this.simWidth = newSimWidth;
      this.simHeight = newSimHeight;
      this.fluid.resizeDomain(newSimWidth, newSimHeight);
      this.renderer.invalidateGridBuffer();
    }
  }

  private createFluid() {
    const fluid = setupFluidScene(
      this.simWidth,
      SIM_HEIGHT, // always use the reference height for h computation
      this.params.resolution,
      this.params.relWaterWidth,
      this.params.relWaterHeight,
      this.params.numParticles,
      this.palette.fluidColor
    );
    fluid.setDiffuseColors(this.palette.foamColor, this.palette.sprayColor, this.palette.bubbleColor);
    return fluid;
  }

  private applyPalette(): void {
    this.fluid.setFluidColor(this.palette.fluidColor);
    this.fluid.setDiffuseColors(this.palette.foamColor, this.palette.sprayColor, this.palette.bubbleColor);
  }

  private tick = (): void => {
    this.fluid.simulate(
      this.params.dt,
      this.gravity.x,
      this.gravity.y,
      this.params.picRatio,
      this.params.numPressureIters,
      this.params.numParticleIters,
      this.params.overRelaxation,
      this.params.compensateDrift,
      this.params.separateParticles,
      this.params.damping,
      this.params.enableWhitewater,
      this.params.maxDiffuseParticles,
      this.params.diffuseEmissionRate,
      this.params.diffuseMinSpeed,
      this.params.diffuseLifetime,
      this.params.bubbleBuoyancy,
      this.params.foamGravity,
      this.params.sprayGravity,
      this.params.weightTurbulence,
      this.params.weightWavecrest,
      this.params.weightKinetic,
      this.params.bubbleEmissionScale,
      this.params.foamEmissionScale,
      this.params.sprayEmissionScale,
      this.params.diffuseRepulsionStrength
    );

    this.renderer.render(this.fluid, {
      showParticles: this.params.showParticles,
      showDiffuseParticles: this.params.showDiffuseParticles,
      showSpray: this.params.showSpray,
      showFoam: this.params.showFoam,
      showBubble: this.params.showBubble,
      showGrid: this.params.showGrid,
      simWidth: this.simWidth,
      simHeight: this.simHeight,
    });

    this.animationId = requestAnimationFrame(this.tick);
  };
}
