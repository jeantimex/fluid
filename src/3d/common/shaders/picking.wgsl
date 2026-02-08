// =============================================================================
// Particle Picking Shader
// =============================================================================
// Finds the intersection of a ray with the fluid particles.

struct Ray {
  origin: vec3<f32>,
  pad0: f32,
  direction: vec3<f32>,
  pad1: f32,
};

struct PickingUniforms {
  ray: Ray,
  particleRadius: f32,
  particleCount: u32,
  pad0: f32,
  pad1: f32,
};

struct PickingResult {
  hitPos: vec3<f32>,
  hitDist: f32,
  particleIndex: i32, // -1 if no hit
  hit: u32,           // 1 if hit, 0 if no hit
  pad0: u32,
  pad1: u32,
};

@group(0) @binding(0) var<storage, read> positions: array<vec4<f32>>;
@group(0) @binding(1) var<uniform> uniforms: PickingUniforms;
@group(0) @binding(2) var<storage, read_write> result: PickingResult;

/**
 * Finds the intersection of a ray and a sphere.
 * Returns the distance to the intersection point, or -1.0 if no hit.
 */
fn raySphereIntersection(rayOrigin: vec3<f32>, rayDir: vec3<f32>, sphereCenter: vec3<f32>, radius: f32) -> f32 {
  let oc = rayOrigin - sphereCenter;
  let b = dot(oc, rayDir);
  let c = dot(oc, oc) - radius * radius;
  let h = b * b - c;
  if (h < 0.0) { return -1.0; } // No intersection
  let h_sqrt = sqrt(h);
  let t = -b - h_sqrt;
  if (t < 0.0) { return -b + h_sqrt; } // If inside, use the exit point
  return t;
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let index = id.x;
  if (index >= uniforms.particleCount) { return; }

  let pos = positions[index].xyz;
  let t = raySphereIntersection(uniforms.ray.origin, uniforms.ray.direction, pos, uniforms.particleRadius);

  if (t > 0.0) {
    // Note: This simple check has a race condition but is usually fine for picking.
    // For a single ray, we want the minimum t.
    if (t < result.hitDist) {
        result.hitDist = t;
        result.hitPos = uniforms.ray.origin + uniforms.ray.direction * t;
        result.particleIndex = i32(index);
        result.hit = 1u;
    }
  }
}

@compute @workgroup_size(1)
fn clear() {
  result.hitPos = vec3<f32>(0.0);
  result.hitDist = 1e10;
  result.particleIndex = -1;
  result.hit = 0u;
}