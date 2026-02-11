import{G as L}from"./lil-gui.esm-DA0aiWCL.js";function q(t,n,s,a){const l=1/Math.tan(t/2),f=1/(s-a),r=new Float32Array(16);return r[0]=l/n,r[5]=l,r[10]=(a+s)*f,r[11]=-1,r[14]=2*a*s*f,r}function I(t,n,s){const a=F(U(t,n)),l=F(R(s,a)),f=R(a,l),r=new Float32Array(16);return r[0]=l.x,r[1]=f.x,r[2]=a.x,r[3]=0,r[4]=l.y,r[5]=f.y,r[6]=a.y,r[7]=0,r[8]=l.z,r[9]=f.z,r[10]=a.z,r[11]=0,r[12]=-H(l,t),r[13]=-H(f,t),r[14]=-H(a,t),r[15]=1,r}function A(t,n){const s=new Float32Array(16);for(let a=0;a<4;a++)for(let l=0;l<4;l++){let f=0;for(let r=0;r<4;r++)f+=t[r*4+a]*n[l*4+r];s[l*4+a]=f}return s}function U(t,n){return{x:t.x-n.x,y:t.y-n.y,z:t.z-n.z}}function F(t){const n=Math.sqrt(t.x*t.x+t.y*t.y+t.z*t.z);return{x:t.x/n,y:t.y/n,z:t.z/n}}function R(t,n){return{x:t.y*n.z-t.z*n.y,y:t.z*n.x-t.x*n.z,z:t.x*n.y-t.y*n.x}}function H(t,n){return t.x*n.x+t.y*n.y+t.z*n.z}function D(t,n){return{x:t.x+n.x,y:t.y+n.y,z:t.z+n.z}}function O(t){const n=new Float32Array(16),s=t[0],a=t[1],l=t[2],f=t[3],r=t[4],o=t[5],e=t[6],v=t[7],h=t[8],g=t[9],B=t[10],u=t[11],C=t[12],w=t[13],x=t[14],b=t[15],k=s*o-a*r,z=s*e-l*r,P=s*v-f*r,y=a*e-l*o,S=a*v-f*o,M=l*v-f*e,T=h*w-g*C,V=h*x-B*C,i=h*b-u*C,p=g*x-B*w,m=g*b-u*w,G=B*b-u*x;let d=k*G-z*m+P*p+y*i-S*V+M*T;return d&&(d=1/d,n[0]=(o*G-e*m+v*p)*d,n[1]=(l*m-a*G-f*p)*d,n[2]=(w*M-x*S+b*y)*d,n[3]=(B*S-g*M-u*y)*d,n[4]=(e*i-r*G-v*V)*d,n[5]=(s*G-l*i+f*V)*d,n[6]=(x*P-C*M-b*z)*d,n[7]=(h*M-B*P+u*z)*d,n[8]=(r*m-o*i+v*T)*d,n[9]=(a*i-s*m-f*T)*d,n[10]=(C*S-w*P+b*k)*d,n[11]=(g*P-h*S-u*k)*d,n[12]=(o*V-r*p-e*T)*d,n[13]=(s*p-a*V+l*T)*d,n[14]=(w*z-C*y-x*k)*d,n[15]=(h*y-g*z+B*k)*d),n}class _{radius=5;theta=0;phi=Math.PI/2;target={x:0,y:0,z:0};minRadius=2;maxRadius=100;rotate(n,s){this.theta+=n,this.phi+=s;const a=.001;this.phi=Math.max(a,Math.min(Math.PI-a,this.phi))}zoom(n){this.radius+=n,this.radius=Math.max(this.minRadius,Math.min(this.maxRadius,this.radius))}get viewMatrix(){const n=this.radius*Math.sin(this.phi)*Math.sin(this.theta),s=this.radius*Math.cos(this.phi),a=this.radius*Math.sin(this.phi)*Math.cos(this.theta),l=D(this.target,{x:n,y:s,z:a});return I(l,this.target,{x:0,y:1,z:0})}get position(){const n=this.radius*Math.sin(this.phi)*Math.sin(this.theta),s=this.radius*Math.cos(this.phi),a=this.radius*Math.sin(this.phi)*Math.cos(this.theta);return D(this.target,{x:n,y:s,z:a})}}const Y=`// Scene shader for rendering background and checkered floor
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
`;class Z{device;context;format;canvas;pipeline;uniformBuffer;bindGroup;config;constructor(n,s,a,l,f){this.device=n,this.context=s,this.canvas=a,this.format=l,this.config=f,this.createPipeline(),this.createBuffers()}createPipeline(){const n=this.device.createShaderModule({code:Y}),s=this.device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,buffer:{type:"uniform"}}]}),a=this.device.createPipelineLayout({bindGroupLayouts:[s]});this.pipeline=this.device.createRenderPipeline({layout:a,vertex:{module:n,entryPoint:"vs_fullscreen"},fragment:{module:n,entryPoint:"fs_main",targets:[{format:this.format}]},primitive:{topology:"triangle-list"}})}createBuffers(){this.uniformBuffer=this.device.createBuffer({size:256,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.bindGroup=this.device.createBindGroup({layout:this.pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.uniformBuffer}}]})}render(n,s){const a=this.canvas.width/this.canvas.height,l=q(Math.PI/3,a,.15,500),f=A(l,n),r=O(f),o=new Float32Array(64);let e=0;o.set(r,e),e+=16,o[e++]=s.x,o[e++]=s.y,o[e++]=s.z,o[e++]=0,o[e++]=this.config.tileCol1.r,o[e++]=this.config.tileCol1.g,o[e++]=this.config.tileCol1.b,o[e++]=0,o[e++]=this.config.tileCol2.r,o[e++]=this.config.tileCol2.g,o[e++]=this.config.tileCol2.b,o[e++]=0,o[e++]=this.config.tileCol3.r,o[e++]=this.config.tileCol3.g,o[e++]=this.config.tileCol3.b,o[e++]=0,o[e++]=this.config.tileCol4.r,o[e++]=this.config.tileCol4.g,o[e++]=this.config.tileCol4.b,o[e++]=0,o[e++]=this.config.floorY,o[e++]=this.config.tileScale,o[e++]=this.config.tileDarkFactor,o[e++]=this.config.floorSize,o[e++]=this.config.dirToSun.x,o[e++]=this.config.dirToSun.y,o[e++]=this.config.dirToSun.z,o[e++]=0,o[e++]=this.config.skyColorHorizon.r,o[e++]=this.config.skyColorHorizon.g,o[e++]=this.config.skyColorHorizon.b,o[e++]=this.config.sunPower,o[e++]=this.config.skyColorZenith.r,o[e++]=this.config.skyColorZenith.g,o[e++]=this.config.skyColorZenith.b,o[e++]=this.config.sunBrightness,o[e++]=this.config.skyColorGround.r,o[e++]=this.config.skyColorGround.g,o[e++]=this.config.skyColorGround.b,o[e++]=this.config.floorAmbient,o[e++]=this.config.tileColVariation.x,o[e++]=this.config.tileColVariation.y,o[e++]=this.config.tileColVariation.z,o[e++]=0,o[e++]=this.config.globalBrightness??1,o[e++]=this.config.globalSaturation??1,o[e++]=0,o[e++]=0,this.device.queue.writeBuffer(this.uniformBuffer,0,o);const v=this.device.createCommandEncoder(),h=this.context.getCurrentTexture().createView(),g=v.beginRenderPass({colorAttachments:[{view:h,clearValue:{r:0,g:0,b:0,a:1},loadOp:"clear",storeOp:"store"}]});g.setPipeline(this.pipeline),g.setBindGroup(0,this.bindGroup),g.draw(3),g.end(),this.device.queue.submit([v.finish()])}}const c={tileCol1:{r:.5647059,g:.4683025,b:.25490198},tileCol2:{r:.424268,g:.27100393,b:.6603774},tileCol3:{r:.14057493,g:.3679245,b:.16709903},tileCol4:{r:.07164471,g:.19658183,b:.4339623},floorY:-5,tileScale:.87,tileDarkFactor:.2,floorSize:80,tileColVariation:{x:.2,y:0,z:.73},dirToSun:{x:-.83,y:.42,z:-.36},skyColorHorizon:{r:1,g:1,b:1},skyColorZenith:{r:.08,g:.37,b:.73},skyColorGround:{r:.55,g:.5,b:.55},sunPower:500,sunBrightness:1,floorAmbient:.58};async function E(){const t=document.querySelector("#app");if(!t)throw new Error("Missing #app container");t.innerHTML='<canvas id="sim-canvas" aria-label="Basic scene"></canvas>';const n=document.querySelector("#sim-canvas");if(!n)throw new Error("Failed to create canvas");if(!navigator.gpu){t.innerHTML="<p>WebGPU is not supported in this browser.</p>";return}const s=await navigator.gpu.requestAdapter();if(!s){t.innerHTML="<p>Failed to get WebGPU adapter.</p>";return}const a=await s.requestDevice(),l=n.getContext("webgpu");if(!l){t.innerHTML="<p>Failed to get WebGPU context.</p>";return}const f=navigator.gpu.getPreferredCanvasFormat();l.configure({device:a,format:f,alphaMode:"premultiplied"});const r=window.devicePixelRatio||1;n.width=window.innerWidth*r,n.height=window.innerHeight*r;const o=new Z(a,l,n,f,c),e=new L({title:"Scene Settings"}),v=e.addFolder("Global"),h={brightness:1,saturation:1};v.add(h,"brightness",.1,4,.1).name("Brightness"),v.add(h,"saturation",0,2,.1).name("Saturation");const g=i=>{const p=m=>Math.round(Math.min(1,Math.max(0,m))*255).toString(16).padStart(2,"0");return"#"+p(i.r)+p(i.g)+p(i.b)},B=i=>Math.pow(i,1/2.2),u=i=>Math.round(Math.min(1,Math.max(0,B(i)))*255).toString(16).padStart(2,"0"),C={tile1:"#"+u(c.tileCol1.r)+u(c.tileCol1.g)+u(c.tileCol1.b),tile2:"#"+u(c.tileCol2.r)+u(c.tileCol2.g)+u(c.tileCol2.b),tile3:"#"+u(c.tileCol3.r)+u(c.tileCol3.g)+u(c.tileCol3.b),tile4:"#"+u(c.tileCol4.r)+u(c.tileCol4.g)+u(c.tileCol4.b)},w=i=>Math.pow(i,2.2),x=i=>{const p=w(parseInt(i.slice(1,3),16)/255),m=w(parseInt(i.slice(3,5),16)/255),G=w(parseInt(i.slice(5,7),16)/255);return{r:p,g:m,b:G}},b=e.addFolder("Tile Colors");b.addColor(C,"tile1").name("Tile 1 (Yellow)").onChange(i=>{c.tileCol1=x(i)}),b.addColor(C,"tile2").name("Tile 2 (Pink)").onChange(i=>{c.tileCol2=x(i)}),b.addColor(C,"tile3").name("Tile 3 (Green)").onChange(i=>{c.tileCol3=x(i)}),b.addColor(C,"tile4").name("Tile 4 (Blue)").onChange(i=>{c.tileCol4=x(i)});const k={horizon:g(c.skyColorHorizon),zenith:g(c.skyColorZenith),ground:g(c.skyColorGround)},z=i=>{const p=parseInt(i.slice(1,3),16)/255,m=parseInt(i.slice(3,5),16)/255,G=parseInt(i.slice(5,7),16)/255;return{r:p,g:m,b:G}},P=e.addFolder("Sky");P.addColor(k,"horizon").name("Horizon").onChange(i=>{c.skyColorHorizon=z(i)}),P.addColor(k,"zenith").name("Zenith").onChange(i=>{c.skyColorZenith=z(i)}),P.addColor(k,"ground").name("Ground").onChange(i=>{c.skyColorGround=z(i)}),c.globalBrightness=h.brightness,c.globalSaturation=h.saturation,v.onChange(()=>{c.globalBrightness=h.brightness,c.globalSaturation=h.saturation});const y=new _;y.target={x:0,y:-2,z:0},y.radius=28,y.theta=-Math.PI*.23,y.phi=Math.PI*.41;let S=!1,M=0,T=0;n.addEventListener("pointerdown",i=>{i.cancelable&&i.preventDefault(),S=!0,M=i.clientX,T=i.clientY}),n.addEventListener("pointermove",i=>{if(i.cancelable&&i.preventDefault(),!S)return;const p=i.clientX-M,m=i.clientY-T;M=i.clientX,T=i.clientY,y.rotate(p*.005,m*.005)}),n.addEventListener("pointerup",()=>{S=!1}),n.addEventListener("pointerleave",()=>{S=!1}),n.addEventListener("wheel",i=>{i.preventDefault(),y.zoom(i.deltaY*.05)}),window.addEventListener("resize",()=>{const i=window.devicePixelRatio||1;n.width=window.innerWidth*i,n.height=window.innerHeight*i,l.configure({device:a,format:f,alphaMode:"premultiplied"})});function V(){o.render(y.viewMatrix,y.position),requestAnimationFrame(V)}requestAnimationFrame(V)}E();
