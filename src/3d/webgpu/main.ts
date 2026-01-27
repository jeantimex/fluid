/**
 * WebGPU 3D Bootstrap - Canvas + Device init only.
 */

import './style.css';
import { createConfig } from '../common/config.ts';
import { createSpawnData } from '../common/spawn.ts';
import {
  configureContext,
  initWebGPU,
  WebGPUInitError,
} from '../../2d/webgpu/webgpu_utils.ts';
import { SimulationBuffers } from './simulation_buffers.ts';

type Mat4 = Float32Array;

function createMat4(): Mat4 {
  return new Float32Array(16);
}

function mat4Multiply(out: Mat4, a: Mat4, b: Mat4): Mat4 {
  const a00 = a[0],
    a01 = a[1],
    a02 = a[2],
    a03 = a[3];
  const a10 = a[4],
    a11 = a[5],
    a12 = a[6],
    a13 = a[7];
  const a20 = a[8],
    a21 = a[9],
    a22 = a[10],
    a23 = a[11];
  const a30 = a[12],
    a31 = a[13],
    a32 = a[14],
    a33 = a[15];

  const b00 = b[0],
    b01 = b[1],
    b02 = b[2],
    b03 = b[3];
  const b10 = b[4],
    b11 = b[5],
    b12 = b[6],
    b13 = b[7];
  const b20 = b[8],
    b21 = b[9],
    b22 = b[10],
    b23 = b[11];
  const b30 = b[12],
    b31 = b[13],
    b32 = b[14],
    b33 = b[15];

  out[0] = b00 * a00 + b01 * a10 + b02 * a20 + b03 * a30;
  out[1] = b00 * a01 + b01 * a11 + b02 * a21 + b03 * a31;
  out[2] = b00 * a02 + b01 * a12 + b02 * a22 + b03 * a32;
  out[3] = b00 * a03 + b01 * a13 + b02 * a23 + b03 * a33;

  out[4] = b10 * a00 + b11 * a10 + b12 * a20 + b13 * a30;
  out[5] = b10 * a01 + b11 * a11 + b12 * a21 + b13 * a31;
  out[6] = b10 * a02 + b11 * a12 + b12 * a22 + b13 * a32;
  out[7] = b10 * a03 + b11 * a13 + b12 * a23 + b13 * a33;

  out[8] = b20 * a00 + b21 * a10 + b22 * a20 + b23 * a30;
  out[9] = b20 * a01 + b21 * a11 + b22 * a21 + b23 * a31;
  out[10] = b20 * a02 + b21 * a12 + b22 * a22 + b23 * a32;
  out[11] = b20 * a03 + b21 * a13 + b22 * a23 + b23 * a33;

  out[12] = b30 * a00 + b31 * a10 + b32 * a20 + b33 * a30;
  out[13] = b30 * a01 + b31 * a11 + b32 * a21 + b33 * a31;
  out[14] = b30 * a02 + b31 * a12 + b32 * a22 + b33 * a32;
  out[15] = b30 * a03 + b31 * a13 + b32 * a23 + b33 * a33;

  return out;
}

function mat4Perspective(
  out: Mat4,
  fovy: number,
  aspect: number,
  near: number,
  far: number
): Mat4 {
  const f = 1.0 / Math.tan(fovy / 2);
  const nf = 1 / (near - far);

  out[0] = f / aspect;
  out[1] = 0;
  out[2] = 0;
  out[3] = 0;
  out[4] = 0;
  out[5] = f;
  out[6] = 0;
  out[7] = 0;
  out[8] = 0;
  out[9] = 0;
  out[10] = (far + near) * nf;
  out[11] = -1;
  out[12] = 0;
  out[13] = 0;
  out[14] = 2 * far * near * nf;
  out[15] = 0;

  return out;
}

