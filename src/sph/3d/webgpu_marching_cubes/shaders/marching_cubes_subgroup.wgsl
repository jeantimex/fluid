/**
 * Marching Cubes Compute Shader - Subgroup Optimized
 *
 * This version uses subgroup operations to reduce atomic contention.
 * Instead of every thread doing atomicAdd for triangle allocation,
 * threads within a subgroup coordinate:
 *   1. Each thread calculates its triangle count
 *   2. subgroupExclusiveAdd gives local offset within subgroup
 *   3. Only the last lane does the global atomicAdd for the whole subgroup
 *   4. subgroupBroadcast shares the base offset with all lanes
 *
 * This significantly reduces atomic contention when many voxels emit triangles.
 */

enable subgroups;

struct Params {
  densityAndMax: vec4<u32>, // xyz = densityMapSize, w = maxTriangles
  isoLevel: f32,
  vpuX: f32,
  vpuY: f32,
  vpuZ: f32,
  minBounds: vec3<f32>,
  pad3: f32,
  maxBounds: vec3<f32>,
  pad4: f32,
};

struct Vertex {
  position: vec3<f32>,
  normal: vec3<f32>,
};

@group(0) @binding(0) var densityTex: texture_3d<f32>;
@group(0) @binding(1) var densitySampler: sampler;
@group(0) @binding(2) var<uniform> params: Params;
@group(0) @binding(3) var<storage, read_write> vertices: array<Vertex>;
@group(0) @binding(4) var<storage, read_write> triangleCount: atomic<u32>;
@group(0) @binding(5) var<storage, read> lut: array<u32>;
@group(0) @binding(6) var<storage, read> offsets: array<u32>;
@group(0) @binding(7) var<storage, read> lengths: array<u32>;
@group(0) @binding(8) var<storage, read> edgeA: array<u32>;
@group(0) @binding(9) var<storage, read> edgeB: array<u32>;

fn coordToWorld(coord: vec3<i32>) -> vec3<f32> {
  let worldToVoxel = vec3<f32>(params.vpuX, params.vpuY, params.vpuZ);
  return params.minBounds + vec3<f32>(coord) / worldToVoxel;
}

fn sampleDensity(coord: vec3<i32>) -> f32 {
  let volumeSizeF = vec3<f32>(params.densityAndMax.xyz);
  let maxCoord = vec3<i32>(params.densityAndMax.xyz) - vec3<i32>(1);
  let isEdge = coord.x <= 0 || coord.y <= 0 || coord.z <= 0 ||
    coord.x >= maxCoord.x || coord.y >= maxCoord.y || coord.z >= maxCoord.z;
  if (isEdge) {
    return params.isoLevel;
  }
  let uvw = vec3<f32>(coord) / (volumeSizeF - vec3<f32>(1.0));
  return textureSampleLevel(densityTex, densitySampler, uvw, 0.0).r;
}

fn calculateNormal(coord: vec3<i32>) -> vec3<f32> {
  let dx = sampleDensity(coord + vec3<i32>(1, 0, 0)) - sampleDensity(coord - vec3<i32>(1, 0, 0));
  let dy = sampleDensity(coord + vec3<i32>(0, 1, 0)) - sampleDensity(coord - vec3<i32>(0, 1, 0));
  let dz = sampleDensity(coord + vec3<i32>(0, 0, 1)) - sampleDensity(coord - vec3<i32>(0, 0, 1));
  let worldToVoxel = vec3<f32>(params.vpuX, params.vpuY, params.vpuZ);
  return normalize(-vec3<f32>(dx * worldToVoxel.x, dy * worldToVoxel.y, dz * worldToVoxel.z));
}

fn createVertex(coordA: vec3<i32>, coordB: vec3<i32>) -> Vertex {
  let posA = coordToWorld(coordA);
  let posB = coordToWorld(coordB);
  let densityA = sampleDensity(coordA);
  let densityB = sampleDensity(coordB);
  let denom = densityB - densityA;
  let t = select(0.5, (params.isoLevel - densityA) / denom, abs(denom) > 1e-6);
  let position = posA + t * (posB - posA);

  let normalA = calculateNormal(coordA);
  let normalB = calculateNormal(coordB);
  let normal = normalize(normalA + t * (normalB - normalA));

  var vertex: Vertex;
  vertex.position = position;
  vertex.normal = normal;
  return vertex;
}

