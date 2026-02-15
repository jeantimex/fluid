interface AnimationLoopOptions {
  frame: () => void | Promise<void>;
  immediateStart?: boolean;
}

export function startAnimationLoop(options: AnimationLoopOptions) {
  const { frame, immediateStart = false } = options;

  function tick() {
    Promise.resolve(frame()).finally(() => {
      requestAnimationFrame(tick);
    });
  }

  if (immediateStart) {
    tick();
    return;
  }

  requestAnimationFrame(tick);
}
