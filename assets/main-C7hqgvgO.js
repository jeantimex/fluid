import{b as F,c as M,a as z,s as A,d as T}from"./gui-DRYZ1KmF.js";class q{positions;predicted;velocities;densities;keys;sortedKeys;indices;sortOffsets;spatialOffsets;positionsSorted;predictedSorted;velocitiesSorted;velocityReadback;densityReadback;particleCount;device;constructor(e,t){this.device=e,this.particleCount=t.count,this.positions=this.createBufferFromArray(t.positions,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST),this.predicted=this.createBufferFromArray(new Float32Array(t.positions),GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST),this.velocities=this.createBufferFromArray(t.velocities,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC),this.densities=this.createEmptyBuffer(t.count*2*4,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC),this.keys=this.createEmptyBuffer(t.count*4,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST),this.sortedKeys=this.createEmptyBuffer(t.count*4,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST),this.indices=this.createEmptyBuffer(t.count*4,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST),this.sortOffsets=this.createEmptyBuffer(t.count*4,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST),this.spatialOffsets=this.createEmptyBuffer(t.count*4,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST),this.positionsSorted=this.createEmptyBuffer(t.count*2*4,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST),this.predictedSorted=this.createEmptyBuffer(t.count*2*4,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST),this.velocitiesSorted=this.createEmptyBuffer(t.count*2*4,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST),this.velocityReadback=e.createBuffer({size:t.count*2*4,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST}),this.densityReadback=e.createBuffer({size:t.count*2*4,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST})}createBufferFromArray(e,t){const i=this.device.createBuffer({size:e.byteLength,usage:t,mappedAtCreation:!0});return(e instanceof Float32Array?new Float32Array(i.getMappedRange()):new Uint32Array(i.getMappedRange())).set(e),i.unmap(),i}createEmptyBuffer(e,t){return this.device.createBuffer({size:e,usage:t})}destroy(){this.positions.destroy(),this.predicted.destroy(),this.velocities.destroy(),this.densities.destroy(),this.keys.destroy(),this.sortedKeys.destroy(),this.indices.destroy(),this.sortOffsets.destroy(),this.spatialOffsets.destroy(),this.positionsSorted.destroy(),this.predictedSorted.destroy(),this.velocitiesSorted.destroy(),this.velocityReadback.destroy(),this.densityReadback.destroy()}}const E=`struct SimParams {
  deltaTime: f32,
  gravity: f32,
  interactionRadius: f32,
  interactionStrength: f32,
  inputPoint: vec2<f32>,
  pad0: vec2<f32>,
};

@group(0) @binding(0) var<storage, read> positions: array<vec2<f32>>;
@group(0) @binding(1) var<storage, read_write> velocities: array<vec2<f32>>;
@group(0) @binding(2) var<storage, read_write> predicted: array<vec2<f32>>;
@group(0) @binding(3) var<uniform> params: SimParams;

fn externalForces(pos: vec2<f32>, velocity: vec2<f32>) -> vec2<f32> {
  let gravityAccel = vec2<f32>(0.0, -params.gravity);
  if (params.interactionStrength == 0.0) {
    return gravityAccel;
  }

  let offset = params.inputPoint - pos;
  let sqrDst = dot(offset, offset);
  let radius = params.interactionRadius;
  if (sqrDst < radius * radius && sqrDst > 0.000001) {
    let dst = sqrt(sqrDst);
    let edgeT = dst / radius;
    let centreT = 1.0 - edgeT;
    let dirToCentre = offset / dst;
    let gravityWeight = 1.0 - (centreT * saturate(params.interactionStrength / 10.0));
    var accel = gravityAccel * gravityWeight + dirToCentre * centreT * params.interactionStrength;
    accel -= velocity * centreT;
    return accel;
  }

  return gravityAccel;
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let index = id.x;
  if (index >= arrayLength(&positions)) {
    return;
  }

  let pos = positions[index];
  var vel = velocities[index];
  vel = vel + externalForces(pos, vel) * params.deltaTime;
  velocities[index] = vel;

  let predictionFactor = 1.0 / 120.0;
  predicted[index] = pos + vel * predictionFactor;
}
`,X=`struct HashParams {
  radius: f32,
  particleCount: f32,
  pad0: vec2<f32>,
};

@group(0) @binding(0) var<storage, read> predicted: array<vec2<f32>>;
@group(0) @binding(1) var<storage, read_write> keys: array<u32>;
@group(0) @binding(2) var<storage, read_write> indices: array<u32>;
@group(0) @binding(3) var<uniform> params: HashParams;

fn hashCell2D(cellX: i32, cellY: i32) -> u32 {
  let ax = cellX * 15823;
  let by = cellY * 9737333;
  return u32(ax + by);
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let index = id.x;
  let count = u32(params.particleCount + 0.5);
  if (index >= count) {
    return;
  }

  let pos = predicted[index];
  let cellX = i32(floor(pos.x / params.radius));
  let cellY = i32(floor(pos.y / params.radius));
  let hash = hashCell2D(cellX, cellY);
  let key = hash % count;
  keys[index] = key;
  indices[index] = index;
}
`,R=`struct SortParams {
  particleCount: u32,
  pad0: vec3<u32>,
};

@group(0) @binding(0) var<storage, read_write> sortOffsets: array<atomic<u32>>;
@group(0) @binding(1) var<uniform> params: SortParams;

@compute @workgroup_size(256)
fn clearOffsets(@builtin(global_invocation_id) id: vec3<u32>) {
  let index = id.x;
  if (index >= params.particleCount) {
    return;
  }
  atomicStore(&sortOffsets[index], 0u);
}

@group(1) @binding(0) var<storage, read> keys: array<u32>;
@group(1) @binding(1) var<storage, read_write> sortOffsetsCount: array<atomic<u32>>;
@group(1) @binding(2) var<uniform> countParams: SortParams;

@compute @workgroup_size(256)
fn countOffsets(@builtin(global_invocation_id) id: vec3<u32>) {
  let index = id.x;
  if (index >= countParams.particleCount) {
    return;
  }
  let key = keys[index];
  atomicAdd(&sortOffsetsCount[key], 1u);
}
`,V=`struct SortParams {
  particleCount: u32,
  pad0: vec3<u32>,
};

@group(0) @binding(0) var<storage, read> keys: array<u32>;
@group(0) @binding(1) var<storage, read_write> sortOffsets: array<u32>;
@group(0) @binding(2) var<storage, read_write> sortedKeys: array<u32>;
@group(0) @binding(3) var<storage, read_write> indices: array<u32>;
@group(0) @binding(4) var<uniform> params: SortParams;

@compute @workgroup_size(1)
fn prefixAndScatter(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x != 0u) {
    return;
  }

  let count = params.particleCount;
  var sum = 0u;
  for (var k = 0u; k < count; k = k + 1u) {
    let c = sortOffsets[k];
    sortOffsets[k] = sum;
    sum = sum + c;
  }

  for (var i = 0u; i < count; i = i + 1u) {
    let key = keys[i];
    let dest = sortOffsets[key];
    sortOffsets[key] = dest + 1u;
    indices[dest] = i;
    sortedKeys[dest] = key;
  }
}
`,I=`struct SortParams {
  particleCount: u32,
  pad0: vec3<u32>,
};

@group(0) @binding(0) var<storage, read> sortedKeys: array<u32>;
@group(0) @binding(1) var<storage, read_write> spatialOffsets: array<u32>;
@group(0) @binding(2) var<uniform> params: SortParams;

@compute @workgroup_size(1)
fn buildOffsets(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x != 0u) {
    return;
  }

  let count = params.particleCount;
  for (var i = 0u; i < count; i = i + 1u) {
    spatialOffsets[i] = count;
  }

  for (var i = 0u; i < count; i = i + 1u) {
    if (i == 0u || sortedKeys[i] != sortedKeys[i - 1u]) {
      spatialOffsets[sortedKeys[i]] = i;
    }
  }
}
`,L=`struct DensityParams {
  radius: f32,
  spikyPow2Scale: f32,
  spikyPow3Scale: f32,
  particleCountF: f32,
  pad0: vec4<f32>,
};

@group(0) @binding(0) var<storage, read> predicted: array<vec2<f32>>;
@group(0) @binding(1) var<storage, read> sortedKeys: array<u32>;
@group(0) @binding(2) var<storage, read> indices: array<u32>;
@group(0) @binding(3) var<storage, read> spatialOffsets: array<u32>;
@group(0) @binding(4) var<storage, read_write> densities: array<vec2<f32>>;
@group(0) @binding(5) var<uniform> params: DensityParams;

const neighborOffsets = array<vec2<i32>, 9>(
  vec2<i32>(-1, 1),
  vec2<i32>(0, 1),
  vec2<i32>(1, 1),
  vec2<i32>(-1, 0),
  vec2<i32>(0, 0),
  vec2<i32>(1, 0),
  vec2<i32>(-1, -1),
  vec2<i32>(0, -1),
  vec2<i32>(1, -1)
);

fn hashCell2D(cellX: i32, cellY: i32) -> u32 {
  let ax = cellX * 15823;
  let by = cellY * 9737333;
  return u32(ax + by);
}

fn spikyPow2(dst: f32, radius: f32, scale: f32) -> f32 {
  if (dst < radius) {
    let v = radius - dst;
    return v * v * scale;
  }
  return 0.0;
}

fn spikyPow3(dst: f32, radius: f32, scale: f32) -> f32 {
  if (dst < radius) {
    let v = radius - dst;
    return v * v * v * scale;
  }
  return 0.0;
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  let count = u32(params.particleCountF + 0.5);
  if (i >= count) {
    return;
  }

  let pos = predicted[i];
  let originCellX = i32(floor(pos.x / params.radius));
  let originCellY = i32(floor(pos.y / params.radius));

  var density = 0.0;
  var nearDensity = 0.0;
  let radiusSq = params.radius * params.radius;

  for (var n = 0u; n < 9u; n = n + 1u) {
    let cellOffset = neighborOffsets[n];
    let cellX = originCellX + cellOffset.x;
    let cellY = originCellY + cellOffset.y;
    let hash = hashCell2D(cellX, cellY);
    let key = hash % count;
    let start = spatialOffsets[key];
    if (start == count) {
      continue;
    }

    var j = start;
    loop {
      if (j >= count || sortedKeys[j] != key) {
        break;
      }
      let neighborIndex = indices[j];
      let neighborPos = predicted[neighborIndex];
      let dx = neighborPos.x - pos.x;
      let dy = neighborPos.y - pos.y;
      let dstSq = dx * dx + dy * dy;
      if (dstSq <= radiusSq) {
        let dst = sqrt(dstSq);
        density = density + spikyPow2(dst, params.radius, params.spikyPow2Scale);
        nearDensity = nearDensity + spikyPow3(dst, params.radius, params.spikyPow3Scale);
      }
      j = j + 1u;
    }
  }

  densities[i] = vec2<f32>(density, nearDensity);
}
`,K=`struct PressureParams {
  dt: f32,
  targetDensity: f32,
  pressureMultiplier: f32,
  nearPressureMultiplier: f32,
  radius: f32,
  spikyPow2DerivScale: f32,
  spikyPow3DerivScale: f32,
  particleCountF: f32,
  pad0: vec4<f32>,
};

@group(0) @binding(0) var<storage, read> predicted: array<vec2<f32>>;
@group(0) @binding(1) var<storage, read_write> velocities: array<vec2<f32>>;
@group(0) @binding(2) var<storage, read> densities: array<vec2<f32>>;
@group(0) @binding(3) var<storage, read> sortedKeys: array<u32>;
@group(0) @binding(4) var<storage, read> indices: array<u32>;
@group(0) @binding(5) var<storage, read> spatialOffsets: array<u32>;
@group(0) @binding(6) var<uniform> params: PressureParams;

const neighborOffsets = array<vec2<i32>, 9>(
  vec2<i32>(-1, 1),
  vec2<i32>(0, 1),
  vec2<i32>(1, 1),
  vec2<i32>(-1, 0),
  vec2<i32>(0, 0),
  vec2<i32>(1, 0),
  vec2<i32>(-1, -1),
  vec2<i32>(0, -1),
  vec2<i32>(1, -1)
);

fn hashCell2D(cellX: i32, cellY: i32) -> u32 {
  let ax = cellX * 15823;
  let by = cellY * 9737333;
  return u32(ax + by);
}

fn derivativeSpikyPow2(dst: f32, radius: f32, scale: f32) -> f32 {
  if (dst <= radius) {
    let v = radius - dst;
    return -v * scale;
  }
  return 0.0;
}

fn derivativeSpikyPow3(dst: f32, radius: f32, scale: f32) -> f32 {
  if (dst <= radius) {
    let v = radius - dst;
    return -v * v * scale;
  }
  return 0.0;
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  let count = u32(params.particleCountF + 0.5);
  if (i >= count) {
    return;
  }

  let densityPair = densities[i];
  let density = densityPair.x;
  let nearDensity = densityPair.y;
  if (density <= 0.0) {
    return;
  }

  let pressure = (density - params.targetDensity) * params.pressureMultiplier;
  let nearPressure = params.nearPressureMultiplier * nearDensity;

  let pos = predicted[i];
  let originCellX = i32(floor(pos.x / params.radius));
  let originCellY = i32(floor(pos.y / params.radius));
  let radiusSq = params.radius * params.radius;

  var forceX = 0.0;
  var forceY = 0.0;

  for (var n = 0u; n < 9u; n = n + 1u) {
    let cellOffset = neighborOffsets[n];
    let cellX = originCellX + cellOffset.x;
    let cellY = originCellY + cellOffset.y;
    let hash = hashCell2D(cellX, cellY);
    let key = hash % count;
    let start = spatialOffsets[key];
    if (start == count) {
      continue;
    }

    var j = start;
    loop {
      if (j >= count || sortedKeys[j] != key) {
        break;
      }
      let neighborIndex = indices[j];
      if (neighborIndex != i) {
        let neighborPos = predicted[neighborIndex];
        let dx = neighborPos.x - pos.x;
        let dy = neighborPos.y - pos.y;
        let dstSq = dx * dx + dy * dy;
        if (dstSq <= radiusSq) {
          let dst = sqrt(dstSq);
          let invDst = select(0.0, 1.0 / dst, dst > 0.0);
          let dirX = dx * invDst;
          let dirY = dy * invDst;

          let neighborDensityPair = densities[neighborIndex];
          let neighborDensity = neighborDensityPair.x;
          let neighborNearDensity = neighborDensityPair.y;
          let neighborPressure =
            (neighborDensity - params.targetDensity) * params.pressureMultiplier;
          let neighborNearPressure =
            params.nearPressureMultiplier * neighborNearDensity;

          let sharedPressure = (pressure + neighborPressure) * 0.5;
          let sharedNearPressure = (nearPressure + neighborNearPressure) * 0.5;

          if (neighborDensity > 0.0) {
            let scale =
              derivativeSpikyPow2(dst, params.radius, params.spikyPow2DerivScale) *
              (sharedPressure / neighborDensity);
            forceX = forceX + dirX * scale;
            forceY = forceY + dirY * scale;
          }

          if (neighborNearDensity > 0.0) {
            let scale =
              derivativeSpikyPow3(dst, params.radius, params.spikyPow3DerivScale) *
              (sharedNearPressure / neighborNearDensity);
            forceX = forceX + dirX * scale;
            forceY = forceY + dirY * scale;
          }
        }
      }
      j = j + 1u;
    }
  }

  velocities[i].x = velocities[i].x + (forceX / density) * params.dt;
  velocities[i].y = velocities[i].y + (forceY / density) * params.dt;
}
`,W=`struct ViscosityParams {
  dt: f32,
  viscosityStrength: f32,
  radius: f32,
  poly6Scale: f32,
  particleCountF: f32,
  pad0: vec3<f32>,
};

@group(0) @binding(0) var<storage, read> predicted: array<vec2<f32>>;
@group(0) @binding(1) var<storage, read_write> velocities: array<vec2<f32>>;
@group(0) @binding(2) var<storage, read> sortedKeys: array<u32>;
@group(0) @binding(3) var<storage, read> indices: array<u32>;
@group(0) @binding(4) var<storage, read> spatialOffsets: array<u32>;
@group(0) @binding(5) var<uniform> params: ViscosityParams;

const neighborOffsets = array<vec2<i32>, 9>(
  vec2<i32>(-1, 1),
  vec2<i32>(0, 1),
  vec2<i32>(1, 1),
  vec2<i32>(-1, 0),
  vec2<i32>(0, 0),
  vec2<i32>(1, 0),
  vec2<i32>(-1, -1),
  vec2<i32>(0, -1),
  vec2<i32>(1, -1)
);

fn hashCell2D(cellX: i32, cellY: i32) -> u32 {
  let ax = cellX * 15823;
  let by = cellY * 9737333;
  return u32(ax + by);
}

fn smoothingKernelPoly6(dst: f32, radius: f32, scale: f32) -> f32 {
  if (dst < radius) {
    let v = radius * radius - dst * dst;
    return v * v * v * scale;
  }
  return 0.0;
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  let count = u32(params.particleCountF + 0.5);
  if (i >= count) {
    return;
  }

  let pos = predicted[i];
  let originCellX = i32(floor(pos.x / params.radius));
  let originCellY = i32(floor(pos.y / params.radius));
  let radiusSq = params.radius * params.radius;

  var forceX = 0.0;
  var forceY = 0.0;
  let vel = velocities[i];

  for (var n = 0u; n < 9u; n = n + 1u) {
    let cellOffset = neighborOffsets[n];
    let cellX = originCellX + cellOffset.x;
    let cellY = originCellY + cellOffset.y;
    let hash = hashCell2D(cellX, cellY);
    let key = hash % count;
    let start = spatialOffsets[key];
    if (start == count) {
      continue;
    }

    var j = start;
    loop {
      if (j >= count || sortedKeys[j] != key) {
        break;
      }
      let neighborIndex = indices[j];
      if (neighborIndex != i) {
        let neighborPos = predicted[neighborIndex];
        let dx = neighborPos.x - pos.x;
        let dy = neighborPos.y - pos.y;
        let dstSq = dx * dx + dy * dy;
        if (dstSq <= radiusSq) {
          let dst = sqrt(dstSq);
          let weight = smoothingKernelPoly6(dst, params.radius, params.poly6Scale);
          let neighborVel = velocities[neighborIndex];
          forceX = forceX + (neighborVel.x - vel.x) * weight;
          forceY = forceY + (neighborVel.y - vel.y) * weight;
        }
      }
      j = j + 1u;
    }
  }

  velocities[i].x = velocities[i].x + forceX * params.viscosityStrength * params.dt;
  velocities[i].y = velocities[i].y + forceY * params.viscosityStrength * params.dt;
}
`,H=`struct IntegrateParams {
  dt: f32,
  collisionDamping: f32,
  hasObstacle: f32,
  pad0: f32,
  halfBounds: vec2<f32>,
  pad1: vec2<f32>,
  obstacleCenter: vec2<f32>,
  obstacleHalf: vec2<f32>,
};

@group(0) @binding(0) var<storage, read_write> positions: array<vec2<f32>>;
@group(0) @binding(1) var<storage, read_write> velocities: array<vec2<f32>>;
@group(0) @binding(2) var<uniform> params: IntegrateParams;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let index = id.x;
  if (index >= arrayLength(&positions)) {
    return;
  }

  var pos = positions[index];
  var vel = velocities[index];

  pos = pos + vel * params.dt;

  let halfBounds = params.halfBounds;
  let edgeDstX = halfBounds.x - abs(pos.x);
  let edgeDstY = halfBounds.y - abs(pos.y);

  if (edgeDstX <= 0.0) {
    pos.x = halfBounds.x * sign(pos.x);
    vel.x = -vel.x * params.collisionDamping;
  }
  if (edgeDstY <= 0.0) {
    pos.y = halfBounds.y * sign(pos.y);
    vel.y = -vel.y * params.collisionDamping;
  }

  if (params.hasObstacle > 0.5) {
    let ox = pos.x - params.obstacleCenter.x;
    let oy = pos.y - params.obstacleCenter.y;
    let obstacleEdgeX = params.obstacleHalf.x - abs(ox);
    let obstacleEdgeY = params.obstacleHalf.y - abs(oy);

    if (obstacleEdgeX >= 0.0 && obstacleEdgeY >= 0.0) {
      if (obstacleEdgeX < obstacleEdgeY) {
        pos.x = params.obstacleHalf.x * sign(ox) + params.obstacleCenter.x;
        vel.x = -vel.x * params.collisionDamping;
      } else {
        pos.y = params.obstacleHalf.y * sign(oy) + params.obstacleCenter.y;
        vel.y = -vel.y * params.collisionDamping;
      }
    }
  }

  positions[index] = pos;
  velocities[index] = vel;
}
`;class N{externalForces;hash;clearOffsets;countOffsets;scatter;spatialOffsets;density;pressure;viscosity;integrate;externalForcesBindGroup;integrateBindGroup;hashBindGroup;clearOffsetsBindGroup;countOffsetsBindGroup;scatterBindGroup;spatialOffsetsBindGroup;densityBindGroup;pressureBindGroup;viscosityBindGroup;uniformBuffers;device;constructor(e){this.device=e,this.uniformBuffers={compute:e.createBuffer({size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),integrate:e.createBuffer({size:64,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),hash:e.createBuffer({size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),sort:e.createBuffer({size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),density:e.createBuffer({size:48,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),pressure:e.createBuffer({size:48,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),viscosity:e.createBuffer({size:48,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST})},this.externalForces=this.createPipeline(E,"main"),this.hash=this.createPipeline(X,"main"),this.clearOffsets=this.createPipeline(R,"clearOffsets"),this.countOffsets=this.createPipeline(R,"countOffsets"),this.scatter=this.createPipeline(V,"prefixAndScatter"),this.spatialOffsets=this.createPipeline(I,"buildOffsets"),this.density=this.createPipeline(L,"main"),this.pressure=this.createPipeline(K,"main"),this.viscosity=this.createPipeline(W,"main"),this.integrate=this.createPipeline(H,"main")}createPipeline(e,t){const i=this.device.createShaderModule({code:e});return this.device.createComputePipeline({layout:"auto",compute:{module:i,entryPoint:t}})}createBindGroups(e){this.externalForcesBindGroup=this.device.createBindGroup({layout:this.externalForces.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:e.positions}},{binding:1,resource:{buffer:e.velocities}},{binding:2,resource:{buffer:e.predicted}},{binding:3,resource:{buffer:this.uniformBuffers.compute}}]}),this.integrateBindGroup=this.device.createBindGroup({layout:this.integrate.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:e.positions}},{binding:1,resource:{buffer:e.velocities}},{binding:2,resource:{buffer:this.uniformBuffers.integrate}}]}),this.hashBindGroup=this.device.createBindGroup({layout:this.hash.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:e.predicted}},{binding:1,resource:{buffer:e.keys}},{binding:2,resource:{buffer:e.indices}},{binding:3,resource:{buffer:this.uniformBuffers.hash}}]}),this.clearOffsetsBindGroup=this.device.createBindGroup({layout:this.clearOffsets.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:e.sortOffsets}},{binding:1,resource:{buffer:this.uniformBuffers.sort}}]}),this.countOffsetsBindGroup=this.device.createBindGroup({layout:this.countOffsets.getBindGroupLayout(1),entries:[{binding:0,resource:{buffer:e.keys}},{binding:1,resource:{buffer:e.sortOffsets}},{binding:2,resource:{buffer:this.uniformBuffers.sort}}]}),this.scatterBindGroup=this.device.createBindGroup({layout:this.scatter.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:e.keys}},{binding:1,resource:{buffer:e.sortOffsets}},{binding:2,resource:{buffer:e.sortedKeys}},{binding:3,resource:{buffer:e.indices}},{binding:4,resource:{buffer:this.uniformBuffers.sort}}]}),this.spatialOffsetsBindGroup=this.device.createBindGroup({layout:this.spatialOffsets.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:e.sortedKeys}},{binding:1,resource:{buffer:e.spatialOffsets}},{binding:2,resource:{buffer:this.uniformBuffers.sort}}]}),this.densityBindGroup=this.device.createBindGroup({layout:this.density.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:e.predicted}},{binding:1,resource:{buffer:e.sortedKeys}},{binding:2,resource:{buffer:e.indices}},{binding:3,resource:{buffer:e.spatialOffsets}},{binding:4,resource:{buffer:e.densities}},{binding:5,resource:{buffer:this.uniformBuffers.density}}]}),this.pressureBindGroup=this.device.createBindGroup({layout:this.pressure.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:e.predicted}},{binding:1,resource:{buffer:e.velocities}},{binding:2,resource:{buffer:e.densities}},{binding:3,resource:{buffer:e.sortedKeys}},{binding:4,resource:{buffer:e.indices}},{binding:5,resource:{buffer:e.spatialOffsets}},{binding:6,resource:{buffer:this.uniformBuffers.pressure}}]}),this.viscosityBindGroup=this.device.createBindGroup({layout:this.viscosity.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:e.predicted}},{binding:1,resource:{buffer:e.velocities}},{binding:2,resource:{buffer:e.sortedKeys}},{binding:3,resource:{buffer:e.indices}},{binding:4,resource:{buffer:e.spatialOffsets}},{binding:5,resource:{buffer:this.uniformBuffers.viscosity}}]})}}const j=`struct SimUniforms {
  boundsSize: vec2<f32>,
  canvasSize: vec2<f32>,
  particleRadius: f32,
  velocityDisplayMax: f32,
  gradientResolution: f32,
  pad0: f32,
};

@group(0) @binding(0) var<storage, read> positions: array<vec2<f32>>;
@group(0) @binding(1) var<storage, read> velocities: array<vec2<f32>>;
@group(0) @binding(2) var<storage, read> gradient: array<vec4<f32>>;
@group(0) @binding(3) var<uniform> uniforms: SimUniforms;

struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) localPos: vec2<f32>,
  @location(1) speed: f32,
};

@vertex
fn vs_main(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32
) -> VertexOut {
  var quad = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(1.0, -1.0),
    vec2<f32>(1.0, 1.0),
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(1.0, 1.0),
    vec2<f32>(-1.0, 1.0)
  );

  let pos = positions[instanceIndex];
  let halfBounds = uniforms.boundsSize * 0.5;
  let ndc = vec2<f32>(pos.x / halfBounds.x, pos.y / halfBounds.y);
  let radiusNdc = vec2<f32>(
    uniforms.particleRadius / uniforms.canvasSize.x * 2.0,
    uniforms.particleRadius / uniforms.canvasSize.y * 2.0
  );
  let offset = quad[vertexIndex] * radiusNdc;

  var out: VertexOut;
  out.position = vec4<f32>(ndc + offset, 0.0, 1.0);
  out.localPos = quad[vertexIndex];
  let vel = velocities[instanceIndex];
  out.speed = length(vel);
  return out;
}

@fragment
fn fs_main(
  @location(0) localPos: vec2<f32>,
  @location(1) speed: f32
) -> @location(0) vec4<f32> {
  if (dot(localPos, localPos) > 1.0) {
    discard;
  }
  let t = clamp(speed / uniforms.velocityDisplayMax, 0.0, 1.0);
  let idx = u32(t * (uniforms.gradientResolution - 1.0));
  return gradient[idx];
}
`,Z=`struct SimUniforms {
  boundsSize: vec2<f32>,
  canvasSize: vec2<f32>,
  particleRadius: f32,
  velocityDisplayMax: f32,
  gradientResolution: f32,
  pad0: f32,
};

@group(0) @binding(0) var<uniform> uniforms: SimUniforms;

struct VertexIn {
  @location(0) pos: vec2<f32>,
  @location(1) color: vec4<f32>,
};

struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
};

@vertex
fn vs_main(input: VertexIn) -> VertexOut {
  let halfBounds = uniforms.boundsSize * 0.5;
  let ndc = vec2<f32>(input.pos.x / halfBounds.x, input.pos.y / halfBounds.y);
  var out: VertexOut;
  out.position = vec4<f32>(ndc, 0.0, 1.0);
  out.color = input.color;
  return out;
}

@fragment
fn fs_main(@location(0) color: vec4<f32>) -> @location(0) vec4<f32> {
  return color;
}
`;class ${device;particlePipeline;linePipeline;uniformBuffer;gradientBuffer;lineVertexBuffer;lineVertexData;particleBindGroup;lineBindGroup;lineVertexStride=24;lineVertexCapacity=16;clearColor={r:5/255,g:7/255,b:11/255,a:1};uniformData=new Float32Array(8);constructor(e,t,i){this.device=e,this.uniformBuffer=e.createBuffer({size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});const n=F(i.colorKeys,i.gradientResolution),r=new Float32Array(i.gradientResolution*4);for(let o=0;o<n.length;o++)r[o*4]=n[o].r,r[o*4+1]=n[o].g,r[o*4+2]=n[o].b,r[o*4+3]=1;this.gradientBuffer=e.createBuffer({size:r.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST,mappedAtCreation:!0}),new Float32Array(this.gradientBuffer.getMappedRange()).set(r),this.gradientBuffer.unmap(),this.lineVertexData=new Float32Array(this.lineVertexCapacity*6),this.lineVertexBuffer=e.createBuffer({size:this.lineVertexData.byteLength,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});const s=e.createShaderModule({code:j});this.particlePipeline=e.createRenderPipeline({layout:"auto",vertex:{module:s,entryPoint:"vs_main"},fragment:{module:s,entryPoint:"fs_main",targets:[{format:t}]},primitive:{topology:"triangle-list"}});const a=e.createShaderModule({code:Z});this.linePipeline=e.createRenderPipeline({layout:"auto",vertex:{module:a,entryPoint:"vs_main",buffers:[{arrayStride:this.lineVertexStride,attributes:[{shaderLocation:0,offset:0,format:"float32x2"},{shaderLocation:1,offset:8,format:"float32x4"}]}]},fragment:{module:a,entryPoint:"fs_main",targets:[{format:t}]},primitive:{topology:"line-list"}}),this.lineBindGroup=e.createBindGroup({layout:this.linePipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.uniformBuffer}}]})}createBindGroup(e){this.particleBindGroup=this.device.createBindGroup({layout:this.particlePipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:e.positions}},{binding:1,resource:{buffer:e.velocities}},{binding:2,resource:{buffer:this.gradientBuffer}},{binding:3,resource:{buffer:this.uniformBuffer}}]})}updateUniforms(e,t,i){const n=window.devicePixelRatio||1;this.uniformData[0]=e.boundsSize.x,this.uniformData[1]=e.boundsSize.y,this.uniformData[2]=t,this.uniformData[3]=i,this.uniformData[4]=e.particleRadius*n,this.uniformData[5]=e.velocityDisplayMax,this.uniformData[6]=e.gradientResolution,this.uniformData[7]=0,this.device.queue.writeBuffer(this.uniformBuffer,0,this.uniformData)}render(e,t,i,n){let r=0;const s=(m,p,h,g,d,x,B,D)=>{const l=r*6;this.lineVertexData[l]=m,this.lineVertexData[l+1]=p,this.lineVertexData[l+2]=d,this.lineVertexData[l+3]=x,this.lineVertexData[l+4]=B,this.lineVertexData[l+5]=D,this.lineVertexData[l+6]=h,this.lineVertexData[l+7]=g,this.lineVertexData[l+8]=d,this.lineVertexData[l+9]=x,this.lineVertexData[l+10]=B,this.lineVertexData[l+11]=D,r+=2},a=i.boundsSize.x*.5,o=i.boundsSize.y*.5,c={r:27/255,g:36/255,b:50/255,a:1};if(s(-a,-o,a,-o,c.r,c.g,c.b,c.a),s(a,-o,a,o,c.r,c.g,c.b,c.a),s(a,o,-a,o,c.r,c.g,c.b,c.a),s(-a,o,-a,-o,c.r,c.g,c.b,c.a),i.obstacleSize.x>0&&i.obstacleSize.y>0){const m=i.obstacleSize.x*.5,p=i.obstacleSize.y*.5,h=i.obstacleCentre.x,g=i.obstacleCentre.y,d={r:54/255,g:81/255,b:109/255,a:1};s(h-m,g-p,h+m,g-p,d.r,d.g,d.b,d.a),s(h+m,g-p,h+m,g+p,d.r,d.g,d.b,d.a),s(h+m,g+p,h-m,g+p,d.r,d.g,d.b,d.a),s(h-m,g+p,h-m,g-p,d.r,d.g,d.b,d.a)}this.device.queue.writeBuffer(this.lineVertexBuffer,0,this.lineVertexData.subarray(0,r*6));const y=t.getCurrentTexture().createView(),v=e.beginRenderPass({colorAttachments:[{view:y,clearValue:this.clearColor,loadOp:"clear",storeOp:"store"}]});v.setPipeline(this.particlePipeline),v.setBindGroup(0,this.particleBindGroup),v.draw(6,n),r>0&&(v.setPipeline(this.linePipeline),v.setBindGroup(0,this.lineBindGroup),v.setVertexBuffer(0,this.lineVertexBuffer),v.draw(r)),v.end()}}const J={useGpuExternalForces:!0,useGpuSpatialHash:!0,useGpuDensity:!0,useGpuDensityReadback:!1,useCpuSpatialDataForGpuDensity:!1,useGpuPressure:!0,useGpuViscosity:!0};class Q{device;context;canvas;config;options;buffers;pipelines;renderer;physics;state;workgroupSize=256;computeData=new Float32Array(8);hashParamsData=new Float32Array(4);sortParamsData=new Uint32Array(4);densityParamsData=new Float32Array(12);pressureParamsData=new Float32Array(12);viscosityParamsData=new Float32Array(12);integrateParamsData=new Float32Array(16);constructor(e,t,i,n,r,s={}){this.device=e,this.context=t,this.canvas=i,this.config=n,this.options={...J,...s},this.pipelines=new N(e),this.renderer=new $(e,r,n),this.reset()}get particleCount(){return this.buffers.particleCount}get simulationState(){return this.state}getScale(){return this.canvas.width/this.config.boundsSize.x}reset(){this.buffers&&this.buffers.destroy();const e=M(this.config);this.state=this.createStateFromSpawn(e),this.buffers=new q(this.device,e),this.physics=z(this.state,this.config,()=>this.getScale()),this.pipelines.createBindGroups(this.buffers),this.renderer.createBindGroup(this.buffers)}refreshSettings(){this.physics.refreshSettings()}createStateFromSpawn(e){return{positions:e.positions,predicted:new Float32Array(e.positions),velocities:e.velocities,densities:new Float32Array(e.count*2),keys:new Uint32Array(e.count),sortedKeys:new Uint32Array(e.count),indices:new Uint32Array(e.count),sortOffsets:new Uint32Array(e.count),spatialOffsets:new Uint32Array(e.count),positionsSorted:new Float32Array(e.count*2),predictedSorted:new Float32Array(e.count*2),velocitiesSorted:new Float32Array(e.count*2),count:e.count,input:{worldX:0,worldY:0,pull:!1,push:!1}}}async step(e){const{options:t,config:i,state:n,buffers:r,pipelines:s,device:a}=this;if(t.useGpuExternalForces){const o=i.maxTimestepFPS?1/i.maxTimestepFPS:Number.POSITIVE_INFINITY,y=Math.min(e*i.timeScale,o)/i.iterationsPerFrame,v=window.devicePixelRatio||1,p=(Math.max(1,Math.round(i.particleRadius))+i.boundsPaddingPx)*v/this.getScale(),h=Math.max(0,i.boundsSize.x*.5-p),g=Math.max(0,i.boundsSize.y*.5-p),d=i.obstacleSize.x>0&&i.obstacleSize.y>0;for(let x=0;x<i.iterationsPerFrame;x++){let B=!1;const D=n.input.push?-i.interactionStrength:n.input.pull?i.interactionStrength:0;this.computeData[0]=y,this.computeData[1]=i.gravity,this.computeData[2]=i.interactionRadius,this.computeData[3]=D,this.computeData[4]=n.input.worldX,this.computeData[5]=n.input.worldY,a.queue.writeBuffer(s.uniformBuffers.compute,0,this.computeData);const l=a.createCommandEncoder(),G=l.beginComputePass();if(G.setPipeline(s.externalForces),G.setBindGroup(0,s.externalForcesBindGroup),G.dispatchWorkgroups(Math.ceil(r.particleCount/this.workgroupSize)),G.end(),(!t.useGpuDensity||t.useCpuSpatialDataForGpuDensity)&&(this.physics.predictPositions(),this.physics.runSpatialHash()),t.useGpuDensity){t.useCpuSpatialDataForGpuDensity?(a.queue.writeBuffer(r.predicted,0,n.predicted),a.queue.writeBuffer(r.sortedKeys,0,n.sortedKeys),a.queue.writeBuffer(r.spatialOffsets,0,n.spatialOffsets)):t.useGpuSpatialHash&&this.dispatchSpatialHash(l),this.updateDensityUniforms();const f=l.beginComputePass();f.setPipeline(s.density),f.setBindGroup(0,s.densityBindGroup),f.dispatchWorkgroups(Math.ceil(r.particleCount/this.workgroupSize)),f.end(),t.useGpuDensityReadback&&(l.copyBufferToBuffer(r.densities,0,r.densityReadback,0,r.particleCount*2*4),B=!0)}else this.physics.calculateDensities(),t.useGpuPressure&&a.queue.writeBuffer(r.densities,0,n.densities);if(t.useGpuPressure){this.updatePressureUniforms(y);const f=l.beginComputePass();f.setPipeline(s.pressure),f.setBindGroup(0,s.pressureBindGroup),f.dispatchWorkgroups(Math.ceil(r.particleCount/this.workgroupSize)),f.end()}else this.physics.calculatePressure(y);if(t.useGpuViscosity){this.updateViscosityUniforms(y);const f=l.beginComputePass();f.setPipeline(s.viscosity),f.setBindGroup(0,s.viscosityBindGroup),f.dispatchWorkgroups(Math.ceil(r.particleCount/this.workgroupSize)),f.end()}else this.physics.calculateViscosity(y);this.updateIntegrateUniforms(y,h,g,d);const U=l.beginComputePass();if(U.setPipeline(s.integrate),U.setBindGroup(0,s.integrateBindGroup),U.dispatchWorkgroups(Math.ceil(r.particleCount/this.workgroupSize)),U.end(),a.queue.submit([l.finish()]),B){await r.densityReadback.mapAsync(GPUMapMode.READ);const f=new Float32Array(r.densityReadback.getMappedRange());n.densities.set(f),r.densityReadback.unmap()}}}else this.physics.step(e);t.useGpuExternalForces||(a.queue.writeBuffer(r.positions,0,n.positions),a.queue.writeBuffer(r.velocities,0,n.velocities),a.queue.writeBuffer(r.predicted,0,n.predicted))}dispatchSpatialHash(e){const{pipelines:t,buffers:i}=this,n=Math.ceil(i.particleCount/this.workgroupSize);this.hashParamsData[0]=this.config.smoothingRadius,this.hashParamsData[1]=i.particleCount,this.device.queue.writeBuffer(t.uniformBuffers.hash,0,this.hashParamsData),this.sortParamsData[0]=i.particleCount,this.device.queue.writeBuffer(t.uniformBuffers.sort,0,this.sortParamsData);const r=e.beginComputePass();r.setPipeline(t.hash),r.setBindGroup(0,t.hashBindGroup),r.dispatchWorkgroups(n),r.end();const s=e.beginComputePass();s.setPipeline(t.clearOffsets),s.setBindGroup(0,t.clearOffsetsBindGroup),s.dispatchWorkgroups(n),s.end();const a=e.beginComputePass();a.setPipeline(t.countOffsets),a.setBindGroup(1,t.countOffsetsBindGroup),a.dispatchWorkgroups(n),a.end();const o=e.beginComputePass();o.setPipeline(t.scatter),o.setBindGroup(0,t.scatterBindGroup),o.dispatchWorkgroups(1),o.end();const c=e.beginComputePass();c.setPipeline(t.spatialOffsets),c.setBindGroup(0,t.spatialOffsetsBindGroup),c.dispatchWorkgroups(1),c.end()}updateDensityUniforms(){const e=this.config.smoothingRadius,t=6/(Math.PI*Math.pow(e,4)),i=10/(Math.PI*Math.pow(e,5));this.densityParamsData[0]=e,this.densityParamsData[1]=t,this.densityParamsData[2]=i,this.densityParamsData[3]=this.buffers.particleCount,this.device.queue.writeBuffer(this.pipelines.uniformBuffers.density,0,this.densityParamsData)}updatePressureUniforms(e){const t=this.config.smoothingRadius,i=12/(Math.PI*Math.pow(t,4)),n=30/(Math.PI*Math.pow(t,5));this.pressureParamsData[0]=e,this.pressureParamsData[1]=this.config.targetDensity,this.pressureParamsData[2]=this.config.pressureMultiplier,this.pressureParamsData[3]=this.config.nearPressureMultiplier,this.pressureParamsData[4]=t,this.pressureParamsData[5]=i,this.pressureParamsData[6]=n,this.pressureParamsData[7]=this.buffers.particleCount,this.device.queue.writeBuffer(this.pipelines.uniformBuffers.pressure,0,this.pressureParamsData)}updateViscosityUniforms(e){const t=this.config.smoothingRadius,i=4/(Math.PI*Math.pow(t,8));this.viscosityParamsData[0]=e,this.viscosityParamsData[1]=this.config.viscosityStrength,this.viscosityParamsData[2]=t,this.viscosityParamsData[3]=i,this.viscosityParamsData[4]=this.buffers.particleCount,this.device.queue.writeBuffer(this.pipelines.uniformBuffers.viscosity,0,this.viscosityParamsData)}updateIntegrateUniforms(e,t,i,n){this.integrateParamsData[0]=e,this.integrateParamsData[1]=this.config.collisionDamping,this.integrateParamsData[2]=n?1:0,this.integrateParamsData[3]=0,this.integrateParamsData[4]=t,this.integrateParamsData[5]=i,this.integrateParamsData[6]=0,this.integrateParamsData[7]=0,this.integrateParamsData[8]=this.config.obstacleCentre.x,this.integrateParamsData[9]=this.config.obstacleCentre.y,this.integrateParamsData[10]=this.config.obstacleSize.x*.5,this.integrateParamsData[11]=this.config.obstacleSize.y*.5,this.device.queue.writeBuffer(this.pipelines.uniformBuffers.integrate,0,this.integrateParamsData)}render(){this.renderer.updateUniforms(this.config,this.canvas.width,this.canvas.height);const e=this.device.createCommandEncoder();this.renderer.render(e,this.context,this.config,this.buffers.particleCount),this.device.queue.submit([e.finish()])}}class O extends Error{constructor(e){super(e),this.name="WebGPUInitError"}}async function ee(u){if(!navigator.gpu)throw new O("WebGPU is not supported in this browser.");const e=await navigator.gpu.requestAdapter();if(!e)throw new O("Unable to acquire a WebGPU adapter.");const t=await e.requestDevice(),i=u.getContext("webgpu");if(!i)throw new O("Unable to create a WebGPU context.");const n=navigator.gpu.getPreferredCanvasFormat();return{device:t,context:i,format:n}}function te(u,e,t){u.configure({device:e,format:t,alphaMode:"opaque"})}function ie(u){u.innerHTML='<canvas id="sim-canvas" aria-label="Fluid simulation"></canvas>';const e=document.querySelector("#sim-canvas");if(!e)throw new Error("Failed to create canvas element");return e}function ne(u,e,t,i){const n=u.getBoundingClientRect(),r=window.devicePixelRatio||1,s=(e-n.left)*r,a=(t-n.top)*r,o=u.width*.5,c=u.height*.5;return{x:(s-o)/i,y:(c-a)/i}}function re(u,e,t){const i=n=>{const r=e();if(!r)return;const s=ne(u,n.clientX,n.clientY,t());r.worldX=s.x,r.worldY=s.y,n.cancelable&&n.preventDefault()};u.addEventListener("pointermove",i),u.addEventListener("pointerdown",n=>{const r=e();r&&(n.cancelable&&n.preventDefault(),i(n),n.button===0&&(r.pull=!0),n.button===2&&(r.push=!0))}),u.addEventListener("pointerup",n=>{const r=e();r&&(n.button===0&&(r.pull=!1),n.button===2&&(r.push=!1))}),u.addEventListener("pointerleave",()=>{const n=e();n&&(n.pull=!1,n.push=!1)}),u.addEventListener("contextmenu",n=>{n.preventDefault()})}function se(u,e,t,i,n){let r=null;const s=()=>{const a=u.getBoundingClientRect();r===null&&(r=e.boundsSize.x/Math.max(1,a.width));const o=window.devicePixelRatio||1,c=Math.max(1,Math.round(a.width*o)),y=Math.max(1,Math.round(a.height*o));(u.width!==c||u.height!==y)&&(u.width=c,u.height=y,e.boundsSize={x:u.width/o*r,y:u.height/o*r},te(t,i,n))};return window.addEventListener("resize",s),s}const _=document.querySelector("#app");if(!_)throw new Error("Missing #app container");const S=ie(_),w=T();let b=null,k;const P={paused:!1,togglePause:()=>{P.paused=!P.paused,k&&k.name(P.paused?"Resume":"Pause")},reset:()=>b?.reset()},{stats:C,gui:Y}=A(w,{onReset:()=>b?.reset(),onSmoothingRadiusChange:()=>b?.refreshSettings()},{trackGPU:!0,title:"WebGPU 2D Fluid",subtitle:"SPH Fluid • Particle Simulation",features:["SPH Fluid Simulator (GPU)","WebGPU Compute Pipelines","Bitonic Sort Optimization","Spatial Grid Optimization","High-Performance Rendering"],interactions:["Click & Drag: Pull Particles","Right Click & Drag: Push Particles","Mouse Wheel: Zoom In/Out"],githubUrl:"https://github.com/jeantimex/fluid"});k=Y.add(P,"togglePause").name(P.paused?"Resume":"Pause");Y.add(P,"reset").name("Reset Simulation");async function ae(){let u,e,t;try{({device:u,context:e,format:t}=await ee(S))}catch(a){if(a instanceof O){_.innerHTML=`<p>${a.message}</p>`;return}throw a}b=new Q(u,e,S,w,t),re(S,()=>b?.simulationState.input,()=>S.width/w.boundsSize.x),se(S,w,e,u,t)();let r=performance.now();const s=async a=>{C.begin();const o=Math.min(.033,(a-r)/1e3);r=a,P.paused||await b.step(o),b.render(),C.end(),C.update(),requestAnimationFrame(s)};requestAnimationFrame(s)}ae();
