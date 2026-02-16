async function init() {
    if (!navigator.gpu) {
        alert("WebGPU is not supported in this browser.");
        return;
    }

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
        alert("No appropriate GPU adapter found.");
        return;
    }

    const device = await adapter.requestDevice();
    const canvas = document.getElementById('canvas') as HTMLCanvasElement;
    const context = canvas.getContext('webgpu') as GPUCanvasContext;

    const devicePixelRatio = window.devicePixelRatio || 1;
    canvas.width = window.innerWidth * devicePixelRatio;
    canvas.height = window.innerHeight * devicePixelRatio;

    const presentationFormat = navigator.gpu.getPreferredCanvasFormat();
    context.configure({
        device,
        format: presentationFormat,
        alphaMode: 'premultiplied',
    });

    console.log("WebGPU Initialized");

    function frame() {
        // Basic clear for now
        const commandEncoder = device.createCommandEncoder();
        const textureView = context.getCurrentTexture().createView();

        const renderPassDescriptor: GPURenderPassDescriptor = {
            colorAttachments: [
                {
                    view: textureView,
                    clearValue: { r: 0.9, g: 0.9, b: 0.9, a: 1.0 },
                    loadOp: 'clear',
                    storeOp: 'store',
                },
            ],
        };

        const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);
        passEncoder.end();

        device.queue.submit([commandEncoder.finish()]);
        requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);

    window.addEventListener('resize', () => {
        canvas.width = window.innerWidth * devicePixelRatio;
        canvas.height = window.innerHeight * devicePixelRatio;
    });
}

init();
