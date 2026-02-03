/**
 * ============================================================================
 * INTEGRATION & COLLISION SHADER
 * ============================================================================
 *
 * Pipeline Stage: Stage 8 (Final compute pass)
 * Entry Point: main
 * Workgroup Size: 256 threads
 *
 * Purpose:
 * --------
 * Updates particle positions based on velocity and handles boundary collisions.
 * This is the final step that commits all physics calculations to position.
 *
 * Time Integration:
 * -----------------
 * Uses simple Euler integration (also called Forward Euler):
 *
 *   position_new = position_old + velocity × dt
 *
 * While more sophisticated integrators exist (Verlet, RK4), Euler is sufficient
 * here because:
 *   1. SPH forces are already computed at predicted positions
 *   2. Timestep is small (typically 1/60 or 1/120 second)
 *   3. Pressure forces provide inherent stability
 *
 * Boundary Collision:
 * -------------------
 * The simulation domain is an axis-aligned box centered at origin.
 *
 *     ┌─────────────────────┐
 *     │                     │
 *     │    halfBounds.y     │
 *     │         ↑           │
 *     │         │           │
 *     │  ←──────┼──────→    │  halfBounds.x
 *     │         │           │
 *     │         ↓           │
 *     │                     │
 *     └─────────────────────┘
 *
 * Collision response:
 *   1. Check if particle is outside bounds: |pos| > halfBounds
 *   2. If outside, clamp position to boundary
 *   3. Reflect velocity component: vel = -vel × damping
 *
 * Collision Damping:
 *   - 1.0 = perfectly elastic (no energy loss)
 *   - 0.5 = moderate damping (half velocity on bounce)
 *   - 0.0 = perfectly inelastic (stops on contact)
 *
 * Typical values: 0.7 - 0.95 for realistic fluid behavior.
 *
 * Coordinate System:
 * ------------------
 *   +Y = Up
 *   +X = Right
 *   +Z = Forward (out of screen)
 *
 *   Box spans: [-halfBounds, +halfBounds] on each axis
 *
 * ============================================================================
 */

/**
 * Integration Parameters Uniform Buffer
 *
 * Memory Layout (16-byte aligned):
 * Offset  Size  Field
 * ------  ----  -----
 *   0      4    dt               - Timestep for position integration
 *   4      4    collisionDamping - Velocity multiplier on collision [0, 1]
 *   8      4    hasObstacle      - Flag for dynamic obstacle (unused currently)
 *  12      4    pad0             - Padding
 *  16     12    halfBounds       - Half-extents of simulation box (x, y, z)
 *  28      4    pad1             - Padding
 *  32     12    obstacleCenter   - Center of dynamic obstacle (reserved)
 *  44      4    pad2             - Padding
 *  48     12    obstacleHalf     - Half-extents of obstacle
 *  60      4    pad3             - Padding
 *  64     12    obstacleRotation - Rotation in degrees (XYZ)
 *  76      4    pad4             - Padding
 * ------
 * Total: 80 bytes
 *
 * Note: obstacleRotation is in degrees to match GUI controls.
 */
struct IntegrateParams {
  dt: f32,
  collisionDamping: f32,
  hasObstacle: f32,
  pad0: f32,
  halfBounds: vec3<f32>,
  pad1: f32,
  obstacleCenter: vec3<f32>,
  pad2: f32,
  obstacleHalf: vec3<f32>,
  pad3: f32,
  obstacleRotation: vec3<f32>,
  pad4: f32,
};

// ============================================================================
// BUFFER BINDINGS
// ============================================================================
// Group 0: Integration compute pass
//
//   Binding 0: positions[]  - Particle positions (read-write)
//              Updated with: pos_new = pos_old + vel × dt
//
//   Binding 1: velocities[] - Particle velocities (read-write)
//              Modified on collision: vel = -vel × damping
//
//   Binding 2: params       - Integration parameters
// ============================================================================

@group(0) @binding(0) var<storage, read_write> positions: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> velocities: array<vec4<f32>>;
@group(0) @binding(2) var<uniform> params: IntegrateParams;

// SDF Collision Bindings
@group(0) @binding(3) var sdfTexture: texture_3d<f32>;
// Sampler removed because textureLoad doesn't use it

