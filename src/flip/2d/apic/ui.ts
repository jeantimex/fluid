import type { AppState } from './types';

export interface AppElements {
  canvas: HTMLCanvasElement;
  overlay: HTMLDivElement;
  title: HTMLHeadingElement;
  message: HTMLParagraphElement;
  actionButton: HTMLButtonElement;
  hint: HTMLDivElement;
}

export function createAppShell(root: HTMLElement): AppElements {
  root.innerHTML = `
    <div class="pure-flip-app">
      <canvas class="pure-flip-canvas" aria-label="2D APIC fluid simulation"></canvas>
      <div class="pure-flip-hint" hidden>
        <p>Tilt your device to control the fluid.</p>
        <p>Shake to cycle palettes.</p>
      </div>
      <div class="pure-flip-overlay">
        <div class="pure-flip-panel">
          <div class="pure-flip-kicker">2D APIC</div>
          <h1 class="pure-flip-title"></h1>
          <p class="pure-flip-message"></p>
          <button class="pure-flip-button" type="button"></button>
        </div>
      </div>
    </div>
  `;

  return {
    canvas: root.querySelector('.pure-flip-canvas') as HTMLCanvasElement,
    overlay: root.querySelector('.pure-flip-overlay') as HTMLDivElement,
    title: root.querySelector('.pure-flip-title') as HTMLHeadingElement,
    message: root.querySelector('.pure-flip-message') as HTMLParagraphElement,
    actionButton: root.querySelector('.pure-flip-button') as HTMLButtonElement,
    hint: root.querySelector('.pure-flip-hint') as HTMLDivElement,
  };
}

export function renderAppState(elements: AppElements, state: AppState): void {
  const { overlay, title, message, actionButton, hint } = elements;

  hint.hidden = state !== 'ready';

  switch (state) {
    case 'loading':
      overlay.hidden = false;
      title.textContent = 'Initializing';
      message.textContent = 'Preparing the fluid simulation.';
      actionButton.hidden = true;
      break;
    case 'needs-permission':
      overlay.hidden = false;
      title.textContent = 'Motion Sensors Required';
      message.textContent =
        "This port keeps the original tilt-driven interaction. Grant motion access to let device orientation drive the solver.";
      actionButton.hidden = false;
      actionButton.textContent = 'Enable Motion Sensors';
      break;
    case 'denied':
      overlay.hidden = true;
      actionButton.hidden = true;
      break;
    case 'not-supported':
      overlay.hidden = true;
      actionButton.hidden = true;
      break;
    case 'ready':
      overlay.hidden = true;
      actionButton.hidden = true;
      break;
  }
}
