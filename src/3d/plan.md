Here is my analysis of the current state and what needs to be cleaned up to achieve a swappable rendering
  architecture.

  1. Physics Core Inconsistency
  The most critical issue is that the physics simulation engine is fragmented:
   * `webgpu_particles` & `webgpu_screen_space`: Use the Linear Grid approach (deterministic indexing,
     contention-free scatter, strip-optimized kernels). This is the most optimized version.
   * `webgpu_marching_cubes` & `webgpu_raymarch`: Use the older Spatial Hash approach (prime-based hashing,
     atomic contention in scatter). They import these components from a secondary file in the webgpu_particles
     directory.

  Cleanup Task: Standardize all 4 projects on the Linear Grid SPH engine and move it to src/3d/common/sim/.

  2. Resource Management Duplication
  Each project manages its own GPUBuffer and GPUComputePipeline instances.
   * SimulationBuffersLinear.ts is duplicated between particles and screen_space.
   * ComputePipelinesLinear.ts is likewise duplicated.
   * webgpu_screen_space adds unique Foam buffers, while the others don't have them.

  Cleanup Task: Create a unified SimulationBuffers class in common that supports optional features (like Foam)
  via composition or conditional allocation.

  3. Rendering Architecture
  The rendering logic is currently "trapped" inside each project's FluidSimulation class or a custom Renderer
  class that isn't standardized.
   * `webgpu_marching_cubes` & `webgpu_raymarch`: Both require a Density Splatting pass (3 compute passes)
     before the final draw.
   * `webgpu_screen_space`: Uses a complex multi-pass pipeline (Depth → Thickness → Smoothing → Normals →
     Composite).
   * `webgpu_particles`: Uses a simple billboard pass with GPU frustum culling.

  Cleanup Task: Implement a Strategy Pattern for rendering. The FluidSimulation should only handle physics,
  while a FluidRenderer interface handles the draw calls.

  4. Workflow Comparison
  The workflows are actually quite similar, which makes modularization feasible:
   1. Init: Create Device/Context.
   2. Setup: Instantiate Sim Core + selected Renderer.
   3. Reset: (Re)allocate buffers based on config → Recreate Bind Groups.
   4. Step: Execute N physics substeps.
   5. Render:
       * Step A: Prep rendering resources (Culling, Splatting, or Depth passes).
       * Step B: Draw to swapchain.

  Recommended Refactoring Plan

  Before we add the dropdown to swap renderers, we should perform these cleanup steps:

   1. Extract Common Sim: Move the Linear Grid SPH logic (Shaders + SimulationBuffers + ComputePipelines) to
      src/3d/common/sim/.
   2. Define a `FluidRenderer` Interface:

   1     interface FluidRenderer {
   2       readonly name: string;
   3       init(device: GPUDevice, format: GPUTextureFormat): void;
   4       recreate(config: SimConfig, buffers: SimulationBuffers): void;
   5       render(encoder: GPUCommandEncoder, view: GPUTextureView, camera: OrbitCamera, config: SimConfig):
     void;
   6     }
   3. Modularize Passes:
       * Create a DensitySplatPass that can be shared by Marching Cubes and Raymarch.
       * Create a FoamSimPass that can be toggled on/off in any renderer.
   4. Unify Config: Merge the specialized config interfaces into a single FluidAppConfig or ensure they all
      inherit from a robust SimConfig.
   5. Standardize Environment: All 4 projects now use the shared environment.wgsl, but they pass data
      differently. We should unify the EnvironmentUniforms update logic.

  Is it possible?
  Yes, absolutely. The underlying particle data (positions/velocities) is the same for all rendering methods.
  The main challenge will be handling the "Foam" system, as only one version currently supports it, and
  standardizing the specialized uniform buffers each renderer needs.