struct SDFParams {
  minBounds: vec3<f32>,
  pad0: f32,
  maxBounds: vec3<f32>,
  pad1: f32,
  modelInv: mat4x4<f32>, // To transform World -> Model
  modelMatrix: mat4x4<f32>, // Model -> World (for normal rotation)
};

@group(0) @binding(5) var<uniform> sdfParams: SDFParams;

fn rotateX(v: vec3<f32>, angle: f32) -> vec3<f32> {
  let c = cos(angle);
  let s = sin(angle);
  return vec3<f32>(v.x, v.y * c - v.z * s, v.y * s + v.z * c);
}

fn rotateY(v: vec3<f32>, angle: f32) -> vec3<f32> {
  let c = cos(angle);
  let s = sin(angle);
  return vec3<f32>(v.x * c + v.z * s, v.y, -v.x * s + v.z * c);
}

fn rotateZ(v: vec3<f32>, angle: f32) -> vec3<f32> {
  let c = cos(angle);
  let s = sin(angle);
  return vec3<f32>(v.x * c - v.y * s, v.x * s + v.y * c, v.z);
}

fn toRadians(v: vec3<f32>) -> vec3<f32> {
  return v * (3.14159265 / 180.0);
}

fn rotateLocalToWorld(v: vec3<f32>, rot: vec3<f32>) -> vec3<f32> {
  var r = v;
  r = rotateX(r, rot.x);
  r = rotateY(r, rot.y);
  r = rotateZ(r, rot.z);
  return r;
}

fn rotateWorldToLocal(v: vec3<f32>, rot: vec3<f32>) -> vec3<f32> {
  var r = v;
  r = rotateZ(r, -rot.z);
  r = rotateY(r, -rot.y);
  r = rotateX(r, -rot.x);
  return r;
}

// Manual Trilinear Interpolation for unfilterable texture
fn sampleSDF(modelPos: vec3<f32>) -> f32 {
  let boundsSize = sdfParams.maxBounds - sdfParams.minBounds;
  let uvw = (modelPos - sdfParams.minBounds) / boundsSize;
  
  if (any(uvw < vec3<f32>(0.0)) || any(uvw > vec3<f32>(1.0))) {
    return 10.0; // Outside grid
  }

  let dims = vec3<f32>(textureDimensions(sdfTexture));
  let coord = uvw * dims - 0.5;
  let base = vec3<i32>(floor(coord));
  let f = fract(coord);

  // Clamp coordinates
  let c000 = max(vec3<i32>(0), base);
  let c111 = min(vec3<i32>(dims) - 1, base + 1);
  let c100 = vec3<i32>(c111.x, c000.y, c000.z);
  let c010 = vec3<i32>(c000.x, c111.y, c000.z);
  let c001 = vec3<i32>(c000.x, c000.y, c111.z);
  let c110 = vec3<i32>(c111.x, c111.y, c000.z);
  let c101 = vec3<i32>(c111.x, c000.y, c111.z);
  let c011 = vec3<i32>(c000.x, c111.y, c111.z);

  // Fetch 8 neighbors
  let v000 = textureLoad(sdfTexture, c000, 0).r;
  let v100 = textureLoad(sdfTexture, c100, 0).r;
  let v010 = textureLoad(sdfTexture, c010, 0).r;
  let v001 = textureLoad(sdfTexture, c001, 0).r;
  let v110 = textureLoad(sdfTexture, c110, 0).r;
  let v101 = textureLoad(sdfTexture, c101, 0).r;
  let v011 = textureLoad(sdfTexture, c011, 0).r;
  let v111 = textureLoad(sdfTexture, c111, 0).r;

  // Interpolate
  let i1 = mix(v000, v100, f.x);
  let i2 = mix(v010, v110, f.x);
  let i3 = mix(v001, v101, f.x);
  let i4 = mix(v011, v111, f.x);

  let j1 = mix(i1, i2, f.y);
  let j2 = mix(i3, i4, f.y);

  return mix(j1, j2, f.z);
}

