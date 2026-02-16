# WebGPU Fluid Simulation Porting Plan

This plan outlines the step-by-step process of porting the WebGL PIC/FLIP fluid simulation reference to WebGPU. The focus is on a direct port of the logic and rendering techniques used in the `webgl_ref` project.

## Phase 1: Project Scaffolding & Scene Setup
Goal: Set up the basic environment, camera, and volume editing tools.

- **Task 1.1: Project Structure**
  - Create `index.html`, `main.ts`, and `style.css`.
  - Set up a basic WebGPU boilerplate (device/context initialization).
- **Task 1.2: Math & Camera Utilities**
  - Port `utilities.js` (Matrix/Vector math) to `utilities.ts`.
  - Port `camera.js` to `camera.ts` (Orbit controls).
- **Task 1.3: Box Editor**
  - Port `boxeditor.js` and its AABB logic to `box_editor.ts` and `aabb.ts`.
  - Implement the `BoxEditor` rendering using WebGPU (Grid and Box wireframes).
- **Task 1.4: Scene Integration**
  - Coordinate the camera and box editor in `main.ts` to allow defining fluid volumes.

## Phase 2: Particle Rendering
Goal: Initialize and render thousands of particles as instanced spheres.

- **Task 2.1: Particle Buffers**
  - Create Storage Buffers for particle positions and velocities.
- **Task 2.2: Sphere Geometry**
  - Port the `generateSphereGeometry` function from `renderer.js`.
  - Create Vertex and Index buffers for the sphere mesh.
- **Task 2.3: Instanced Rendering Pipeline**
  - Create a WGSL shader for rendering instanced spheres.
  - Implement the rendering loop to draw particles at their stored positions.
- **Task 2.4: Particle Spawning**
  - Implement logic to spawn particles within the defined `BoxEditor` volumes.
  - Verify that particles appear correctly in the scene.

## Phase 3: Grid & Transfer Operations
Goal: Set up the simulation grid and implement the particle-to-grid transfer.

- **Task 3.1: Grid Buffer Setup**
  - Define Storage Buffers for the MAC Grid (Velocity X, Y, Z, and Weight).
  - Use 1D arrays to represent the 3D grid for efficiency.
- **Task 3.2: Transfer to Grid (Splatting)**
  - Implement a Compute Shader to accumulate particle velocities into the grid.
  - Use atomic operations or efficient summation techniques.
- **Task 3.3: Grid Normalization & Marking**
  - Implement a Compute Shader to divide accumulated velocities by weights.
  - Implement a Compute Shader to mark grid cells as Fluid or Air.

## Phase 4: Fluid Simulation Logic
Goal: Implement the core PIC/FLIP simulation steps.

- **Task 4.1: External Forces & Boundaries**
  - Implement a Compute Shader to apply gravity and handle wall collisions.
- **Task 4.2: Pressure Projection (Incompressibility)**
  - Implement a Compute Shader to calculate divergence.
  - Implement the Jacobi Pressure Solver as a Compute Shader (Iterative).
  - Implement a Compute Shader to subtract the pressure gradient from the velocity grid.
- **Task 4.3: Velocity Update (PIC/FLIP)**
  - Implement a Compute Shader to transfer velocities from the grid back to particles.
  - Support the "flipness" parameter to mix PIC and FLIP methods.
- **Task 4.4: Advection**
  - Implement a Compute Shader to move particles through the velocity field (RK2).

## Phase 5: Rendering Enhancements
Goal: Port the advanced rendering features from the reference.

- **Task 5.1: Shadow Mapping**
  - Implement a depth-only pass for particles and obstacles.
- **Task 5.2: Spherical Ambient Occlusion**
  - Port the AO shader logic to WGSL to add depth to the particle mass.
- **Task 5.3: Post-Processing (FXAA)**
  - Implement a final screen-space pass for anti-aliasing.

## Phase 6: Final Integration
Goal: UI and Polish.

- **Task 6.1: UI Controls**
  - Port the sliders and buttons for Fluidity, Density, and Speed.
- **Task 6.2: Optimization**
  - Clean up buffers and optimize workgroup sizes for compute shaders.
