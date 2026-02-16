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

    // Generate sphere geometry with normals (3 iterations for smooth spheres)
    const sphereGeom = generateSphereGeometry(3);
    const sphereVertexBuffer = device.createBuffer({
        size: sphereGeom.vertices.byteLength,
        usage: GPUBufferUsage.VERTEX,
        mappedAtCreation: true,
    });
    new Float32Array(sphereVertexBuffer.getMappedRange()).set(sphereGeom.vertices);
    sphereVertexBuffer.unmap();

    const sphereNormalBuffer = device.createBuffer({
        size: sphereGeom.normals.byteLength,
        usage: GPUBufferUsage.VERTEX,
        mappedAtCreation: true,
    });
    new Float32Array(sphereNormalBuffer.getMappedRange()).set(sphereGeom.normals);
    sphereNormalBuffer.unmap();

    const sphereIndexBuffer = device.createBuffer({
        size: sphereGeom.indices.byteLength,
        usage: GPUBufferUsage.INDEX,
        mappedAtCreation: true,
    });
    new Uint16Array(sphereIndexBuffer.getMappedRange()).set(sphereGeom.indices);
    sphereIndexBuffer.unmap();

    // Shadow map dimensions
    const SHADOW_MAP_SIZE = 256;

    // Create G-buffer texture (normal.xy, speed, depth) - using rgba16float
    let gBufferTexture = device.createTexture({
        size: [canvas.width, canvas.height],
        format: 'rgba16float',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });

    // Occlusion texture
    let occlusionTexture = device.createTexture({
        size: [canvas.width, canvas.height],
        format: 'r16float',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });

    // Shadow map depth texture
    const shadowDepthTexture = device.createTexture({
        size: [SHADOW_MAP_SIZE, SHADOW_MAP_SIZE],
        format: 'depth32float',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });

    // Create samplers
    const linearSampler = device.createSampler({
        magFilter: 'linear',
        minFilter: 'linear',
    });

    const shadowSampler = device.createSampler({
        magFilter: 'linear',
        minFilter: 'linear',
        compare: 'less',
    });

    // Calculate light matrices (light from above)
    const midpoint = [GRID_WIDTH / 2, GRID_HEIGHT / 2, GRID_DEPTH / 2];
    const lightViewMatrix = Utilities.makeLookAtMatrix(
        new Float32Array(16),
        midpoint,
        [midpoint[0], midpoint[1] - 1.0, midpoint[2]],
        [0.0, 0.0, 1.0]
    );
    const lightProjectionMatrix = Utilities.makeOrthographicMatrix(
        new Float32Array(16),
        -GRID_WIDTH / 2, GRID_WIDTH / 2,
        -GRID_DEPTH / 2, GRID_DEPTH / 2,
        -GRID_HEIGHT / 2, GRID_HEIGHT / 2
    );
    const lightProjectionViewMatrix = new Float32Array(16);
    Utilities.premultiplyMatrix(lightProjectionViewMatrix, lightViewMatrix, lightProjectionMatrix);

    // ============ G-BUFFER PASS SHADER ============
    const gBufferShaderModule = device.createShaderModule({
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
                @location(0) viewSpaceNormal: vec3<f32>,
                @location(1) viewSpaceZ: f32,
                @location(2) speed: f32,
            };

            @vertex
            fn vs_main(
                @location(0) vertexPos: vec3<f32>,
                @location(1) vertexNormal: vec3<f32>,
                @builtin(instance_index) instanceIndex: u32
            ) -> VertexOutput {
                let spherePos = positions[instanceIndex].xyz;
                let velocity = velocities[instanceIndex].xyz;
                let worldPos = vertexPos * uniforms.sphereRadius + spherePos;
                let viewPos = uniforms.viewMatrix * vec4<f32>(worldPos, 1.0);

                var out: VertexOutput;
                out.position = uniforms.projectionMatrix * viewPos;
                out.viewSpaceNormal = (uniforms.viewMatrix * vec4<f32>(vertexNormal, 0.0)).xyz;
                out.viewSpaceZ = viewPos.z;
                out.speed = length(velocity);
                return out;
            }

            @fragment
            fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
                let n = normalize(in.viewSpaceNormal);
                return vec4<f32>(n.x, n.y, in.speed, in.viewSpaceZ);
            }
        `
    });

    // ============ SHADOW PASS SHADER ============
    const shadowShaderModule = device.createShaderModule({
        code: `
            struct Uniforms {
                projectionViewMatrix: mat4x4<f32>,
                sphereRadius: f32,
            };

            @group(0) @binding(0) var<uniform> uniforms: Uniforms;
            @group(0) @binding(1) var<storage, read> positions: array<vec4<f32>>;

            @vertex
            fn vs_main(
                @location(0) vertexPos: vec3<f32>,
                @builtin(instance_index) instanceIndex: u32
            ) -> @builtin(position) vec4<f32> {
                let spherePos = positions[instanceIndex].xyz;
                let worldPos = vertexPos * uniforms.sphereRadius + spherePos;
                return uniforms.projectionViewMatrix * vec4<f32>(worldPos, 1.0);
            }

            @fragment
            fn fs_main() {}
        `
    });

    // ============ COMPOSITE PASS SHADER ============
    const compositeShaderModule = device.createShaderModule({
        code: `
            struct Uniforms {
                inverseViewMatrix: mat4x4<f32>,
                lightProjectionViewMatrix: mat4x4<f32>,
                resolution: vec2<f32>,
                fov: f32,
                shadowResolution: f32,
            };

            @group(0) @binding(0) var<uniform> uniforms: Uniforms;
            @group(0) @binding(1) var gBufferTex: texture_2d<f32>;
            @group(0) @binding(2) var occlusionTex: texture_2d<f32>;
            @group(0) @binding(3) var shadowTex: texture_depth_2d;
            @group(0) @binding(4) var linearSamp: sampler;
            @group(0) @binding(5) var shadowSamp: sampler_comparison;

            struct VertexOutput {
                @builtin(position) position: vec4<f32>,
                @location(0) uv: vec2<f32>,
            };

            @vertex
            fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
                var pos = array<vec2<f32>, 4>(
                    vec2<f32>(-1.0, -1.0),
                    vec2<f32>(1.0, -1.0),
                    vec2<f32>(-1.0, 1.0),
                    vec2<f32>(1.0, 1.0)
                );
                var out: VertexOutput;
                out.position = vec4<f32>(pos[vertexIndex], 0.0, 1.0);
                // Flip Y for WebGPU's top-left origin (vs WebGL's bottom-left)
                out.uv = vec2<f32>(pos[vertexIndex].x * 0.5 + 0.5, 1.0 - (pos[vertexIndex].y * 0.5 + 0.5));
                return out;
            }

            fn hsvToRGB(c: vec3<f32>) -> vec3<f32> {
                let K = vec4<f32>(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
                let p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
                return c.z * mix(K.xxx, clamp(p - K.xxx, vec3<f32>(0.0), vec3<f32>(1.0)), c.y);
            }

            @fragment
            fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
                let data = textureSample(gBufferTex, linearSamp, in.uv);
                let occlusion = textureSample(occlusionTex, linearSamp, in.uv).r;

                let speed = data.b;
                let viewSpaceZ = data.a;

                // Reconstruct normal and position (do this unconditionally for uniform control flow)
                let nx = data.r;
                let ny = data.g;
                let nz = sqrt(max(0.0, 1.0 - nx * nx - ny * ny));

                let tanHalfFov = tan(uniforms.fov / 2.0);
                let viewRay = vec3<f32>(
                    (in.uv.x * 2.0 - 1.0) * tanHalfFov * uniforms.resolution.x / uniforms.resolution.y,
                    (1.0 - 2.0 * in.uv.y) * tanHalfFov,  // Corrected for flipped UV
                    -1.0
                );
                let viewSpacePos = viewRay * max(-viewSpaceZ, 0.01);
                let worldSpacePos = (uniforms.inverseViewMatrix * vec4<f32>(viewSpacePos, 1.0)).xyz;

                // Shadow calculation with PCF (must be in uniform control flow)
                var lightSpacePos = uniforms.lightProjectionViewMatrix * vec4<f32>(worldSpacePos, 1.0);
                lightSpacePos = lightSpacePos / lightSpacePos.w;
                let lightCoords = lightSpacePos.xy * 0.5 + 0.5;
                let lightDepth = lightSpacePos.z * 0.5 + 0.5;

                var shadow = 0.0;
                let texelSize = 5.0 / uniforms.shadowResolution;
                for (var x = -2; x <= 2; x++) {
                    for (var y = -2; y <= 2; y++) {
                        let offset = vec2<f32>(f32(x), f32(y)) * texelSize;
                        shadow += textureSampleCompare(shadowTex, shadowSamp, lightCoords + offset, lightDepth - 0.001);
                    }
                }
                shadow /= 25.0;

                // Now we can branch based on whether this is background or particle
                let isBackground = speed < 0.0 || viewSpaceZ > -0.01;

                // Background (vignette)
                let dist = length(in.uv * 2.0 - 1.0);
                let bgColor = vec3<f32>(1.0) - dist * 0.1;

                // Particle color from speed (HSV to RGB)
                let hue = max(0.6 - speed * 0.0025, 0.52);
                var particleColor = hsvToRGB(vec3<f32>(hue, 0.75, 1.0));

                // Ambient and direct lighting
                let ambient = 1.0 - occlusion * 0.7;
                let direct = 1.0 - (1.0 - shadow) * 0.8;
                particleColor *= ambient * direct;

                // Select final color
                let finalColor = select(particleColor, bgColor, isBackground);
                return vec4<f32>(finalColor, 1.0);
            }
        `
    });

    // ============ AMBIENT OCCLUSION PASS SHADER ============
    const aoShaderModule = device.createShaderModule({
        code: `
            struct Uniforms {
                projectionMatrix: mat4x4<f32>,
                viewMatrix: mat4x4<f32>,
                resolution: vec2<f32>,
                fov: f32,
                sphereRadius: f32,
            };

            @group(0) @binding(0) var<uniform> uniforms: Uniforms;
            @group(0) @binding(1) var<storage, read> positions: array<vec4<f32>>;
            @group(0) @binding(2) var gBufferTex: texture_2d<f32>;
            @group(0) @binding(3) var linearSamp: sampler;

            struct VertexOutput {
                @builtin(position) position: vec4<f32>,
                @location(0) viewSpaceSpherePos: vec3<f32>,
                @location(1) sphereRadius: f32,
            };

            const PI: f32 = 3.14159265;

            @vertex
            fn vs_main(
                @location(0) vertexPos: vec3<f32>,
                @builtin(instance_index) instanceIndex: u32
            ) -> VertexOutput {
                let spherePos = positions[instanceIndex].xyz;
                let viewSpherPos = (uniforms.viewMatrix * vec4<f32>(spherePos, 1.0)).xyz;

                // Extrude sphere 5x for AO range
                let extrudedRadius = uniforms.sphereRadius * 5.0;
                let worldPos = vertexPos * extrudedRadius + spherePos;

                var out: VertexOutput;
                out.position = uniforms.projectionMatrix * uniforms.viewMatrix * vec4<f32>(worldPos, 1.0);
                out.viewSpaceSpherePos = viewSpherPos;
                out.sphereRadius = uniforms.sphereRadius;
                return out;
            }

            @fragment
            fn fs_main(in: VertexOutput) -> @location(0) f32 {
                let coords = in.position.xy / uniforms.resolution;
                let data = textureSample(gBufferTex, linearSamp, coords);

                let viewSpaceZ = data.a;
                if (viewSpaceZ > -0.01) { return 0.0; }

                // Reconstruct view space position
                let nx = data.r;
                let ny = data.g;
                let nz = sqrt(max(0.0, 1.0 - nx * nx - ny * ny));
                let viewSpaceNormal = vec3<f32>(nx, ny, nz);

                let tanHalfFov = tan(uniforms.fov / 2.0);
                let viewRay = vec3<f32>(
                    (coords.x * 2.0 - 1.0) * tanHalfFov * uniforms.resolution.x / uniforms.resolution.y,
                    (1.0 - 2.0 * coords.y) * tanHalfFov,  // Corrected for WebGPU screen coords
                    -1.0
                );
                let viewSpacePos = viewRay * -viewSpaceZ;

                // Calculate occlusion from this sphere
                let di = in.viewSpaceSpherePos - viewSpacePos;
                let l = length(di);
                if (l < 0.001) { return 0.0; }

                let nl = dot(viewSpaceNormal, di / l);
                let h = l / in.sphereRadius;
                let h2 = h * h;
                let k2 = 1.0 - h2 * nl * nl;

                var result = max(0.0, nl) / h2;

                if (k2 > 0.0 && l > in.sphereRadius) {
                    result = nl * acos(-nl * sqrt((h2 - 1.0) / (1.0 - nl * nl))) - sqrt(k2 * (h2 - 1.0));
                    result = result / h2 + atan(sqrt(k2 / (h2 - 1.0)));
                    result /= PI;
                }

                return result;
            }
        `
    });

    // Create pipelines
    const gBufferPipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: {
            module: gBufferShaderModule,
            entryPoint: 'vs_main',
            buffers: [
                { arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] },
                { arrayStride: 12, attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x3' }] },
            ]
        },
        fragment: {
            module: gBufferShaderModule,
            entryPoint: 'fs_main',
            targets: [{ format: 'rgba16float' }]
        },
        primitive: { topology: 'triangle-list', cullMode: 'back' },
        depthStencil: { depthWriteEnabled: true, depthCompare: 'less', format: 'depth24plus' }
    });

    const shadowPipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: {
            module: shadowShaderModule,
            entryPoint: 'vs_main',
            buffers: [{ arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] }]
        },
        fragment: { module: shadowShaderModule, entryPoint: 'fs_main', targets: [] },
        primitive: { topology: 'triangle-list', cullMode: 'back' },
        depthStencil: { depthWriteEnabled: true, depthCompare: 'less', format: 'depth32float' }
    });

    const aoPipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: {
            module: aoShaderModule,
            entryPoint: 'vs_main',
            buffers: [{ arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] }]
        },
        fragment: {
            module: aoShaderModule,
            entryPoint: 'fs_main',
            targets: [{
                format: 'r16float',
                blend: {
                    color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
                    alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' }
                }
            }]
        },
        primitive: { topology: 'triangle-list', cullMode: 'back' },
        depthStencil: { depthWriteEnabled: false, depthCompare: 'less', format: 'depth24plus' }
    });

    const compositePipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: { module: compositeShaderModule, entryPoint: 'vs_main' },
        fragment: {
            module: compositeShaderModule,
            entryPoint: 'fs_main',
            targets: [{ format: presentationFormat }]
        },
        primitive: { topology: 'triangle-strip' }
    });

    // Create uniform buffers
    const gBufferUniformBuffer = device.createBuffer({
        size: 144,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const shadowUniformBuffer = device.createBuffer({
        size: 80,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const aoUniformBuffer = device.createBuffer({
        size: 160,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const compositeUniformBuffer = device.createBuffer({
        size: 144,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Create bind groups
    const gBufferBindGroup = device.createBindGroup({
        layout: gBufferPipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: gBufferUniformBuffer } },
            { binding: 1, resource: { buffer: particlePositionBuffer } },
            { binding: 2, resource: { buffer: particleVelocityBuffer } },
        ]
    });

    const shadowBindGroup = device.createBindGroup({
        layout: shadowPipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: shadowUniformBuffer } },
            { binding: 1, resource: { buffer: particlePositionBuffer } },
        ]
    });

    let aoBindGroup: GPUBindGroup;
    let compositeBindGroup: GPUBindGroup;

    function createSizeDepedentBindGroups() {
        aoBindGroup = device.createBindGroup({
            layout: aoPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: aoUniformBuffer } },
                { binding: 1, resource: { buffer: particlePositionBuffer } },
                { binding: 2, resource: gBufferTexture.createView() },
                { binding: 3, resource: linearSampler },
            ]
        });

        compositeBindGroup = device.createBindGroup({
            layout: compositePipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: compositeUniformBuffer } },
                { binding: 1, resource: gBufferTexture.createView() },
                { binding: 2, resource: occlusionTexture.createView() },
                { binding: 3, resource: shadowDepthTexture.createView() },
                { binding: 4, resource: linearSampler },
                { binding: 5, resource: shadowSampler },
            ]
        });
    }
    createSizeDepedentBindGroups();

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

    const sphereRadius = 7.0 / RESOLUTION_X;

    function frame() {
        const commandEncoder = device.createCommandEncoder();

        // Compute Pass
        const computePass = commandEncoder.beginComputePass();
        simulator.step(computePass, particleCount);
        computePass.end();

        const viewMatrix = camera.getViewMatrix();
        const inverseViewMatrix = Utilities.invertMatrix(new Float32Array(16), viewMatrix) || new Float32Array(16);

        if (particleCount > 0) {
            // ============ 1. G-BUFFER PASS ============
            device.queue.writeBuffer(gBufferUniformBuffer, 0, projectionMatrix);
            device.queue.writeBuffer(gBufferUniformBuffer, 64, viewMatrix);
            device.queue.writeBuffer(gBufferUniformBuffer, 128, new Float32Array([sphereRadius]));

            const gBufferPass = commandEncoder.beginRenderPass({
                colorAttachments: [{
                    view: gBufferTexture.createView(),
                    clearValue: { r: 0, g: 0, b: -1, a: 0 },
                    loadOp: 'clear',
                    storeOp: 'store',
                }],
                depthStencilAttachment: {
                    view: depthTexture.createView(),
                    depthClearValue: 1.0,
                    depthLoadOp: 'clear',
                    depthStoreOp: 'store',
                },
            });
            gBufferPass.setPipeline(gBufferPipeline);
            gBufferPass.setBindGroup(0, gBufferBindGroup);
            gBufferPass.setVertexBuffer(0, sphereVertexBuffer);
            gBufferPass.setVertexBuffer(1, sphereNormalBuffer);
            gBufferPass.setIndexBuffer(sphereIndexBuffer, 'uint16');
            gBufferPass.drawIndexed(sphereGeom.indices.length, particleCount);
            gBufferPass.end();

            // ============ 2. SHADOW PASS ============
            device.queue.writeBuffer(shadowUniformBuffer, 0, lightProjectionViewMatrix);
            device.queue.writeBuffer(shadowUniformBuffer, 64, new Float32Array([sphereRadius]));

            const shadowPass = commandEncoder.beginRenderPass({
                colorAttachments: [],
                depthStencilAttachment: {
                    view: shadowDepthTexture.createView(),
                    depthClearValue: 1.0,
                    depthLoadOp: 'clear',
                    depthStoreOp: 'store',
                },
            });
            shadowPass.setPipeline(shadowPipeline);
            shadowPass.setBindGroup(0, shadowBindGroup);
            shadowPass.setVertexBuffer(0, sphereVertexBuffer);
            shadowPass.setIndexBuffer(sphereIndexBuffer, 'uint16');
            shadowPass.setViewport(1, 1, SHADOW_MAP_SIZE - 2, SHADOW_MAP_SIZE - 2, 0, 1);
            shadowPass.drawIndexed(sphereGeom.indices.length, particleCount);
            shadowPass.end();

            // ============ 3. AMBIENT OCCLUSION PASS ============
            device.queue.writeBuffer(aoUniformBuffer, 0, projectionMatrix);
            device.queue.writeBuffer(aoUniformBuffer, 64, viewMatrix);
            device.queue.writeBuffer(aoUniformBuffer, 128, new Float32Array([canvas.width, canvas.height, FOV, sphereRadius]));

            const aoPass = commandEncoder.beginRenderPass({
                colorAttachments: [{
                    view: occlusionTexture.createView(),
                    clearValue: { r: 0, g: 0, b: 0, a: 0 },
                    loadOp: 'clear',
                    storeOp: 'store',
                }],
                depthStencilAttachment: {
                    view: depthTexture.createView(),
                    depthLoadOp: 'load',
                    depthStoreOp: 'store',
                },
            });
            aoPass.setPipeline(aoPipeline);
            aoPass.setBindGroup(0, aoBindGroup);
            aoPass.setVertexBuffer(0, sphereVertexBuffer);
            aoPass.setIndexBuffer(sphereIndexBuffer, 'uint16');
            aoPass.drawIndexed(sphereGeom.indices.length, particleCount);
            aoPass.end();

            // ============ 4. COMPOSITE PASS ============
            device.queue.writeBuffer(compositeUniformBuffer, 0, inverseViewMatrix);
            device.queue.writeBuffer(compositeUniformBuffer, 64, lightProjectionViewMatrix);
            device.queue.writeBuffer(compositeUniformBuffer, 128, new Float32Array([
                canvas.width, canvas.height, FOV, SHADOW_MAP_SIZE
            ]));

            const compositePass = commandEncoder.beginRenderPass({
                colorAttachments: [{
                    view: context.getCurrentTexture().createView(),
                    clearValue: { r: 0.9, g: 0.9, b: 0.9, a: 1.0 },
                    loadOp: 'clear',
                    storeOp: 'store',
                }],
            });
            compositePass.setPipeline(compositePipeline);
            compositePass.setBindGroup(0, compositeBindGroup);
            compositePass.draw(4);
            compositePass.end();
        } else {
            // No particles - just clear
            const passEncoder = commandEncoder.beginRenderPass({
                colorAttachments: [{
                    view: context.getCurrentTexture().createView(),
                    clearValue: { r: 0.9, g: 0.9, b: 0.9, a: 1.0 },
                    loadOp: 'clear',
                    storeOp: 'store',
                }],
            });
            passEncoder.end();
        }

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

        gBufferTexture.destroy();
        gBufferTexture = device.createTexture({
            size: [canvas.width, canvas.height],
            format: 'rgba16float',
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        });

        occlusionTexture.destroy();
        occlusionTexture = device.createTexture({
            size: [canvas.width, canvas.height],
            format: 'r16float',
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        });

        createSizeDepedentBindGroups();
        updateProjectionMatrix();
    });
}

init();
