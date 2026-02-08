import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        'main-index': resolve(__dirname, 'index.html'),
        'main-canvas2d': resolve(__dirname, 'canvas2d.html'),
        'main-webgpu2d': resolve(__dirname, 'webgpu2d.html'),
        'main-scene': resolve(__dirname, 'scene.html'),
        // Subdirectory demos
        'demo-2d-canvas2d': resolve(__dirname, 'src/2d/canvas2d/index.html'),
        'demo-2d-webgpu': resolve(__dirname, 'src/2d/webgpu/index.html'),
        'demo-3d-particles': resolve(__dirname, 'src/3d/webgpu_particles/index.html'),
        'demo-3d-raymarch': resolve(__dirname, 'src/3d/webgpu_raymarch/index.html'),
        'demo-3d-screen-space': resolve(__dirname, 'src/3d/webgpu_screen_space/index.html'),
        'demo-3d-marching-cubes': resolve(__dirname, 'src/3d/webgpu_marching_cubes/index.html'),
        'demo-3d-fluid-combined': resolve(__dirname, 'src/3d/webgpu_fluid/index.html'),
        'demo-3d-scene': resolve(__dirname, 'src/3d/scene/index.html'),
      },
    },
  },
});