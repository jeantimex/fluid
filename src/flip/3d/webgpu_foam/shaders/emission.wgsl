// =============================================================================
// Whitewater Emission Potential Compute Kernels
// =============================================================================
// Computes emission potentials for whitewater particles (foam, spray, bubbles).
// Separate shader module to stay within 10 storage buffer per-stage limit.
//
// Potentials computed:
// - Trapped Air (Ita): Vorticity magnitude - where bubbles form
// - Wave Crest (Iwc): velocity · surfaceNormal - where spray forms
// - Kinetic Energy (Ike): |velocity|² - energy multiplier
// =============================================================================

struct EmissionUniforms {
  nx: u32,
  ny: u32,
  nz: u32,
  _pad: u32,
};

@group(0) @binding(0) var<uniform> uniforms: EmissionUniforms;
@group(0) @binding(1) var<storage, read> velocity: array<vec4<f32>>;  // MAC grid velocity
@group(0) @binding(2) var<storage, read> surfaceSDF: array<f32>;
@group(0) @binding(3) var<storage, read_write> trappedAirPotential: array<f32>;
@group(0) @binding(4) var<storage, read_write> waveCrestPotential: array<f32>;
@group(0) @binding(5) var<storage, read_write> kineticEnergyPotential: array<f32>;

// -----------------------------------------------------------------------------
// Index helpers
// -----------------------------------------------------------------------------

/// Scalar grid index (cell-centered values like SDF, marker, potentials)
fn scalarIdx(x: u32, y: u32, z: u32) -> u32 {
  let cx = clamp(x, 0u, uniforms.nx - 1u);
  let cy = clamp(y, 0u, uniforms.ny - 1u);
  let cz = clamp(z, 0u, uniforms.nz - 1u);
  return cx + cy * uniforms.nx + cz * uniforms.nx * uniforms.ny;
}

/// Velocity grid index (staggered MAC grid, size nx+1 × ny+1 × nz+1)
fn velIdx(x: u32, y: u32, z: u32) -> u32 {
  let vnx = uniforms.nx + 1u;
  let vny = uniforms.ny + 1u;
  let cx = clamp(x, 0u, vnx - 1u);
  let cy = clamp(y, 0u, vny - 1u);
  let cz = clamp(z, 0u, uniforms.nz); // nz+1 - 1 = nz
  return cx + cy * vnx + cz * vnx * vny;
}

/// Sample velocity at cell center by averaging face velocities
fn sampleVelocityAtCell(x: u32, y: u32, z: u32) -> vec3<f32> {
  // Average the two face velocities for each component
  let vx = (velocity[velIdx(x, y, z)].x + velocity[velIdx(x + 1u, y, z)].x) * 0.5;
  let vy = (velocity[velIdx(x, y, z)].y + velocity[velIdx(x, y + 1u, z)].y) * 0.5;
  let vz = (velocity[velIdx(x, y, z)].z + velocity[velIdx(x, y, z + 1u)].z) * 0.5;
  return vec3<f32>(vx, vy, vz);
}

// =============================================================================
// TRAPPED AIR POTENTIAL (Ita) - Vorticity/Curl magnitude
// =============================================================================
// Computes the curl of the velocity field: ω = ∇ × v
// High vorticity indicates turbulent regions where air gets trapped.
//
// Curl components:
//   ωx = ∂vz/∂y - ∂vy/∂z
//   ωy = ∂vx/∂z - ∂vz/∂x
//   ωz = ∂vy/∂x - ∂vx/∂y
// =============================================================================