function mat4LookAt(
  out: Mat4,
  eye: { x: number; y: number; z: number },
  target: { x: number; y: number; z: number },
  up: { x: number; y: number; z: number }
): Mat4 {
  const zx = eye.x - target.x;
  const zy = eye.y - target.y;
  const zz = eye.z - target.z;
  const zLen = Math.hypot(zx, zy, zz) || 1;
  const zxN = zx / zLen;
  const zyN = zy / zLen;
  const zzN = zz / zLen;

  const xx = up.y * zzN - up.z * zyN;
  const xy = up.z * zxN - up.x * zzN;
  const xz = up.x * zyN - up.y * zxN;
  const xLen = Math.hypot(xx, xy, xz) || 1;
  const xxN = xx / xLen;
  const xyN = xy / xLen;
  const xzN = xz / xLen;

  const yx = zyN * xzN - zzN * xyN;
  const yy = zzN * xxN - zxN * xzN;
  const yz = zxN * xyN - zyN * xxN;

  out[0] = xxN;
  out[1] = yx;
  out[2] = zxN;
  out[3] = 0;
  out[4] = xyN;
  out[5] = yy;
  out[6] = zyN;
  out[7] = 0;
  out[8] = xzN;
  out[9] = yz;
  out[10] = zzN;
  out[11] = 0;
  out[12] = -(xxN * eye.x + xyN * eye.y + xzN * eye.z);
  out[13] = -(yx * eye.x + yy * eye.y + yz * eye.z);
  out[14] = -(zxN * eye.x + zyN * eye.y + zzN * eye.z);
  out[15] = 1;

  return out;
}

function createCanvas(app: HTMLDivElement): HTMLCanvasElement {
  app.innerHTML =
    '<canvas id="sim-canvas" aria-label="Fluid simulation"></canvas>';
  const canvas = document.querySelector<HTMLCanvasElement>('#sim-canvas');
  if (!canvas) {
    throw new Error('Failed to create canvas element');
  }
  return canvas;
}

function setupResizeHandler(
  canvas: HTMLCanvasElement,
  context: GPUCanvasContext,
  device: GPUDevice,
  format: GPUTextureFormat,
  boundsSize: { x: number; y: number; z: number }
): () => void {
  let baseUnitsPerPixel: number | null = null;

  const resize = (): void => {
    const rect = canvas.getBoundingClientRect();
    if (baseUnitsPerPixel === null) {
      baseUnitsPerPixel = boundsSize.x / Math.max(1, rect.width);
    }

    const dpr = window.devicePixelRatio || 1;
    const nextWidth = Math.max(1, Math.round(rect.width * dpr));
    const nextHeight = Math.max(1, Math.round(rect.height * dpr));

    if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
      canvas.width = nextWidth;
      canvas.height = nextHeight;

      // Keep Z as-is for now; adjust X/Y to match viewport scale.
      boundsSize.x = (canvas.width / dpr) * baseUnitsPerPixel;
      boundsSize.y = (canvas.height / dpr) * baseUnitsPerPixel;

      configureContext(context, device, format);
    }
  };

  window.addEventListener('resize', resize);
  return resize;
}

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) {
  throw new Error('Missing #app container');
}

const canvas = createCanvas(app);
const config = createConfig();

