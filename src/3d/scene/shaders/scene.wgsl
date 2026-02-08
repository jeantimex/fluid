// Scene shader for rendering background and checkered floor
// Ported from Unity Fluid-Sim scene setup
// Based on environment.wgsl implementation

struct Uniforms {
    invViewProj: mat4x4<f32>,
    cameraPos: vec3<f32>,
    _pad0: f32,
    // Tile colors
    tileCol1: vec3<f32>,  // -X, +Z quadrant (Blue)
    _pad1: f32,
    tileCol2: vec3<f32>,  // +X, +Z quadrant (Pink/Purple)
    _pad2: f32,
    tileCol3: vec3<f32>,  // -X, -Z quadrant (Green)
    _pad3: f32,
    tileCol4: vec3<f32>,  // +X, -Z quadrant (Yellow/Tan)
    _pad4: f32,
    // Floor parameters
    floorY: f32,
    tileScale: f32,
    tileDarkFactor: f32,  // Multiplicative factor for dark tiles (e.g., 0.8)
    floorSize: f32,
    // Lighting
    dirToSun: vec3<f32>,
    _pad5: f32,
    // Sky colors
    skyColorHorizon: vec3<f32>,
    sunPower: f32,
    skyColorZenith: vec3<f32>,
    sunBrightness: f32,
    skyColorGround: vec3<f32>,
    floorAmbient: f32,
    // Tile color variation (HSV)
    tileColVariation: vec3<f32>,
    _pad7: f32,
    // Global adjustments
    globalBrightness: f32,
    globalSaturation: f32,
    _pad8: f32,
    _pad9: f32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
};

// Fullscreen triangle vertex shader
@vertex
fn vs_fullscreen(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
    var out: VertexOutput;
    let x = f32((vertexIndex << 1u) & 2u);
    let y = f32(vertexIndex & 2u);
    out.position = vec4<f32>(x * 2.0 - 1.0, y * 2.0 - 1.0, 0.0, 1.0);
    out.uv = vec2<f32>(x, 1.0 - y);
    return out;
}

