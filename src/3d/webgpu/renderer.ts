import particleShader from './shaders/particle3d.wgsl?raw';
import type { SimulationBuffers } from './simulation_buffers.ts';
import type { SimConfig } from '../common/types.ts';

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

    render(encoder: GPUCommandEncoder, view: GPUTextureView, config: SimConfig, count: number) {
        // Simple fixed camera
        const aspect = this.canvas.width / this.canvas.height;
        const projection = mat4Perspective(Math.PI / 3, aspect, 0.1, 100.0);
        // Camera at (0, 0, 5.0) looking at (0, 0, 0)
        const viewMat = mat4LookAt(
            {x: 0, y: 0, z: 5.0}, 
            {x: 0, y: 0, z: 0}, 
            {x: 0, y: 1, z: 0}
        );
        const viewProj = mat4Multiply(projection, viewMat);
        
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

function mat4Perspective(fov: number, aspect: number, near: number, far: number): Float32Array {
    const f = 1.0 / Math.tan(fov / 2);
    const nf = 1 / (near - far);
    const out = new Float32Array(16);
    out[0] = f / aspect;
    out[5] = f;
    out[10] = (far + near) * nf;
    out[11] = -1;
    out[14] = (2 * far * near) * nf;
    return out;
}

function mat4LookAt(eye: any, target: any, up: any): Float32Array {
    const z = normalize(sub(eye, target));
    const x = normalize(cross(up, z));
    const y = cross(z, x);
    const out = new Float32Array(16);
    out[0] = x.x; out[4] = x.y; out[8] = x.z; out[12] = -dot(x, eye);
    out[1] = y.x; out[5] = y.y; out[9] = y.z; out[13] = -dot(y, eye);
    out[2] = z.x; out[6] = z.y; out[10] = z.z; out[14] = -dot(z, eye);
    out[3] = 0;   out[7] = 0;   out[11] = 0;   out[15] = 1;
    return out;
}

function mat4Multiply(a: Float32Array, b: Float32Array): Float32Array {
    const out = new Float32Array(16);
    for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 4; c++) {
            let sum = 0;
            for (let k = 0; k < 4; k++) {
                sum += a[k * 4 + r] * b[c * 4 + k]; // Column-major logic
            }
            out[c * 4 + r] = sum;
        }
    }
    return out;
}

function sub(a: any, b: any) { return {x: a.x-b.x, y: a.y-b.y, z: a.z-b.z}; }
function normalize(v: any) { const l = Math.sqrt(v.x*v.x + v.y*v.y + v.z*v.z); return {x: v.x/l, y: v.y/l, z: v.z/l}; }
function cross(a: any, b: any) { return {x: a.y*b.z - a.z*b.y, y: a.z*b.x - a.x*b.z, z: a.x*b.y - a.y*b.x}; }
function dot(a: any, b: any) { return a.x*b.x + a.y*b.y + a.z*b.z; }
