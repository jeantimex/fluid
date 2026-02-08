WebGPU Fluid - add-only integration plan

Goal
- Add a new "webgpu_fluid" app that can load and swap between the 4 existing 3D sims without modifying them.
- Keep each demo intact; use adapters to map their current APIs to a shared interface.

Key constraints
- No edits to existing projects under src/3d/webgpu_particles, src/3d/webgpu_marching_cubes,
  src/3d/webgpu_raymarch, src/3d/webgpu_screen_space.
- Adapters must tolerate differences in render workflow and config.
- Adapter cleanup is optional for now; GPU resource teardown can be added later when
  the underlying sims expose destroy hooks.

Proposed minimal shared interface

interface FluidAppAdapter<TConfig> {
  readonly name: string;
  readonly config: TConfig;
  init(opts: {
    device: GPUDevice;
    context: GPUCanvasContext;
    canvas: HTMLCanvasElement;
    format: GPUTextureFormat;
  }): Promise<void> | void;
  reset(): void;
  step(dt: number): Promise<void> | void;
  render(): void;
  resize(): void;
  destroy?(): void;
}

Notes
- render() is adapter-owned and may internally call the sim's render with viewMatrix or camera.
- resize() exists because some renderers allocate resolution-dependent textures.

Adapter mapping (current APIs)

1) webgpu_particles
- Sim: new FluidSimulation(device, context, canvas, config, format)
- step(dt): async
- render(viewMatrix): uses internal cull + renderer
- Requires: OrbitCamera, input handler

2) webgpu_screen_space
- Sim: new FluidSimulation(device, context, canvas, config, format)
- step(dt): async
- render(viewMatrix): screen-space renderer handles its own passes
- Requires: OrbitCamera, input handler

3) webgpu_marching_cubes
- Sim: new FluidSimulation(device, context, canvas, config, format)
- step(dt): async (splat happens inside step)
- render(camera): expects OrbitCamera instance

4) webgpu_raymarch
- Sim: new FluidSimulation(device, context, canvas, config, format)
- step(dt): async (splat happens inside step)
- render(camera): expects OrbitCamera instance

Shared utilities (import from existing demos)
- OrbitCamera: src/3d/webgpu_particles/orbit_camera.ts
- input handling: src/3d/webgpu_particles/input_handler.ts
- webgpu utils: src/3d/webgpu_particles/webgpu_utils.ts
- GUI + config + environment: src/3d/common/*

Manual test checklist
- Load the combined app and verify the first adapter renders and animates.
- Switch to each renderer via the dropdown; confirm it renders and animates.
- Test camera orbit (drag) and zoom (wheel) on each renderer.
- Test particle interaction (shift + left/right drag) in each renderer.
- Use Reset and verify particle positions reinitialize.
- Resize the window and confirm the renderer updates without errors.

Next step (code scaffolding)
- Create src/3d/webgpu_fluid/main.ts with a dropdown to pick adapter.
- Add adapters per sim under src/3d/webgpu_fluid/adapters/*.ts
- Reuse existing config builders and GUI wiring with per-adapter overrides.
