import { FluidRenderer, setupFluidScene } from './fluid';
import type { FluidPalette, SimulationParams, Vec2 } from './types';

const SIM_HEIGHT = 3.0;

export class PureFlipSimulation {
  private renderer: FluidRenderer;
  private fluid;
  private simWidth = 4.0;
  private animationId = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private gravity: Vec2,
    private palette: FluidPalette,
    private params: SimulationParams
  ) {
    this.renderer = new FluidRenderer(canvas);
    this.fluid = this.createFluid();
    this.resize();
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
    this.fluid = this.createFluid();
    this.applyPalette();
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));

    this.renderer.resize(width, height);
    this.simWidth = width / (height / SIM_HEIGHT);
    this.reset();
  }

  private createFluid() {
    return setupFluidScene(
      this.simWidth,
      SIM_HEIGHT,
      this.params.resolution,
      this.params.relWaterWidth,
      this.params.relWaterHeight,
      this.palette.fluidColor,
      this.palette.foamColor,
      this.palette.colorDiffusionCoeff,
      this.palette.foamReturnRate
    );
  }

  private applyPalette(): void {
    this.fluid.setFluidColor(this.palette.fluidColor);
    this.fluid.setFoamColor(this.palette.foamColor);
    this.fluid.setColorDiffusionCoeff(this.palette.colorDiffusionCoeff);
    this.fluid.setFoamReturnRate(this.palette.foamReturnRate);
  }

  private tick = (): void => {
    this.fluid.simulate(
      this.params.dt,
      this.gravity.x,
      this.gravity.y,
      this.params.flipRatio,
      this.params.numPressureIters,
      this.params.numParticleIters,
      this.params.overRelaxation,
      this.params.compensateDrift,
      this.params.separateParticles,
      this.params.damping
    );

    this.renderer.render(this.fluid, {
      showParticles: this.params.showParticles,
      showGrid: this.params.showGrid,
      simWidth: this.simWidth,
      simHeight: SIM_HEIGHT,
    });

    this.animationId = requestAnimationFrame(this.tick);
  };
}