// Compute normal from SDF gradient
fn computeSDFNormal(modelPos: vec3<f32>) -> vec3<f32> {
  // Epsilon should be comparable to voxel size for smooth normals.
  // Model is ~250 units, grid 64 -> voxel ~4 units.
  // Using eps = 1.0 gives reasonable smoothing.
  let eps = 1.0; 
  let dx = sampleSDF(modelPos + vec3<f32>(eps, 0.0, 0.0)) - sampleSDF(modelPos - vec3<f32>(eps, 0.0, 0.0));
  let dy = sampleSDF(modelPos + vec3<f32>(0.0, eps, 0.0)) - sampleSDF(modelPos - vec3<f32>(0.0, eps, 0.0));
  let dz = sampleSDF(modelPos + vec3<f32>(0.0, 0.0, eps)) - sampleSDF(modelPos - vec3<f32>(0.0, 0.0, eps));
  
  let v = vec3<f32>(dx, dy, dz);
  if (dot(v, v) < 0.000001) {
    return vec3<f32>(0.0, 1.0, 0.0);
  }
  return normalize(v);
}

/**
 * Main Integration Compute Kernel
 */
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let index = id.x;

  if (index >= arrayLength(&positions)) {
    return;
  }

  var pos = positions[index].xyz;
  var vel = velocities[index].xyz;

  // Time integration
  pos = pos + vel * params.dt;

  // ========================================================================
  // SDF MODEL COLLISION
  // ========================================================================
  
  // Transform world position to model space
  let localPos = (sdfParams.modelInv * vec4<f32>(pos, 1.0)).xyz;
  
  // Sample distance
  let dist = sampleSDF(localPos);
  
  // Convert World Space particle radius (approx 0.1) to Model Space
  // Model Scale is 0.04, so Model Units = World Units / 0.04
  let modelScale = 0.04;
  let particleRadiusWorld = 0.2; 
  let particleRadiusModel = particleRadiusWorld / modelScale; 
  
  if (dist < particleRadiusModel) {
    let localNormal = computeSDFNormal(localPos);
    // Transform normal to world space (using model matrix, not inverse transpose because uniform scaling assumed)
    let worldNormal = normalize((sdfParams.modelMatrix * vec4<f32>(localNormal, 0.0)).xyz);
    
    // Penetration depth in Model Space
    let penetrationModel = particleRadiusModel - dist;
    
    // Convert penetration to World Space
    // Clamp to max 0.5 world units to prevent explosions from deep penetration
    let penetrationWorld = min(penetrationModel * modelScale, 0.5);
    
    // Push out
    pos = pos + worldNormal * penetrationWorld;
    
    // Reflect velocity
    let vn = dot(vel, worldNormal);
    if (vn < 0.0) {
      vel = vel - (1.0 + params.collisionDamping) * vn * worldNormal;
    }
  }

  // ========================================================================
  // BOUNDARY COLLISION HANDLING
  // ========================================================================
  let halfBounds = params.halfBounds;

  // ---- X-AXIS COLLISION ----
  let edgeDstX = halfBounds.x - abs(pos.x);
  if (edgeDstX <= 0.0) {
    // Clamp to boundary (sign preserves direction: +halfBounds or -halfBounds)
    pos.x = halfBounds.x * sign(pos.x);
    // Reflect and damp velocity
    vel.x = -vel.x * params.collisionDamping;
  }

  // ---- Y-AXIS COLLISION ----
  let edgeDstY = halfBounds.y - abs(pos.y);
  if (edgeDstY <= 0.0) {
    pos.y = halfBounds.y * sign(pos.y);
    vel.y = -vel.y * params.collisionDamping;
  }

  // ---- Z-AXIS COLLISION ----
  let edgeDstZ = halfBounds.z - abs(pos.z);
  if (edgeDstZ <= 0.0) {
    pos.z = halfBounds.z * sign(pos.z);
    vel.z = -vel.z * params.collisionDamping;
  }

  // ========================================================================
  // WRITE BACK RESULTS
  // ========================================================================
  // Store updated position (w = 1.0 for homogeneous coordinates)
  // Store updated velocity (w = 0.0, velocity is a direction/rate)
  positions[index] = vec4<f32>(pos, 1.0);
  velocities[index] = vec4<f32>(vel, 0.0);
}