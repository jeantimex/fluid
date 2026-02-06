1. Fluid Raymarch.unity
  This scene uses Volumetric Raymarching to calculate shadows on the fly within the shader.
   * Technique: "Marching towards the light."
   * How it works:
       * The shader (Raymarching.shader) renders the fluid by marching a ray from the camera through the 3D density volume.
       * To calculate the shadow at any point (e.g., on the floor or inside the fluid), it fires a secondary ray from that
         point towards the light source.
       * It steps through the 3D DensityMap texture along this light ray, accumulating density.
       * It calculates light transmission using Beer's Law (exp(-accumulatedDensity * extinction)).
   * Pros/Cons: Physically accurate for volumetric data but computationally expensive (many texture samples per pixel).


  2. Fluid ScreenSpace 1.unity
  This scene uses Shadow Mapping (Thickness Accumulation).
   * Technique: "Render to Texture from Light's View."
   * How it works:
       * It uses a dedicated Shadow Camera (controlled by FluidRenderTest.cs) positioned at the light source.
       * This camera renders all fluid particles into a 2D texture (ShadowMap). Instead of color, it accumulates the
         thickness of the particles.
       * The main rendering shader (FluidRender.shader) then calculates the shadow for the floor/background by projecting
         the world position into the light's view space (standard shadow mapping math).
       * It samples the accumulated thickness from the ShadowMap and applies Beer's Law (exp(-thickness * extinction)) to
         darken the surface.
   * Pros/Cons: Much faster (rasterization-based) but is an approximation that assumes the light travels straight through
     the accumulated thickness.


  Summary:
   * Raymarch: Real-time 3D volume sampling (heavy, accurate).
   * ScreenSpace: 2D Shadow Map rasterization (fast, approximate).


=============================

Short answer: the Unity scene does not use built‑in Unity shadows. It creates a custom particle shadow map from a
  dedicated “Shadow Camera,” then the floor is procedurally shaded in the composite shader and multiplied by that shadow
  map.

  How the particle shadow reaches the tiles floor

  - The scene’s Fluid Renderer component is FluidRenderTest and it wires in shadowCam and sun. See /Users/jeantimex/
    Workspace/github/fluid-simulation/Fluid-Sim/Assets/Scenes/Fluid ScreenSpace 1.unity and /Users/jeantimex/Workspace/
    github/fluid-simulation/Fluid-Sim/Assets/Scripts/Rendering/ScreenSpace/FluidRenderTest.cs.
  - Each frame, FluidRenderTest.BuildCommands() renders particles into shadowRt via the shadow camera using matThickness
    (the same quad‑instanced particle path), then Gaussian‑blurs it:
    /Users/jeantimex/Workspace/github/fluid-simulation/Fluid-Sim/Assets/Scripts/Rendering/ScreenSpace/FluidRenderTest.cs.
  - ShadowCamSetup() positions an orthographic shadow camera aligned to the light direction and sized to the sim bounds.
    /Users/jeantimex/Workspace/github/fluid-simulation/Fluid-Sim/Assets/Scripts/Rendering/ScreenSpace/FluidRenderTest.cs.
  - In the composite shader (FluidRender.shader), the floor is not a mesh; it’s a ray‑box intersection in
    SampleEnvironment().
    It transforms the hit point into light clip space using shadowVP, samples ShadowMap, then applies Beer‑Lambert
    absorption and ambient:
    /Users/jeantimex/Workspace/github/fluid-simulation/Fluid-Sim/Assets/Scripts/Rendering/ScreenSpace/Shaders/
    FluidRender.shader.

  Key lines to look at

  - Shadow render + blur: /Users/jeantimex/Workspace/github/fluid-simulation/Fluid-Sim/Assets/Scripts/Rendering/ScreenSpace/
    FluidRenderTest.cs
  - Shadow map sampling on the floor: /Users/jeantimex/Workspace/github/fluid-simulation/Fluid-Sim/Assets/Scripts/Rendering/
    ScreenSpace/Shaders/FluidRender.shader

  ———

  Port feasibility to src/3d/webgpu_screen_space
  Yes, a clean port is doable, but the WebGPU version currently has no particle shadow map feeding the floor. The
  environment shader only has sky/floor/tiles + obstacle lighting and does not take a shadow texture or light VP matrix.

  What’s missing in WebGPU:

  - There is no pass that renders particle thickness from a light‑space camera to a shadow texture.
  - EnvironmentUniforms does not include shadowVP and there is no ShadowMap texture in the composite bind group.
    /Users/jeantimex/Workspace/unity-canvas2d/src/3d/common/shaders/environment.wgsl
    /Users/jeantimex/Workspace/unity-canvas2d/src/3d/webgpu_screen_space/screen_space/shaders/composite_final.wgsl

  What a faithful port needs

  1. Shadow pass: render particles to a low‑res shadow texture from an orthographic light camera aligned to dirToSun (match
     Unity’s shadowCam + FrameBoundsOrtho logic).
  2. Blur: add a separable blur pass (the Unity version uses Gaussian) to soften shadow edges.
  3. Composite: add ShadowMap + shadowVP to the composite shader and multiply the floor tile color by the shadow term
     (including Beer‑Lambert absorption and ambient floor light).
  4. Uniform updates: mirror Unity’s shadowVP, dirToSun, and floor params update into WebGPU’s EnvironmentUniforms /
     composite uniforms.

  If you want, I can:

  1. Add the shadow pass + blur in src/3d/webgpu_screen_space.
  2. Extend EnvironmentUniforms and composite pipeline to sample the shadow map.
  3. Tune it to match Unity visually.