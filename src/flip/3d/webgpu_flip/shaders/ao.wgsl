// Ambient Occlusion Pass Shader
// Computes screen-space ambient occlusion from particle spheres

struct Uniforms {
    projectionMatrix: mat4x4<f32>,
    viewMatrix: mat4x4<f32>,
    resolution: vec2<f32>,
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

    // Extrude sphere 3x for AO range (reduced for performance)
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
    let coords = in.position.xy / uniforms.resolution;
    let data = textureSample(gBufferTex, linearSamp, coords);

    let viewSpaceZ = data.a;
    if (viewSpaceZ > -0.01) { return 0.0; }

    // Reconstruct view space position
    let nx = data.r;
    let ny = data.g;
    let nz = sqrt(max(0.0, 1.0 - nx * nx - ny * ny));
    let viewSpaceNormal = vec3<f32>(nx, ny, nz);

    let tanHalfFov = tan(uniforms.fov / 2.0);
    let viewRay = vec3<f32>(
        (coords.x * 2.0 - 1.0) * tanHalfFov * uniforms.resolution.x / uniforms.resolution.y,
        (1.0 - 2.0 * coords.y) * tanHalfFov,
        -1.0
    );
    let viewSpacePos = viewRay * -viewSpaceZ;

    // Calculate occlusion from this sphere
    let di = in.viewSpaceSpherePos - viewSpacePos;
    let l = length(di);
    if (l < 0.001) { return 0.0; }

    let nl = dot(viewSpaceNormal, di / l);
    let h = l / in.sphereRadius;
    let h2 = h * h;
    let k2 = 1.0 - h2 * nl * nl;

    var result = max(0.0, nl) / h2;

    if (k2 > 0.0 && l > in.sphereRadius) {
        result = nl * acos(-nl * sqrt((h2 - 1.0) / (1.0 - nl * nl))) - sqrt(k2 * (h2 - 1.0));
        result = result / h2 + atan(sqrt(k2 / (h2 - 1.0)));
        result /= PI;
    }

    return result;
}
