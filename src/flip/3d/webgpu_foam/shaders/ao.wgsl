// =============================================================================
// SCREEN-SPACE AMBIENT OCCLUSION (SSAO) PASS
// =============================================================================
//
// This pass computes soft shadows from nearby particles using an analytic
// sphere occlusion formula. Unlike traditional SSAO (which samples random
// directions), this leverages our knowledge of particle positions.
//
// ## Algorithm Overview
//
// 1. For each particle, render an enlarged sphere (3x particle radius)
// 2. For each pixel covered by this sphere:
//    a. Sample G-buffer to get shaded point position and normal
//    b. Compute analytic occlusion from this particle to that point
//    c. Accumulate via additive blending
//
// The result is a soft, physically-plausible ambient occlusion that accounts
// for all nearby occluders without expensive ray marching.
//
// ## Analytic Sphere Occlusion
//
// The occlusion from a sphere at distance d with radius r to a surface
// with normal n is computed analytically. This formula accounts for:
// - Distance falloff (1/d²)
// - Sphere solid angle (depends on r/d ratio)
// - Surface orientation (n·L term)
//
// ## Additive Blending
//
// Each particle's contribution is added to a single-channel (r16float) buffer.
// The composite pass reads this accumulated occlusion value.
//
// ## Performance
//
// Using lower-polygon spheres (1 subdivision = 80 faces) keeps vertex costs
// down since we don't need surface detail for the soft occlusion effect.

struct Uniforms {
  projectionMatrix: mat4x4<f32>,
  viewMatrix: mat4x4<f32>,
  resolution: vec2<f32>,
  // Camera FOV is used for view-ray reconstruction from screen UV.
  fov: f32,
  sphereRadius: f32,
  positionScale: f32,
  simOffsetX: f32,
  simOffsetY: f32,
  simOffsetZ: f32,
  _pad: vec3<f32>,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> positions: array<vec4<f32>>;
@group(0) @binding(2) var gBufferTex: texture_2d<f32>;
@group(0) @binding(3) var linearSamp: sampler;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) viewSpaceSpherePos: vec3<f32>,
  @location(1) sphereRadius: f32,
};

const PI: f32 = 3.14159265;

@vertex
fn vs_main(
  @location(0) vertexPos: vec3<f32>,
  @builtin(instance_index) instanceIndex: u32
) -> VertexOutput {
  let spherePos = positions[instanceIndex].xyz * uniforms.positionScale;
  let simOffset = vec3<f32>(uniforms.simOffsetX, uniforms.simOffsetY, uniforms.simOffsetZ);
  let worldSpherePos = spherePos + simOffset;
  let viewSpherPos = (uniforms.viewMatrix * vec4<f32>(worldSpherePos, 1.0)).xyz;

  // Render a larger proxy sphere so fragments near the particle can receive AO.
  let extrudedRadius = uniforms.sphereRadius * 3.0;
  let worldPos = vertexPos * extrudedRadius + worldSpherePos;

  var out: VertexOutput;
  out.position = uniforms.projectionMatrix * uniforms.viewMatrix * vec4<f32>(worldPos, 1.0);
  out.viewSpaceSpherePos = viewSpherPos;
  out.sphereRadius = uniforms.sphereRadius;
  return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) f32 {
  // Convert pixel coord to normalized UV for sampling G-buffer.
  let coords = in.position.xy / uniforms.resolution;
  let data = textureSample(gBufferTex, linearSamp, coords);

  // Background pixels don't receive particle occlusion.
  let viewSpaceZ = data.a;
  if (viewSpaceZ > -0.01) { return 0.0; }

  // Reconstruct unit normal from packed x/y.
  let nx = data.r;
  let ny = data.g;
  let nz = sqrt(max(0.0, 1.0 - nx * nx - ny * ny));
  let viewSpaceNormal = vec3<f32>(nx, ny, nz);

  // Reconstruct view-space position from depth and camera projection params.
  let tanHalfFov = tan(uniforms.fov / 2.0);
  let viewRay = vec3<f32>(
    (coords.x * 2.0 - 1.0) * tanHalfFov * uniforms.resolution.x / uniforms.resolution.y,
    (1.0 - 2.0 * coords.y) * tanHalfFov,
    -1.0
  );
  let viewSpacePos = viewRay * -viewSpaceZ;

  // Relative vector from shaded point to occluding sphere center.
  let di = in.viewSpaceSpherePos - viewSpacePos;
  let l = length(di);
  if (l < 0.001) { return 0.0; }

  let nl = dot(viewSpaceNormal, di / l);
  let h = l / in.sphereRadius;
  let h2 = h * h;
  let k2 = 1.0 - h2 * nl * nl;

  // Analytic sphere occlusion approximation used by the original reference.
  var result = max(0.0, nl) / h2;

  if (k2 > 0.0 && l > in.sphereRadius) {
    result = nl * acos(-nl * sqrt((h2 - 1.0) / (1.0 - nl * nl))) - sqrt(k2 * (h2 - 1.0));
    result = result / h2 + atan(sqrt(k2 / (h2 - 1.0)));
    result /= PI;
  }

  return result;
}
