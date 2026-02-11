import{p as G,k as z,w as F,f as C,o as R,g as V,j as O,e as S,m as A,q as M,F as _,S as L,P as N,l as E,n as P}from"./picking_system-B9OfnGpZ.js";import{e as k}from"./environment-ODazOT3W.js";const I=`/**
 * ============================================================================
 * FOAM SPAWN COMPUTE SHADER (MATCHING UNITY)
 * ============================================================================
 *
 * Entry Point: main
 * Workgroup Size: 256 threads
 *
 * Purpose:
 * --------
 * Spawns foam/spray particles using Unity's "Trapped Air" model.
 * 
 * Logic:
 * 1. Calculate 'weightedVelocityDifference' by searching neighbors.
 * 2. Calculate 'kineticEnergy' (speed squared).
 * 3. Spawn probability = trappedAirFactor * kineticEnergyFactor * dt.
 *
 * ============================================================================
 */

// Beginner note: foam particles are stored in a ring buffer using an atomic counter.

@group(0) @binding(0) var<storage, read> fluidPositions: array<vec4<f32>>; // Predicted
@group(0) @binding(1) var<storage, read> fluidVelocities: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> foamPositions: array<vec4<f32>>;
@group(0) @binding(4) var<storage, read_write> foamVelocities: array<vec4<f32>>;
@group(0) @binding(5) var<storage, read_write> foamCounter: atomic<u32>;
@group(0) @binding(6) var<uniform> params: FoamSpawnParams;
@group(0) @binding(7) var<storage, read> sortOffsets: array<u32>;

struct FoamSpawnParams {
  dt: f32,
  airRate: f32,
  airMin: f32,
  airMax: f32,
  kinMin: f32,
  kinMax: f32,
  maxFoam: u32,
  frameCount: u32,
  particleCount: u32,
  radius: f32,
  lifeMin: f32,
  lifeMax: f32,
  minBounds: vec3<f32>,
  pad1: f32,
  gridRes: vec3<f32>,
  bubbleScale: f32,
};

fn pcgHash(input: u32) -> u32 {
  var state = input * 747796405u + 2891336453u;
  var word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}

fn randomFloat(seed: u32) -> f32 {
  return f32(pcgHash(seed)) / 4294967295.0;
}

fn remap01(val: f32, minVal: f32, maxVal: f32) -> f32 {
  return saturate((val - minVal) / (maxVal - minVal));
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let index = id.x;
  if (index >= params.particleCount) { return; }

  let pos = fluidPositions[index].xyz;
  let vel = fluidVelocities[index].xyz;
  
  // ========================================================================
  // NEIGHBOR SEARCH (TRAPPED AIR CALCULATION)
  // ========================================================================
  var weightedVelocityDifference = 0.0;
  let radiusSq = params.radius * params.radius;

  let gridRes = vec3<i32>(i32(params.gridRes.x), i32(params.gridRes.y), i32(params.gridRes.z));
  let localPos = pos - params.minBounds;
  let cellX = i32(floor(localPos.x / params.radius));
  let cellY = i32(floor(localPos.y / params.radius));
  let cellZ = i32(floor(localPos.z / params.radius));

  for (var z = -1; z <= 1; z++) {
    for (var y = -1; y <= 1; y++) {
      for (var x = -1; x <= 1; x++) {
        let cx = cellX + x;
        let cy = cellY + y;
        let cz = cellZ + z;

        if (cx >= 0 && cx < gridRes.x && cy >= 0 && cy < gridRes.y && cz >= 0 && cz < gridRes.z) {
           let key = u32(cx) + u32(gridRes.x) * (u32(cy) + u32(gridRes.y) * u32(cz));
           let start = sortOffsets[key];
           let end = sortOffsets[key + 1u];

           for (var j = start; j < end; j++) {
             if (j == index) { continue; }
             
             let fPos = fluidPositions[j].xyz;
             let offset = fPos - pos;
             let dstSq = dot(offset, offset);

             if (dstSq < radiusSq) {
               let dst = sqrt(dstSq);
               let dirToNeighbour = offset / dst;
               
               let relativeVelocity = vel - fluidVelocities[j].xyz;
               let relVelMag = length(relativeVelocity);
               let relVelDir = relativeVelocity / max(0.000001, relVelMag);
               
               // Unity: 1 - dot(relVelDir, -dirToNeighbour)
               let convergeWeight = 1.0 - dot(relVelDir, -dirToNeighbour);
               let influence = 1.0 - saturate(dst / params.radius);
               
               weightedVelocityDifference += relVelMag * convergeWeight * influence;
             }
           }
        }
      }
    }
  }

  // ========================================================================
  // SPAWN CALCULATION
  // ========================================================================
  let trappedAirFactor = params.airRate * remap01(weightedVelocityDifference, params.airMin, params.airMax);
  let kineticEnergyFactor = remap01(dot(vel, vel), params.kinMin, params.kinMax);
  let particleSpawnFactor = trappedAirFactor * kineticEnergyFactor * params.dt;

  let particleSpawnCount = i32(floor(particleSpawnFactor));
  let fractionalSpawnRemainder = particleSpawnFactor - f32(particleSpawnCount);

  let baseSeed = index * 1000u + params.frameCount;
  var actualSpawnCount = particleSpawnCount;
  if (randomFloat(baseSeed) < fractionalSpawnRemainder) {
    actualSpawnCount += 1;
  }

  if (actualSpawnCount <= 0) { return; }

  // Clamp spawn count to avoid massive bursts
  let count = min(actualSpawnCount, 10); 

  for (var i = 0; i < count; i++) {
    let slot = atomicAdd(&foamCounter, 1u) % params.maxFoam;
    
    let s = baseSeed + u32(i) * 7u;
    let r1 = randomFloat(s + 1u);
    let r2 = randomFloat(s + 2u);
    let r3 = randomFloat(s + 3u);
    
    // Unity uses a cylinder spawner based on velocity, let's approximate
    let spawnPos = pos + vel * params.dt * randomFloat(s + 4u);
    let foamVel = vel + vec3<f32>(randomFloat(s+5u)-0.5, randomFloat(s+6u), randomFloat(s+7u)-0.5) * 2.0;
    
    let lifetime = mix(params.lifeMin, params.lifeMax, randomFloat(s + 8u));
    let scale = (params.bubbleScale + 1.0) / 2.0;

    foamPositions[slot] = vec4<f32>(spawnPos, lifetime);
    foamVelocities[slot] = vec4<f32>(foamVel, scale);
  }
}
`,q=`/**
 * ============================================================================
 * FOAM UPDATE COMPUTE SHADER (WITH FLUID ADVECTION)
 * ============================================================================
 *
 * Entry Point: main
 * Workgroup Size: 256 threads
 *
 * Purpose:
 * --------
 * Updates foam particle physics with classification:
 * 1. Foam: Advected by fluid velocity (stays on surface)
 * 2. Bubble: Buoyancy pushes it up + fluid advection
 * 3. Spray: Ballistic (gravity + drag)
 *
 * Uses neighbor search (Linear Grid) to determine particle type and
 * local fluid velocity.
 * ============================================================================
 */

// Beginner note: this pass advances foam particles and classifies them
// as foam/bubble/spray based on local neighbor counts.

struct FoamUpdateParams {
  dt: f32,
  gravity: f32,
  dragCoeff: f32,
  buoyancy: f32,
  maxBounds: vec3<f32>,
  radius: f32,
  minBounds: vec3<f32>,
  pad0: f32,
  gridRes: vec3<f32>,
  pad1: f32,
  minBubble: u32,
  maxSpray: u32,
  bubbleScale: f32,
  scaleChangeSpeed: f32,
};

@group(0) @binding(0) var<storage, read_write> foamPositions: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> foamVelocities: array<vec4<f32>>;
@group(0) @binding(2) var<uniform> params: FoamUpdateParams;
@group(0) @binding(3) var<storage, read> fluidPositions: array<vec4<f32>>; // Predicted
@group(0) @binding(4) var<storage, read> fluidVelocities: array<vec4<f32>>;
@group(0) @binding(5) var<storage, read> sortOffsets: array<u32>;

/** Poly6 kernel: W(r,h) = (h²-r²)³ × scale. Using unscaled for weighting. */
fn poly6Weight(dst: f32, radius: f32) -> f32 {
  if (dst < radius) {
    let v = radius * radius - dst * dst;
    return v * v * v;
  }
  return 0.0;
}

fn getGridIndex(pos: vec3<f32>) -> u32 {
    let gridRes = vec3<u32>(u32(params.gridRes.x), u32(params.gridRes.y), u32(params.gridRes.z));
    let localPos = pos - params.minBounds;
    let cellX = u32(clamp(floor(localPos.x / params.radius), 0.0, f32(gridRes.x - 1u)));
    let cellY = u32(clamp(floor(localPos.y / params.radius), 0.0, f32(gridRes.y - 1u)));
    let cellZ = u32(clamp(floor(localPos.z / params.radius), 0.0, f32(gridRes.z - 1u)));
    return cellX + gridRes.x * (cellY + gridRes.y * cellZ);
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let index = id.x;
  if (index >= arrayLength(&foamPositions)) { return; }

  var posData = foamPositions[index];
  var velData = foamVelocities[index];
  var lifetime = posData.w;

  if (lifetime <= 0.0) { return; }

  // Decrement lifetime (dissolve)
  lifetime -= params.dt;

  var pos = posData.xyz;
  var vel = velData.xyz;
  let scale = velData.w;

  // ========================================================================
  // NEIGHBOR SEARCH (FLUID COUPLING)
  // ========================================================================
  var velocitySum = vec3<f32>(0.0);
  var weightSum = 0.0;
  var neighbourCount = 0u;

  let radiusSq = params.radius * params.radius;
  
  // Grid lookup
  let gridRes = vec3<i32>(i32(params.gridRes.x), i32(params.gridRes.y), i32(params.gridRes.z));
  let localPos = pos - params.minBounds;
  let cellX = i32(floor(localPos.x / params.radius));
  let cellY = i32(floor(localPos.y / params.radius));
  let cellZ = i32(floor(localPos.z / params.radius));

  // 3x3x3 Search
  for (var z = -1; z <= 1; z++) {
    for (var y = -1; y <= 1; y++) {
      for (var x = -1; x <= 1; x++) {
        let cx = cellX + x;
        let cy = cellY + y;
        let cz = cellZ + z;

        if (cx >= 0 && cx < gridRes.x && cy >= 0 && cy < gridRes.y && cz >= 0 && cz < gridRes.z) {
           let key = u32(cx) + u32(gridRes.x) * (u32(cy) + u32(gridRes.y) * u32(cz));
           let start = sortOffsets[key];
           let end = sortOffsets[key + 1u];

           for (var j = start; j < end; j++) {
             let fPos = fluidPositions[j].xyz;
             let offset = fPos - pos;
             let dstSq = dot(offset, offset);

             if (dstSq < radiusSq) {
               let dst = sqrt(dstSq);
               let weight = poly6Weight(dst, params.radius);
               
               velocitySum += fluidVelocities[j].xyz * weight;
               weightSum += weight;
               neighbourCount++;
             }
           }
        }
      }
    }
  }

  // ========================================================================
  // CLASSIFICATION & UPDATE
  // ========================================================================
  let isSpray = neighbourCount <= params.maxSpray;
  let isBubble = neighbourCount >= params.minBubble;
  let isFoam = !isSpray && !isBubble;

  if (isFoam) {
    // Foam: Advected by fluid
    if (weightSum > 0.0001) {
      vel = velocitySum / weightSum;
    }
  } else if (isBubble) {
    // Bubble: Buoyancy + Advection
    // Accelerate bubble to match fluid velocity
    if (weightSum > 0.0001) {
      let fluidVel = velocitySum / weightSum;
      let accelFluid = (fluidVel - vel) * 3.0; // Coupling strength
      let accelBuoyancy = vec3<f32>(0.0, -params.gravity * params.buoyancy, 0.0); // Upward
      vel += (accelFluid + accelBuoyancy) * params.dt;
    }
  } else {
    // Spray: Gravity + Drag
    vel.y += params.gravity * params.dt;
    vel *= (1.0 - params.dragCoeff * params.dt);
  }

  // Scale interpolation: bubbles shrink toward bubbleScale, foam/spray expand toward 1.0
  let targetScale = select(1.0, params.bubbleScale, isBubble);
  let newScale = mix(scale, targetScale, params.dt * params.scaleChangeSpeed);

  // Integrate
  pos += vel * params.dt;

  // Boundary
  let damping = 0.5;
  let minB = params.minBounds;
  let maxB = params.maxBounds;
  if (pos.x < minB.x) { pos.x = minB.x; vel.x *= -damping; }
  if (pos.x > maxB.x) { pos.x = maxB.x; vel.x *= -damping; }
  if (pos.y < minB.y) { pos.y = minB.y; vel.y *= -damping; }
  if (pos.y > maxB.y) { pos.y = maxB.y; vel.y *= -damping; }
  if (pos.z < minB.z) { pos.z = minB.z; vel.z *= -damping; }
  if (pos.z > maxB.z) { pos.z = maxB.z; vel.z *= -damping; }

  foamPositions[index] = vec4<f32>(pos, lifetime);
  foamVelocities[index] = vec4<f32>(vel, newScale);
}
`,H=`/**
 * ============================================================================
 * FOAM CLEAR COUNTER COMPUTE SHADER
 * ============================================================================
 *
 * Entry Point: main
 * Workgroup Size: 1 thread
 *
 * Purpose:
 * --------
 * Resets the foam spawn counter to zero at the start of each frame,
 * before the foam spawn pass runs.
 *
 * ============================================================================
 */

@group(0) @binding(0) var<storage, read_write> foamCounter: atomic<u32>;

@compute @workgroup_size(1)
fn main() {
  atomicStore(&foamCounter, 0u);
}
`;class j{device;foamClearCounter;foamSpawn;foamUpdate;foamClearCounterBindGroup;foamSpawnBindGroup;foamUpdateBindGroup;constructor(e){this.device=e,this.foamClearCounter=this.createPipeline(H,"main"),this.foamSpawn=this.createPipeline(I,"main"),this.foamUpdate=this.createPipeline(q,"main")}createPipeline(e,t){return this.device.createComputePipeline({layout:"auto",compute:{module:this.device.createShaderModule({code:e}),entryPoint:t}})}createBindGroups(e,t){if(!e.foamPositions||!e.foamVelocities||!e.foamCounter)throw new Error("FoamPipeline requires FluidBuffers created with includeFoam.");this.foamClearCounterBindGroup=this.device.createBindGroup({layout:this.foamClearCounter.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:e.foamCounter}}]}),this.foamSpawnBindGroup=this.device.createBindGroup({layout:this.foamSpawn.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:e.predicted}},{binding:1,resource:{buffer:e.velocities}},{binding:3,resource:{buffer:e.foamPositions}},{binding:4,resource:{buffer:e.foamVelocities}},{binding:5,resource:{buffer:e.foamCounter}},{binding:6,resource:{buffer:t.spawn}},{binding:7,resource:{buffer:e.sortOffsets}}]}),this.foamUpdateBindGroup=this.device.createBindGroup({layout:this.foamUpdate.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:e.foamPositions}},{binding:1,resource:{buffer:e.foamVelocities}},{binding:2,resource:{buffer:t.update}},{binding:3,resource:{buffer:e.predicted}},{binding:4,resource:{buffer:e.velocities}},{binding:5,resource:{buffer:e.sortOffsets}}]})}dispatch(e,t,i,n=!1){if(n){const u=e.beginComputePass();u.setPipeline(this.foamClearCounter),u.setBindGroup(0,this.foamClearCounterBindGroup),u.dispatchWorkgroups(1),u.end()}const a=e.beginComputePass();a.setPipeline(this.foamSpawn),a.setBindGroup(0,this.foamSpawnBindGroup),a.dispatchWorkgroups(Math.ceil(t/256)),a.end();const r=e.beginComputePass();r.setPipeline(this.foamUpdate),r.setBindGroup(0,this.foamUpdateBindGroup),r.dispatchWorkgroups(Math.ceil(i/256)),r.end()}}const W=`/**
 * Depth Pass Shader (screen-space fluids)
 *
 * Beginner note: renders particle depth into a depth texture using billboards.
 */

struct Uniforms {
  viewProjection: mat4x4<f32>,
  canvasSize: vec2<f32>,
  particleRadius: f32,
  _pad: f32,
  nearFar: vec2<f32>,
};

@group(0) @binding(0) var<storage, read> positions: array<vec4<f32>>;
@group(0) @binding(1) var<uniform> uniforms: Uniforms;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) depth: f32,
};

@vertex
fn vs_main(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32
) -> VertexOutput {
  let pos = positions[instanceIndex].xyz;

  var quadPos = vec2<f32>(0.0, 0.0);
  switch (vertexIndex) {
    case 0u: { quadPos = vec2<f32>(-1.0, -1.0); }
    case 1u: { quadPos = vec2<f32>( 1.0, -1.0); }
    case 2u: { quadPos = vec2<f32>(-1.0,  1.0); }
    case 3u: { quadPos = vec2<f32>(-1.0,  1.0); }
    case 4u: { quadPos = vec2<f32>( 1.0, -1.0); }
    case 5u: { quadPos = vec2<f32>( 1.0,  1.0); }
    default: { quadPos = vec2<f32>(0.0, 0.0); }
  }

  let clipPos = uniforms.viewProjection * vec4<f32>(pos, 1.0);
  let radiusNdc = vec2<f32>(
    uniforms.particleRadius / uniforms.canvasSize.x * 2.0,
    uniforms.particleRadius / uniforms.canvasSize.y * 2.0
  );
  let offset = quadPos * radiusNdc * clipPos.w;

  var out: VertexOutput;
  out.position = clipPos + vec4<f32>(offset, 0.0, 0.0);
  out.uv = quadPos;
  out.depth = clipPos.z / clipPos.w;
  return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) f32 {
  let d = length(in.uv);
  if (d > 1.0) {
    discard;
  }
  return clamp(in.depth, 0.0, 1.0);
}
`;class Y{device;pipeline;uniformBuffer;bindGroupLayout;bindGroup=null;constructor(e){this.device=e,this.uniformBuffer=e.createBuffer({size:96,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.bindGroupLayout=e.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.VERTEX,buffer:{type:"read-only-storage"}},{binding:1,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{type:"uniform"}}]});const t=e.createShaderModule({code:W});this.pipeline=e.createRenderPipeline({layout:e.createPipelineLayout({bindGroupLayouts:[this.bindGroupLayout]}),vertex:{module:t,entryPoint:"vs_main"},fragment:{module:t,entryPoint:"fs_main",targets:[{format:"r16float"}]},primitive:{topology:"triangle-list",cullMode:"none"},depthStencil:{format:"depth24plus",depthWriteEnabled:!0,depthCompare:"less"}})}resize(e,t){}createBindGroup(e){this.bindGroup=this.device.createBindGroup({layout:this.bindGroupLayout,entries:[{binding:0,resource:{buffer:e.buffers.positions}},{binding:1,resource:{buffer:this.uniformBuffer}}]})}encode(e,t,i){if(!t.depthTexture||!this.bindGroup)return;const n=new Float32Array(24);if(n.set(i.viewProjection),n[16]=i.canvasWidth,n[17]=i.canvasHeight,n[18]=i.particleRadius,n[19]=0,n[20]=i.near,n[21]=i.far,this.device.queue.writeBuffer(this.uniformBuffer,0,n),!t.smoothTextureA)return;const a=e.beginRenderPass({colorAttachments:[{view:t.smoothTextureA.createView(),clearValue:{r:0,g:0,b:0,a:1},loadOp:"clear",storeOp:"store"}],depthStencilAttachment:{view:t.depthTexture.createView(),depthClearValue:1,depthLoadOp:"clear",depthStoreOp:"store"}});a.setPipeline(this.pipeline),a.setBindGroup(0,this.bindGroup),a.draw(6,t.buffers.particleCount),a.end()}}const X=`/**
 * Foam Render Shader
 *
 * Beginner note: draws foam particles as soft billboards into a foam texture.
 */

struct Uniforms {
  viewProjection: mat4x4<f32>,
  canvasSize: vec2<f32>,
  particleRadius: f32,
  pad0: f32,
};

@group(0) @binding(0) var<storage, read> foamPositions: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read> foamVelocities: array<vec4<f32>>;
@group(0) @binding(2) var<uniform> uniforms: Uniforms;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) intensity: f32,
};

@vertex
fn vs_main(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32
) -> VertexOutput {
  let posData = foamPositions[instanceIndex];
  let velData = foamVelocities[instanceIndex];

  let pos = posData.xyz;
  let lifetime = posData.w;
  let scale = velData.w;

  var out: VertexOutput;

  // Dead particles produce degenerate triangles (behind far plane)
  if (lifetime <= 0.0) {
    out.position = vec4<f32>(0.0, 0.0, 2.0, 1.0);
    out.uv = vec2<f32>(0.0, 0.0);
    out.intensity = 0.0;
    return out;
  }

  var quadPos = vec2<f32>(0.0, 0.0);
  switch (vertexIndex) {
    case 0u: { quadPos = vec2<f32>(-1.0, -1.0); }
    case 1u: { quadPos = vec2<f32>( 1.0, -1.0); }
    case 2u: { quadPos = vec2<f32>(-1.0,  1.0); }
    case 3u: { quadPos = vec2<f32>(-1.0,  1.0); }
    case 4u: { quadPos = vec2<f32>( 1.0, -1.0); }
    case 5u: { quadPos = vec2<f32>( 1.0,  1.0); }
    default: { quadPos = vec2<f32>(0.0, 0.0); }
  }

  // Fade out over last 2 seconds of lifetime
  let dissolveScale = saturate(lifetime / 2.0);

  let clipPos = uniforms.viewProjection * vec4<f32>(pos, 1.0);
  let billboardSize = uniforms.particleRadius * scale * dissolveScale;
  let radiusNdc = vec2<f32>(
    billboardSize / uniforms.canvasSize.x * 2.0,
    billboardSize / uniforms.canvasSize.y * 2.0
  );
  let offset = quadPos * radiusNdc * clipPos.w;

  out.position = clipPos + vec4<f32>(offset, 0.0, 0.0);
  out.uv = quadPos;
  out.intensity = dissolveScale;
  return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) f32 {
  let d = length(in.uv);
  if (d > 1.0) {
    discard;
  }
  return in.intensity * (1.0 - d);
}
`;class Z{device;pipeline;bindGroupLayout;bindGroup=null;uniformBuffer;maxFoamParticles=0;constructor(e){this.device=e,this.uniformBuffer=e.createBuffer({size:80,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.bindGroupLayout=e.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.VERTEX,buffer:{type:"read-only-storage"}},{binding:1,visibility:GPUShaderStage.VERTEX,buffer:{type:"read-only-storage"}},{binding:2,visibility:GPUShaderStage.VERTEX,buffer:{type:"uniform"}}]});const t=e.createShaderModule({code:X});this.pipeline=e.createRenderPipeline({layout:e.createPipelineLayout({bindGroupLayouts:[this.bindGroupLayout]}),vertex:{module:t,entryPoint:"vs_main"},fragment:{module:t,entryPoint:"fs_main",targets:[{format:"r16float",blend:{color:{srcFactor:"one",dstFactor:"one"},alpha:{srcFactor:"one",dstFactor:"one"}}}]},primitive:{topology:"triangle-list",cullMode:"none"},depthStencil:{format:"depth24plus",depthWriteEnabled:!1,depthCompare:"less-equal"}})}createBindGroup(e,t,i){this.maxFoamParticles=i,this.bindGroup=this.device.createBindGroup({layout:this.bindGroupLayout,entries:[{binding:0,resource:{buffer:e}},{binding:1,resource:{buffer:t}},{binding:2,resource:{buffer:this.uniformBuffer}}]})}encode(e,t,i,n){if(!this.bindGroup||this.maxFoamParticles===0)return;const a=new Float32Array(20);a.set(i.viewProjection),a[16]=i.canvasWidth,a[17]=i.canvasHeight,a[18]=i.foamParticleRadius,a[19]=0,this.device.queue.writeBuffer(this.uniformBuffer,0,a);const r=e.beginRenderPass({colorAttachments:[{view:n.createView(),clearValue:{r:0,g:0,b:0,a:0},loadOp:"clear",storeOp:"store"}],depthStencilAttachment:t.depthTexture?{view:t.depthTexture.createView(),depthLoadOp:"load",depthStoreOp:"store"}:void 0});r.setPipeline(this.pipeline),r.setBindGroup(0,this.bindGroup),r.draw(6,this.maxFoamParticles),r.end()}}const K=`/**
 * Thickness Pass Shader
 *
 * Beginner note: accumulates particle thickness into a screen-space texture.
 */

struct Uniforms {
  viewProjection: mat4x4<f32>,
  canvasSize: vec2<f32>,
  particleRadius: f32,
  _pad: f32,
};

@group(0) @binding(0) var<storage, read> positions: array<vec4<f32>>;
@group(0) @binding(1) var<uniform> uniforms: Uniforms;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32
) -> VertexOutput {
  let pos = positions[instanceIndex].xyz;

  var quadPos = vec2<f32>(0.0, 0.0);
  switch (vertexIndex) {
    case 0u: { quadPos = vec2<f32>(-1.0, -1.0); }
    case 1u: { quadPos = vec2<f32>( 1.0, -1.0); }
    case 2u: { quadPos = vec2<f32>(-1.0,  1.0); }
    case 3u: { quadPos = vec2<f32>(-1.0,  1.0); }
    case 4u: { quadPos = vec2<f32>( 1.0, -1.0); }
    case 5u: { quadPos = vec2<f32>( 1.0,  1.0); }
    default: { quadPos = vec2<f32>(0.0, 0.0); }
  }

  let clipPos = uniforms.viewProjection * vec4<f32>(pos, 1.0);
  let radiusNdc = vec2<f32>(
    uniforms.particleRadius / uniforms.canvasSize.x * 2.0,
    uniforms.particleRadius / uniforms.canvasSize.y * 2.0
  );
  let offset = quadPos * radiusNdc * clipPos.w;

  var out: VertexOutput;
  out.position = clipPos + vec4<f32>(offset, 0.0, 0.0);
  out.uv = quadPos;
  return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) f32 {
  let d = length(in.uv);
  if (d > 1.0) {
    discard;
  }
  // Simple circular thickness contribution.
  let thickness = 1.0 - d;
  return thickness;
}
`;class J{device;pipeline;uniformBuffer;bindGroupLayout;bindGroup=null;constructor(e){this.device=e,this.uniformBuffer=e.createBuffer({size:80,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.bindGroupLayout=e.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.VERTEX,buffer:{type:"read-only-storage"}},{binding:1,visibility:GPUShaderStage.VERTEX,buffer:{type:"uniform"}}]});const t=e.createShaderModule({code:K});this.pipeline=e.createRenderPipeline({layout:e.createPipelineLayout({bindGroupLayouts:[this.bindGroupLayout]}),vertex:{module:t,entryPoint:"vs_main"},fragment:{module:t,entryPoint:"fs_main",targets:[{format:"r16float",blend:{color:{srcFactor:"one",dstFactor:"one"},alpha:{srcFactor:"one",dstFactor:"one"}}}]},primitive:{topology:"triangle-list",cullMode:"none"},depthStencil:{format:"depth24plus",depthWriteEnabled:!1,depthCompare:"less-equal"}})}resize(e,t){}createBindGroup(e){this.bindGroup=this.device.createBindGroup({layout:this.bindGroupLayout,entries:[{binding:0,resource:{buffer:e.buffers.positions}},{binding:1,resource:{buffer:this.uniformBuffer}}]})}encode(e,t,i){if(!t.thicknessTexture||!t.depthTexture||!this.bindGroup)return;const n=new Float32Array(20);n.set(i.viewProjection),n[16]=i.canvasWidth,n[17]=i.canvasHeight,n[18]=i.particleRadius,n[19]=0,this.device.queue.writeBuffer(this.uniformBuffer,0,n);const a=e.beginRenderPass({colorAttachments:[{view:t.thicknessTexture.createView(),clearValue:{r:0,g:0,b:0,a:0},loadOp:"clear",storeOp:"store"}],depthStencilAttachment:{view:t.depthTexture.createView(),depthLoadOp:"load",depthStoreOp:"store"}});a.setPipeline(this.pipeline),a.setBindGroup(0,this.bindGroup),a.draw(6,t.buffers.particleCount),a.end()}}const Q=`/**
 * Normal Pass Shader
 *
 * Beginner note: reconstructs surface normals from depth/thickness textures.
 */

struct FullscreenOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> FullscreenOut {
  var pos = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>( 1.0,  1.0)
  );

  var out: FullscreenOut;
  let p = pos[vertexIndex];
  out.position = vec4<f32>(p, 0.0, 1.0);
  out.uv = vec2<f32>(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5);
  return out;
}

@group(0) @binding(0) var depthTex: texture_2d<f32>;
@group(0) @binding(1) var depthSampler: sampler;

@fragment
fn fs_main(in: FullscreenOut) -> @location(0) vec4<f32> {
  let dims = textureDimensions(depthTex);
  let texel = 1.0 / vec2<f32>(dims);

  let dC = textureSample(depthTex, depthSampler, in.uv).r;
  let dR = textureSample(depthTex, depthSampler, in.uv + vec2<f32>(texel.x, 0.0)).r;
  let dU = textureSample(depthTex, depthSampler, in.uv + vec2<f32>(0.0, texel.y)).r;

  let strength = 200.0;
  let dzdx = (dR - dC) * strength;
  let dzdy = (dU - dC) * strength;

  let n = normalize(vec3<f32>(-dzdx, -dzdy, 1.0));
  return vec4<f32>(n * 0.5 + 0.5, 1.0);
}
`;class ${device;pipeline;bindGroupLayout;bindGroup=null;sampler;constructor(e){this.device=e,this.sampler=e.createSampler({magFilter:"linear",minFilter:"linear"}),this.bindGroupLayout=e.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:"float"}},{binding:1,visibility:GPUShaderStage.FRAGMENT,sampler:{}}]});const t=e.createShaderModule({code:Q});this.pipeline=e.createRenderPipeline({layout:e.createPipelineLayout({bindGroupLayouts:[this.bindGroupLayout]}),vertex:{module:t,entryPoint:"vs_main"},fragment:{module:t,entryPoint:"fs_main",targets:[{format:"rgba16float"}]},primitive:{topology:"triangle-list"}})}resize(e,t){this.bindGroup=null}createBindGroup(e){if(!e.smoothTextureA){this.bindGroup=null;return}this.bindGroup=this.device.createBindGroup({layout:this.bindGroupLayout,entries:[{binding:0,resource:e.smoothTextureA.createView()},{binding:1,resource:this.sampler}]})}encode(e,t,i){if(!t.normalTexture||(this.bindGroup||this.createBindGroup(t),!this.bindGroup))return;const n=e.beginRenderPass({colorAttachments:[{view:t.normalTexture.createView(),clearValue:{r:.5,g:.5,b:1,a:1},loadOp:"clear",storeOp:"store"}]});n.setPipeline(this.pipeline),n.setBindGroup(0,this.bindGroup),n.draw(6,1),n.end()}}const ee=`/**
 * Smooth Pass Shader (screen-space blur)
 *
 * Beginner note: applies a depth-aware blur to reduce particle noise.
 */

struct FullscreenOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> FullscreenOut {
  var pos = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>( 1.0,  1.0)
  );

  var out: FullscreenOut;
  let p = pos[vertexIndex];
  out.position = vec4<f32>(p, 0.0, 1.0);
  out.uv = vec2<f32>(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5);
  return out;
}

@group(0) @binding(0) var srcTex: texture_2d<f32>;
@group(0) @binding(1) var depthTex: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;

fn bilateralWeight(dc: f32, dn: f32) -> f32 {
  let sigma = 0.02;
  let diff = dn - dc;
  return exp(- (diff * diff) / (sigma * sigma));
}

@fragment
fn fs_main(in: FullscreenOut) -> @location(0) f32 {
  let dims = textureDimensions(srcTex);
  let texel = 1.0 / vec2<f32>(dims);

  let depthCenter = textureSample(depthTex, samp, in.uv).r;

  var sum = 0.0;
  var wsum = 0.0;

  for (var y = -1; y <= 1; y = y + 1) {
    for (var x = -1; x <= 1; x = x + 1) {
      let offset = vec2<f32>(f32(x), f32(y)) * texel;
      let uv = in.uv + offset;
      let t = textureSample(srcTex, samp, uv).r;
      let d = textureSample(depthTex, samp, uv).r;
      let w = bilateralWeight(depthCenter, d);
      sum = sum + t * w;
      wsum = wsum + w;
    }
  }

  return select(0.0, sum / wsum, wsum > 0.0);
}
`;class te{device;pipeline;bindGroupLayout;bindGroup=null;lastSource=null;lastDepth=null;sampler;constructor(e){this.device=e,this.sampler=e.createSampler({magFilter:"linear",minFilter:"linear"}),this.bindGroupLayout=e.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:"float"}},{binding:1,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:"float"}},{binding:2,visibility:GPUShaderStage.FRAGMENT,sampler:{}}]});const t=e.createShaderModule({code:ee});this.pipeline=e.createRenderPipeline({layout:e.createPipelineLayout({bindGroupLayouts:[this.bindGroupLayout]}),vertex:{module:t,entryPoint:"vs_main"},fragment:{module:t,entryPoint:"fs_main",targets:[{format:"r16float"}]},primitive:{topology:"triangle-list"}})}resize(e,t){}createBindGroup(e,t){this.bindGroup=this.device.createBindGroup({layout:this.bindGroupLayout,entries:[{binding:0,resource:e.createView()},{binding:1,resource:t.createView()},{binding:2,resource:this.sampler}]}),this.lastSource=e,this.lastDepth=t}encode(e,t,i,n,a,r){if((!this.bindGroup||this.lastSource!==n||this.lastDepth!==r)&&this.createBindGroup(n,r),!this.bindGroup)return;const u=e.beginRenderPass({colorAttachments:[{view:a.createView(),clearValue:{r:0,g:0,b:0,a:0},loadOp:"clear",storeOp:"store"}]});u.setPipeline(this.pipeline),u.setBindGroup(0,this.bindGroup),u.draw(6,1),u.end()}}const ie=`/**
 * Composite Shader (final screen-space shading)
 *
 * Beginner note: combines depth/thickness/normals/foam into final color.
 */

struct FullscreenOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

#include "../../../common/shaders/environment.wgsl"
#include "../../../common/shaders/shadow_common.wgsl"

struct RenderUniforms {
  inverseViewProjection: mat4x4<f32>,
  waterColor: vec3<f32>,
  pad0: f32,
  deepWaterColor: vec3<f32>,
  pad1: f32,
  foamColor: vec3<f32>,
  foamOpacity: f32,
  extinctionCoeff: vec3<f32>,
  extinctionMultiplier: f32,
  refractionStrength: f32,
  showFluidShadows: f32,
  pad2: f32,
  shadowParams: ShadowUniforms,
};

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> FullscreenOut {
  var pos = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>( 1.0,  1.0)
  );

  var out: FullscreenOut;
  let p = pos[vertexIndex];
  out.position = vec4<f32>(p, 0.0, 1.0);
  out.uv = vec2<f32>(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5);
  return out;
}

@group(0) @binding(0) var thicknessTex: texture_2d<f32>;
@group(0) @binding(1) var normalTex: texture_2d<f32>;
@group(0) @binding(2) var depthTex: texture_2d<f32>;
@group(0) @binding(3) var foamTex: texture_2d<f32>;
@group(0) @binding(4) var samp: sampler;
@group(0) @binding(5) var<uniform> renderUniforms: RenderUniforms;
@group(0) @binding(6) var<uniform> envUniforms: EnvironmentUniforms;
@group(0) @binding(7) var shadowTex: texture_2d<f32>;

@fragment
fn fs_main(in: FullscreenOut) -> @location(0) vec4<f32> {
  let thickness = textureSample(thicknessTex, samp, in.uv).r;
  let n = textureSample(normalTex, samp, in.uv).rgb * 2.0 - 1.0;
  let normal = normalize(n);

  let depth = textureSample(depthTex, samp, in.uv).r;
  let ndc = vec4<f32>(in.uv.x * 2.0 - 1.0, 1.0 - in.uv.y * 2.0, depth, 1.0);
  var world = renderUniforms.inverseViewProjection * ndc;
  world = world / world.w;

  // Compute camera ray from near/far plane unprojection.
  let ndcNear = vec4<f32>(in.uv.x * 2.0 - 1.0, 1.0 - in.uv.y * 2.0, 0.0, 1.0);
  var worldNear = renderUniforms.inverseViewProjection * ndcNear;
  worldNear = worldNear / worldNear.w;
  let ndcFar = vec4<f32>(in.uv.x * 2.0 - 1.0, 1.0 - in.uv.y * 2.0, 1.0, 1.0);
  var worldFar = renderUniforms.inverseViewProjection * ndcFar;
  worldFar = worldFar / worldFar.w;
  let rayDir = normalize(worldFar.xyz - worldNear.xyz);

  // Background using shared environment
  // We don't have camera pos explicitly, but worldNear is roughly it (on near plane)
  // For infinite sky/floor, origin matters. worldNear is correct.
  var bg = getEnvironmentColor(worldNear.xyz, rayDir, envUniforms);

  // Floor hit from environment to support debug visualization.
  let floorMin = envUniforms.floorCenter - 0.5 * envUniforms.floorSize;
  let floorMax = envUniforms.floorCenter + 0.5 * envUniforms.floorSize;
  let boxHit = envRayBoxIntersection(worldNear.xyz, rayDir, floorMin, floorMax);
  let floorHit = boxHit.y >= max(boxHit.x, 0.0);

  // Apply fluid shadow to floor
  let floorT = max(boxHit.x, 0.0);
  let floorHitPos = worldNear.xyz + rayDir * floorT;
  let shadowClip = renderUniforms.shadowParams.lightViewProjection * vec4<f32>(floorHitPos, 1.0);
  let shadowNdc = shadowClip.xy / shadowClip.w;
  let shadowUV = vec2<f32>(shadowNdc.x * 0.5 + 0.5, 1.0 - (shadowNdc.y * 0.5 + 0.5));
  let shadowVal = textureSample(shadowTex, samp, shadowUV).r;

  let lightDir = normalize(envUniforms.dirToSun);

  if (floorHit) {
    var shadowFactor = 1.0;

    // Fluid shadow from shadow texture
    let inBounds = shadowUV.x >= 0.0 && shadowUV.x <= 1.0 && shadowUV.y >= 0.0 && shadowUV.y <= 1.0;
    if (renderUniforms.showFluidShadows > 0.5 && inBounds && shadowVal > 0.0) {
      // Apply subtle shadow like raymarch demo
      // Very light shadows with high ambient floor
      let shadowAtten = exp(-shadowVal * 0.3);
      let ambientMin = 0.7; // High ambient = very subtle shadows
      shadowFactor = shadowAtten * (1.0 - ambientMin) + ambientMin;
    }

    // Obstacle shadow - cast ray from floor toward sun
    let obstacleShadowHit = getObstacleHit(floorHitPos, lightDir, envUniforms);
    if (obstacleShadowHit.x >= 0.0) {
      // Obstacle blocks light - apply shadow
      let obstacleAmbient = 0.5; // Obstacle shadow is a bit darker than fluid shadow
      shadowFactor = min(shadowFactor, obstacleAmbient);
    }

    bg = bg * shadowFactor;
  }

  let finalBg = bg;

  let base = renderUniforms.deepWaterColor;
  let shallow = renderUniforms.waterColor;

  let ndotl = max(dot(normal, lightDir), 0.0) * envUniforms.sunBrightness;

  let viewDir = normalize(worldNear.xyz - world.xyz); // From surface to camera
  let halfDir = normalize(lightDir + viewDir);
  let spec = pow(max(dot(normal, halfDir), 0.0), 64.0) * envUniforms.sunBrightness;
  let fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 5.0);

  let alpha = clamp(thickness * 4.0, 0.0, 1.0);

  let offset = normal.xy * renderUniforms.refractionStrength;
  let refractThickness = textureSample(thicknessTex, samp, in.uv + offset).r;

  // Beer-Lambert Law for absorption
  let absorption = exp(-refractThickness * renderUniforms.extinctionCoeff * renderUniforms.extinctionMultiplier);
  
  // Blend between shallow and deep color based on absorption
  let fluidColor = mix(base, shallow, absorption);
  
  let diffuse = fluidColor * (0.35 * envUniforms.floorAmbient + 0.65 * ndotl);
  let specular = vec3<f32>(0.9, 0.95, 1.0) * spec * (0.2 + 0.8 * fresnel);

  let refracted = mix(finalBg, fluidColor, 1.0 - absorption);

  // Obstacle shading
  let obsHit = getObstacleHit(worldNear.xyz, rayDir, envUniforms);
  let obsT = obsHit.x;
  
  let hasFluid = alpha > 0.001;
  let tFluid = select(1.0e9, dot(world.xyz - worldNear.xyz, rayDir), hasFluid);

  var color = mix(finalBg, diffuse + specular, alpha);
  color = mix(color, refracted, 0.4 * fresnel);
  let foam = textureSample(foamTex, samp, in.uv).r;
  color = mix(color, renderUniforms.foamColor, clamp(foam * renderUniforms.foamOpacity, 0.0, 1.0));

  if (obsT >= 0.0 && obsT < tFluid) {
    // Render obstacle on top
    let a = clamp(envUniforms.obstacleAlpha, 0.0, 1.0);
    // Obstacle lighting
    let ambient = envUniforms.floorAmbient;
    let sun = max(0.0, dot(obsHit.yzw, envUniforms.dirToSun)) * envUniforms.sunBrightness;

    let litShadowed = envUniforms.obstacleColor * (ambient + sun);

    color = mix(color, litShadowed, a);
  }

  let exposure = envUniforms.sceneExposure;
  return vec4<f32>(color * exposure, 1.0);
}
`;class ne{device;compositePipeline;wireframePipeline;compositeBindGroupLayout;compositeBindGroup=null;wireframeBindGroup;sampler;uniformBuffer;envUniformBuffer;wireframeUniformBuffer;wireframeVertexBuffer;wireframeVertexData;constructor(e,t){this.device=e,this.sampler=e.createSampler({magFilter:"linear",minFilter:"linear"}),this.uniformBuffer=e.createBuffer({size:224,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.envUniformBuffer=e.createBuffer({size:240,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.compositeBindGroupLayout=e.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:"float"}},{binding:1,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:"float"}},{binding:2,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:"float"}},{binding:3,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:"float"}},{binding:4,visibility:GPUShaderStage.FRAGMENT,sampler:{}},{binding:5,visibility:GPUShaderStage.FRAGMENT,buffer:{type:"uniform"}},{binding:6,visibility:GPUShaderStage.FRAGMENT,buffer:{type:"uniform"}},{binding:7,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:"float"}}]});const i=G(ie,{"../../../common/shaders/environment.wgsl":k,"../../../common/shaders/shadow_common.wgsl":z}),n=e.createShaderModule({code:i});this.compositePipeline=e.createRenderPipeline({layout:e.createPipelineLayout({bindGroupLayouts:[this.compositeBindGroupLayout]}),vertex:{module:n,entryPoint:"vs_main"},fragment:{module:n,entryPoint:"fs_main",targets:[{format:t}]},primitive:{topology:"triangle-list"}});const a=e.createShaderModule({code:F});this.wireframePipeline=e.createRenderPipeline({layout:"auto",vertex:{module:a,entryPoint:"vs_main",buffers:[{arrayStride:28,attributes:[{shaderLocation:0,offset:0,format:"float32x3"},{shaderLocation:1,offset:12,format:"float32x4"}]}]},fragment:{module:a,entryPoint:"fs_main",targets:[{format:t}]},primitive:{topology:"line-list"},depthStencil:{format:"depth24plus",depthWriteEnabled:!0,depthCompare:"less"}}),this.wireframeUniformBuffer=e.createBuffer({size:64,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.wireframeVertexData=new Float32Array(168),this.wireframeVertexBuffer=e.createBuffer({size:this.wireframeVertexData.byteLength,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST}),this.wireframeBindGroup=e.createBindGroup({layout:this.wireframePipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.wireframeUniformBuffer}}]})}resize(e,t){this.compositeBindGroup=null}buildBoundsWireframe(e){const t=e.boundsSize.x*.5,i=e.boundsSize.y*.5,n=e.boundsSize.z*.5,a=i-5,r=e.boundsWireframeColor??{r:1,g:1,b:1},u=[[-t,a-i,-n],[+t,a-i,-n],[+t,a+i,-n],[-t,a+i,-n],[-t,a-i,+n],[+t,a-i,+n],[+t,a+i,+n],[-t,a+i,+n]],l=[[0,1],[1,5],[5,4],[4,0],[3,2],[2,6],[6,7],[7,3],[0,3],[1,2],[5,6],[4,7]];let o=0;const h=d=>{const c=u[d];this.wireframeVertexData[o++]=c[0],this.wireframeVertexData[o++]=c[1],this.wireframeVertexData[o++]=c[2],this.wireframeVertexData[o++]=r.r,this.wireframeVertexData[o++]=r.g,this.wireframeVertexData[o++]=r.b,this.wireframeVertexData[o++]=1};for(const[d,c]of l)h(d),h(c);return l.length*2}createCompositeBindGroup(e){if(!e.smoothTextureB||!e.normalTexture||!e.smoothTextureA||!e.foamTexture||!e.shadowSmoothTexture){this.compositeBindGroup=null;return}this.compositeBindGroup=this.device.createBindGroup({layout:this.compositeBindGroupLayout,entries:[{binding:0,resource:e.smoothTextureB.createView()},{binding:1,resource:e.normalTexture.createView()},{binding:2,resource:e.smoothTextureA.createView()},{binding:3,resource:e.foamTexture.createView()},{binding:4,resource:this.sampler},{binding:5,resource:{buffer:this.uniformBuffer}},{binding:6,resource:{buffer:this.envUniformBuffer}},{binding:7,resource:e.shadowTexture.createView()}]})}encode(e,t,i,n){if(this.compositeBindGroup||this.createCompositeBindGroup(t),!this.compositeBindGroup)return;const a=new Float32Array(56);a.set(i.inverseViewProjection,0),a[16]=i.waterColor.r,a[17]=i.waterColor.g,a[18]=i.waterColor.b,a[19]=0,a[20]=i.deepWaterColor.r,a[21]=i.deepWaterColor.g,a[22]=i.deepWaterColor.b,a[23]=0,a[24]=i.foamColor.r,a[25]=i.foamColor.g,a[26]=i.foamColor.b,a[27]=i.foamOpacity,a[28]=i.extinctionCoeff.x,a[29]=i.extinctionCoeff.y,a[30]=i.extinctionCoeff.z,a[31]=i.extinctionMultiplier,a[32]=i.refractionStrength,a[33]=i.showFluidShadows?1:0,a[34]=0,a[35]=0,i.shadowViewProjection&&(a.set(i.shadowViewProjection,36),a[52]=i.shadowSoftness,a[53]=0,a[54]=0,a[55]=0),this.device.queue.writeBuffer(this.uniformBuffer,0,a);const r=new Float32Array(60);C(r,0,i,{...i,obstacleCentre:i.obstacleCentre,obstacleSize:{x:i.obstacleHalfSize.x*2,y:i.obstacleHalfSize.y*2,z:i.obstacleHalfSize.z*2}}),this.device.queue.writeBuffer(this.envUniformBuffer,0,r);const u=e.beginRenderPass({colorAttachments:[{view:n,clearValue:{r:0,g:0,b:0,a:1},loadOp:"clear",storeOp:"store"}]});if(u.setPipeline(this.compositePipeline),u.setBindGroup(0,this.compositeBindGroup),u.draw(6,1),u.end(),i.showBoundsWireframe&&t.depthTexture){const l=this.buildBoundsWireframe(i);this.device.queue.writeBuffer(this.wireframeVertexBuffer,0,this.wireframeVertexData.buffer,this.wireframeVertexData.byteOffset,l*7*4),this.device.queue.writeBuffer(this.wireframeUniformBuffer,0,i.viewProjection.buffer,i.viewProjection.byteOffset,i.viewProjection.byteLength);const o=e.beginRenderPass({colorAttachments:[{view:n,loadOp:"load",storeOp:"store"}],depthStencilAttachment:{view:t.depthTexture.createView(),depthLoadOp:"load",depthStoreOp:"store"}});o.setPipeline(this.wireframePipeline),o.setBindGroup(0,this.wireframeBindGroup),o.setVertexBuffer(0,this.wireframeVertexBuffer,0),o.draw(l),o.end()}}}const ae=`// Debug shader - renders all particles as white dots to verify shadow pass works
// Beginner note: this bypasses shading and draws raw particle depth.

struct Uniforms {
  viewProjection: mat4x4<f32>,
  canvasSize: vec2<f32>,
  particleRadius: f32,
  _pad: f32,
};

@group(0) @binding(0) var<storage, read> positions: array<vec4<f32>>;
@group(0) @binding(1) var<uniform> uniforms: Uniforms;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32
) -> VertexOutput {
  let pos = positions[instanceIndex].xyz;

  var quadPos = vec2<f32>(0.0, 0.0);
  switch (vertexIndex) {
    case 0u: { quadPos = vec2<f32>(-1.0, -1.0); }
    case 1u: { quadPos = vec2<f32>( 1.0, -1.0); }
    case 2u: { quadPos = vec2<f32>(-1.0,  1.0); }
    case 3u: { quadPos = vec2<f32>(-1.0,  1.0); }
    case 4u: { quadPos = vec2<f32>( 1.0, -1.0); }
    case 5u: { quadPos = vec2<f32>( 1.0,  1.0); }
    default: { quadPos = vec2<f32>(0.0, 0.0); }
  }

  let clipPos = uniforms.viewProjection * vec4<f32>(pos, 1.0);
  let ndc = clipPos.xyz / clipPos.w;

  let radiusNdc = vec2<f32>(0.02, 0.02);
  let offset = quadPos * radiusNdc;

  var out: VertexOutput;
  // Clamp Z to valid [0,1] range for WebGPU
  let z = clamp(ndc.z, 0.0, 1.0);
  out.position = vec4<f32>(ndc.xy + offset, z, 1.0);
  out.uv = quadPos;
  return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) f32 {
  let d = length(in.uv);
  if (d > 1.0) {
    discard;
  }
  // Return a constant value for debugging
  return 1.0;
}
`;class se{device;pipeline;uniformBuffer;bindGroupLayout;bindGroup=null;constructor(e){this.device=e,this.uniformBuffer=e.createBuffer({size:80,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.bindGroupLayout=e.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.VERTEX,buffer:{type:"read-only-storage"}},{binding:1,visibility:GPUShaderStage.VERTEX,buffer:{type:"uniform"}}]});const t=e.createShaderModule({code:ae});this.pipeline=e.createRenderPipeline({layout:e.createPipelineLayout({bindGroupLayouts:[this.bindGroupLayout]}),vertex:{module:t,entryPoint:"vs_main"},fragment:{module:t,entryPoint:"fs_main",targets:[{format:"r16float",blend:{color:{srcFactor:"one",dstFactor:"one"},alpha:{srcFactor:"one",dstFactor:"one"}}}]},primitive:{topology:"triangle-list",cullMode:"none"}})}createBindGroup(e){this.bindGroup=this.device.createBindGroup({layout:this.bindGroupLayout,entries:[{binding:0,resource:{buffer:e.positions}},{binding:1,resource:{buffer:this.uniformBuffer}}]})}buildShadowVP(e){const t=R(e.dirToSun),i={x:0,y:-2.5,z:0},n=30,a={x:i.x+t.x*n,y:i.y+t.y*n,z:i.z+t.z*n},r=Math.abs(t.y)>.99?{x:1,y:0,z:0}:{x:0,y:1,z:0},u=V(a,i,r),l=e.boundsSize.x*.5+2,o=e.boundsSize.y*.5+2,h=e.boundsSize.z*.5+2,d=Math.max(l,o,h),c=O(-d,d,-d,d,n-d-10,n+d+10);return S(c,u)}encode(e,t,i){if(!t.shadowTexture||!this.bindGroup)return null;const n=this.buildShadowVP(i),a=t.shadowTexture.width,r=t.shadowTexture.height,u=Math.max(a,r)*.05,l=new Float32Array(20);l.set(n),l[16]=a,l[17]=r,l[18]=u,l[19]=0,this.device.queue.writeBuffer(this.uniformBuffer,0,l);const o=e.beginRenderPass({colorAttachments:[{view:t.shadowTexture.createView(),clearValue:{r:0,g:0,b:0,a:0},loadOp:"clear",storeOp:"store"}]});return o.setPipeline(this.pipeline),o.setBindGroup(0,this.bindGroup),o.draw(6,t.buffers.particleCount),o.end(),n}}class re{device;canvas;config;width=0;height=0;depthTexture=null;thicknessTexture=null;normalTexture=null;smoothTextureA=null;smoothTextureB=null;foamTexture=null;shadowTexture=null;shadowSmoothTexture=null;buffers=null;depthPass;thicknessPass;normalPass;smoothPass;foamPass;compositePass;shadowPass;constructor(e,t,i,n){this.device=e,this.canvas=t,this.config=n,this.depthPass=new Y(e),this.thicknessPass=new J(e),this.normalPass=new $(e),this.smoothPass=new te(e),this.foamPass=new Z(e),this.compositePass=new ne(e,i),this.shadowPass=new se(e)}createBindGroups(e){this.buffers=e;const t={buffers:e,depthTexture:this.depthTexture,thicknessTexture:this.thicknessTexture,normalTexture:this.normalTexture,smoothTextureA:this.smoothTextureA,smoothTextureB:this.smoothTextureB,foamTexture:this.foamTexture,shadowTexture:this.shadowTexture,shadowSmoothTexture:this.shadowSmoothTexture};this.depthPass.createBindGroup(t),this.thicknessPass.createBindGroup(t),this.normalPass.createBindGroup(t),this.shadowPass.createBindGroup(e),e.foamPositions&&e.foamVelocities&&e.maxFoamParticles>0&&this.foamPass.createBindGroup(e.foamPositions,e.foamVelocities,e.maxFoamParticles)}resize(e,t){if(e===this.width&&t===this.height)return;this.width=Math.max(1,Math.floor(e)),this.height=Math.max(1,Math.floor(t)),this.depthTexture=this.device.createTexture({size:{width:this.width,height:this.height},format:"depth24plus",usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});const i=GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING;this.thicknessTexture=this.device.createTexture({size:{width:this.width,height:this.height},format:"r16float",usage:i}),this.normalTexture=this.device.createTexture({size:{width:this.width,height:this.height},format:"rgba16float",usage:i}),this.smoothTextureA=this.device.createTexture({size:{width:this.width,height:this.height},format:"r16float",usage:i}),this.smoothTextureB=this.device.createTexture({size:{width:this.width,height:this.height},format:"r16float",usage:i}),this.foamTexture=this.device.createTexture({size:{width:this.width,height:this.height},format:"r16float",usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});const n=Math.max(1,Math.floor(this.width/4)),a=Math.max(1,Math.floor(this.height/4));this.shadowTexture=this.device.createTexture({size:{width:n,height:a},format:"r16float",usage:i}),this.shadowSmoothTexture=this.device.createTexture({size:{width:n,height:a},format:"r16float",usage:i}),this.depthPass.resize(this.width,this.height),this.thicknessPass.resize(this.width,this.height),this.normalPass.resize(this.width,this.height),this.smoothPass.resize(this.width,this.height),this.compositePass.resize(this.width,this.height)}render(e,t,i){if(!this.buffers)return;const n=this.canvas.width/this.canvas.height,a=.1,r=100,u=A(Math.PI/3,n,a,r),l=S(u,i),o=M(l),h=window.devicePixelRatio||1,d=this.config.showObstacle!==!1,c=this.config.obstacleShape??"box",g=c==="sphere",m=this.config.obstacleRadius??0,f={...this.config,viewProjection:l,inverseViewProjection:o,canvasWidth:this.canvas.width,canvasHeight:this.canvas.height,particleRadius:this.config.particleRadius*h,foamParticleRadius:this.config.foamParticleRadius*h,near:a,far:r,obstacleHalfSize:{x:d?g?m:this.config.obstacleSize.x*.5:0,y:d?g?m:this.config.obstacleSize.y*.5:0,z:d?g?m:this.config.obstacleSize.z*.5:0},obstacleColor:this.config.obstacleColor??{r:1,g:0,b:0},obstacleAlpha:d?this.config.obstacleAlpha??.8:0,obstacleShape:c,obstacleRadius:m,showBoundsWireframe:this.config.showBoundsWireframe,boundsWireframeColor:this.config.boundsWireframeColor,boundsSize:this.config.boundsSize,shadowViewProjection:null,shadowSoftness:this.config.shadowSoftness},s={buffers:this.buffers,depthTexture:this.depthTexture,thicknessTexture:this.thicknessTexture,normalTexture:this.normalTexture,smoothTextureA:this.smoothTextureA,smoothTextureB:this.smoothTextureB,foamTexture:this.foamTexture,shadowTexture:this.shadowTexture,shadowSmoothTexture:this.shadowSmoothTexture};if(this.depthPass.encode(e,s,f),this.thicknessPass.encode(e,s,f),s.foamTexture&&this.foamPass.encode(e,s,f,s.foamTexture),this.config.showFluidShadows){const x=this.shadowPass.encode(e,s,f);f.shadowViewProjection=x,s.shadowTexture&&s.shadowSmoothTexture&&this.smoothPass.encode(e,s,f,s.shadowTexture,s.shadowSmoothTexture,s.shadowTexture)}s.thicknessTexture&&s.smoothTextureA&&s.smoothTextureB&&(this.smoothPass.encode(e,s,f,s.thicknessTexture,s.smoothTextureB,s.smoothTextureA),this.smoothPass.encode(e,s,f,s.smoothTextureB,s.thicknessTexture,s.smoothTextureA),this.smoothPass.encode(e,s,f,s.thicknessTexture,s.smoothTextureB,s.smoothTextureA),this.smoothPass.encode(e,s,f,s.smoothTextureB,s.thicknessTexture,s.smoothTextureA),this.smoothPass.encode(e,s,f,s.thicknessTexture,s.smoothTextureB,s.smoothTextureA)),this.normalPass.encode(e,s,f),this.compositePass.encode(e,s,f,t)}}class le{device;context;canvas;config;buffers;physics;grid;foam;renderer;pickingSystem;state;gridRes={x:0,y:0,z:0};gridTotalCells=0;isPicking=!1;interactionPos={x:0,y:0,z:0};physicsUniforms;gridUniforms;foamUniforms;computeData=new Float32Array(8);integrateData=new Float32Array(24);hashParamsData=new Float32Array(8);sortParamsData=new Uint32Array(8);scanParamsDataL0=new Uint32Array(4);scanParamsDataL1=new Uint32Array(4);scanParamsDataL2=new Uint32Array(4);densityParamsData=new Float32Array(12);pressureParamsData=new Float32Array(16);viscosityParamsData=new Float32Array(12);foamSpawnData=new Float32Array(28);foamUpdateData=new Float32Array(28);foamFrameCount=0;simTimer=0;constructor(e,t,i,n,a){this.device=e,this.context=t,this.canvas=i,this.config=n,this.physics=new _(e),this.grid=new L(e),this.foam=new j(e),this.renderer=new re(e,i,a,n),this.pickingSystem=new N(e),this.physicsUniforms={external:e.createBuffer({size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),density:e.createBuffer({size:48,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),pressure:e.createBuffer({size:64,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),viscosity:e.createBuffer({size:48,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),integrate:e.createBuffer({size:96,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST})},this.gridUniforms={hash:e.createBuffer({size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),sort:e.createBuffer({size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),scanL0:e.createBuffer({size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),scanL1:e.createBuffer({size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),scanL2:e.createBuffer({size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST})},this.foamUniforms={spawn:e.createBuffer({size:112,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),update:e.createBuffer({size:112,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST})},this.reset()}get particleCount(){return this.buffers.particleCount}get simulationState(){return this.state}reset(){this.buffers&&this.buffers.destroy(),this.simTimer=0,this.foamFrameCount=0;const{boundsSize:e,smoothingRadius:t}=this.config;this.gridRes={x:Math.ceil(e.x/t),y:Math.ceil(e.y/t),z:Math.ceil(e.z/t)},this.gridTotalCells=this.gridRes.x*this.gridRes.y*this.gridRes.z;const i=E(this.config);this.state=this.createStateFromSpawn(i),this.buffers=new P(this.device,i,{gridTotalCells:this.gridTotalCells,includeFoam:!0,maxFoamParticles:P.DEFAULT_MAX_FOAM_PARTICLES}),this.physics.createBindGroups(this.buffers,this.physicsUniforms),this.grid.createBindGroups(this.buffers,this.gridUniforms),this.foam.createBindGroups(this.buffers,this.foamUniforms),this.renderer.createBindGroups(this.buffers),this.pickingSystem.createBindGroup(this.buffers.positions)}createStateFromSpawn(e){return{positions:e.positions,predicted:new Float32Array(e.positions),velocities:e.velocities,densities:new Float32Array(e.count*2),keys:new Uint32Array(e.count),sortedKeys:new Uint32Array(e.count),indices:new Uint32Array(e.count),sortOffsets:new Uint32Array(e.count),spatialOffsets:new Uint32Array(e.count),positionsSorted:new Float32Array(e.count*4),predictedSorted:new Float32Array(e.count*4),velocitiesSorted:new Float32Array(e.count*4),count:e.count,input:{worldX:0,worldY:0,worldZ:0,pull:!1,push:!1}}}async step(e){const{config:t,buffers:i,device:n}=this,a=t.maxTimestepFPS?1/t.maxTimestepFPS:Number.POSITIVE_INFINITY,r=Math.min(e*t.timeScale,a);this.simTimer+=r;const u=r/t.iterationsPerFrame;this.updateUniforms(u);const l=n.createCommandEncoder();let o=!1;!this.isPicking&&this.state.input.rayOrigin&&this.state.input.rayDir&&(this.isPicking=!0,o=!0,this.pickingSystem.dispatch(l,this.state.input.rayOrigin,this.state.input.rayDir,t.smoothingRadius,i.particleCount));const h=l.beginComputePass();for(let c=0;c<t.iterationsPerFrame;c++)this.physics.step(h,this.grid,i.particleCount,this.gridTotalCells,t.viscosityStrength>0);h.end(),this.dispatchFoam(r,l),n.queue.submit([l.finish()]),o&&this.pickingSystem.getResult().then(c=>{if(c&&c.hit){let g=c.hitPos.x,m=c.hitPos.y,f=c.hitPos.z;this.state.input.pull&&this.state.input.rayDir&&(g+=this.state.input.rayDir.x*.5,m+=this.state.input.rayDir.y*.5,f+=this.state.input.rayDir.z*.5),this.state.input.worldX=g,this.state.input.worldY=m,this.state.input.worldZ=f,this.state.input.isHoveringFluid=!0}else this.state.input.isHoveringFluid=!1;this.isPicking=!1});const d=.15;this.interactionPos.x+=(this.state.input.worldX-this.interactionPos.x)*d,this.interactionPos.y+=(this.state.input.worldY-this.interactionPos.y)*d,this.interactionPos.z+=(this.state.input.worldZ-this.interactionPos.z)*d}updateUniforms(e){const{config:t,state:i,buffers:n,device:a}=this;let r=0;i.input.push?r=-t.interactionStrength:i.input.pull&&(r=t.interactionStrength),this.computeData[0]=e,this.computeData[1]=t.gravity,this.computeData[2]=t.interactionRadius,this.computeData[3]=r,this.computeData[4]=this.interactionPos.x,this.computeData[5]=this.interactionPos.y,this.computeData[6]=this.interactionPos.z,this.computeData[7]=0,a.queue.writeBuffer(this.physicsUniforms.external,0,this.computeData),this.hashParamsData[0]=t.smoothingRadius,this.hashParamsData[1]=n.particleCount,this.hashParamsData[2]=-t.boundsSize.x*.5,this.hashParamsData[3]=-5,this.hashParamsData[4]=-t.boundsSize.z*.5,this.hashParamsData[5]=this.gridRes.x,this.hashParamsData[6]=this.gridRes.y,this.hashParamsData[7]=this.gridRes.z,a.queue.writeBuffer(this.gridUniforms.hash,0,this.hashParamsData),this.sortParamsData[0]=n.particleCount,this.sortParamsData[1]=this.gridTotalCells,a.queue.writeBuffer(this.gridUniforms.sort,0,this.sortParamsData);const u=Math.ceil((this.gridTotalCells+1)/512),l=Math.ceil(u/512);this.scanParamsDataL0[0]=this.gridTotalCells+1,this.scanParamsDataL1[0]=u,this.scanParamsDataL2[0]=l,a.queue.writeBuffer(this.gridUniforms.scanL0,0,this.scanParamsDataL0),a.queue.writeBuffer(this.gridUniforms.scanL1,0,this.scanParamsDataL1),a.queue.writeBuffer(this.gridUniforms.scanL2,0,this.scanParamsDataL2);const o=t.smoothingRadius,h=15/(2*Math.PI*Math.pow(o,5)),d=15/(Math.PI*Math.pow(o,6));this.densityParamsData[0]=o,this.densityParamsData[1]=h,this.densityParamsData[2]=d,this.densityParamsData[3]=n.particleCount,this.densityParamsData[4]=-t.boundsSize.x*.5,this.densityParamsData[5]=-5,this.densityParamsData[6]=-t.boundsSize.z*.5,this.densityParamsData[7]=0,this.densityParamsData[8]=this.gridRes.x,this.densityParamsData[9]=this.gridRes.y,this.densityParamsData[10]=this.gridRes.z,this.densityParamsData[11]=0,a.queue.writeBuffer(this.physicsUniforms.density,0,this.densityParamsData);const c=15/(Math.PI*Math.pow(o,5)),g=45/(Math.PI*Math.pow(o,6));this.pressureParamsData[0]=e,this.pressureParamsData[1]=t.targetDensity,this.pressureParamsData[2]=t.pressureMultiplier,this.pressureParamsData[3]=t.nearPressureMultiplier,this.pressureParamsData[4]=o,this.pressureParamsData[5]=c,this.pressureParamsData[6]=g,this.pressureParamsData[7]=n.particleCount,this.pressureParamsData[8]=-t.boundsSize.x*.5,this.pressureParamsData[9]=-5,this.pressureParamsData[10]=-t.boundsSize.z*.5,this.pressureParamsData[11]=0,this.pressureParamsData[12]=this.gridRes.x,this.pressureParamsData[13]=this.gridRes.y,this.pressureParamsData[14]=this.gridRes.z,this.pressureParamsData[15]=0,a.queue.writeBuffer(this.physicsUniforms.pressure,0,this.pressureParamsData);const m=315/(64*Math.PI*Math.pow(o,9));this.viscosityParamsData[0]=e,this.viscosityParamsData[1]=t.viscosityStrength,this.viscosityParamsData[2]=o,this.viscosityParamsData[3]=m,this.viscosityParamsData[4]=n.particleCount,this.viscosityParamsData[5]=-t.boundsSize.x*.5,this.viscosityParamsData[6]=-5,this.viscosityParamsData[7]=-t.boundsSize.z*.5,this.viscosityParamsData[8]=this.gridRes.x,this.viscosityParamsData[9]=this.gridRes.y,this.viscosityParamsData[10]=this.gridRes.z,this.viscosityParamsData[11]=0,a.queue.writeBuffer(this.physicsUniforms.viscosity,0,this.viscosityParamsData),this.integrateData[0]=e,this.integrateData[1]=t.collisionDamping;const s=(t.obstacleShape??"box")==="sphere",x=t.obstacleRadius??0,U=t.showObstacle!==!1&&(s?x>0:t.obstacleSize.x>0&&t.obstacleSize.y>0&&t.obstacleSize.z>0);this.integrateData[2]=U?1:0,this.integrateData[3]=s?1:0;const v=t.boundsSize,b=v.x*.5,y=v.z*.5,w=-5;this.integrateData[4]=-b,this.integrateData[5]=w,this.integrateData[6]=-y,this.integrateData[8]=b,this.integrateData[9]=w+v.y,this.integrateData[10]=y,this.integrateData[12]=t.obstacleCentre.x,this.integrateData[13]=s?t.obstacleCentre.y:t.obstacleCentre.y+t.obstacleSize.y*.5,this.integrateData[14]=t.obstacleCentre.z;const B=s?x:t.obstacleSize.x*.5,T=s?x:t.obstacleSize.y*.5,D=s?x:t.obstacleSize.z*.5;this.integrateData[16]=B,this.integrateData[17]=T,this.integrateData[18]=D,this.integrateData[20]=t.obstacleRotation.x,this.integrateData[21]=t.obstacleRotation.y,this.integrateData[22]=t.obstacleRotation.z,a.queue.writeBuffer(this.physicsUniforms.integrate,0,this.integrateData)}dispatchFoam(e,t){const{buffers:i,config:n,device:a}=this,r=i.maxFoamParticles;this.foamFrameCount++;const u=n.spawnRateFadeInTime<=0?1:Math.min(1,Math.max(0,(this.simTimer-n.spawnRateFadeStartTime)/n.spawnRateFadeInTime));this.foamSpawnData[0]=e,this.foamSpawnData[1]=n.foamSpawnRate*u*u,this.foamSpawnData[2]=n.trappedAirVelocityMin,this.foamSpawnData[3]=n.trappedAirVelocityMax,this.foamSpawnData[4]=n.foamKineticEnergyMin,this.foamSpawnData[5]=n.foamKineticEnergyMax;const l=new Uint32Array(this.foamSpawnData.buffer);l[6]=r,l[7]=this.foamFrameCount,this.foamSpawnData[8]=i.particleCount,this.foamSpawnData[9]=n.smoothingRadius,this.foamSpawnData[10]=n.foamLifetimeMin,this.foamSpawnData[11]=n.foamLifetimeMax,this.foamSpawnData[12]=-n.boundsSize.x*.5,this.foamSpawnData[13]=-5,this.foamSpawnData[14]=-n.boundsSize.z*.5,this.foamSpawnData[16]=this.gridRes.x,this.foamSpawnData[17]=this.gridRes.y,this.foamSpawnData[18]=this.gridRes.z,this.foamSpawnData[19]=n.bubbleScale,a.queue.writeBuffer(this.foamUniforms.spawn,0,this.foamSpawnData),this.foamUpdateData[0]=e,this.foamUpdateData[1]=n.gravity,this.foamUpdateData[2]=.04,this.foamUpdateData[3]=n.bubbleBuoyancy;const o=n.boundsSize.x*.5,h=n.boundsSize.z*.5,d=-5;this.foamUpdateData[4]=o,this.foamUpdateData[5]=d+n.boundsSize.y,this.foamUpdateData[6]=h,this.foamUpdateData[7]=n.smoothingRadius,this.foamUpdateData[8]=-o,this.foamUpdateData[9]=d,this.foamUpdateData[10]=-h,this.foamUpdateData[11]=0,this.foamUpdateData[12]=this.gridRes.x,this.foamUpdateData[13]=this.gridRes.y,this.foamUpdateData[14]=this.gridRes.z,this.foamUpdateData[15]=0;const c=new Uint32Array(this.foamUpdateData.buffer);c[16]=n.bubbleClassifyMinNeighbours,c[17]=n.sprayClassifyMaxNeighbours,this.foamUpdateData[18]=n.bubbleScale,this.foamUpdateData[19]=n.bubbleChangeScaleSpeed,a.queue.writeBuffer(this.foamUniforms.update,0,this.foamUpdateData),this.foam.dispatch(t,i.particleCount,r,!1)}render(e){this.renderer.resize(this.canvas.width,this.canvas.height);const t=this.device.createCommandEncoder();this.renderer.render(t,this.context.getCurrentTexture().createView(),e),this.device.queue.submit([t.finish()])}}export{le as F};
