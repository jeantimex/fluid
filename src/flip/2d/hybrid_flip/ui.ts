import type { AppState } from './types';

export interface AppElements {
  canvas: HTMLCanvasElement;
  hint: HTMLDivElement;
  mobilePrompt: HTMLDivElement;
}

export function createAppShell(root: HTMLElement): AppElements {
  root.innerHTML = `
    <div class="pure-flip-app">
      <canvas class="pure-flip-canvas" aria-label="2D PIC/FLIP fluid simulation"></canvas>
      <div class="pure-flip-hint" hidden>
        <p>Tilt your device to control the fluid.</p>
        <p>Shake to cycle palettes.</p>
      </div>
      <div class="pure-flip-mobile-prompt" hidden>
        <p>Tap here to enable device tilt</p>
      </div>
    </div>
  `;

  return {
    canvas: root.querySelector('.pure-flip-canvas') as HTMLCanvasElement,
    hint: root.querySelector('.pure-flip-hint') as HTMLDivElement,
    mobilePrompt: root.querySelector('.pure-flip-mobile-prompt') as HTMLDivElement,
  };
}

export function renderAppState(_elements: AppElements, _state: AppState): void {
  // No overlay to manage
}
