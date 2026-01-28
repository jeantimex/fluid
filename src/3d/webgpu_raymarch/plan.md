Key differences (texture + rendering)

  - Fluid-Sim/Assets/Scenes/Fluid Particles.unity runs FluidSim with renderToTex3D: 0 and
    densityTextureRes: 1, so no 3D density texture is generated; rendering is via ParticleDisplay3D (and
    foam) using particle buffers.
  - Fluid-Sim/Assets/Scenes/Fluid Raymarch.unity runs FluidSim with renderToTex3D: 1 and
    densityTextureRes: 150, so a 3D density texture is generated each frame and consumed by
    RayMarchingTest on the “Raymarching Camera”.
  - The raymarch scene adds RayMarchingTest (image effect) and a Test Cube transform; the particles scene
    adds Particle Display with ParticleDisplay3D + FoamRenderTest.
  - Texture usage is only wired in the raymarch setup; the particles setup doesn’t reference DensityMap.

  How the fluid “texture” is applied (Unity)

  - FluidSim creates and updates a 3D render texture (DensityMap) in UpdateDensityMap() when renderToTex3D
    is true. Fluid-Sim/Assets/Scripts/Simulation/FluidSim.cs.
  - The compute kernel UpdateDensityTexture writes density per voxel into DensityMap, sampling particle
    density at each voxel via neighbor search. Fluid-Sim/Assets/Scripts/Simulation/Compute/
    FluidSim.compute.
  - RayMarchingTest sets DensityMap on the raymarch material and passes bounds + density scaling
    parameters. Fluid-Sim/Assets/Scripts/Rendering/Raymarch/RayMarchingTest.cs.
  - The shader samples the 3D texture (DensityMap.SampleLevel) using normalized bounds-space UVW. Fluid-
    Sim/Assets/Scripts/Rendering/Raymarch/Raymarching.shader.

  Relevant fields in the raymarch scene

  - densityTextureRes: 150, renderToTex3D: 1 on FluidSim.
  - densityOffset: 200, densityMultiplier: 0.05 on RayMarchingTest (note the script divides by 1000 before
    sending to shader).
  - shader: Raymarching.shader, cubeTransform: Test Cube, sim: FluidSim.

  Reusing src/3d/webgpu_particles
  You can reuse most of it:

  - Reuse: FluidSimulation orchestration, SimulationBuffers, ComputePipelines, SPH kernels, spatial hash,
    and camera/input flow. Paths: src/3d/webgpu_particles/fluid_simulation.ts, simulation_buffers.ts,
    compute_pipelines.ts, orbit_camera.ts.
  - Add: a density-volume compute pass equivalent to Unity’s UpdateDensityTexture that writes a 3D texture
    (voxel grid) using neighbor search at each voxel position.
  - Add: a raymarch render pipeline (fullscreen triangle/quad) that samples the 3D density texture using
    the same bounds mapping as Unity’s shader.
  - Keep: bounds size from config (SimConfig.boundsSize) and use it to size the 3D texture similarly to
    Unity’s densityTextureRes scaling.

  Concrete mapping for WebGPU (based on Unity)

  - Allocate a 3D texture sized from bounds:
    w = round(bounds.x / maxAxis * densityTextureRes), etc. (mirrors FluidSim.UpdateDensityMap).
  - Compute pass: for each voxel, compute worldPos in bounds and evaluate density using your existing
    spatial hash + predicted positions (same neighbor search as in your density kernel, but centered at
    worldPos).
  - Raymarch shader: map worldPos → UVW as (pos + bounds * 0.5) / bounds, sample the 3D texture, apply
    densityOffset + densityMultiplier like Unity.

  Can sketch the WebGPU pipeline wiring (new buffers + bind groups + pass order) or scaffold the new
  webgpu_raymarch folder using the shared modules from webgpu_particles.