export interface GridResettableRenderer {
  resetGridBuffer: () => void;
}

export function resetGridRenderer(renderer?: GridResettableRenderer | null) {
  renderer?.resetGridBuffer();
}
