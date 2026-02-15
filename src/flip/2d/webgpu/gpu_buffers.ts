/**
 * GPU Buffer Management for FLIP Fluid Simulation
 *
 * This module manages all GPU buffers needed for the compute shader simulation.
 */

export interface SimulationParams {
  // Grid parameters
  fNumX: number;
  fNumY: number;
  fNumCells: number;
  h: number;
  fInvSpacing: number;

  // Particle parameters
  numParticles: number;
  maxParticles: number;
  particleRadius: number;

  // Spatial hash parameters
  pNumX: number;
  pNumY: number;
  pNumCells: number;
  pInvSpacing: number;

  // Simulation parameters
  gravity: number;
  dt: number;
  flipRatio: number;
  overRelaxation: number;
  particleRestDensity: number;

  // Domain
  domainWidth: number;
  domainHeight: number;
}

export class GPUSimulationBuffers {
  private device: GPUDevice;

  // Particle buffers
  particlePos: GPUBuffer;
  particleVel: GPUBuffer;
  particleColor: GPUBuffer;

  // Spatial hash buffers
  particleHash: GPUBuffer;
  particleIndex: GPUBuffer;
  cellCount: GPUBuffer;
  cellOffset: GPUBuffer;
  sortedIndex: GPUBuffer;

  // Grid buffers (MAC staggered grid)
  gridU: GPUBuffer;           // x-velocity at left cell faces
  gridV: GPUBuffer;           // y-velocity at bottom cell faces
  gridDU: GPUBuffer;          // weight accumulator for u
  gridDV: GPUBuffer;          // weight accumulator for v
  gridPrevU: GPUBuffer;       // previous u for FLIP
  gridPrevV: GPUBuffer;       // previous v for FLIP
  gridP: GPUBuffer;           // pressure
  gridS: GPUBuffer;           // solid flag (0=solid, 1=fluid)
  gridCellType: GPUBuffer;    // cell type (FLUID/AIR/SOLID)
  gridDensity: GPUBuffer;     // particle density per cell

  // For pressure solver ping-pong
  gridUTemp: GPUBuffer;
  gridVTemp: GPUBuffer;

  // Uniform buffers
  simParams: GPUBuffer;
  obstacleParams: GPUBuffer;

  // Sizes for reference
  maxParticles: number;
  fNumCells: number;
  pNumCells: number;

  constructor(device: GPUDevice, params: SimulationParams) {
    this.device = device;
    this.maxParticles = params.maxParticles;
    this.fNumCells = params.fNumCells;
    this.pNumCells = params.pNumCells;

    // Particle buffers
    this.particlePos = device.createBuffer({
      size: params.maxParticles * 2 * 4, // vec2<f32>
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
      label: 'particlePos',
    });

    this.particleVel = device.createBuffer({
      size: params.maxParticles * 2 * 4, // vec2<f32>
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
      label: 'particleVel',
    });

    this.particleColor = device.createBuffer({
      size: params.maxParticles * 4 * 4, // vec4<f32> (padded from vec3)
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
      label: 'particleColor',
    });

    // Spatial hash buffers
    this.particleHash = device.createBuffer({
      size: params.maxParticles * 4, // u32
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      label: 'particleHash',
    });

    this.particleIndex = device.createBuffer({
      size: params.maxParticles * 4, // u32
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      label: 'particleIndex',
    });

    this.cellCount = device.createBuffer({
      size: params.pNumCells * 4, // u32
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      label: 'cellCount',
    });

    this.cellOffset = device.createBuffer({
      size: (params.pNumCells + 1) * 4, // u32
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      label: 'cellOffset',
    });

    this.sortedIndex = device.createBuffer({
      size: params.maxParticles * 4, // u32
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      label: 'sortedIndex',
    });

    // Grid buffers
    const gridSize = params.fNumCells * 4; // f32

    this.gridU = device.createBuffer({
      size: gridSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
      label: 'gridU',
    });

    this.gridV = device.createBuffer({
      size: gridSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
      label: 'gridV',
    });

    this.gridDU = device.createBuffer({
      size: gridSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      label: 'gridDU',
    });

    this.gridDV = device.createBuffer({
      size: gridSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      label: 'gridDV',
    });

    this.gridPrevU = device.createBuffer({
      size: gridSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
      label: 'gridPrevU',
    });

    this.gridPrevV = device.createBuffer({
      size: gridSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
      label: 'gridPrevV',
    });

    this.gridP = device.createBuffer({
      size: gridSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      label: 'gridP',
    });

    this.gridS = device.createBuffer({
      size: gridSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      label: 'gridS',
    });

    this.gridCellType = device.createBuffer({
      size: params.fNumCells * 4, // i32
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      label: 'gridCellType',
    });

    this.gridDensity = device.createBuffer({
      size: gridSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      label: 'gridDensity',
    });

    // Ping-pong buffers for pressure solver
    this.gridUTemp = device.createBuffer({
      size: gridSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      label: 'gridUTemp',
    });

    this.gridVTemp = device.createBuffer({
      size: gridSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      label: 'gridVTemp',
    });

    // Uniform buffers
    // SimParams: 16 floats + 8 ints = 96 bytes, round to 128
    this.simParams = device.createBuffer({
      size: 128,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      label: 'simParams',
    });

    // ObstacleParams: x, y, vx, vy, radius = 5 floats = 20 bytes, round to 32
    this.obstacleParams = device.createBuffer({
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      label: 'obstacleParams',
    });
  }