// Convert RGB to HSV (fixed select condition to match GLSL original)
fn rgbToHsv(rgb: vec3<f32>) -> vec3<f32> {
    let K = vec4<f32>(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    let p = select(vec4<f32>(rgb.gb, K.xy), vec4<f32>(rgb.bg, K.wz), rgb.g < rgb.b);
    // Fixed: swapped arguments to match GLSL mix(a,b,step(p.x,r)) behavior
    let q = select(vec4<f32>(rgb.r, p.yzx), vec4<f32>(p.xyw, rgb.r), rgb.r < p.x);
    let d = q.x - min(q.w, q.y);
    let e = 1.0e-10;
    return vec3<f32>(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

// Convert HSV to RGB
fn hsvToRgb(hsv: vec3<f32>) -> vec3<f32> {
    let K = vec4<f32>(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    let p = abs(fract(hsv.xxx + K.xyz) * 6.0 - K.www);
    return hsv.z * mix(K.xxx, clamp(p - K.xxx, vec3<f32>(0.0), vec3<f32>(1.0)), hsv.y);
}

// Tweak HSV: add shift to HSV channels
fn tweakHsv(colRGB: vec3<f32>, shift: vec3<f32>) -> vec3<f32> {
    let hsv = rgbToHsv(colRGB);
    return clamp(hsvToRgb(hsv + shift), vec3<f32>(0.0), vec3<f32>(1.0));
}

// Hash function for pseudo-random
fn hashInt2(v: vec2<i32>) -> u32 {
    return u32(v.x) * 5023u + u32(v.y) * 96456u;
}

// Random value from state
fn randomValue(state: ptr<function, u32>) -> f32 {
    *state = *state * 747796405u + 2891336453u;
    let word = ((*state >> ((*state >> 28u) + 4u)) ^ *state) * 277803737u;
    let res = (word >> 22u) ^ word;
    return f32(res) / 4294967295.0;
}

// Random signed normalized 3D vector
fn randomSNorm3(state: ptr<function, u32>) -> vec3<f32> {
    return vec3<f32>(
        randomValue(state) * 2.0 - 1.0,
        randomValue(state) * 2.0 - 1.0,
        randomValue(state) * 2.0 - 1.0
    );
}

// Modulo that handles negatives properly
fn modulo(x: f32, y: f32) -> f32 {
    return x - y * floor(x / y);
}

// Linear to sRGB gamma correction
fn linearToSrgb(color: vec3<f32>) -> vec3<f32> {
    return pow(color, vec3<f32>(1.0 / 2.2));
}

// Ray-plane intersection
fn rayPlaneIntersect(rayOrigin: vec3<f32>, rayDir: vec3<f32>, planeY: f32) -> f32 {
    if (abs(rayDir.y) < 0.0001) {
        return -1.0;
    }
    let t = (planeY - rayOrigin.y) / rayDir.y;
    return select(-1.0, t, t > 0.0);
}

// Sky color
fn getSkyColor(dir: vec3<f32>) -> vec3<f32> {
    // Sun disc
    let sun = pow(max(0.0, dot(dir, uniforms.dirToSun)), uniforms.sunPower);

    // Sky gradient
    let skyGradientT = pow(smoothstep(0.0, 0.4, dir.y), 0.35);
    let groundToSkyT = smoothstep(-0.01, 0.0, dir.y);
    let skyGradient = mix(uniforms.skyColorHorizon, uniforms.skyColorZenith, skyGradientT);

    var res = mix(uniforms.skyColorGround, skyGradient, groundToSkyT);
    if (dir.y >= -0.01) {
        res = res + sun * uniforms.sunBrightness;
    }
    return res;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    // Convert UV to NDC
    let ndc = vec2<f32>(in.uv.x * 2.0 - 1.0, (1.0 - in.uv.y) * 2.0 - 1.0);

    // Reconstruct world space ray
    let nearPoint = uniforms.invViewProj * vec4<f32>(ndc.x, ndc.y, 0.0, 1.0);
    let farPoint = uniforms.invViewProj * vec4<f32>(ndc.x, ndc.y, 1.0, 1.0);

    let nearWorld = nearPoint.xyz / nearPoint.w;
    let farWorld = farPoint.xyz / farPoint.w;

    let rayOrigin = uniforms.cameraPos;
    let rayDir = normalize(farWorld - nearWorld);

    // Check floor intersection
    let t = rayPlaneIntersect(rayOrigin, rayDir, uniforms.floorY);

    if (t > 0.0) {
        let hitPos = rayOrigin + rayDir * t;

        // Check if within floor bounds
        let halfSize = uniforms.floorSize * 0.5;
        if (abs(hitPos.x) < halfSize && abs(hitPos.z) < halfSize) {
            // Rotate tile coordinates by 270 degrees
            let rotatedPos = vec2<f32>(-hitPos.z, hitPos.x);

            // Select base color based on quadrant (matching Unity's logic)
            var tileCol: vec3<f32>;
            if (rotatedPos.x < 0.0) {
                tileCol = uniforms.tileCol1;
            } else {
                tileCol = uniforms.tileCol2;
            }
            if (rotatedPos.y < 0.0) {
                if (rotatedPos.x < 0.0) {
                    tileCol = uniforms.tileCol3;
                } else {
                    tileCol = uniforms.tileCol4;
                }
            }

            // Apply gamma correction (linear to sRGB)
            tileCol = linearToSrgb(tileCol);

            // Calculate tile coordinates
            let tileCoord = floor(rotatedPos * uniforms.tileScale);

            // Apply HSV variation per tile FIRST (multiply by 0.1 like Unity)
            if (any(uniforms.tileColVariation != vec3<f32>(0.0))) {
                var rngState = hashInt2(vec2<i32>(i32(tileCoord.x), i32(tileCoord.y)));
                let randomVariation = randomSNorm3(&rngState) * uniforms.tileColVariation * 0.1;
                tileCol = tweakHsv(tileCol, randomVariation);
            }

            // Checkerboard pattern - Unity: TweakHSV(tileCol, float3(0, 0, tileDarkOffset * isDarkTile))
            // tileDarkOffset=0.2 means "dark tile" positions get V+0.2 (brighter)
            // The OTHER tiles (isDarkTile=false) are the actually darker ones
            let isDarkTile = modulo(tileCoord.x, 2.0) == modulo(tileCoord.y, 2.0);
            if (isDarkTile) {
                tileCol = tweakHsv(tileCol, vec3<f32>(0.0, 0.0, uniforms.tileDarkFactor));
            }

            // Apply color adjustments (controlled by GUI)
            var finalColor = tileCol;

            // 1. Brightness boost
            finalColor = finalColor * uniforms.globalBrightness;

            // 2. Saturation adjustment (< 1 = desaturate, > 1 = boost saturation)
            let gray = dot(finalColor, vec3<f32>(0.299, 0.587, 0.114));
            finalColor = vec3<f32>(gray) + (finalColor - vec3<f32>(gray)) * uniforms.globalSaturation;

            return vec4<f32>(finalColor, 1.0);
        }
    }

    // Sky color
    return vec4<f32>(getSkyColor(rayDir), 1.0);
}
