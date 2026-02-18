import { AABB } from './aabb';
import { Camera } from './camera';

export enum InteractionMode {
    RESIZING = 0,
    TRANSLATING = 1,
    DRAWING = 2,
    EXTRUDING = 3
}

export class BoxEditor {
    device: GPUDevice;
    gridDimensions: number[];
    boxes: AABB[] = [];
    
    // WebGPU resources
    linePipeline: GPURenderPipeline;
    solidPipeline: GPURenderPipeline;
    
    gridVertexBuffer: GPUBuffer;
    cubeVertexBuffer: GPUBuffer;
    cubeIndexBuffer: GPUBuffer;
    
    uniformBuffer: GPUBuffer;
    bindGroup: GPUBindGroup;

    constructor(device: GPUDevice, presentationFormat: GPUTextureFormat, gridDimensions: number[]) {
        this.device = device;
        this.gridDimensions = gridDimensions;

        // Default box for verification
        this.boxes.push(new AABB([0, 0, 0], [15, 20, 20]));

        const shaderCode = `
            struct Uniforms {
                projectionMatrix: mat4x4<f32>,
                viewMatrix: mat4x4<f32>,
                translation: vec3<f32>,
                scale: vec3<f32>,
                color: vec4<f32>,
            };

            @group(0) @binding(0) var<uniform> uniforms: Uniforms;

            struct VertexOutput {
                @builtin(position) position: vec4<f32>,
            };

            @vertex
            fn vs_main(@location(0) position: vec3<f32>) -> VertexOutput {
                var out: VertexOutput;
                let scaledPos = position * uniforms.scale + uniforms.translation;
                out.position = uniforms.projectionMatrix * uniforms.viewMatrix * vec4<f32>(scaledPos, 1.0);
                return out;
            }

            @fragment
            fn fs_main() -> @location(0) vec4<f32> {
                return uniforms.color;
            }
        `;

        const shaderModule = device.createShaderModule({ code: shaderCode });

        // Explicitly define the Bind Group Layout for sharing
        const bindGroupLayout = device.createBindGroupLayout({
            entries: [{
                binding: 0,
                visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
                buffer: { type: 'uniform' }
            }]
        });

        const pipelineLayout = device.createPipelineLayout({
            bindGroupLayouts: [bindGroupLayout]
        });

        const pipelineDescriptor: GPURenderPipelineDescriptor = {
            layout: pipelineLayout,
            vertex: {
                module: shaderModule,
                entryPoint: 'vs_main',
                buffers: [{
                    arrayStride: 12,
                    attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }]
                }]
            },
            fragment: {
                module: shaderModule,
                entryPoint: 'fs_main',
                targets: [{ format: presentationFormat }]
            },
            primitive: { topology: 'line-list' },
            depthStencil: {
                depthWriteEnabled: true,
                depthCompare: 'less',
                format: 'depth24plus',
            }
        };

        this.linePipeline = device.createRenderPipeline(pipelineDescriptor);

        // Solid pipeline for filled boxes
        const solidDescriptor = { ...pipelineDescriptor };
        solidDescriptor.primitive = { topology: 'triangle-list', cullMode: 'back' as GPUCullMode };
        this.solidPipeline = device.createRenderPipeline(solidDescriptor as GPURenderPipelineDescriptor);

        // Grid/Boundary wireframe
        const gridVertices = new Float32Array([
            0, 0, 0,  1, 0, 0,  1, 0, 0,  1, 0, 1,  1, 0, 1,  0, 0, 1,  0, 0, 1,  0, 0, 0,
            0, 1, 0,  1, 1, 0,  1, 1, 0,  1, 1, 1,  1, 1, 1,  0, 1, 1,  0, 1, 1,  0, 1, 0,
            0, 0, 0,  0, 1, 0,  1, 0, 0,  1, 1, 0,  1, 0, 1,  1, 1, 1,  0, 0, 1,  0, 1, 1,
        ]);
        this.gridVertexBuffer = this.createBuffer(gridVertices, GPUBufferUsage.VERTEX);

        // Cube for boxes
        const cubeVertices = new Float32Array([
            0, 0, 1,  1, 0, 1,  1, 1, 1,  0, 1, 1, // Front
            0, 0, 0,  0, 1, 0,  1, 1, 0,  1, 0, 0, // Back
            0, 1, 0,  0, 1, 1,  1, 1, 1,  1, 1, 0, // Top
            0, 0, 0,  1, 0, 0,  1, 0, 1,  0, 0, 1, // Bottom
            1, 0, 0,  1, 1, 0,  1, 1, 1,  1, 0, 1, // Right
            0, 0, 0,  0, 0, 1,  0, 1, 1,  0, 1, 0  // Left
        ]);
        this.cubeVertexBuffer = this.createBuffer(cubeVertices, GPUBufferUsage.VERTEX);

        const cubeIndices = new Uint16Array([
            0, 1, 2, 0, 2, 3,    // front
            4, 5, 6, 4, 6, 7,    // back
            8, 9, 10, 8, 10, 11, // top
            12, 13, 14, 12, 14, 15, // bottom
            16, 17, 18, 16, 18, 19, // right
            20, 21, 22, 20, 22, 23  // left
        ]);
        this.cubeIndexBuffer = this.createBuffer(cubeIndices, GPUBufferUsage.INDEX);

        this.uniformBuffer = device.createBuffer({
            size: 256,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        this.bindGroup = device.createBindGroup({
            layout: bindGroupLayout,
            entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }]
        });
    }

    private createBuffer(data: Float32Array | Uint16Array, usage: GPUBufferUsageFlags) {
        const buffer = this.device.createBuffer({
            size: data.byteLength,
            usage: usage | GPUBufferUsage.COPY_DST,
            mappedAtCreation: true,
        });
        if (data instanceof Float32Array) {
            new Float32Array(buffer.getMappedRange()).set(data);
        } else {
            new Uint16Array(buffer.getMappedRange()).set(data);
        }
        buffer.unmap();
        return buffer;
    }

    draw(passEncoder: GPURenderPassEncoder, projectionMatrix: Float32Array, camera: Camera, simOffset: number[] = [0, 0, 0], gridDimensions: number[] = [1, 1, 1]) {
        this.device.queue.writeBuffer(this.uniformBuffer, 0, projectionMatrix);
        this.device.queue.writeBuffer(this.uniformBuffer, 64, camera.getViewMatrix());

        // 1. Draw Boundary Grid
        passEncoder.setPipeline(this.linePipeline);
        passEncoder.setBindGroup(0, this.bindGroup);
        
        this.updateUniforms(simOffset, gridDimensions, [1.0, 1.0, 1.0, 1.0]);
        passEncoder.setVertexBuffer(0, this.gridVertexBuffer);
        passEncoder.draw(24);

        /*
        // 2. Draw Solid Boxes (Disabled to show only particles)
        passEncoder.setPipeline(this.solidPipeline);
        for (const box of this.boxes) {
            const translation = [
                box.min[0] + simOffset[0],
                box.min[1] + simOffset[1],
                box.min[2] + simOffset[2]
            ];
            const scale = [box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]];
            this.updateUniforms(translation, scale, [0.97, 0.97, 0.97, 1.0]);
            
            passEncoder.setVertexBuffer(0, this.cubeVertexBuffer);
            passEncoder.setIndexBuffer(this.cubeIndexBuffer, 'uint16');
            passEncoder.drawIndexed(36);
        }
        */

        /*
        // 3. Draw Box Wireframes
        passEncoder.setPipeline(this.linePipeline);
        for (const box of this.boxes) {
            const translation = [
                box.min[0] + simOffset[0],
                box.min[1] + simOffset[1],
                box.min[2] + simOffset[2]
            ];
            const scale = [box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]];
            this.updateUniforms(translation, scale, [0.5, 0.5, 0.5, 1.0]);
            
            passEncoder.setVertexBuffer(0, this.gridVertexBuffer); // Reuse grid wireframe for unit cube
            passEncoder.draw(24);
        }
        */
    }

    private updateUniforms(translation: number[], scale: number[], color: number[]) {
        this.device.queue.writeBuffer(this.uniformBuffer, 128, new Float32Array(translation));
        this.device.queue.writeBuffer(this.uniformBuffer, 144, new Float32Array(scale));
        this.device.queue.writeBuffer(this.uniformBuffer, 160, new Float32Array(color));
    }
}