  /**
   * Upload simulation parameters to GPU.
   */
  updateSimParams(params: SimulationParams): void {
    const data = new ArrayBuffer(128);
    const floatView = new Float32Array(data);
    const intView = new Int32Array(data);

    // Floats (offset 0-15)
    floatView[0] = params.h;
    floatView[1] = params.fInvSpacing;
    floatView[2] = params.particleRadius;
    floatView[3] = params.pInvSpacing;
    floatView[4] = params.gravity;
    floatView[5] = params.dt;
    floatView[6] = params.flipRatio;
    floatView[7] = params.overRelaxation;
    floatView[8] = params.particleRestDensity;
    floatView[9] = params.domainWidth;
    floatView[10] = params.domainHeight;
    floatView[11] = 0; // padding

    // Ints (offset 12-19, which is byte offset 48-76)
    intView[12] = params.fNumX;
    intView[13] = params.fNumY;
    intView[14] = params.fNumCells;
    intView[15] = params.numParticles;
    intView[16] = params.maxParticles;
    intView[17] = params.pNumX;
    intView[18] = params.pNumY;
    intView[19] = params.pNumCells;

    this.device.queue.writeBuffer(this.simParams, 0, data);
  }

  /**
   * Upload obstacle parameters to GPU.
   */
  updateObstacleParams(x: number, y: number, vx: number, vy: number, radius: number): void {
    const data = new Float32Array([x, y, vx, vy, radius, 0, 0, 0]);
    this.device.queue.writeBuffer(this.obstacleParams, 0, data);
  }

  /**
   * Upload particle positions from CPU.
   */
  uploadParticlePos(data: Float32Array, count: number): void {
    this.device.queue.writeBuffer(this.particlePos, 0, data.buffer, 0, count * 2 * 4);
  }

  /**
   * Upload particle velocities from CPU.
   */
  uploadParticleVel(data: Float32Array, count: number): void {
    this.device.queue.writeBuffer(this.particleVel, 0, data.buffer, 0, count * 2 * 4);
  }

  /**
   * Upload particle colors from CPU (converts RGB to RGBA).
   */
  uploadParticleColor(data: Float32Array, count: number): void {
    // Convert from interleaved RGB to RGBA
    const rgba = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      rgba[i * 4 + 0] = data[i * 3 + 0];
      rgba[i * 4 + 1] = data[i * 3 + 1];
      rgba[i * 4 + 2] = data[i * 3 + 2];
      rgba[i * 4 + 3] = 1.0;
    }
    this.device.queue.writeBuffer(this.particleColor, 0, rgba);
  }

  /**
   * Upload grid solid flags from CPU.
   */
  uploadGridS(data: Float32Array): void {
    this.device.queue.writeBuffer(this.gridS, 0, data.buffer, data.byteOffset, data.byteLength);
  }

  /**
   * Upload grid density from CPU.
   */
  uploadGridDensity(data: Float32Array): void {
    this.device.queue.writeBuffer(this.gridDensity, 0, data.buffer, data.byteOffset, data.byteLength);
  }

  /**
   * Clean up GPU resources.
   */
  destroy(): void {
    this.particlePos.destroy();
    this.particleVel.destroy();
    this.particleColor.destroy();
    this.particleHash.destroy();
    this.particleIndex.destroy();
    this.cellCount.destroy();
    this.cellOffset.destroy();
    this.sortedIndex.destroy();
    this.gridU.destroy();
    this.gridV.destroy();
    this.gridDU.destroy();
    this.gridDV.destroy();
    this.gridPrevU.destroy();
    this.gridPrevV.destroy();
    this.gridP.destroy();
    this.gridS.destroy();
    this.gridCellType.destroy();
    this.gridDensity.destroy();
    this.gridUTemp.destroy();
    this.gridVTemp.destroy();
    this.simParams.destroy();
    this.obstacleParams.destroy();
  }
}
