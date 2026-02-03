/**
 * ============================================================================
 * SDF GENERATOR (Mesh Voxelizer)
 * ============================================================================
 * 
 * Computes a Signed Distance Field (SDF) from a triangle mesh.
 * 
 * Algorithm:
 * For each voxel in the 3D grid:
 *   1. Calculate voxel center position in model space.
 *   2. Iterate over all triangles in the mesh.
 *   3. Find the closest point on the triangle to the voxel center.
 *   4. Compute distance squared.
 *   5. Store the minimum distance found.
 * 
 * Note: This implementation computes an UNSIGNED distance field (always positive).
 * True inside/outside determination (Sign) requires winding number or ray parity 
 * checks, which are more complex. For collision, we assume the mesh is a thin 
 * shell or simply rely on the gradient to push particles out.
 */

struct Params {
  gridRes: vec3<u32>,
  triangleCount: u32,
  minBounds: vec3<f32>,
  pad0: f32,
  maxBounds: vec3<f32>,
  pad1: f32,
};

@group(0) @binding(0) var<storage, read> indices: array<u32>;
@group(0) @binding(1) var<storage, read> positions: array<f32>; // Flat float array [x,y,z, x,y,z...]
@group(0) @binding(2) var sdfTexture: texture_storage_3d<r32float, write>;
@group(0) @binding(3) var<uniform> params: Params;

// Helper: Get vertex position from flat array
fn getVertex(index: u32) -> vec3<f32> {
  let i = index * 3u;
  return vec3<f32>(positions[i], positions[i+1u], positions[i+2u]);
}

// Helper: Distance from point P to Triangle ABC
fn distSqPointTriangle(p: vec3<f32>, a: vec3<f32>, b: vec3<f32>, c: vec3<f32>) -> f32 {
  let ab = b - a;
  let ac = c - a;
  let ap = p - a;
  
  let d1 = dot(ab, ap);
  let d2 = dot(ac, ap);
  
  if (d1 <= 0.0 && d2 <= 0.0) { return dot(ap, ap); } // Vertex A
  
  let bp = p - b;
  let d3 = dot(ab, bp);
  let d4 = dot(ac, bp);
  
  if (d3 >= 0.0 && d4 <= d3) { return dot(bp, bp); } // Vertex B
  
  let vc = d1*d4 - d3*d2;
  if (vc <= 0.0 && d1 >= 0.0 && d3 <= 0.0) {
    let v = d1 / (d1 - d3);
    return dot(ap - v * ab, ap - v * ab); // Edge AB
  }
  
  let cp = p - c;
  let d5 = dot(ab, cp);
  let d6 = dot(ac, cp);
  
  if (d6 >= 0.0 && d5 <= d6) { return dot(cp, cp); } // Vertex C
  
  let vb = d5*d2 - d1*d6;
  if (vb <= 0.0 && d2 >= 0.0 && d6 <= 0.0) {
    let w = d2 / (d2 - d6);
    return dot(ap - w * ac, ap - w * ac); // Edge AC
  }
  
  let va = d3*d6 - d5*d4;
  if (va <= 0.0 && (d4 - d3) >= 0.0 && (d5 - d6) >= 0.0) {
    let w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    return dot(bp - w * (c - b), bp - w * (c - b)); // Edge BC
  }
  
  let denom = 1.0 / (va + vb + vc);
  let v = vb * denom;
  let w = vc * denom;
  return dot(ap - (a + v * ab + w * ac), ap - (a + v * ab + w * ac)); // Face
}

@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (any(id >= params.gridRes)) { return; }

  // Convert grid index to world position
  let uvw = (vec3<f32>(id) + 0.5) / vec3<f32>(params.gridRes);
  let size = params.maxBounds - params.minBounds;
  let pos = params.minBounds + uvw * size;

  var minDistSq = 1e10;

  // Brute force check all triangles
  // For 64^3 voxels * 2000 tris -> 500M checks. GPU can handle this easily.
  let triCount = params.triangleCount;
  for (var i = 0u; i < triCount; i = i + 1u) {
    let idx0 = indices[i * 3u];
    let idx1 = indices[i * 3u + 1u];
    let idx2 = indices[i * 3u + 2u];

    let v0 = getVertex(idx0);
    let v1 = getVertex(idx1);
    let v2 = getVertex(idx2);

    let dSq = distSqPointTriangle(pos, v0, v1, v2);
    minDistSq = min(minDistSq, dSq);
  }

  // Store signed distance
  // Since we don't calculate sign, we assume "outside" is positive.
  // We can treat collision as: if dist < radius, collision.
  // But wait, particles need to know if they are DEEP inside.
  // A simple unsigned distance is okay if we treat the mesh as a "shell".
  // Particles hitting the shell get pushed out.
  
  // Storing simple distance.
  let dist = sqrt(minDistSq);
  textureStore(sdfTexture, id, vec4<f32>(dist, 0.0, 0.0, 0.0));
}
