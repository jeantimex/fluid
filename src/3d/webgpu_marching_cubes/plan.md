---
  Three Unity Scenes: Technical Comparison

  All three scenes share the exact same SPH fluid simulation (FluidSim.compute, 11 kernels). They differ only
  in how the fluid is visualized.

  Shared Simulation Pipeline (identical across all 3)

  External Forces → Spatial Hash → GPU Sort → Reorder →
  Density Calc → Pressure Forces → Viscosity → Integration

  Rendering Differences
  ┌────────────────────┬─────────────────────────────┬──────────────────────────┬────────────────────────────┐
  │       Aspect       │          Particles          │         Raymarch         │       Marching Cubes       │
  ├────────────────────┼─────────────────────────────┼──────────────────────────┼────────────────────────────┤
  │ Visualization      │ Billboard quads per         │ Full-screen ray cast     │ Polygonal mesh from        │
  │                    │ particle                    │ through volume           │ isosurface                 │
  ├────────────────────┼─────────────────────────────┼──────────────────────────┼────────────────────────────┤
  │ 3D Density Texture │ No                          │ Yes (150x100x80)         │ Yes (150x150x150)          │
  ├────────────────────┼─────────────────────────────┼──────────────────────────┼────────────────────────────┤
  │ Surface            │ Implicit (each dot =        │ Implicit (density field) │ Explicit (triangle mesh)   │
  │ Representation     │ particle)                   │                          │                            │
  ├────────────────────┼─────────────────────────────┼──────────────────────────┼────────────────────────────┤
  │ Lighting           │ Velocity-based coloring     │ Fresnel, refraction,     │ Lambertian (dot(N,L))      │
  │                    │                             │ extinction               │                            │
  ├────────────────────┼─────────────────────────────┼──────────────────────────┼────────────────────────────┤
  │ GPU Output         │ DrawMeshInstancedIndirect   │ Image-effect             │ DrawProceduralIndirect     │
  │                    │                             │ post-process             │                            │
  ├────────────────────┼─────────────────────────────┼──────────────────────────┼────────────────────────────┤
  │ Geometry Generated │ None (vertex pulling)       │ None (per-pixel          │ Triangles via append       │
  │                    │                             │ raymarch)                │ buffer                     │
  └────────────────────┴─────────────────────────────┴──────────────────────────┴────────────────────────────┘
  The Marching Cubes Pipeline (Unity)

  Particles → [SPH Simulation] → Positions/Densities
      ↓
  [UpdateDensityTexture kernel] → 3D density texture (R16_SFloat)
      ↓
  [MarchingCubes.compute] → reads density volume, evaluates 8 corners per voxel
      ↓
      ├─ LUT lookup (256 configs → edge indices)
      ├─ Vertex interpolation along edges (lerp by density)
      ├─ Normal from density gradient (central differences)
      └─ AppendBuffer<Triangle> output
      ↓
  [RenderArgsCompute] → copies triangle count × 3 to indirect args
      ↓
  [DrawProceduralIndirect] → MarchingCubesDraw.shader reads StructuredBuffer<Triangle> by SV_VertexID

  What Already Exists in Your WebGPU Ports
  Component: SPH simulation (all stages)
  webgpu_particles: Yes
  webgpu_raymarch: Yes (reuses particles)
  Needed for MC: Reuse
  ────────────────────────────────────────
  Component: 3D density texture generation
  webgpu_particles: No
  webgpu_raymarch: Yes (splat_pipeline.ts, 3-pass atomic splat)
  Needed for MC: Reuse
  ────────────────────────────────────────
  Component: Orbit camera, input, math
  webgpu_particles: Yes
  webgpu_raymarch: Yes
  Needed for MC: Reuse
  ────────────────────────────────────────
  Component: Common config/types/GUI
  webgpu_particles: Yes
  webgpu_raymarch: Yes
  Needed for MC: Reuse
  ────────────────────────────────────────
  Component: Marching cubes compute
  webgpu_particles: No
  webgpu_raymarch: No
  Needed for MC: Port
  ────────────────────────────────────────
  Component: Marching cubes LUT
  webgpu_particles: No
  webgpu_raymarch: No
  Needed for MC: Port
  ────────────────────────────────────────
  Component: Mesh render pipeline
  webgpu_particles: No
  webgpu_raymarch: No
  Needed for MC: Port
  ────────────────────────────────────────
  Component: Indirect draw args compute
  webgpu_particles: No
  webgpu_raymarch: No
  Needed for MC: Port
  Recommended Porting Strategy

  Base your marching cubes port on webgpu_raymarch, since it already has both the simulation and the density
  texture generation. You only need to replace the raymarch renderer with a marching cubes pipeline. Here's
  what to build:

  1. Port the LUT — Convert MarchingCubesLUT.txt into a GPU storage buffer. This is a static table of ~2,460
  ints containing the 256 cube configurations and edge-to-corner mappings.

  2. Port MarchingCubes.compute → marching_cubes.wgsl — A single compute shader dispatched as [8,8,8]
  workgroups over the density volume. For each voxel:
  - Sample 8 corners from the density texture
  - Build an 8-bit config index (above/below isoLevel)
  - Look up edge list from LUT
  - Interpolate vertex positions along edges using density values
  - Compute normals via central differences on the density field
  - Write triangles to a storage buffer (WebGPU doesn't have append buffers, so use atomicAdd on a counter)

  3. Port RenderArgsCompute.compute → render_args.wgsl — A tiny compute shader that reads the atomic triangle
  counter and writes [triCount * 3, 1, 0, 0] into the indirect draw buffer.

  4. Port MarchingCubesDraw.shader → marching_cubes_draw.wgsl — A render shader that uses vertex_index
  (equivalent to Unity's SV_VertexID) to read from the triangle storage buffer. Vertex shader transforms
  position; fragment shader does Lambertian lighting with the interpolated normal.

  5. Wire it up — The frame loop becomes:
  [SPH simulation passes]  ← reuse from webgpu_raymarch
  [Splat density texture]  ← reuse splat_pipeline.ts
  [Clear triangle counter] ← new (1 dispatch)
  [Marching cubes compute] ← new (main algorithm)
  [Render args compute]    ← new (1 dispatch)
  [DrawIndirect triangles] ← new (render pass)

  Key WebGPU difference from Unity: WebGPU has no AppendStructuredBuffer. Instead, use a regular storage
  buffer + an atomic counter. Each workgroup thread does atomicAdd(&counter, numTriangles) to get a write
  offset, then writes triangles at that offset. This is a well-established pattern in WebGPU compute.