async function main(): Promise<void> {
  let device: GPUDevice;
  let context: GPUCanvasContext;
  let format: GPUTextureFormat;

  try {
    ({ device, context, format } = await initWebGPU(canvas));
  } catch (error) {
    if (error instanceof WebGPUInitError) {
      app.innerHTML = `<p>${error.message}</p>`;
      return;
    }
    throw error;
  }

  const resize = setupResizeHandler(
    canvas,
    context,
    device,
    format,
    config.boundsSize
  );
  resize();

  const spawn = createSpawnData(config);
  const buffers = new SimulationBuffers(device, spawn);

  const uniformBuffer = device.createBuffer({
    size: 4 * 32, // 128-byte min binding size
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const computeParamsBuffer = device.createBuffer({
    size: 4 * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const computeModule = device.createShaderModule({
    code: `
struct Params {
  data : vec4<f32>,
};

@group(0) @binding(0) var<storage, read_write> Positions : array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> Velocities : array<vec4<f32>>;
@group(0) @binding(2) var<uniform> ParamsU : Params;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let idx = gid.x;
  let count = u32(ParamsU.data.z);
  if (idx >= count) {
    return;
  }

  let dt = ParamsU.data.x;
  let gravity = ParamsU.data.y;

  var v = Velocities[idx];
  v.y = v.y + gravity * dt;
  Velocities[idx] = v;

  var p = Positions[idx];
  p = p + vec4<f32>(v.xyz * dt, 0.0);
  Positions[idx] = p;
}
    `,
  });

  const computePipeline = device.createComputePipeline({
    layout: 'auto',
    compute: {
      module: computeModule,
      entryPoint: 'main',
    },
  });

  const shaderModule = device.createShaderModule({
    code: `
struct CameraUniforms {
  viewProj : mat4x4<f32>,
  camRight : vec3<f32>,
  _pad0 : f32,
  camUp : vec3<f32>,
  _pad1 : f32,
  radius : f32,
  _pad2 : vec3<f32>,
};

@group(0) @binding(0) var<storage, read> Positions : array<vec4<f32>>;
@group(0) @binding(1) var<uniform> Camera : CameraUniforms;

struct VSOut {
  @builtin(position) pos : vec4<f32>,
  @location(0) quad : vec2<f32>,
};

fn quadVertex(id : u32) -> vec2<f32> {
  switch (id) {
    case 0u: { return vec2<f32>(-1.0, -1.0); }
    case 1u: { return vec2<f32>( 1.0, -1.0); }
    case 2u: { return vec2<f32>( 1.0,  1.0); }
    case 3u: { return vec2<f32>(-1.0, -1.0); }
    case 4u: { return vec2<f32>( 1.0,  1.0); }
    default: { return vec2<f32>(-1.0,  1.0); }
  }
}

@vertex
fn vsMain(@builtin(vertex_index) vid : u32, @builtin(instance_index) iid : u32) -> VSOut {
  let corner = quadVertex(vid);
  let center = Positions[iid].xyz;
  let world = center + (Camera.camRight * corner.x + Camera.camUp * corner.y) * Camera.radius;

  var out : VSOut;
  out.pos = Camera.viewProj * vec4<f32>(world, 1.0);
  out.quad = corner;
  return out;
}

@fragment
fn fsMain(in : VSOut) -> @location(0) vec4<f32> {
  let r2 = dot(in.quad, in.quad);
  if (r2 > 1.0) {
    discard;
  }

  let z = sqrt(1.0 - r2);
  let n = normalize(vec3<f32>(in.quad, z));
  let lightDir = normalize(vec3<f32>(0.3, 0.5, 0.8));
  let diff = max(dot(n, lightDir), 0.0);
  let base = vec3<f32>(0.2, 0.6, 1.0);
  let color = base * (0.25 + 0.75 * diff);
  return vec4<f32>(color, 1.0);
}
    `,
  });

  const pipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: {
      module: shaderModule,
      entryPoint: 'vsMain',
    },
    fragment: {
      module: shaderModule,
      entryPoint: 'fsMain',
      targets: [{ format }],
    },
    primitive: {
      topology: 'triangle-list',
      cullMode: 'back',
    },
  });

  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: buffers.positions } },
      { binding: 1, resource: { buffer: uniformBuffer } },
    ],
  });

  const computeBindGroup = device.createBindGroup({
    layout: computePipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: buffers.positions } },
      { binding: 1, resource: { buffer: buffers.velocities } },
      { binding: 2, resource: { buffer: computeParamsBuffer } },
    ],
  });

  const view = createMat4();
  const proj = createMat4();
  const viewProj = createMat4();

  const eye = { x: 0, y: 0, z: 30 };
  const target = { x: 0, y: 0, z: 0 };
  const up = { x: 0, y: 1, z: 0 };

  const cameraRight = { x: 1, y: 0, z: 0 };
  const cameraUp = { x: 0, y: 1, z: 0 };

  const updateCameraUniforms = (): void => {
    const aspect = canvas.width / Math.max(1, canvas.height);
    mat4LookAt(view, eye, target, up);
    mat4Perspective(proj, Math.PI / 4, aspect, 0.1, 200);
    mat4Multiply(viewProj, proj, view);

    const data = new Float32Array(32);
    data.set(viewProj, 0);
    data.set([cameraRight.x, cameraRight.y, cameraRight.z, 0], 16);
    data.set([cameraUp.x, cameraUp.y, cameraUp.z, 0], 20);
    data[24] = config.particleRadius;

    device.queue.writeBuffer(uniformBuffer, 0, data);
  };

  let lastTime = performance.now();

  const frame = (): void => {
    const now = performance.now();
    const dt = Math.min(0.033, (now - lastTime) / 1000);
    lastTime = now;

    updateCameraUniforms();

    const params = new Float32Array(4);
    params[0] = dt;
    params[1] = config.gravity;
    params[2] = buffers.particleCount;
    device.queue.writeBuffer(computeParamsBuffer, 0, params);

    const encoder = device.createCommandEncoder();
    const view = context.getCurrentTexture().createView();

    const computePass = encoder.beginComputePass();
    computePass.setPipeline(computePipeline);
    computePass.setBindGroup(0, computeBindGroup);
    computePass.dispatchWorkgroups(Math.ceil(buffers.particleCount / 256));
    computePass.end();

    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view,
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: { r: 0.05, g: 0.07, b: 0.1, a: 1 },
        },
      ],
    });

    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(6, buffers.particleCount);
    pass.end();

    device.queue.submit([encoder.finish()]);

    requestAnimationFrame(frame);
  };

  requestAnimationFrame(frame);
}

void main();
