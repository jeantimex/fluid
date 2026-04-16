import { FlipFluid } from './FlipFluid';
import type { RGB } from '../types';

export function setupFluidScene(
  simWidth: number,
  simHeight: number,
  resolution = 70,
  relWaterWidth = 0.6,
  relWaterHeight = 0.8,
  numParticlesTarget = 0,
  baseColor?: RGB
): FlipFluid {
  const tankHeight = simHeight;
  const tankWidth = simWidth;
  const h = tankHeight / resolution;
  const density = 1000.0;

  const r = 0.3 * h;
  const dx = 2.0 * r;
  const dy = (Math.sqrt(3.0) / 2.0) * dx;

  const maxNumX = Math.floor((tankWidth - 2.0 * h - 2.0 * r) / dx);
  const maxNumY = Math.floor((tankHeight - 2.0 * h - 2.0 * r) / dy);
  let numX: number;
  let numY: number;
  if (numParticlesTarget > 0) {
    // Square block: numX * dx = numY * dy => numY = sqrt(N * dx/dy), numX = N / numY
    numY = Math.max(1, Math.min(Math.round(Math.sqrt(numParticlesTarget * dx / dy)), maxNumY));
    numX = Math.max(1, Math.min(Math.round(numParticlesTarget / numY), maxNumX));
  } else {
    numX = Math.floor((relWaterWidth * tankWidth - 2.0 * h - 2.0 * r) / dx);
    numY = Math.max(1, Math.floor((relWaterHeight * tankHeight - 2.0 * h - 2.0 * r) / dy));
  }
  const maxParticles = numX * numY;

  const fluid = new FlipFluid(
    density,
    tankWidth,
    tankHeight,
    h,
    r,
    maxParticles,
    baseColor
  );

  fluid.numParticles = numX * numY;

  const totalParticleWidth = (numX - 1) * dx;
  const totalParticleHeight = (numY - 1) * dy;
  const startX = (tankWidth - totalParticleWidth) / 2.0;
  const startY = (tankHeight - totalParticleHeight) / 2.0;

  let p = 0;
  for (let i = 0; i < numX; i++) {
    for (let j = 0; j < numY; j++) {
      fluid.particlePos[p++] = startX + dx * i + (j % 2 === 0 ? 0.0 : r);
      fluid.particlePos[p++] = startY + dy * j;
    }
  }

  const n = fluid.fNumY;
  for (let i = 0; i < fluid.fNumX; i++) {
    for (let j = 0; j < fluid.fNumY; j++) {
      let s = 1.0;
      if (i === 0 || i === fluid.fNumX - 1 || j === 0) {
        s = 0.0;
      }
      fluid.s[i * n + j] = s;
    }
  }

  return fluid;
}
