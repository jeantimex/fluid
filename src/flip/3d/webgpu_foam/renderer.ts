/**
 * Generates an icosphere mesh by recursively subdividing an icosahedron.
 *
 * Why this mesh:
 * - Uniform-ish triangle distribution gives stable normal shading.
 * - Adjustable `iterations` allows quality/perf tradeoff per render pass.
 *   (This project uses a denser sphere for G-buffer and a cheaper one for AO.)
 */
export function generateSphereGeometry(iterations: number) {
  let vertices: number[][] = [];

  const addVertex = (v: number[]) => {
    // Project each generated vertex onto the unit sphere.
    const mag = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
    const normalized = [v[0] / mag, v[1] / mag, v[2] / mag];
    vertices.push(normalized);
  };

  const getMiddlePoint = (p1: number, p2: number) => {
    // Midpoint in Euclidean space, then normalized by addVertex.
    const v1 = vertices[p1];
    const v2 = vertices[p2];
    const middle = [
      (v1[0] + v2[0]) / 2.0,
      (v1[1] + v2[1]) / 2.0,
      (v1[2] + v2[2]) / 2.0,
    ];
    addVertex(middle);
    return vertices.length - 1;
  };

  const t = (1.0 + Math.sqrt(5.0)) / 2.0;

  // Initial icosahedron vertices
  addVertex([-1, t, 0]);
  addVertex([1, t, 0]);
  addVertex([-1, -t, 0]);
  addVertex([1, -t, 0]);
  addVertex([0, -1, t]);
  addVertex([0, 1, t]);
  addVertex([0, -1, -t]);
  addVertex([0, 1, -t]);
  addVertex([t, 0, -1]);
  addVertex([t, 0, 1]);
  addVertex([-t, 0, -1]);
  addVertex([-t, 0, 1]);

  let faces = [
    [0, 11, 5],
    [0, 5, 1],
    [0, 1, 7],
    [0, 7, 10],
    [0, 10, 11],
    [1, 5, 9],
    [5, 11, 4],
    [11, 10, 2],
    [10, 7, 6],
    [7, 1, 8],
    [3, 9, 4],
    [3, 4, 2],
    [3, 2, 6],
    [3, 6, 8],
    [3, 8, 9],
    [4, 9, 5],
    [2, 4, 11],
    [6, 2, 10],
    [8, 6, 7],
    [9, 8, 1],
  ];

  for (let i = 0; i < iterations; i++) {
    // Split each triangle into four triangles.
    const faces2: number[][] = [];
    for (const face of faces) {
      const a = getMiddlePoint(face[0], face[1]);
      const b = getMiddlePoint(face[1], face[2]);
      const c = getMiddlePoint(face[2], face[0]);
      faces2.push([face[0], a, c]);
      faces2.push([face[1], b, a]);
      faces2.push([face[2], c, b]);
      faces2.push([a, b, c]);
    }
    faces = faces2;
  }

  const packedVertices = new Float32Array(vertices.length * 3);
  const packedNormals = new Float32Array(vertices.length * 3);
  for (let i = 0; i < vertices.length; i++) {
    // For a unit sphere centered at origin, position == normal.
    packedVertices[i * 3 + 0] = vertices[i][0];
    packedVertices[i * 3 + 1] = vertices[i][1];
    packedVertices[i * 3 + 2] = vertices[i][2];
    packedNormals[i * 3 + 0] = vertices[i][0];
    packedNormals[i * 3 + 1] = vertices[i][1];
    packedNormals[i * 3 + 2] = vertices[i][2];
  }

  const indices = new Uint16Array(faces.length * 3);
  for (let i = 0; i < faces.length; i++) {
    indices[i * 3 + 0] = faces[i][0];
    indices[i * 3 + 1] = faces[i][1];
    indices[i * 3 + 2] = faces[i][2];
  }

  return { vertices: packedVertices, normals: packedNormals, indices };
}
