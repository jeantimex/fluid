interface ResizeBootstrapOptions {
  resize: () => void;
  onBeforeResize?: () => void;
}

export function bootstrapWithResize(options: ResizeBootstrapOptions) {
  const { resize, onBeforeResize } = options;
  onBeforeResize?.();
  resize();
  window.addEventListener("resize", resize);
}
