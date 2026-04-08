import { FlipFluid } from './FlipFluid';

export interface SceneConfig {
    gravity: number;
    dt: number;
    flipRatio: number;
    numPressureIters: number;
    numParticleIters: number;
    overRelaxation: number;
    compensateDrift: boolean;
    separateParticles: boolean;
    showParticles: boolean;
    showGrid: boolean;
}

export const DEFAULT_SCENE_CONFIG: SceneConfig = {
    gravity: -9.81,
    dt: 1.0 / 120.0,
    flipRatio: 0.9,
    numPressureIters: 100,
    numParticleIters: 2,
    overRelaxation: 1.9,
    compensateDrift: true,
    separateParticles: true,
    showParticles: true,
    showGrid: false
};

export function setupFluidScene(
    simWidth: number,
    simHeight: number,
    resolution = 100,
    relWaterWidth = 0.6,
    relWaterHeight = 0.8,
    baseColor?: { r: number; g: number; b: number },
    foamColor?: { r: number; g: number; b: number },
    colorDiffusionCoeff: number = 0.01,
    foamReturnRate: number = 1.0
): FlipFluid {
    const tankHeight = simHeight;
    const tankWidth = simWidth;
    const h = tankHeight / resolution;
    const density = 1000.0;

    // Particle setup
    const r = 0.3 * h;
    const dx = 2.0 * r;
    const dy = Math.sqrt(3.0) / 2.0 * dx;

    const numX = Math.floor((relWaterWidth * tankWidth - 2.0 * h - 2.0 * r) / dx);
    const numY = Math.floor((relWaterHeight * tankHeight - 2.0 * h - 2.0 * r) / dy);
    const maxParticles = numX * numY;

    // Create fluid
    const fluid = new FlipFluid(
        density,
        tankWidth,
        tankHeight,
        h,
        r,
        maxParticles,
        baseColor,
        foamColor,
        colorDiffusionCoeff,
        foamReturnRate
    );

    // Create particles centered on the screen
    fluid.numParticles = numX * numY;

    // Calculate total dimensions of the particle block
    const totalParticleWidth = (numX - 1) * dx;
    const totalParticleHeight = (numY - 1) * dy;

    // Calculate starting position to center the particles
    const startX = (tankWidth - totalParticleWidth) / 2.0;
    const startY = (tankHeight - totalParticleHeight) / 2.0;

    let p = 0;
    for (let i = 0; i < numX; i++) {
        for (let j = 0; j < numY; j++) {
            fluid.particlePos[p++] = startX + dx * i + (j % 2 === 0 ? 0.0 : r);
            fluid.particlePos[p++] = startY + dy * j;
        }
    }

    // Setup grid cells for the tank boundaries
    const n = fluid.fNumY;
    for (let i = 0; i < fluid.fNumX; i++) {
        for (let j = 0; j < fluid.fNumY; j++) {
            let s = 1.0; // Fluid
            if (i === 0 || i === fluid.fNumX - 1 || j === 0) {
                s = 0.0; // Solid
            }
            fluid.s[i * n + j] = s;
        }
    }

    return fluid;
}
