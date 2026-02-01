struct Params {
  densityAndMax: vec4<u32>, // xyz = densityMapSize, w = maxTriangles
  isoLevel: f32,
  pad0: u32,
  pad1: u32,
  pad2: u32,
  scale: vec3<f32>,
  pad3: u32,
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
  let denom = vec3<f32>(params.densityAndMax.xyz) - vec3<f32>(1.0);
  return vec3<f32>(coord) / denom - vec3<f32>(0.5);
}

fn sampleDensity(coord: vec3<i32>) -> f32 {
  let maxCoord = vec3<i32>(params.densityAndMax.xyz) - vec3<i32>(1);
  let isEdge = coord.x <= 0 || coord.y <= 0 || coord.z <= 0 ||
    coord.x >= maxCoord.x || coord.y >= maxCoord.y || coord.z >= maxCoord.z;
  if (isEdge) {
    return params.isoLevel;
  }
  let uvw = vec3<f32>(coord) / (vec3<f32>(params.densityAndMax.xyz) - vec3<f32>(1.0));
  return textureSampleLevel(densityTex, densitySampler, uvw, 0.0).r;
}

fn calculateNormal(coord: vec3<i32>) -> vec3<f32> {
  let dx = sampleDensity(coord + vec3<i32>(1, 0, 0)) - sampleDensity(coord - vec3<i32>(1, 0, 0));
  let dy = sampleDensity(coord + vec3<i32>(0, 1, 0)) - sampleDensity(coord - vec3<i32>(0, 1, 0));
  let dz = sampleDensity(coord + vec3<i32>(0, 0, 1)) - sampleDensity(coord - vec3<i32>(0, 0, 1));
  return normalize(-vec3<f32>(dx, dy, dz));
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
  vertex.position = position * params.scale;
  vertex.normal = normal;
  return vertex;
}

@compute @workgroup_size(8, 8, 4)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let numCubes = params.densityAndMax.xyz - vec3<u32>(1u);
  if (id.x >= numCubes.x || id.y >= numCubes.y || id.z >= numCubes.z) {
    return;
  }

  let coord = vec3<i32>(id);
  var cornerCoords: array<vec3<i32>, 8>;
  cornerCoords[0] = coord + vec3<i32>(0, 0, 0);
  cornerCoords[1] = coord + vec3<i32>(1, 0, 0);
  cornerCoords[2] = coord + vec3<i32>(1, 0, 1);
  cornerCoords[3] = coord + vec3<i32>(0, 0, 1);
  cornerCoords[4] = coord + vec3<i32>(0, 1, 0);
  cornerCoords[5] = coord + vec3<i32>(1, 1, 0);
  cornerCoords[6] = coord + vec3<i32>(1, 1, 1);
  cornerCoords[7] = coord + vec3<i32>(0, 1, 1);

  var cubeConfig: u32 = 0u;
  for (var i: u32 = 0u; i < 8u; i = i + 1u) {
    if (sampleDensity(cornerCoords[i]) > params.isoLevel) {
      cubeConfig = cubeConfig | (1u << i);
    }
  }

  let numIndices = lengths[cubeConfig];
  if (numIndices == 0u) {
    return;
  }

  let numTriangles = numIndices / 3u;
  let baseTri = atomicAdd(&triangleCount, numTriangles);
  if (baseTri >= params.densityAndMax.w) {
    return;
  }
  let available = params.densityAndMax.w - baseTri;
  let clampedTriangles = min(numTriangles, available);
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
