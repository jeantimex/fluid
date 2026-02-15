interface AnimationLoopOptions {
  frame: () => void;
  immediateStart?: boolean;
}

export function startAnimationLoop(options: AnimationLoopOptions) {
  const { frame, immediateStart = false } = options;

  function tick() {
    frame();
    requestAnimationFrame(tick);
  }

  if (immediateStart) {
    tick();
    return;
  }

  requestAnimationFrame(tick);
}
