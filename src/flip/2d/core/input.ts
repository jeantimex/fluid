export interface WorldPoint {
  x: number;
  y: number;
}

export function clientToWorld(
  canvas: HTMLCanvasElement,
  cScale: number,
  clientX: number,
  clientY: number
): WorldPoint {
  const bounds = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const mx = (clientX - bounds.left) * dpr;
  const my = (clientY - bounds.top) * dpr;
  return {
    x: mx / cScale,
    y: (canvas.height - my) / cScale,
  };
}