@compute @workgroup_size(8, 4, 4)
fn computeTrappedAir(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= uniforms.nx || id.y >= uniforms.ny || id.z >= uniforms.nz) { return; }

  let si = scalarIdx(id.x, id.y, id.z);

  // Skip cells far from surface (optimization)
  let sdf = surfaceSDF[si];
  if (abs(sdf) > 3.0) {
    trappedAirPotential[si] = 0.0;
    return;
  }

  // Sample velocities at neighboring cells for curl computation
  // Use central differences where possible
  let x = id.x;
  let y = id.y;
  let z = id.z;

  // Get velocities at neighboring cells (clamped at boundaries)
  let v_xm = sampleVelocityAtCell(max(x, 1u) - 1u, y, z);
  let v_xp = sampleVelocityAtCell(min(x + 1u, uniforms.nx - 1u), y, z);
  let v_ym = sampleVelocityAtCell(x, max(y, 1u) - 1u, z);
  let v_yp = sampleVelocityAtCell(x, min(y + 1u, uniforms.ny - 1u), z);
  let v_zm = sampleVelocityAtCell(x, y, max(z, 1u) - 1u);
  let v_zp = sampleVelocityAtCell(x, y, min(z + 1u, uniforms.nz - 1u));

  // Compute curl using central differences (scale by 0.5 for proper derivative)
  // ωx = ∂vz/∂y - ∂vy/∂z
  let curl_x = (v_yp.z - v_ym.z) * 0.5 - (v_zp.y - v_zm.y) * 0.5;
  // ωy = ∂vx/∂z - ∂vz/∂x
  let curl_y = (v_zp.x - v_zm.x) * 0.5 - (v_xp.z - v_xm.z) * 0.5;
  // ωz = ∂vy/∂x - ∂vx/∂y
  let curl_z = (v_xp.y - v_xm.y) * 0.5 - (v_yp.x - v_ym.x) * 0.5;

  // Vorticity magnitude
  let vorticity = sqrt(curl_x * curl_x + curl_y * curl_y + curl_z * curl_z);

  trappedAirPotential[si] = vorticity;
}

// =============================================================================
// WAVE CREST POTENTIAL (Iwc) - Velocity dot Surface Normal
// =============================================================================
// Measures breaking waves where fluid moves outward from the surface.
// Iwc = max(0, v · n) where n = normalize(∇SDF)
//
// High values indicate:
// - Wave crests breaking
// - Splashing fluid
// - Spray emission regions
// =============================================================================

@compute @workgroup_size(8, 4, 4)
fn computeWaveCrest(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= uniforms.nx || id.y >= uniforms.ny || id.z >= uniforms.nz) { return; }

  let si = scalarIdx(id.x, id.y, id.z);

  // Only compute near the surface
  let sdf = surfaceSDF[si];
  if (abs(sdf) > 2.0) {
    waveCrestPotential[si] = 0.0;
    return;
  }

  let x = id.x;
  let y = id.y;
  let z = id.z;

  // Compute SDF gradient (surface normal direction)
  let sdf_xm = surfaceSDF[scalarIdx(max(x, 1u) - 1u, y, z)];
  let sdf_xp = surfaceSDF[scalarIdx(min(x + 1u, uniforms.nx - 1u), y, z)];
  let sdf_ym = surfaceSDF[scalarIdx(x, max(y, 1u) - 1u, z)];
  let sdf_yp = surfaceSDF[scalarIdx(x, min(y + 1u, uniforms.ny - 1u), z)];
  let sdf_zm = surfaceSDF[scalarIdx(x, y, max(z, 1u) - 1u)];
  let sdf_zp = surfaceSDF[scalarIdx(x, y, min(z + 1u, uniforms.nz - 1u))];

  var normal = vec3<f32>(
    (sdf_xp - sdf_xm) * 0.5,
    (sdf_yp - sdf_ym) * 0.5,
    (sdf_zp - sdf_zm) * 0.5
  );

  let normalLen = length(normal);
  if (normalLen < 0.01) {
    waveCrestPotential[si] = 0.0;
    return;
  }
  normal = normal / normalLen;

  // Sample velocity at cell center
  let vel = sampleVelocityAtCell(x, y, z);

  // Wave crest potential = max(0, v · n)
  // Positive when velocity points outward from fluid (breaking wave)
  let vDotN = dot(vel, normal);
  waveCrestPotential[si] = max(0.0, vDotN);
}

// =============================================================================
// KINETIC ENERGY POTENTIAL (Ike) - Velocity magnitude squared
// =============================================================================
// Simple energy measure used as multiplier for emission rates.
// Ike = |v|²
//
// High energy regions produce more whitewater overall.
// =============================================================================

@compute @workgroup_size(8, 4, 4)
fn computeKineticEnergy(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= uniforms.nx || id.y >= uniforms.ny || id.z >= uniforms.nz) { return; }

  let si = scalarIdx(id.x, id.y, id.z);

  // Only compute near the surface (whitewater only forms at/near surface)
  let sdf = surfaceSDF[si];
  if (abs(sdf) > 3.0) {
    kineticEnergyPotential[si] = 0.0;
    return;
  }

  // Sample velocity at cell center
  let vel = sampleVelocityAtCell(id.x, id.y, id.z);

  // Kinetic energy = |v|²
  kineticEnergyPotential[si] = dot(vel, vel);
}
