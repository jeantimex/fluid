import { Utilities } from './utilities';
import { Camera } from './camera';
import { BoxEditor } from './box_editor';
import { generateSphereGeometry } from './renderer';
import { Simulator } from './simulator';

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

    const device = await adapter.requestDevice({
        requiredLimits: {
            maxStorageBuffersPerShaderStage: 10,
        }
    });
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

    let depthTexture = device.createTexture({
        size: [canvas.width, canvas.height],
        format: 'depth24plus',
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });

    const GRID_WIDTH = 40;
    const GRID_HEIGHT = 20;
    const GRID_DEPTH = 20;

    // WebGL uses gridCellDensity = 0.5 by default
    // gridCells = 40 * 20 * 20 * 0.5 = 8000
    // gridResolutionY = ceil(pow(8000/2, 1/3)) = 16
    // gridResolutionX = 32, gridResolutionZ = 16
    const RESOLUTION_X = 32;
    const RESOLUTION_Y = 16;
    const RESOLUTION_Z = 16;

    const PARTICLES_PER_CELL = 10;

    const camera = new Camera(canvas, [GRID_WIDTH / 2, GRID_HEIGHT / 3, GRID_DEPTH / 2]);
    const boxEditor = new BoxEditor(device, presentationFormat, [GRID_WIDTH, GRID_HEIGHT, GRID_DEPTH]);

    // --- Particle Setup ---
    const MAX_PARTICLES = 100000;
    const particlePositionBuffer = device.createBuffer({
        size: MAX_PARTICLES * 16,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const particleVelocityBuffer = device.createBuffer({
        size: MAX_PARTICLES * 16,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    const simulator = new Simulator(device, RESOLUTION_X, RESOLUTION_Y, RESOLUTION_Z, GRID_WIDTH, GRID_HEIGHT, GRID_DEPTH, particlePositionBuffer, particleVelocityBuffer);

    const sphereGeom = generateSphereGeometry(2);
    const sphereVertexBuffer = device.createBuffer({
        size: sphereGeom.vertices.byteLength,
        usage: GPUBufferUsage.VERTEX,
        mappedAtCreation: true,
    });
    new Float32Array(sphereVertexBuffer.getMappedRange()).set(sphereGeom.vertices);
    sphereVertexBuffer.unmap();

    const sphereIndexBuffer = device.createBuffer({
        size: sphereGeom.indices.byteLength,
        usage: GPUBufferUsage.INDEX,
        mappedAtCreation: true,
    });
    new Uint16Array(sphereIndexBuffer.getMappedRange()).set(sphereGeom.indices);
    sphereIndexBuffer.unmap();

    const sphereShaderModule = device.createShaderModule({
        code: `
            struct Uniforms {
                projectionMatrix: mat4x4<f32>,
                viewMatrix: mat4x4<f32>,
                sphereRadius: f32,
            };

            @group(0) @binding(0) var<uniform> uniforms: Uniforms;
            @group(0) @binding(1) var<storage, read> positions: array<vec4<f32>>;
            @group(0) @binding(2) var<storage, read> velocities: array<vec4<f32>>;

            struct VertexOutput {
                @builtin(position) position: vec4<f32>,
                @location(0) color: vec4<f32>,
            };

            @vertex
            fn vs_main(@location(0) position: vec3<f32>, @builtin(instance_index) instanceIndex: u32) -> VertexOutput {
                let p = positions[instanceIndex].xyz;
                let v = velocities[instanceIndex].xyz;
                let worldPos = position * uniforms.sphereRadius + p;
                
                var out: VertexOutput;
                out.position = uniforms.projectionMatrix * uniforms.viewMatrix * vec4<f32>(worldPos, 1.0);
                
                let speed = length(v);
                out.color = mix(vec4<f32>(0.1, 0.4, 0.9, 1.0), vec4<f32>(0.9, 0.2, 0.1, 1.0), clamp(speed * 0.1, 0.0, 1.0));
                return out;
            }

            @fragment
            fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
                return in.color;
            }
        `
    });

    const spherePipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: {
            module: sphereShaderModule,
            entryPoint: 'vs_main',
            buffers: [{
                arrayStride: 12,
                attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }]
            }]
        },
        fragment: {
            module: sphereShaderModule,
            entryPoint: 'fs_main',
            targets: [{ format: presentationFormat }]
        },
        primitive: { topology: 'triangle-list', cullMode: 'back' },
        depthStencil: {
            depthWriteEnabled: true,
            depthCompare: 'less',
            format: 'depth24plus',
        }
    });

    const sphereUniformBuffer = device.createBuffer({
        size: 144, // 2 * mat4x4 + f32 (aligned)
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const sphereBindGroup = device.createBindGroup({
        layout: spherePipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: sphereUniformBuffer } },
            { binding: 1, resource: { buffer: particlePositionBuffer } },
            { binding: 2, resource: { buffer: particleVelocityBuffer } },
        ]
    });

    let particleCount = 0;
    function spawnParticles() {
        const positions = new Float32Array(MAX_PARTICLES * 4);
        const velocities = new Float32Array(MAX_PARTICLES * 4);

        // Spawn particles in all boxes (matching WebGL behavior)
        if (boxEditor.boxes.length > 0) {
            // Calculate total volume of all boxes
            let totalBoxVolume = 0;
            for (const box of boxEditor.boxes) {
                totalBoxVolume += box.computeVolume();
            }

            // Calculate particle count (matching WebGL formula)
            const totalGridVolume = GRID_WIDTH * GRID_HEIGHT * GRID_DEPTH;
            const fractionFilled = totalBoxVolume / totalGridVolume;
            const totalGridCells = RESOLUTION_X * RESOLUTION_Y * RESOLUTION_Z;
            const desiredParticleCount = Math.floor(fractionFilled * totalGridCells * PARTICLES_PER_CELL);
            particleCount = Math.min(desiredParticleCount, MAX_PARTICLES);

            console.log(`Spawning ${particleCount} particles (fraction: ${fractionFilled.toFixed(3)}, cells: ${totalGridCells})`);

            // Distribute particles across boxes proportionally
            let particlesCreated = 0;
            for (let boxIdx = 0; boxIdx < boxEditor.boxes.length; boxIdx++) {
                const box = boxEditor.boxes[boxIdx];
                const boxVolume = box.computeVolume();

                let particlesInBox: number;
                if (boxIdx < boxEditor.boxes.length - 1) {
                    particlesInBox = Math.floor(particleCount * boxVolume / totalBoxVolume);
                } else {
                    // Last box gets remaining particles
                    particlesInBox = particleCount - particlesCreated;
                }

                for (let i = 0; i < particlesInBox; i++) {
                    const idx = particlesCreated + i;
                    const p = box.randomPoint();
                    positions[idx * 4 + 0] = p[0];
                    positions[idx * 4 + 1] = p[1];
                    positions[idx * 4 + 2] = p[2];
                    positions[idx * 4 + 3] = 1.0;

                    // WebGL reference initializes with zero velocity
                    velocities[idx * 4 + 0] = 0.0;
                    velocities[idx * 4 + 1] = 0.0;
                    velocities[idx * 4 + 2] = 0.0;
                    velocities[idx * 4 + 3] = 0.0;
                }
                particlesCreated += particlesInBox;
            }

            device.queue.writeBuffer(particlePositionBuffer, 0, positions);
            device.queue.writeBuffer(particleVelocityBuffer, 0, velocities);
        }
    }

    spawnParticles();

    // --- End Particle Setup ---

    const projectionMatrix = new Float32Array(16);
    const FOV = Math.PI / 3;

    function updateProjectionMatrix() {
        const aspect = canvas.width / canvas.height;
        Utilities.makePerspectiveMatrix(projectionMatrix, FOV, aspect, 0.1, 100.0);
    }
    updateProjectionMatrix();

    canvas.addEventListener('mousedown', (e) => camera.onMouseDown(e));
    window.addEventListener('mouseup', () => camera.onMouseUp());
    window.addEventListener('mousemove', (e) => camera.onMouseMove(e));

    console.log("WebGPU Initialized with Particles");

    function frame() {
        const commandEncoder = device.createCommandEncoder();

        // Compute Pass
        const computePass = commandEncoder.beginComputePass();
        simulator.step(computePass, particleCount);
        computePass.end();

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
            depthStencilAttachment: {
                view: depthTexture.createView(),
                depthClearValue: 1.0,
                depthLoadOp: 'clear',
                depthStoreOp: 'store',
            },
        };

        const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);
        
        // Draw Grid and Boxes
        boxEditor.draw(passEncoder, projectionMatrix, camera);

        // Draw Particles
        if (particleCount > 0) {
            passEncoder.setPipeline(spherePipeline);
            passEncoder.setBindGroup(0, sphereBindGroup);
            
            device.queue.writeBuffer(sphereUniformBuffer, 0, projectionMatrix);
            device.queue.writeBuffer(sphereUniformBuffer, 64, camera.getViewMatrix());
            // Sphere radius = 7.0 / gridResolutionX (matches WebGL)
            const sphereRadius = 7.0 / RESOLUTION_X;
            device.queue.writeBuffer(sphereUniformBuffer, 128, new Float32Array([sphereRadius]));

            passEncoder.setVertexBuffer(0, sphereVertexBuffer);
            passEncoder.setIndexBuffer(sphereIndexBuffer, 'uint16');
            passEncoder.drawIndexed(sphereGeom.indices.length, particleCount);
        }

        passEncoder.end();

        device.queue.submit([commandEncoder.finish()]);
        requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);

    window.addEventListener('resize', () => {
        canvas.width = window.innerWidth * devicePixelRatio;
        canvas.height = window.innerHeight * devicePixelRatio;
        
        depthTexture.destroy();
        depthTexture = device.createTexture({
            size: [canvas.width, canvas.height],
            format: 'depth24plus',
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
        });

        updateProjectionMatrix();
    });
}

init();
