import particleShader from './shaders/particle3d.wgsl?raw';
import lineShader from './shaders/line3d.wgsl?raw';
import type { SimulationBuffers } from './simulation_buffers.ts';
import type { SimConfig } from '../common/types.ts';
import { mat4Perspective, mat4Multiply } from './math_utils.ts';

export class Renderer {
    private device: GPUDevice;
    private particlePipeline: GPURenderPipeline;
    private linePipeline: GPURenderPipeline;
    private uniformBuffer: GPUBuffer;
    private particleBindGroup!: GPUBindGroup;
    private lineBindGroup: GPUBindGroup;
    private lineVertexBuffer: GPUBuffer;
    private lineVertexData: Float32Array;
    private canvas: HTMLCanvasElement;
    private depthTexture!: GPUTexture;

    constructor(device: GPUDevice, canvas: HTMLCanvasElement, format: GPUTextureFormat) {
        this.device = device;
        this.canvas = canvas;

        this.uniformBuffer = device.createBuffer({
            size: 96,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });

        // Particle Pipeline
        const particleModule = device.createShaderModule({ code: particleShader });
        this.particlePipeline = device.createRenderPipeline({
            layout: 'auto',
            vertex: {
                module: particleModule,
                entryPoint: 'vs_main',
            },
            fragment: {
                module: particleModule,
                entryPoint: 'fs_main',
                targets: [{ format }]
            },
            primitive: {
                topology: 'triangle-list'
            },
            depthStencil: {
                format: 'depth24plus',
                depthWriteEnabled: true,
                depthCompare: 'less',
            }
        });

        // Line Pipeline
        const lineModule = device.createShaderModule({ code: lineShader });
        this.linePipeline = device.createRenderPipeline({
            layout: 'auto',
            vertex: {
                module: lineModule,
                entryPoint: 'vs_main',
                buffers: [{
                    arrayStride: 28, // 3 pos + 4 color = 7 floats * 4 bytes
                    attributes: [
                        { shaderLocation: 0, offset: 0, format: 'float32x3' }, // pos
                        { shaderLocation: 1, offset: 12, format: 'float32x4' } // color
                    ]
                }]
            },
            fragment: {
                module: lineModule,
                entryPoint: 'fs_main',
                targets: [{ 
                    format,
                    blend: {
                        color: {
                            srcFactor: 'src-alpha',
                            dstFactor: 'one-minus-src-alpha',
                            operation: 'add',
                        },
                        alpha: {
                            srcFactor: 'one',
                            dstFactor: 'one-minus-src-alpha',
                            operation: 'add',
                        },
                    }
                }]
            },
            primitive: {
                topology: 'line-list'
            },
            depthStencil: {
                format: 'depth24plus',
                depthWriteEnabled: true,
                depthCompare: 'less',
            }
        });

        // Line Resources
        // 12 edges for cube * 2 vertices = 24 vertices.
        this.lineVertexData = new Float32Array(48 * 7);
        this.lineVertexBuffer = device.createBuffer({
            size: this.lineVertexData.byteLength,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
        });

        this.lineBindGroup = device.createBindGroup({
            layout: this.linePipeline.getBindGroupLayout(0),
            entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }]
        });

        this.resize();
    }

    resize() {
        if (this.depthTexture) this.depthTexture.destroy();
        this.depthTexture = this.device.createTexture({
            size: [this.canvas.width, this.canvas.height],
            format: 'depth24plus',
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
        });
    }

    createBindGroup(buffers: SimulationBuffers) {
        this.particleBindGroup = this.device.createBindGroup({
            layout: this.particlePipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: buffers.positions } },
                { binding: 1, resource: { buffer: buffers.velocities } },
                { binding: 2, resource: { buffer: this.uniformBuffer } }
            ]
        });
    }

    render(encoder: GPUCommandEncoder, view: GPUTextureView, config: SimConfig, count: number, viewMatrix: Float32Array) {
        const aspect = this.canvas.width / this.canvas.height;
        const projection = mat4Perspective(Math.PI / 3, aspect, 0.1, 100.0);
        const viewProj = mat4Multiply(projection, viewMatrix);
        
        const uniforms = new Float32Array(24);
        uniforms.set(viewProj);
        uniforms[16] = config.particleRadius;
        
        this.device.queue.writeBuffer(this.uniformBuffer, 0, uniforms);

        // Update Line Data
        let vertexCount = 0;
        const addLine = (p1: {x:number, y:number, z:number}, p2: {x:number, y:number, z:number}, r:number, g:number, b:number, a:number) => {
            const i = vertexCount * 7;
            this.lineVertexData[i] = p1.x; this.lineVertexData[i+1] = p1.y; this.lineVertexData[i+2] = p1.z;
            this.lineVertexData[i+3] = r; this.lineVertexData[i+4] = g; this.lineVertexData[i+5] = b; this.lineVertexData[i+6] = a;
            
            this.lineVertexData[i+7] = p2.x; this.lineVertexData[i+8] = p2.y; this.lineVertexData[i+9] = p2.z;
            this.lineVertexData[i+10] = r; this.lineVertexData[i+11] = g; this.lineVertexData[i+12] = b; this.lineVertexData[i+13] = a;
            vertexCount += 2;
        };

        const drawBox = (cx:number, cy:number, cz:number, sx:number, sy:number, sz:number, r:number, g:number, b:number, a:number) => {
            const hx = sx/2, hy = sy/2, hz = sz/2;
            // Bottom
            addLine({x:cx-hx, y:cy-hy, z:cz-hz}, {x:cx+hx, y:cy-hy, z:cz-hz}, r, g, b, a);
            addLine({x:cx+hx, y:cy-hy, z:cz-hz}, {x:cx+hx, y:cy-hy, z:cz+hz}, r, g, b, a);
            addLine({x:cx+hx, y:cy-hy, z:cz+hz}, {x:cx-hx, y:cy-hy, z:cz+hz}, r, g, b, a);
            addLine({x:cx-hx, y:cy-hy, z:cz+hz}, {x:cx-hx, y:cy-hy, z:cz-hz}, r, g, b, a);
            // Top
            addLine({x:cx-hx, y:cy+hy, z:cz-hz}, {x:cx+hx, y:cy+hy, z:cz-hz}, r, g, b, a);
            addLine({x:cx+hx, y:cy+hy, z:cz-hz}, {x:cx+hx, y:cy+hy, z:cz+hz}, r, g, b, a);
            addLine({x:cx+hx, y:cy+hy, z:cz+hz}, {x:cx-hx, y:cy+hy, z:cz+hz}, r, g, b, a);
            addLine({x:cx-hx, y:cy+hy, z:cz+hz}, {x:cx-hx, y:cy+hy, z:cz-hz}, r, g, b, a);
            // Vertical
            addLine({x:cx-hx, y:cy-hy, z:cz-hz}, {x:cx-hx, y:cy+hy, z:cz-hz}, r, g, b, a);
            addLine({x:cx+hx, y:cy-hy, z:cz-hz}, {x:cx+hx, y:cy+hy, z:cz-hz}, r, g, b, a);
            addLine({x:cx+hx, y:cy-hy, z:cz+hz}, {x:cx+hx, y:cy+hy, z:cz+hz}, r, g, b, a);
            addLine({x:cx-hx, y:cy-hy, z:cz+hz}, {x:cx-hx, y:cy+hy, z:cz+hz}, r, g, b, a);
        };

        const boundsCol = { r: 0.9, g: 0.9, b: 0.9 };
        drawBox(0, 0, 0, config.boundsSize.x, config.boundsSize.y, config.boundsSize.z, boundsCol.r, boundsCol.g, boundsCol.b, 0.5);

        this.device.queue.writeBuffer(this.lineVertexBuffer, 0, this.lineVertexData as unknown as BufferSource, 0, vertexCount * 7);

        const pass = encoder.beginRenderPass({
            colorAttachments: [{
                view,
                clearValue: { r: 0.05, g: 0.05, b: 0.08, a: 1 },
                loadOp: 'clear',
                storeOp: 'store'
            }],
            depthStencilAttachment: {
                view: this.depthTexture.createView(),
                depthClearValue: 1.0,
                depthLoadOp: 'clear',
                depthStoreOp: 'store'
            }
        });

        // Draw Lines
        pass.setPipeline(this.linePipeline);
        pass.setBindGroup(0, this.lineBindGroup);
        pass.setVertexBuffer(0, this.lineVertexBuffer);
        pass.draw(vertexCount);

        // Draw Particles
        pass.setPipeline(this.particlePipeline);
        pass.setBindGroup(0, this.particleBindGroup);
        pass.draw(6, count);
        
        pass.end();
    }
}