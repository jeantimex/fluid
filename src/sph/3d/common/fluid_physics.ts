import type { FluidBuffers } from './fluid_buffers.ts';
import type { SpatialGrid } from './spatial_grid.ts';

// Shader imports
import externalForcesShader from './shaders/external_forces.wgsl?raw';
import densityShader from './shaders/density_linear.wgsl?raw';
import densitySharedShader from './shaders/density_shared.wgsl?raw';
import pressureShader from './shaders/pressure_linear.wgsl?raw';
import pressureSharedShader from './shaders/pressure_shared.wgsl?raw';
import viscosityShader from './shaders/viscosity_linear.wgsl?raw';
import integrateShader from './shaders/integrate.wgsl?raw';

export interface PhysicsUniforms {
  external: GPUBuffer;
  density: GPUBuffer;
  pressure: GPUBuffer;
  viscosity: GPUBuffer;
  integrate: GPUBuffer;
}

export interface SpatialGridUniforms {
  hash: GPUBuffer;
  sort: GPUBuffer;
  scanL0: GPUBuffer;
  scanL1: GPUBuffer;
  scanL2: GPUBuffer;
}

/**
 * Orchestrates the SPH physics simulation steps.
 */
export class FluidPhysics {
  /**
   * Beginner note:
   * This class owns compute pipelines for the core SPH passes.
   * It does not manage buffers; it just dispatches pipelines in order.
   */
  private device: GPUDevice;

  // Physics Pipelines
  private externalForcesPipeline: GPUComputePipeline;
  private densityPipeline: GPUComputePipeline;
  private pressurePipeline: GPUComputePipeline;
  private viscosityPipeline: GPUComputePipeline;
  private integratePipeline: GPUComputePipeline;

  // Bind Groups
  private externalBG!: GPUBindGroup;
  private densityBG!: GPUBindGroup;
  private pressureBG!: GPUBindGroup;
  private viscosityBG!: GPUBindGroup;
  private integrateBG!: GPUBindGroup;

  // Workgroup size for density/pressure (64 for shared memory, 256 for standard)
  private readonly densityPressureWorkgroupSize: number;

  constructor(device: GPUDevice, useSharedMemory: boolean = false) {
    this.device = device;

    // Select shaders based on shared memory preference
    const selectedDensityShader = useSharedMemory
      ? densitySharedShader
      : densityShader;
    const selectedPressureShader = useSharedMemory
      ? pressureSharedShader
      : pressureShader;

    // Shared memory shaders use workgroup size 64, standard use 256
    this.densityPressureWorkgroupSize = useSharedMemory ? 64 : 256;

    if (useSharedMemory) {
      console.log('FluidPhysics: Using shared memory optimized shaders');
    }

    // Create Pipelines
    this.externalForcesPipeline = this.createPipeline(
      externalForcesShader,
      'main'
    );
    this.densityPipeline = this.createPipeline(selectedDensityShader, 'main');
    this.pressurePipeline = this.createPipeline(selectedPressureShader, 'main');
    this.viscosityPipeline = this.createPipeline(viscosityShader, 'main');
    this.integratePipeline = this.createPipeline(integrateShader, 'main');
  }

  private createPipeline(code: string, entryPoint: string): GPUComputePipeline {
    return this.device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: this.device.createShaderModule({ code }),
        entryPoint,
      },
    });
  }

  /**
   * (Re)creates bind groups when buffers change.
   */
  createBindGroups(buffers: FluidBuffers, uniforms: PhysicsUniforms) {
    this.externalBG = this.device.createBindGroup({
      layout: this.externalForcesPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.positions } },
        { binding: 1, resource: { buffer: buffers.velocities } },
        { binding: 2, resource: { buffer: buffers.predicted } },
        { binding: 3, resource: { buffer: uniforms.external } },
      ],
    });

    this.densityBG = this.device.createBindGroup({
      layout: this.densityPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.predicted } },
        { binding: 1, resource: { buffer: buffers.sortOffsets } },
        { binding: 2, resource: { buffer: buffers.densities } },
        { binding: 3, resource: { buffer: uniforms.density } },
      ],
    });

    this.pressureBG = this.device.createBindGroup({
      layout: this.pressurePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.predicted } },
        { binding: 1, resource: { buffer: buffers.velocities } },
        { binding: 2, resource: { buffer: buffers.densities } },
        { binding: 3, resource: { buffer: buffers.sortOffsets } },
        { binding: 4, resource: { buffer: uniforms.pressure } },
      ],
    });

    this.viscosityBG = this.device.createBindGroup({
      layout: this.viscosityPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.predicted } },
        { binding: 1, resource: { buffer: buffers.velocities } },
        { binding: 2, resource: { buffer: buffers.sortOffsets } },
        { binding: 4, resource: { buffer: uniforms.viscosity } },
      ],
    });

    this.integrateBG = this.device.createBindGroup({
      layout: this.integratePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: buffers.positions } },
        { binding: 1, resource: { buffer: buffers.velocities } },
        { binding: 2, resource: { buffer: uniforms.integrate } },
      ],
    });
  }

  /**
   * Executes a single simulation substep.
   */
  step(
    pass: GPUComputePassEncoder,
    grid: SpatialGrid,
    particleCount: number,
    gridTotalCells: number,
    includeViscosity: boolean = true,
    rebuildGrid: boolean = true
  ) {
    const numBlocks256 = Math.ceil(particleCount / 256);
    const numBlocksDensityPressure = Math.ceil(
      particleCount / this.densityPressureWorkgroupSize
    );

    // 1. External Forces (Gravity, Input) -> Predicts Positions
    pass.setPipeline(this.externalForcesPipeline);
    pass.setBindGroup(0, this.externalBG);
    pass.dispatchWorkgroups(numBlocks256);

    // 2. Spatial Grid Pass (Hash, Sort, Reorder, CopyBack)
    if (rebuildGrid) {
      grid.dispatch(pass, particleCount, gridTotalCells);
    }

    // 3. Density Pass (uses shared memory workgroup size if enabled)
    pass.setPipeline(this.densityPipeline);
    pass.setBindGroup(0, this.densityBG);
    pass.dispatchWorkgroups(numBlocksDensityPressure);

    // 4. Pressure Pass (uses shared memory workgroup size if enabled)
    pass.setPipeline(this.pressurePipeline);
    pass.setBindGroup(0, this.pressureBG);
    pass.dispatchWorkgroups(numBlocksDensityPressure);

    // 5. Viscosity Pass (Optional)
    if (includeViscosity) {
      pass.setPipeline(this.viscosityPipeline);
      pass.setBindGroup(0, this.viscosityBG);
      pass.dispatchWorkgroups(numBlocks256);
    }

    // 6. Integration Pass (Velocity -> Position, Boundary Collisions)
    pass.setPipeline(this.integratePipeline);
    pass.setBindGroup(0, this.integrateBG);
    pass.dispatchWorkgroups(numBlocks256);
  }
}