@compute @workgroup_size(8, 8, 4)
fn main(
  @builtin(global_invocation_id) id: vec3<u32>,
  @builtin(subgroup_size) sg_size: u32,
  @builtin(subgroup_invocation_id) sg_lane: u32
) {
  let numCubes = params.densityAndMax.xyz - vec3<u32>(1u);
  let outOfBounds = id.x >= numCubes.x || id.y >= numCubes.y || id.z >= numCubes.z;

  // Even out-of-bounds threads must participate in subgroup operations
  var myTriangles: u32 = 0u;
  var cubeConfig: u32 = 0u;
  var cornerCoords: array<vec3<i32>, 8>;

  if (!outOfBounds) {
    let coord = vec3<i32>(id);
    cornerCoords[0] = coord + vec3<i32>(0, 0, 0);
    cornerCoords[1] = coord + vec3<i32>(1, 0, 0);
    cornerCoords[2] = coord + vec3<i32>(1, 0, 1);
    cornerCoords[3] = coord + vec3<i32>(0, 0, 1);
    cornerCoords[4] = coord + vec3<i32>(0, 1, 0);
    cornerCoords[5] = coord + vec3<i32>(1, 1, 0);
    cornerCoords[6] = coord + vec3<i32>(1, 1, 1);
    cornerCoords[7] = coord + vec3<i32>(0, 1, 1);

    for (var i: u32 = 0u; i < 8u; i = i + 1u) {
      if (sampleDensity(cornerCoords[i]) > params.isoLevel) {
        cubeConfig = cubeConfig | (1u << i);
      }
    }

    let numIndices = lengths[cubeConfig];
    myTriangles = numIndices / 3u;
  }

  // =========================================================================
  // SUBGROUP TRIANGLE ALLOCATION
  // =========================================================================
  // Instead of each thread doing atomicAdd, we use subgroup operations:
  // 1. Get exclusive prefix sum of triangle counts within subgroup
  // 2. Get total triangles for entire subgroup
  // 3. Only lane 0 does the global atomicAdd
  // 4. Broadcast result to all lanes using subgroupBroadcastFirst

  // Get my offset within the subgroup
  let localOffset = subgroupExclusiveAdd(myTriangles);

  // Get total triangles for this subgroup
  let subgroupTotal = subgroupAdd(myTriangles);

  // Lane 0 does the global atomic allocation
  var subgroupBase: u32 = 0u;
  if (sg_lane == 0u) {
    if (subgroupTotal > 0u) {
      subgroupBase = atomicAdd(&triangleCount, subgroupTotal);
    }
  }

  // Broadcast the base index from lane 0 to all lanes
  subgroupBase = subgroupBroadcastFirst(subgroupBase);

  // Now each thread knows its global base: subgroupBase + localOffset
  let baseTri = subgroupBase + localOffset;

  // Early exit if we have no triangles or exceeded capacity
  if (myTriangles == 0u) {
    return;
  }

  if (baseTri >= params.densityAndMax.w) {
    return;
  }

  let available = params.densityAndMax.w - baseTri;
  let clampedTriangles = min(myTriangles, available);
  let maxIndices = clampedTriangles * 3u;

  let offset = offsets[cubeConfig];
  var i: u32 = 0u;
  loop {
    if (i >= maxIndices) { break; }
    let v0 = lut[offset + i];
    let v1 = lut[offset + i + 1u];
    let v2 = lut[offset + i + 2u];

    let a0 = edgeA[v0];
    let b0 = edgeB[v0];
    let a1 = edgeA[v1];
    let b1 = edgeB[v1];
    let a2 = edgeA[v2];
    let b2 = edgeB[v2];

    let vertexA = createVertex(cornerCoords[a0], cornerCoords[b0]);
    let vertexB = createVertex(cornerCoords[a1], cornerCoords[b1]);
    let vertexC = createVertex(cornerCoords[a2], cornerCoords[b2]);

    let baseVertex = (baseTri * 3u) + i;
    vertices[baseVertex + 0u] = vertexC;
    vertices[baseVertex + 1u] = vertexB;
    vertices[baseVertex + 2u] = vertexA;

    i = i + 3u;
  }
}
