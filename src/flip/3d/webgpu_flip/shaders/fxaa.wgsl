// FXAA Anti-Aliasing Pass Shader
// Fast Approximate Anti-Aliasing implementation

struct Uniforms {
    resolution: vec2<f32>,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var linearSamp: sampler;

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
};

const FXAA_SPAN_MAX: f32 = 8.0;
const FXAA_REDUCE_MUL: f32 = 1.0 / 8.0;
const FXAA_REDUCE_MIN: f32 = 1.0 / 128.0;

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
    var pos = array<vec2<f32>, 4>(
        vec2<f32>(-1.0, -1.0),
        vec2<f32>(1.0, -1.0),
        vec2<f32>(-1.0, 1.0),
        vec2<f32>(1.0, 1.0)
    );
    var out: VertexOutput;
    out.position = vec4<f32>(pos[vertexIndex], 0.0, 1.0);
    out.uv = vec2<f32>(pos[vertexIndex].x * 0.5 + 0.5, 0.5 - pos[vertexIndex].y * 0.5);
    return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    let delta = 1.0 / uniforms.resolution;

    let rgbNW = textureSample(inputTex, linearSamp, in.uv + vec2<f32>(-1.0, -1.0) * delta).rgb;
    let rgbNE = textureSample(inputTex, linearSamp, in.uv + vec2<f32>(1.0, -1.0) * delta).rgb;
    let rgbSW = textureSample(inputTex, linearSamp, in.uv + vec2<f32>(-1.0, 1.0) * delta).rgb;
    let rgbSE = textureSample(inputTex, linearSamp, in.uv + vec2<f32>(1.0, 1.0) * delta).rgb;
    let rgbM = textureSample(inputTex, linearSamp, in.uv).rgb;

    let luma = vec3<f32>(0.299, 0.587, 0.114);
    let lumaNW = dot(rgbNW, luma);
    let lumaNE = dot(rgbNE, luma);
    let lumaSW = dot(rgbSW, luma);
    let lumaSE = dot(rgbSE, luma);
    let lumaM = dot(rgbM, luma);

    let lumaMin = min(lumaM, min(min(lumaNW, lumaNE), min(lumaSW, lumaSE)));
    let lumaMax = max(lumaM, max(max(lumaNW, lumaNE), max(lumaSW, lumaSE)));

    var dir = vec2<f32>(
        -((lumaNW + lumaNE) - (lumaSW + lumaSE)),
        ((lumaNW + lumaSW) - (lumaNE + lumaSE))
    );

    let dirReduce = max((lumaNW + lumaNE + lumaSW + lumaSE) * (0.25 * FXAA_REDUCE_MUL), FXAA_REDUCE_MIN);
    let rcpDirMin = 1.0 / (min(abs(dir.x), abs(dir.y)) + dirReduce);
    dir = min(vec2<f32>(FXAA_SPAN_MAX), max(vec2<f32>(-FXAA_SPAN_MAX), dir * rcpDirMin)) * delta;

    let rgbA = 0.5 * (
        textureSample(inputTex, linearSamp, in.uv + dir * (1.0 / 3.0 - 0.5)).rgb +
        textureSample(inputTex, linearSamp, in.uv + dir * (2.0 / 3.0 - 0.5)).rgb
    );
    let rgbB = rgbA * 0.5 + 0.25 * (
        textureSample(inputTex, linearSamp, in.uv + dir * -0.5).rgb +
        textureSample(inputTex, linearSamp, in.uv + dir * 0.5).rgb
    );
    let lumaB = dot(rgbB, luma);

    if (lumaB < lumaMin || lumaB > lumaMax) {
        return vec4<f32>(rgbA, 1.0);
    } else {
        return vec4<f32>(rgbB, 1.0);
    }
}
