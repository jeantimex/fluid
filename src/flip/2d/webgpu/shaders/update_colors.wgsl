/**
 * Particle Color Update Compute Shader
 *
 * Updates particle colors based on local density.
 * Particles in low-density regions (spray) get brighter colors.
 * This is an embarrassingly parallel operation - one thread per particle.
 */

struct SimParams {
  // Floats
  h: f32,
  fInvSpacing: f32,
  particleRadius: f32,
  pInvSpacing: f32,
  gravity: f32,
  dt: f32,
  flipRatio: f32,
  overRelaxation: f32,
  particleRestDensity: f32,
  domainWidth: f32,
  domainHeight: f32,
  _pad0: f32,

  // Ints
  fNumX: i32,
  fNumY: i32,
  fNumCells: i32,
  numParticles: i32,
  maxParticles: i32,
  pNumX: i32,
  pNumY: i32,
  pNumCells: i32,
};

@group(0) @binding(0) var<storage, read> positions: array<vec2<f32>>;
@group(0) @binding(1) var<storage, read_write> colors: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> density: array<f32>;
@group(0) @binding(3) var<uniform> params: SimParams;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;

  // Bounds check
  if (i >= u32(params.numParticles)) {
    return;
  }

  // Gradually shift colors toward blue
  let s = 0.01;
  var color = colors[i];
  color.r = clamp(color.r - s, 0.0, 1.0);
  color.g = clamp(color.g - s, 0.0, 1.0);
  color.b = clamp(color.b + s, 0.0, 1.0);

  // Get particle position
  let pos = positions[i];

  // Compute grid cell indices
  let xi = clamp(i32(floor(pos.x * params.fInvSpacing)), 1, params.fNumX - 1);
  let yi = clamp(i32(floor(pos.y * params.fInvSpacing)), 1, params.fNumY - 1);
  let cellNr = xi * params.fNumY + yi;

  // Check density and brighten spray particles
  let d0 = params.particleRestDensity;
  if (d0 > 0.0) {
    let relDensity = density[cellNr] / d0;
    if (relDensity < 0.7) {
      // Spray particle - make it bright
      let brightness = 0.8;
      color.r = brightness;
      color.g = brightness;
      color.b = 1.0;
    }
  }

  colors[i] = color;
}
