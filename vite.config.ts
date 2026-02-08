import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        canvas2d: resolve(__dirname, 'canvas2d.html'),
        webgpu2d: resolve(__dirname, 'webgpu2d.html'),
        // Subdirectory demos
        '2d-canvas2d': resolve(__dirname, 'src/2d/canvas2d/index.html'),
        '2d-webgpu': resolve(__dirname, 'src/2d/webgpu/index.html'),
        '3d-particles': resolve(__dirname, 'src/3d/webgpu_particles/index.html'),
        '3d-raymarch': resolve(__dirname, 'src/3d/webgpu_raymarch/index.html'),
        '3d-screen-space': resolve(__dirname, 'src/3d/webgpu_screen_space/index.html'),
        '3d-marching-cubes': resolve(__dirname, 'src/3d/webgpu_marching_cubes/index.html'),
        '3d-fluid-combined': resolve(__dirname, 'src/3d/webgpu_fluid/index.html'),
        basic: resolve(__dirname, 'src/basic/index.html'),
      },
    },
  },
});
