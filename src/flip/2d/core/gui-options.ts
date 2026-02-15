import { GuiOptions } from '../canvas2d/gui';

const DEFAULT_INTERACTIONS = [
  'Click & Drag: Move Obstacle',
  'P: Pause/Resume',
  'M: Step Simulation',
  'Click Reset to apply Fluid > Setup',
];

const DEFAULT_GITHUB_URL = 'https://github.com/jeantimex/fluid';

export function createFluidGuiOptions(options: GuiOptions): GuiOptions {
  return {
    ...options,
    interactions: options.interactions ?? DEFAULT_INTERACTIONS,
    githubUrl: options.githubUrl ?? DEFAULT_GITHUB_URL,
  };
}
