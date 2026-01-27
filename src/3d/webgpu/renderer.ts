import particleShader from './shaders/particle3d.wgsl?raw';
import type { SimulationBuffers } from './simulation_buffers.ts';
import type { SimConfig } from '../common/types.ts';
import { mat4Perspective, mat4Multiply } from './math_utils.ts';

export class Renderer {
    private device: GPUDevice;
    private particlePipeline: GPURenderPipeline;
    private uniformBuffer: GPUBuffer;
    private particleBindGroup!: GPUBindGroup;
    private canvas: HTMLCanvasElement;
    private depthTexture!: GPUTexture;

    constructor(device: GPUDevice, canvas: HTMLCanvasElement, format: GPUTextureFormat) {
        this.device = device;
        this.canvas = canvas;

        this.uniformBuffer = device.createBuffer({
            size: 96,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });

        const module = device.createShaderModule({ code: particleShader });
        this.particlePipeline = device.createRenderPipeline({
            layout: 'auto',
            vertex: {
                module,
                entryPoint: 'vs_main',
            },
            fragment: {
                module,
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

        pass.setPipeline(this.particlePipeline);
        pass.setBindGroup(0, this.particleBindGroup);
        pass.draw(6, count);
        pass.end();
    }
}