// =============================================================================
// Surface Field Compute Shader
// =============================================================================
// Computes a scalar field from particle positions for surface extraction.
// Refactored to use a particle-centric "scatter" approach for performance.
// =============================================================================

struct SurfaceFieldUniforms {
  nx: u32,
  ny: u32,
  nz: u32,
  particleCount: u32,

  gridWidth: f32,
  gridHeight: f32,
  gridDepth: f32,
  particleRadius: f32,

  kernelRadius: f32,    // Search radius for particle contributions
  surfaceLevel: f32,    // Isosurface threshold (typically 0.5)
  _pad0: f32,
  _pad1: f32,
};

@group(0) @binding(0) var<uniform> uniforms: SurfaceFieldUniforms;
@group(0) @binding(1) var<storage, read> particlePositions: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> scalarFieldAtomic: array<atomic<i32>>;
@group(0) @binding(3) var<storage, read_write> scalarField: array<f32>;

// Fixed-point scale for atomic accumulation
const SCALE: f32 = 10000.0;

// -----------------------------------------------------------------------------
// Helper Functions
// -----------------------------------------------------------------------------

/// Grid vertex index (field is defined at grid vertices, not cell centers)
fn fieldIdx(x: u32, y: u32, z: u32) -> u32 {
  let cx = clamp(x, 0u, uniforms.nx);
  let cy = clamp(y, 0u, uniforms.ny);
  let cz = clamp(z, 0u, uniforms.nz);
  let fnx = uniforms.nx + 1u;
  let fny = uniforms.ny + 1u;
  return cx + cy * fnx + cz * fnx * fny;
}

/// Convert grid vertex coordinates to world position
fn gridVertexToWorld(x: u32, y: u32, z: u32) -> vec3<f32> {
  let dx = uniforms.gridWidth / f32(uniforms.nx);
  let dy = uniforms.gridHeight / f32(uniforms.ny);
  let dz = uniforms.gridDepth / f32(uniforms.nz);
  return vec3<f32>(f32(x) * dx, f32(y) * dy, f32(z) * dz);
}

/// Smooth kernel function (poly6-like)
fn kernel(distSq: f32, radiusSq: f32) -> f32 {
  if (distSq >= radiusSq) { return 0.0; }
  let x = 1.0 - distSq / radiusSq;
  return x * x * x; // Cubic falloff
}

// =============================================================================
// CLEAR FIELD - Reset scalar field to zero
// =============================================================================

@compute @workgroup_size(8, 4, 4)
fn clearField(@builtin(global_invocation_id) id: vec3<u32>) {
  let fnx = uniforms.nx + 1u;
  let fny = uniforms.ny + 1u;
  let fnz = uniforms.nz + 1u;

  if (id.x >= fnx || id.y >= fny || id.z >= fnz) { return; }

  let idx = fieldIdx(id.x, id.y, id.z);
  atomicStore(&scalarFieldAtomic[idx], 0);
}

// =============================================================================
// COMPUTE FIELD (Particle-centric scatter)
// =============================================================================

@compute @workgroup_size(64)
fn computeField(@builtin(global_invocation_id) id: vec3<u32>) {
  let pIdx = id.x;
  if (pIdx >= uniforms.particleCount) { return; }

  let pos = particlePositions[pIdx].xyz;
  let radius = uniforms.kernelRadius;
  let radiusSq = radius * radius;

  // Grid spacing
  let dx = uniforms.gridWidth / f32(uniforms.nx);
  let dy = uniforms.gridHeight / f32(uniforms.ny);
  let dz = uniforms.gridDepth / f32(uniforms.nz);

  // Find range of grid vertices affected by this particle
  let minX = u32(max(0.0, (pos.x - radius) / dx));
  let maxX = u32(min(f32(uniforms.nx), (pos.x + radius) / dx));
  let minY = u32(max(0.0, (pos.y - radius) / dy));
  let maxY = u32(min(f32(uniforms.ny), (pos.y + radius) / dy));
  let minZ = u32(max(0.0, (pos.z - radius) / dz));
  let maxZ = u32(min(f32(uniforms.nz), (pos.z + radius) / dz));

  // Splat contribution to nearby vertices
  for (var z = minZ; z <= maxZ; z++) {
    for (var y = minY; y <= maxY; y++) {
      for (var x = minX; x <= maxX; x++) {
        let vertexPos = gridVertexToWorld(x, y, z);
        let diff = pos - vertexPos;
        let distSq = dot(diff, diff);

        if (distSq < radiusSq) {
          let weight = kernel(distSq, radiusSq);
          let idx = fieldIdx(x, y, z);
          atomicAdd(&scalarFieldAtomic[idx], i32(weight * SCALE));
        }
      }
    }
  }
}

// =============================================================================
// NORMALIZE FIELD - Convert atomic integers back to floats
// =============================================================================

@compute @workgroup_size(8, 4, 4)
fn normalizeField(@builtin(global_invocation_id) id: vec3<u32>) {
  let fnx = uniforms.nx + 1u;
  let fny = uniforms.ny + 1u;
  let fnz = uniforms.nz + 1u;

  if (id.x >= fnx || id.y >= fny || id.z >= fnz) { return; }

  let idx = fieldIdx(id.x, id.y, id.z);
  let intVal = atomicLoad(&scalarFieldAtomic[idx]);
  scalarField[idx] = f32(intVal) / SCALE;
}
