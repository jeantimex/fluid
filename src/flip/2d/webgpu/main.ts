import { initWebGPU, configureContext, WebGPUInitError } from './webgpu_utils';
import { FlipFluid } from './sim';

async function main() {
  const app = document.querySelector<HTMLDivElement>('#app')!;
  const canvas = document.createElement('canvas');
  app.appendChild(canvas);

  try {
    const { device, context, format } = await initWebGPU(canvas);
    configureContext(context, device, format);

    const fluid = new FlipFluid(device, context, format);

    const resize = () => {
      canvas.width = canvas.clientWidth * window.devicePixelRatio;
      canvas.height = canvas.clientHeight * window.devicePixelRatio;
      configureContext(context, device, format);
      fluid.render();
    };
    
    window.addEventListener('resize', resize);
    resize();

    function frame() {
        fluid.step(1/60);
        fluid.render();
        requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);

  } catch (err) {
    console.error(err);
    if (err instanceof WebGPUInitError) {
        app.innerText = "WebGPU not supported: " + err.message;
    }
  }
}

main();
