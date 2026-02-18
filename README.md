# WebGPU Fluid Simulation

WebGPU fluid simulation using Smoothed Particle Hydrodynamics (SPH) and PIC/FLIP methods.

This project is ported from [Sebastian Lague](https://github.com/SebLague)'s [Fluid-Sim](https://github.com/SebLague/Fluid-Sim) Unity project and [David Li](https://github.com/dli)'s [Fluid Particles](https://github.com/dli/fluid) WebGL project. It explores various rendering and simulation techniques for real-time fluids in the browser, leveraging the power of WebGPU for both compute-heavy physics and advanced visualization pipelines.

## Key Features

- **GPU-Accelerated Physics**: SPH calculations (Density, Pressure, Viscosity) and PIC/FLIP grid-based solving run entirely in WebGPU compute shaders.
- **Efficient Spatial Sorting**: Uses a parallel Prefix-Sum and Linear Grid approach to handle tens of thousands of particles at 60 FPS.
- **Diverse Renderers**: From simple billboards to complex screen-space refraction and volumetric raymarching.
- **Interactive Simulation**: Real-time particle interaction (push/pull), dynamic obstacle manipulation, and smoothly interpolating bounding boxes.
- **Cross-Platform UI**: Responsive settings panel with Material Icons and performance statistics.

## Project Structure

### 2D Simulations

https://github.com/user-attachments/assets/6559bca9-59b1-4ca3-9723-de5a8d6c1b95

- **Canvas 2D**: A baseline implementation using the standard HTML5 Canvas API.
  - [Live Demo](https://jeantimex.github.io/fluid/canvas2d.html)
- **WebGPU 2D**: A 2D simulation utilizing WebGPU compute shaders for physics and a custom render pipeline.
  - [Live Demo](https://jeantimex.github.io/fluid/webgpu2d.html)

### 3D Simulations

https://github.com/user-attachments/assets/26b13e45-8f26-4896-9a95-ab9bfaddc907

[Live Demo](https://jeantimex.github.io/fluid/)

The project features several specialized 3D rendering techniques and simulation methods:

#### 1. Billboard Particles (webgpu_particles)

Renders fluid particles as camera-facing quads.

- **Techniques**: Vertex pulling, indirect instanced rendering, and frustum culling.
- **Shading**: Features dynamic shadow mapping and velocity-based color gradients.

#### 2. Marching Cubes (webgpu_marching_cubes)

Extracts a polygonal mesh from the fluid density field in real-time.

- **Techniques**: GPU-based Marching Cubes algorithm, density probing, and hardware-accelerated mesh rendering.
- **Visuals**: Classic "metaball" look with a solid, reflective surface.

#### 3. Volumetric Raymarching (webgpu_raymarch)

Visualizes the fluid by marching rays through a density field.

- **Techniques**: Signed Distance Fields (SDF) approximation from particles, volumetric lighting, and refraction.
- **Visuals**: Provides a thick, jelly-like or deep-water aesthetic with realistic light extinction.

#### 4. Screen-Space Fluid (webgpu_screen_space)

A high-end rendering pipeline that treats fluid as a continuous surface.

- **Pipeline**:
  1. **Depth Pass**: Renders particle depth to a texture.
  2. **Smoothing Pass**: Applies a bilateral blur to remove "bumpy" particle artifacts.
  3. **Thickness Pass**: Calculates fluid volume for light absorption.
  4. **Normal Pass**: Reconstructs surface normals from the depth buffer.
  5. **Foam Simulation**: Advects foam particles based on trapped air and kinetic energy.
  6. **Composite**: Final shading with refraction, Fresnel effects, and shadows.

#### 5. FLIP Fluid (webgpu_flip)

A high-performance PIC/FLIP hybrid simulation with dynamic boundaries.

- **Techniques**: Hybrid particle-grid solver using a staggered MAC grid for pressure projection.
- **Dynamic Boundaries**: Features a smoothly interpolating bounding box that reacts to physics in real-time.
- **Visual Decoupling**: Particle rendering radius is independent of physical spacing, allowing for highly customizable visual densities.

#### 6. Unified Dashboard (webgpu_fluid)

The main entry point that allows hot-swapping between all 3D renderers while preserving the simulation state (gravity, bounds, particle positions).

## Getting Started

### Prerequisites

- A browser with WebGPU support (Chrome 113+, Edge 113+, or Firefox Nightly with flags).
- Node.js (v20.19.0 or higher recommended).

### Installation

```bash
# Clone the repository
git clone https://github.com/jeantimex/fluid.git

# Install dependencies
npm install
```

### Development

```bash
# Start the Vite development server
npm run dev
```

### Production

```bash
# Build the project
npm run build
```

## Inspiration and Credits

- Inspired by [Sebastian Lague](https://github.com/SebLague)'s "[Coding Adventure: Simulating Fluids](youtube.com/watch?si=oe9BznpAUnMWUslT&v=rSKMYc1CQHE&feature=youtu.be)" and "[Rendering Fluids](https://www.youtube.com/watch?v=kOkfC5fLfgE)".
- Based on the Smoothed Particle Hydrodynamics (SPH) formulation for incompressible flow and the PIC/FLIP hybrid method.
- Heavily influenced by [David Li](https://github.com/dli)'s work on real-time WebGL fluid simulations.

## License

This project is licensed under the MIT License - see the LICENSE file for details.
