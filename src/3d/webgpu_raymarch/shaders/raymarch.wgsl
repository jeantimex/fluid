struct RaymarchParams {
  viewPos: vec3<f32>,
  pad0: f32,
  cameraRight: vec3<f32>,
  pad1: f32,
  cameraUp: vec3<f32>,
  pad2: f32,
  cameraForward: vec3<f32>,
  pad3: f32,
  boundsSize: vec3<f32>,
  densityOffset: f32,
  densityMultiplier: f32,
  stepSize: f32,
  aspect: f32,
  fovY: f32,
  maxSteps: f32,
  pad4: vec2<f32>,
};

@group(0) @binding(0) var densityTex: texture_3d<f32>;
@group(0) @binding(1) var densitySampler: sampler;
@group(0) @binding(2) var<uniform> params: RaymarchParams;

struct VSOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VSOut {
  var positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(3.0, -1.0),
    vec2<f32>(-1.0, 3.0)
  );

  let pos = positions[vertexIndex];
  var out: VSOut;
  out.position = vec4<f32>(pos, 0.0, 1.0);
  out.uv = pos * 0.5 + vec2<f32>(0.5);
  return out;
}

fn rayBoxIntersection(origin: vec3<f32>, dir: vec3<f32>, boundsMin: vec3<f32>, boundsMax: vec3<f32>) -> vec2<f32> {
  let invDir = 1.0 / dir;
  let t0 = (boundsMin - origin) * invDir;
  let t1 = (boundsMax - origin) * invDir;
  let tmin = max(max(min(t0.x, t1.x), min(t0.y, t1.y)), min(t0.z, t1.z));
  let tmax = min(min(max(t0.x, t1.x), max(t0.y, t1.y)), max(t0.z, t1.z));
  return vec2<f32>(tmin, tmax);
}

fn sampleDensityRaw(pos: vec3<f32>) -> f32 {
  let uvw = (pos + 0.5 * params.boundsSize) / params.boundsSize;
  return textureSampleLevel(densityTex, densitySampler, uvw, 0.0).r - params.densityOffset;
}

fn densityGradient(pos: vec3<f32>, eps: f32) -> vec3<f32> {
  let dx = sampleDensityRaw(pos + vec3<f32>(eps, 0.0, 0.0)) - sampleDensityRaw(pos - vec3<f32>(eps, 0.0, 0.0));
  let dy = sampleDensityRaw(pos + vec3<f32>(0.0, eps, 0.0)) - sampleDensityRaw(pos - vec3<f32>(0.0, eps, 0.0));
  let dz = sampleDensityRaw(pos + vec3<f32>(0.0, 0.0, eps)) - sampleDensityRaw(pos - vec3<f32>(0.0, 0.0, eps));
  return vec3<f32>(dx, dy, dz);
}

fn skyColor(dir: vec3<f32>) -> vec3<f32> {
  let t = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
  let top = vec3<f32>(0.45, 0.65, 0.95);
  let bottom = vec3<f32>(0.1, 0.12, 0.16);
  return mix(bottom, top, t);
}

fn floorColor(pos: vec3<f32>) -> vec3<f32> {
  let scale = 0.6;
  let q = pos.xz * scale;
  let check = (i32(floor(q.x)) + i32(floor(q.y))) & 1;
  let c1 = vec3<f32>(0.28, 0.55, 0.85);
  let c2 = vec3<f32>(0.75, 0.65, 0.9);
  return select(c1, c2, check == 1);
}

fn environmentColor(origin: vec3<f32>, dir: vec3<f32>) -> vec3<f32> {
  let floorY = -0.5 * params.boundsSize.y;
  if (abs(dir.y) > 0.0001) {
    let t = (floorY - origin.y) / dir.y;
    if (t > 0.0) {
      let hitPos = origin + dir * t;
      return floorColor(hitPos);
    }
  }
  return skyColor(dir);
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  let ndc = in.uv * 2.0 - vec2<f32>(1.0);
  let tanFov = tan(0.5 * params.fovY);
  var rayDir = params.cameraForward + params.cameraRight * (ndc.x * params.aspect * tanFov) + params.cameraUp * (ndc.y * tanFov);
  rayDir = normalize(rayDir);

  let boundsMin = -0.5 * params.boundsSize;
  let boundsMax = 0.5 * params.boundsSize;
  let hit = rayBoxIntersection(params.viewPos, rayDir, boundsMin, boundsMax);

  if (hit.y <= max(hit.x, 0.0)) {
    let env = environmentColor(params.viewPos, rayDir);
    return vec4<f32>(env, 1.0);
  }

  let tStart = max(hit.x, 0.0);
  let tEnd = hit.y;
  let maxSteps = u32(params.maxSteps + 0.5);

  var opticalDepth = 0.0;
  var hitPos = vec3<f32>(0.0);
  var hitFound = false;
  var t = tStart;

  for (var i = 0u; i < maxSteps; i = i + 1u) {
    if (t > tEnd) {
      break;
    }

    let pos = params.viewPos + rayDir * t;
    let sample = sampleDensityRaw(pos);
    if (!hitFound && sample > 0.0002) {
      hitFound = true;
      hitPos = pos;
    }
    let density = max(0.0, sample - 0.0002) * params.densityMultiplier;
    opticalDepth = opticalDepth + density * params.stepSize;

    t = t + params.stepSize;
  }

  if (!hitFound) {
    let bg = environmentColor(params.viewPos, rayDir);
    return vec4<f32>(bg, 1.0);
  }

  opticalDepth = max(opticalDepth, 0.01);
  let alpha = 1.0 - exp(-opticalDepth * 6.0);
  let fluidColor = vec3<f32>(0.35, 0.75, 1.0);
  let bgColor = environmentColor(params.viewPos, rayDir);
  var color = mix(bgColor, fluidColor, clamp(alpha, 0.0, 1.0));
  color = min(color + vec3<f32>(0.2), vec3<f32>(1.0));

  if (hitFound) {
    let grad = densityGradient(hitPos, params.stepSize);
    if (dot(grad, grad) > 0.0) {
      let normal = normalize(grad);
      let fresnel = pow(1.0 - clamp(dot(-rayDir, normal), 0.0, 1.0), 5.0);
      let refl = environmentColor(hitPos, reflect(rayDir, normal));
      color = mix(color, refl, 0.35 * fresnel + 0.1);
    }
  }

  return vec4<f32>(color, 1.0);
}
