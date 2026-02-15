export interface ResizeResult {
  dpr: number;
  simWidth: number;
  simHeight: number;
  cScale: number;
}

export function resizeSimulationCanvas(canvas: HTMLCanvasElement): ResizeResult {
  const dpr = window.devicePixelRatio || 1;
  const width = window.innerWidth;
  const height = window.innerHeight;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';

  const cScale = 300.0 * dpr;
  return {
    dpr,
    cScale,
    simWidth: canvas.width / cScale,
    simHeight: canvas.height / cScale,
  };
}
