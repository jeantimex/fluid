import { Scene } from '../canvas2d/types';

const particleShaderWGSL = `
  struct Uniforms {
    domainSize: vec2f,
    pointSize: f32,
    drawDisk: f32,
  }

  @group(0) @binding(0) var<uniform> uniforms: Uniforms;

  struct VertexInput {
    @builtin(vertex_index) vertexIndex: u32,
    @builtin(instance_index) instanceIndex: u32,
    @location(0) position: vec2f,
    @location(1) color: vec3f,
  }

  struct VertexOutput {
    @builtin(position) pos: vec4f,
    @location(0) fragColor: vec3f,
    @location(1) uv: vec2f,
  }

  @vertex
  fn vs_main(input: VertexInput) -> VertexOutput {
    let pos = array<vec2f, 4>(
      vec2f(-1.0, -1.0), vec2f(1.0, -1.0),
      vec2f(-1.0,  1.0), vec2f(1.0,  1.0)
    );
    
    let uv = pos[input.vertexIndex];
    let worldPos = input.position + uv * (uniforms.pointSize * 0.5);
    
    // Transform to clip space [-1, 1]
    let clipX = (worldPos.x * (2.0 / uniforms.domainSize.x)) - 1.0;
    let clipY = (worldPos.y * (2.0 / uniforms.domainSize.y)) - 1.0;
    
    var output: VertexOutput;
    output.pos = vec4f(clipX, clipY, 0.0, 1.0);
    output.fragColor = input.color;
    output.uv = uv;
    return output;
  }

  @fragment
  fn fs_main(input: VertexOutput) -> @location(0) vec4f {
    if (uniforms.drawDisk > 0.5) {
      let r2 = dot(input.uv, input.uv);
      if (r2 > 1.0) {
        discard;
      }
    }
    return vec4f(input.fragColor, 1.0);
  }
`;

const meshShaderWGSL = `
  struct MeshUniforms {
    domainSize: vec2f,
    color: vec3f,
    translation: vec2f,
    scale: f32,
  }

  @group(0) @binding(0) var<uniform> uniforms: MeshUniforms;

  struct VertexInput {
    @builtin(vertex_index) vertexIndex: u32,
  }

  struct VertexOutput {
    @builtin(position) pos: vec4f,
  }

  @vertex
  fn vs_main(input: VertexInput) -> VertexOutput {
    let numSegs: u32 = 50u;
    var pos: vec2f;
    
    if (input.vertexIndex % 3u == 0u) {
      pos = vec2f(0.0, 0.0);
    } else {
      let i = f32(input.vertexIndex / 3u) + f32(input.vertexIndex % 3u - 1u);
      let angle = i * (2.0 * 3.14159265 / f32(numSegs));
      pos = vec2f(cos(angle), sin(angle));
    }

    let worldPos = uniforms.translation + pos * uniforms.scale;
    let clipX = (worldPos.x * (2.0 / uniforms.domainSize.x)) - 1.0;
    let clipY = (worldPos.y * (2.0 / uniforms.domainSize.y)) - 1.0;

    var output: VertexOutput;
    output.pos = vec4f(clipX, clipY, 0.0, 1.0);
    return output;
  }

  @fragment
  fn fs_main() -> @location(0) vec4f {
    return vec4f(uniforms.color, 1.0);
  }
`;

const boundaryCollisionShaderWGSL = `
  struct BoundaryUniforms {
    domainSize: vec2f,
    particleRadius: f32,
    numParticles: f32,
    obstaclePos: vec2f,
    obstacleRadius: f32,
    _pad0: f32,
    obstacleVel: vec2f,
    minX: f32,
    maxX: f32,
    minY: f32,
    maxY: f32,
    _pad1: vec2f,
  }

  @group(0) @binding(0) var<uniform> uniforms: BoundaryUniforms;
  @group(0) @binding(1) var<storage, read_write> positions: array<vec2f>;
  @group(0) @binding(2) var<storage, read_write> velocities: array<vec2f>;

  @compute @workgroup_size(64)
  fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i >= u32(uniforms.numParticles)) {
      return;
    }

    var p = positions[i];
    var v = velocities[i];

    if (uniforms.obstacleRadius > 0.0) {
      let dx = p.x - uniforms.obstaclePos.x;
      let dy = p.y - uniforms.obstaclePos.y;
      let d2 = dx * dx + dy * dy;
      let minDist = uniforms.obstacleRadius + uniforms.particleRadius;
      let minDist2 = minDist * minDist;

      if (d2 < minDist2 && d2 > 1e-12) {
        let d = sqrt(d2);
        let s = (minDist - d) / d;
        p.x = p.x + dx * s;
        p.y = p.y + dy * s;
        v = uniforms.obstacleVel;
      }
    }

    if (p.x < uniforms.minX) { p.x = uniforms.minX; v.x = 0.0; }
    if (p.x > uniforms.maxX) { p.x = uniforms.maxX; v.x = 0.0; }
    if (p.y < uniforms.minY) { p.y = uniforms.minY; v.y = 0.0; }
    if (p.y > uniforms.maxY) { p.y = uniforms.maxY; v.y = 0.0; }

    positions[i] = p;
    velocities[i] = v;
  }
`;

const integrateParticlesShaderWGSL = `
  struct IntegrateUniforms {
    dt: f32,
    gravity: f32,
    numParticles: f32,
    _pad0: f32,
  }

  @group(0) @binding(0) var<uniform> uniforms: IntegrateUniforms;
  @group(0) @binding(1) var<storage, read_write> positions: array<vec2f>;
  @group(0) @binding(2) var<storage, read_write> velocities: array<vec2f>;

  @compute @workgroup_size(64)
  fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i >= u32(uniforms.numParticles)) {
      return;
    }

    var v = velocities[i];
    var p = positions[i];
    v.y = v.y + uniforms.dt * uniforms.gravity;
    p = p + v * uniforms.dt;
    velocities[i] = v;
    positions[i] = p;
  }
`;

const particleColorFadeShaderWGSL = `
  struct ColorFadeUniforms {
    numParticles: f32,
    step: f32,
    _pad0: vec2f,
  }

  @group(0) @binding(0) var<uniform> uniforms: ColorFadeUniforms;
  @group(0) @binding(1) var<storage, read_write> colors: array<f32>;

  @compute @workgroup_size(64)
  fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i >= u32(uniforms.numParticles)) {
      return;
    }
    let base = i * 3u;
    colors[base] = clamp(colors[base] - uniforms.step, 0.0, 1.0);
    colors[base + 1u] = clamp(colors[base + 1u] - uniforms.step, 0.0, 1.0);
    colors[base + 2u] = clamp(colors[base + 2u] + uniforms.step, 0.0, 1.0);
  }
`;

const particleSurfaceTintShaderWGSL = `
  struct SurfaceTintUniforms {
    numParticles: f32,
    invCellSize: f32,
    restDensity: f32,
    threshold: f32,
    bright: f32,
    numX: f32,
    numY: f32,
    _pad0: f32,
  }

  @group(0) @binding(0) var<uniform> uniforms: SurfaceTintUniforms;
  @group(0) @binding(1) var<storage, read_write> colors: array<f32>;
  @group(0) @binding(2) var<storage, read> positions: array<vec2f>;
  @group(0) @binding(3) var<storage, read> density: array<f32>;

  @compute @workgroup_size(64)
  fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i >= u32(uniforms.numParticles)) {
      return;
    }
    if (uniforms.restDensity <= 0.0) {
      return;
    }

    let p = positions[i];
    let xi = clamp(i32(floor(p.x * uniforms.invCellSize)), 1, i32(uniforms.numX) - 1);
    let yi = clamp(i32(floor(p.y * uniforms.invCellSize)), 1, i32(uniforms.numY) - 1);
    let cellNr = xi * i32(uniforms.numY) + yi;
    let relDensity = density[u32(cellNr)] / uniforms.restDensity;

    if (relDensity < uniforms.threshold) {
      let base = i * 3u;
      colors[base] = uniforms.bright;
      colors[base + 1u] = uniforms.bright;
      colors[base + 2u] = 1.0;
    }
  }
`;

const particleSeparationShaderWGSL = `
  struct SeparationUniforms {
    numParticles: f32,
    invSpacing: f32,
    gridNumX: f32,
    gridNumY: f32,
    minDist: f32,
    minDist2: f32,
    _unused: f32,
    _pad0: f32,
  }

  @group(0) @binding(0) var<uniform> uniforms: SeparationUniforms;
  @group(0) @binding(1) var<storage, read> positionsIn: array<vec2f>;
  @group(0) @binding(2) var<storage, read_write> positionsOut: array<vec2f>;
  @group(0) @binding(3) var<storage, read> firstCellParticle: array<u32>;
  @group(0) @binding(4) var<storage, read> cellParticleIds: array<u32>;

  @compute @workgroup_size(64)
  fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i >= u32(uniforms.numParticles)) {
      return;
    }

    var p = positionsIn[i];
    let pxi = i32(floor(p.x * uniforms.invSpacing));
    let pyi = i32(floor(p.y * uniforms.invSpacing));
    let x0 = max(pxi - 1, 0);
    let y0 = max(pyi - 1, 0);
    let x1 = min(pxi + 1, i32(uniforms.gridNumX) - 1);
    let y1 = min(pyi + 1, i32(uniforms.gridNumY) - 1);

    for (var xi = x0; xi <= x1; xi = xi + 1) {
      for (var yi = y0; yi <= y1; yi = yi + 1) {
        let cellNr = u32(xi * i32(uniforms.gridNumY) + yi);
        let firstIdx = firstCellParticle[cellNr];
        let lastIdx = firstCellParticle[cellNr + 1u];
        for (var j = firstIdx; j < lastIdx; j = j + 1u) {
          let id = cellParticleIds[j];
          if (id == i) {
            continue;
          }
          let q = positionsIn[id];
          let dx = q.x - p.x;
          let dy = q.y - p.y;
          let d2 = dx * dx + dy * dy;
          if (d2 > uniforms.minDist2 || d2 <= 1e-12) {
            continue;
          }
          let d = sqrt(d2);
          let correction = (0.5 * (uniforms.minDist - d)) / d;
          p.x = p.x - dx * correction;
          p.y = p.y - dy * correction;

        }
      }
    }

    positionsOut[i] = p;
  }
`;

const hashCountShaderWGSL = `
  struct HashCountUniforms {
    numParticles: u32,
    gridNumX: u32,
    gridNumY: u32,
    _pad0: u32,
    invSpacing: f32,
    _pad1: vec3f,
  }

  @group(0) @binding(0) var<uniform> uniforms: HashCountUniforms;
  @group(0) @binding(1) var<storage, read> positions: array<vec2f>;
  @group(0) @binding(2) var<storage, read_write> cellCounts: array<atomic<u32>>;

  @compute @workgroup_size(64)
  fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i >= uniforms.numParticles) {
      return;
    }
    let p = positions[i];
    let xi = clamp(u32(floor(p.x * uniforms.invSpacing)), 0u, uniforms.gridNumX - 1u);
    let yi = clamp(u32(floor(p.y * uniforms.invSpacing)), 0u, uniforms.gridNumY - 1u);
    let cellNr = xi * uniforms.gridNumY + yi;
    atomicAdd(&cellCounts[cellNr], 1u);
  }
`;

const hashFillShaderWGSL = `
  struct HashFillUniforms {
    numParticles: u32,
    gridNumX: u32,
    gridNumY: u32,
    _pad0: u32,
    invSpacing: f32,
    _pad1: vec3f,
  }

  @group(0) @binding(0) var<uniform> uniforms: HashFillUniforms;
  @group(0) @binding(1) var<storage, read> positions: array<vec2f>;
  @group(0) @binding(2) var<storage, read_write> cellOffsets: array<atomic<u32>>;
  @group(0) @binding(3) var<storage, read_write> cellParticleIds: array<u32>;

  @compute @workgroup_size(64)
  fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i >= uniforms.numParticles) {
      return;
    }
    let p = positions[i];
    let xi = clamp(u32(floor(p.x * uniforms.invSpacing)), 0u, uniforms.gridNumX - 1u);
    let yi = clamp(u32(floor(p.y * uniforms.invSpacing)), 0u, uniforms.gridNumY - 1u);
    let cellNr = xi * uniforms.gridNumY + yi;
    let dst = atomicAdd(&cellOffsets[cellNr], 1u);
    cellParticleIds[dst] = i;
  }
`;

const p2gCellCountShaderWGSL = `
  struct P2GUniforms {
    numParticles: u32,
    gridNumX: u32,
    gridNumY: u32,
    _pad0: u32,
    invCellSize: f32,
    cellSize: f32,
    scale: f32,
    _pad1: f32,
  }

  @group(0) @binding(0) var<uniform> uniforms: P2GUniforms;
  @group(0) @binding(1) var<storage, read> positions: array<vec2f>;
  @group(0) @binding(2) var<storage, read_write> cellCounts: array<atomic<u32>>;

  @compute @workgroup_size(64)
  fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i >= uniforms.numParticles) {
      return;
    }

    let h = uniforms.cellSize;
    let hInv = uniforms.invCellSize;
    let h2 = 0.5 * h;
    var x = positions[i].x;
    var y = positions[i].y;
    x = clamp(x, h, (f32(uniforms.gridNumX) - 1.0) * h);
    y = clamp(y, h, (f32(uniforms.gridNumY) - 1.0) * h);

    let x0f = floor((x - h2) * hInv);
    let y0f = floor((y - h2) * hInv);
    let x0 = i32(x0f);
    let y0 = i32(y0f);
    let tx = (x - h2 - f32(x0) * h) * hInv;
    let ty = (y - h2 - f32(y0) * h) * hInv;
    let x1 = min(x0 + 1, i32(uniforms.gridNumX) - 2);
    let y1 = min(y0 + 1, i32(uniforms.gridNumY) - 2);
    let sx = 1.0 - tx;
    let sy = 1.0 - ty;

    let d0 = sx * sy;
    let d1 = tx * sy;
    let d2 = tx * ty;
    let d3 = sx * ty;

    let nr0 = u32(x0) * uniforms.gridNumY + u32(y0);
    let nr1 = u32(x1) * uniforms.gridNumY + u32(y0);
    let nr2 = u32(x1) * uniforms.gridNumY + u32(y1);
    let nr3 = u32(x0) * uniforms.gridNumY + u32(y1);

    let w0 = u32(round(d0 * uniforms.scale));
    let w1 = u32(round(d1 * uniforms.scale));
    let w2 = u32(round(d2 * uniforms.scale));
    let w3 = u32(round(d3 * uniforms.scale));

    atomicAdd(&cellCounts[nr0], w0);
    atomicAdd(&cellCounts[nr1], w1);
    atomicAdd(&cellCounts[nr2], w2);
    atomicAdd(&cellCounts[nr3], w3);
  }
`;

const cellCountsToDensityShaderWGSL = `
  struct P2GUniforms {
    numParticles: u32,
    gridNumX: u32,
    gridNumY: u32,
    _pad0: u32,
    invCellSize: f32,
    cellSize: f32,
    scale: f32,
    _pad1: f32,
  }

  @group(0) @binding(0) var<uniform> uniforms: P2GUniforms;
  @group(0) @binding(1) var<storage, read_write> cellCounts: array<atomic<u32>>;
  @group(0) @binding(2) var<storage, read_write> density: array<f32>;

  @compute @workgroup_size(64)
  fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    let totalCells = uniforms.gridNumX * uniforms.gridNumY;
    if (i >= totalCells) {
      return;
    }
    density[i] = f32(atomicLoad(&cellCounts[i])) / uniforms.scale;
  }
`;

const buildCellTypesShaderWGSL = `
  struct CellTypeUniforms {
    totalCells: u32,
    _pad0: vec3u,
  }

  @group(0) @binding(0) var<uniform> uniforms: CellTypeUniforms;
  @group(0) @binding(1) var<storage, read> solidMask: array<f32>;
  @group(0) @binding(2) var<storage, read_write> cellCounts: array<atomic<u32>>;
  @group(0) @binding(3) var<storage, read_write> cellType: array<i32>;

  @compute @workgroup_size(64)
  fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i >= uniforms.totalCells) {
      return;
    }

    if (solidMask[i] == 0.0) {
      cellType[i] = 2; // SOLID
      return;
    }

    let count = atomicLoad(&cellCounts[i]);
    if (count > 0u) {
      cellType[i] = 0; // FLUID
    } else {
      cellType[i] = 1; // AIR
    }
  }
`;

const p2gVelocityXScatterShaderWGSL = `
  struct P2GVelocityXScatterUniforms {
    numParticles: u32,
    numX: u32,
    numY: u32,
    _pad0: u32,
    invCellSize: f32,
    cellSize: f32,
    scale: f32,
    _pad1: f32,
  }

  @group(0) @binding(0) var<uniform> uniforms: P2GVelocityXScatterUniforms;
  @group(0) @binding(1) var<storage, read> positions: array<vec2f>;
  @group(0) @binding(2) var<storage, read> velocities: array<vec2f>;
  @group(0) @binding(3) var<storage, read_write> velAccum: array<atomic<i32>>;
  @group(0) @binding(4) var<storage, read_write> weightAccum: array<atomic<u32>>;

  @compute @workgroup_size(64)
  fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let p = gid.x;
    if (p >= uniforms.numParticles) {
      return;
    }

    let h = uniforms.cellSize;
    let hInv = uniforms.invCellSize;
    let h2 = 0.5 * h;
    var x = positions[p].x;
    var y = positions[p].y;
    x = clamp(x, h, (f32(uniforms.numX) - 1.0) * h);
    y = clamp(y, h, (f32(uniforms.numY) - 1.0) * h);

    let x0f = floor((x - 0.0) * hInv);
    let y0f = floor((y - h2) * hInv);
    let x0 = min(i32(x0f), i32(uniforms.numX) - 2);
    let y0 = min(i32(y0f), i32(uniforms.numY) - 2);
    let tx = (x - f32(x0) * h) * hInv;
    let ty = (y - h2 - f32(y0) * h) * hInv;
    let x1 = min(x0 + 1, i32(uniforms.numX) - 2);
    let y1 = min(y0 + 1, i32(uniforms.numY) - 2);
    let sx = 1.0 - tx;
    let sy = 1.0 - ty;
    let d0 = sx * sy;
    let d1 = tx * sy;
    let d2 = tx * ty;
    let d3 = sx * ty;
    let nY = uniforms.numY;
    let nr0 = u32(x0) * nY + u32(y0);
    let nr1 = u32(x1) * nY + u32(y0);
    let nr2 = u32(x1) * nY + u32(y1);
    let nr3 = u32(x0) * nY + u32(y1);

    let pvx = velocities[p].x;
    let w0 = u32(round(d0 * uniforms.scale));
    let w1 = u32(round(d1 * uniforms.scale));
    let w2 = u32(round(d2 * uniforms.scale));
    let w3 = u32(round(d3 * uniforms.scale));
    let v0 = i32(round(pvx * d0 * uniforms.scale));
    let v1 = i32(round(pvx * d1 * uniforms.scale));
    let v2 = i32(round(pvx * d2 * uniforms.scale));
    let v3 = i32(round(pvx * d3 * uniforms.scale));

    atomicAdd(&weightAccum[nr0], w0);
    atomicAdd(&weightAccum[nr1], w1);
    atomicAdd(&weightAccum[nr2], w2);
    atomicAdd(&weightAccum[nr3], w3);
    atomicAdd(&velAccum[nr0], v0);
    atomicAdd(&velAccum[nr1], v1);
    atomicAdd(&velAccum[nr2], v2);
    atomicAdd(&velAccum[nr3], v3);
  }
`;

const p2gVelocityXNormalizeShaderWGSL = `
  struct P2GVelocityXNormalizeUniforms {
    totalCells: u32,
    _pad0: vec3u,
    scale: f32,
    _pad1: vec3f,
  }

  @group(0) @binding(0) var<uniform> uniforms: P2GVelocityXNormalizeUniforms;
  @group(0) @binding(1) var<storage, read_write> velAccum: array<atomic<i32>>;
  @group(0) @binding(2) var<storage, read_write> weightAccum: array<atomic<u32>>;
  @group(0) @binding(3) var<storage, read_write> velocityX: array<f32>;

  @compute @workgroup_size(64)
  fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i >= uniforms.totalCells) {
      return;
    }
    let w = atomicLoad(&weightAccum[i]);
    if (w == 0u) {
      velocityX[i] = 0.0;
      return;
    }
    let v = atomicLoad(&velAccum[i]);
    velocityX[i] = f32(v) / f32(w);
  }
`;

const p2gVelocityYScatterShaderWGSL = `
  struct P2GVelocityYScatterUniforms {
    numParticles: u32,
    numX: u32,
    numY: u32,
    _pad0: u32,
    invCellSize: f32,
    cellSize: f32,
    scale: f32,
    _pad1: f32,
  }

  @group(0) @binding(0) var<uniform> uniforms: P2GVelocityYScatterUniforms;
  @group(0) @binding(1) var<storage, read> positions: array<vec2f>;
  @group(0) @binding(2) var<storage, read> velocities: array<vec2f>;
  @group(0) @binding(3) var<storage, read_write> velAccum: array<atomic<i32>>;
  @group(0) @binding(4) var<storage, read_write> weightAccum: array<atomic<u32>>;

  @compute @workgroup_size(64)
  fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let p = gid.x;
    if (p >= uniforms.numParticles) {
      return;
    }

    let h = uniforms.cellSize;
    let hInv = uniforms.invCellSize;
    let h2 = 0.5 * h;
    var x = positions[p].x;
    var y = positions[p].y;
    x = clamp(x, h, (f32(uniforms.numX) - 1.0) * h);
    y = clamp(y, h, (f32(uniforms.numY) - 1.0) * h);

    let x0f = floor((x - h2) * hInv);
    let y0f = floor((y - 0.0) * hInv);
    let x0 = min(i32(x0f), i32(uniforms.numX) - 2);
    let y0 = min(i32(y0f), i32(uniforms.numY) - 2);
    let tx = (x - h2 - f32(x0) * h) * hInv;
    let ty = (y - f32(y0) * h) * hInv;
    let x1 = min(x0 + 1, i32(uniforms.numX) - 2);
    let y1 = min(y0 + 1, i32(uniforms.numY) - 2);
    let sx = 1.0 - tx;
    let sy = 1.0 - ty;
    let d0 = sx * sy;
    let d1 = tx * sy;
    let d2 = tx * ty;
    let d3 = sx * ty;
    let nY = uniforms.numY;
    let nr0 = u32(x0) * nY + u32(y0);
    let nr1 = u32(x1) * nY + u32(y0);
    let nr2 = u32(x1) * nY + u32(y1);
    let nr3 = u32(x0) * nY + u32(y1);

    let pvy = velocities[p].y;
    let w0 = u32(round(d0 * uniforms.scale));
    let w1 = u32(round(d1 * uniforms.scale));
    let w2 = u32(round(d2 * uniforms.scale));
    let w3 = u32(round(d3 * uniforms.scale));
    let v0 = i32(round(pvy * d0 * uniforms.scale));
    let v1 = i32(round(pvy * d1 * uniforms.scale));
    let v2 = i32(round(pvy * d2 * uniforms.scale));
    let v3 = i32(round(pvy * d3 * uniforms.scale));

    atomicAdd(&weightAccum[nr0], w0);
    atomicAdd(&weightAccum[nr1], w1);
    atomicAdd(&weightAccum[nr2], w2);
    atomicAdd(&weightAccum[nr3], w3);
    atomicAdd(&velAccum[nr0], v0);
    atomicAdd(&velAccum[nr1], v1);
    atomicAdd(&velAccum[nr2], v2);
    atomicAdd(&velAccum[nr3], v3);
  }
`;

const clearPressureShaderWGSL = `
  struct ClearPressureUniforms {
    totalCells: u32,
    _pad0: vec3u,
  }

  @group(0) @binding(0) var<uniform> uniforms: ClearPressureUniforms;
  @group(0) @binding(1) var<storage, read_write> pressure: array<f32>;

  @compute @workgroup_size(64)
  fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i >= uniforms.totalCells) {
      return;
    }
    pressure[i] = 0.0;
  }
`;

const g2pVelocityShaderWGSL = `
  struct G2PUniforms {
    numParticles: u32,
    numX: u32,
    numY: u32,
    _pad0: u32,
    invCellSize: f32,
    cellSize: f32,
    flipRatio: f32,
    _pad1: f32,
  }

  @group(0) @binding(0) var<uniform> uniforms: G2PUniforms;
  @group(0) @binding(1) var<storage, read> positions: array<vec2f>;
  @group(0) @binding(2) var<storage, read_write> particleVel: array<vec2f>;
  @group(0) @binding(3) var<storage, read> cellType: array<i32>;
  @group(0) @binding(4) var<storage, read> velocityXNew: array<f32>;
  @group(0) @binding(5) var<storage, read> velocityYNew: array<f32>;
  @group(0) @binding(6) var<storage, read> velocityXOld: array<f32>;
  @group(0) @binding(7) var<storage, read> velocityYOld: array<f32>;

  fn transferComponent(
    p: vec2f,
    pVelComp: f32,
    component: u32
  ) -> f32 {
    let nY = uniforms.numY;
    let h = uniforms.cellSize;
    let hInv = uniforms.invCellSize;
    let h2 = 0.5 * h;
    let dx = select(0.0, h2, component == 1u);
    let dy = select(h2, 0.0, component == 1u);

    var x = clamp(p.x, h, (f32(uniforms.numX) - 1.0) * h);
    var y = clamp(p.y, h, (f32(uniforms.numY) - 1.0) * h);

    let x0 = min(i32(floor((x - dx) * hInv)), i32(uniforms.numX) - 2);
    let tx = (x - dx - f32(x0) * h) * hInv;
    let x1 = min(x0 + 1, i32(uniforms.numX) - 2);
    let y0 = min(i32(floor((y - dy) * hInv)), i32(uniforms.numY) - 2);
    let ty = (y - dy - f32(y0) * h) * hInv;
    let y1 = min(y0 + 1, i32(uniforms.numY) - 2);

    let sx = 1.0 - tx;
    let sy = 1.0 - ty;
    let d0 = sx * sy;
    let d1 = tx * sy;
    let d2 = tx * ty;
    let d3 = sx * ty;
    let nr0 = u32(x0) * nY + u32(y0);
    let nr1 = u32(x1) * nY + u32(y0);
    let nr2 = u32(x1) * nY + u32(y1);
    let nr3 = u32(x0) * nY + u32(y1);

    let offset = select(i32(nY), 1, component == 1u);
    let valid0 = select(0.0, 1.0, cellType[nr0] != 1 || cellType[u32(i32(nr0) - offset)] != 1);
    let valid1 = select(0.0, 1.0, cellType[nr1] != 1 || cellType[u32(i32(nr1) - offset)] != 1);
    let valid2 = select(0.0, 1.0, cellType[nr2] != 1 || cellType[u32(i32(nr2) - offset)] != 1);
    let valid3 = select(0.0, 1.0, cellType[nr3] != 1 || cellType[u32(i32(nr3) - offset)] != 1);

    let totalWeight = valid0 * d0 + valid1 * d1 + valid2 * d2 + valid3 * d3;
    if (totalWeight <= 0.0) {
      return pVelComp;
    }

    let new0 = select(velocityXNew[nr0], velocityYNew[nr0], component == 1u);
    let new1 = select(velocityXNew[nr1], velocityYNew[nr1], component == 1u);
    let new2 = select(velocityXNew[nr2], velocityYNew[nr2], component == 1u);
    let new3 = select(velocityXNew[nr3], velocityYNew[nr3], component == 1u);
    let old0 = select(velocityXOld[nr0], velocityYOld[nr0], component == 1u);
    let old1 = select(velocityXOld[nr1], velocityYOld[nr1], component == 1u);
    let old2 = select(velocityXOld[nr2], velocityYOld[nr2], component == 1u);
    let old3 = select(velocityXOld[nr3], velocityYOld[nr3], component == 1u);

    let picVel = (
      valid0 * d0 * new0 +
      valid1 * d1 * new1 +
      valid2 * d2 * new2 +
      valid3 * d3 * new3
    ) / totalWeight;
    let deltaVel = (
      valid0 * d0 * (new0 - old0) +
      valid1 * d1 * (new1 - old1) +
      valid2 * d2 * (new2 - old2) +
      valid3 * d3 * (new3 - old3)
    ) / totalWeight;
    let flipVel = pVelComp + deltaVel;
    return (1.0 - uniforms.flipRatio) * picVel + uniforms.flipRatio * flipVel;
  }

  @compute @workgroup_size(64)
  fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    if (i >= uniforms.numParticles) {
      return;
    }
    let p = positions[i];
    var pv = particleVel[i];
    pv.x = transferComponent(p, pv.x, 0u);
    pv.y = transferComponent(p, pv.y, 1u);
    particleVel[i] = pv;
  }
`;

const pressureDivergenceShaderWGSL = `
  struct PressureUniforms {
    numX: u32,
    numY: u32,
    _pad0: vec2u,
    overRelaxation: f32,
    compensateDrift: f32,
    restDensity: f32,
    _pad1: f32,
  }

  @group(0) @binding(0) var<uniform> uniforms: PressureUniforms;
  @group(0) @binding(1) var<storage, read> solidMask: array<f32>;
  @group(0) @binding(2) var<storage, read> cellType: array<i32>;
  @group(0) @binding(3) var<storage, read> velocityX: array<f32>;
  @group(0) @binding(4) var<storage, read> velocityY: array<f32>;
  @group(0) @binding(5) var<storage, read> particleDensity: array<f32>;
  @group(0) @binding(6) var<storage, read_write> divergence: array<f32>;

  @compute @workgroup_size(8, 8, 1)
  fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    let j = gid.y;
    let nY = uniforms.numY;
    let center = i * nY + j;
    if (i <= 0u || i >= uniforms.numX - 1u || j <= 0u || j >= uniforms.numY - 1u) {
      divergence[center] = 0.0;
      return;
    }

    if (cellType[center] != 0) { // FLUID
      divergence[center] = 0.0;
      return;
    }

    let left = (i - 1u) * nY + j;
    let right = (i + 1u) * nY + j;
    let bottom = i * nY + (j - 1u);
    let top = i * nY + (j + 1u);

    let sx0 = solidMask[left];
    let sx1 = solidMask[right];
    let sy0 = solidMask[bottom];
    let sy1 = solidMask[top];
    let sSum = sx0 + sx1 + sy0 + sy1;
    if (sSum == 0.0) {
      divergence[center] = 0.0;
      return;
    }

    var div = velocityX[right] - velocityX[center] + velocityY[top] - velocityY[center];
    if (uniforms.compensateDrift > 0.5 && uniforms.restDensity > 0.0) {
      let compression = particleDensity[center] - uniforms.restDensity;
      if (compression > 0.0) {
        div = div - compression;
      }
    }
    divergence[center] = div;
  }
`;

const pressureJacobiShaderWGSL = `
  struct PressureUniforms {
    numX: u32,
    numY: u32,
    _pad0: vec2u,
    overRelaxation: f32,
    compensateDrift: f32,
    restDensity: f32,
    _pad1: f32,
  }

  @group(0) @binding(0) var<uniform> uniforms: PressureUniforms;
  @group(0) @binding(1) var<storage, read> solidMask: array<f32>;
  @group(0) @binding(2) var<storage, read> cellType: array<i32>;
  @group(0) @binding(3) var<storage, read> divergence: array<f32>;
  @group(0) @binding(4) var<storage, read> pressureIn: array<f32>;
  @group(0) @binding(5) var<storage, read_write> pressureOut: array<f32>;

  @compute @workgroup_size(8, 8, 1)
  fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    let j = gid.y;
    let nY = uniforms.numY;
    let center = i * nY + j;
    if (i <= 0u || i >= uniforms.numX - 1u || j <= 0u || j >= uniforms.numY - 1u) {
      pressureOut[center] = 0.0;
      return;
    }
    if (cellType[center] != 0) { // FLUID
      pressureOut[center] = 0.0;
      return;
    }

    let left = (i - 1u) * nY + j;
    let right = (i + 1u) * nY + j;
    let bottom = i * nY + (j - 1u);
    let top = i * nY + (j + 1u);

    let sx0 = solidMask[left];
    let sx1 = solidMask[right];
    let sy0 = solidMask[bottom];
    let sy1 = solidMask[top];
    let sSum = sx0 + sx1 + sy0 + sy1;
    if (sSum == 0.0) {
      pressureOut[center] = 0.0;
      return;
    }

    let neighborP =
      sx0 * pressureIn[left] +
      sx1 * pressureIn[right] +
      sy0 * pressureIn[bottom] +
      sy1 * pressureIn[top];
    pressureOut[center] = (neighborP - divergence[center]) / sSum;
  }
`;

const pressureProjectShaderWGSL = `
  struct PressureUniforms {
    numX: u32,
    numY: u32,
    _pad0: vec2u,
    overRelaxation: f32,
    compensateDrift: f32,
    restDensity: f32,
    _pad1: f32,
  }

  @group(0) @binding(0) var<uniform> uniforms: PressureUniforms;
  @group(0) @binding(1) var<storage, read> solidMask: array<f32>;
  @group(0) @binding(2) var<storage, read> cellType: array<i32>;
  @group(0) @binding(3) var<storage, read> pressure: array<f32>;
  @group(0) @binding(4) var<storage, read> velocityXIn: array<f32>;
  @group(0) @binding(5) var<storage, read> velocityYIn: array<f32>;
  @group(0) @binding(6) var<storage, read_write> velocityXOut: array<f32>;
  @group(0) @binding(7) var<storage, read_write> velocityYOut: array<f32>;

  @compute @workgroup_size(8, 8, 1)
  fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let i = gid.x;
    let j = gid.y;
    let nY = uniforms.numY;
    let center = i * nY + j;
    if (i <= 0u || i >= uniforms.numX - 1u || j <= 0u || j >= uniforms.numY - 1u) {
      velocityXOut[center] = velocityXIn[center];
      velocityYOut[center] = velocityYIn[center];
      return;
    }
    if (cellType[center] != 0) { // FLUID
      velocityXOut[center] = velocityXIn[center];
      velocityYOut[center] = velocityYIn[center];
      return;
    }

    let left = (i - 1u) * nY + j;
    let bottom = i * nY + (j - 1u);
    let sx0 = solidMask[left];
    let sy0 = solidMask[bottom];
    let corrX = sx0 * uniforms.overRelaxation * (pressure[center] - pressure[left]);
    let corrY = sy0 * uniforms.overRelaxation * (pressure[center] - pressure[bottom]);

    velocityXOut[center] = velocityXIn[center] - corrX;
    velocityYOut[center] = velocityYIn[center] - corrY;
  }
`;

export class WebGPURenderer {
  device: GPUDevice;
  format: GPUTextureFormat;
  
  particlePipeline: GPURenderPipeline;
  meshPipeline: GPURenderPipeline;
  boundaryCollisionPipeline: GPUComputePipeline;
  integrateParticlesPipeline: GPUComputePipeline;
  particleColorFadePipeline: GPUComputePipeline;
  particleSurfaceTintPipeline: GPUComputePipeline;
  particleSeparationPipeline: GPUComputePipeline;
  hashCountPipeline: GPUComputePipeline;
  hashFillPipeline: GPUComputePipeline;
  p2gCellCountPipeline: GPUComputePipeline;
  cellCountsToDensityPipeline: GPUComputePipeline;
  buildCellTypesPipeline: GPUComputePipeline;
  p2gVelocityXScatterPipeline: GPUComputePipeline;
  p2gVelocityXNormalizePipeline: GPUComputePipeline;
  p2gVelocityYScatterPipeline: GPUComputePipeline;
  g2pVelocityPipeline: GPUComputePipeline;
  pressureDivergencePipeline: GPUComputePipeline;
  pressureProjectPipeline: GPUComputePipeline;
  clearPressurePipeline: GPUComputePipeline;
  pressureJacobiPipeline: GPUComputePipeline;
  
  uniformBuffer: GPUBuffer;
  meshUniformBuffer: GPUBuffer;
  boundaryUniformBuffer: GPUBuffer;
  integrateUniformBuffer: GPUBuffer;
  particleColorFadeUniformBuffer: GPUBuffer;
  particleSurfaceTintUniformBuffer: GPUBuffer;
  particleSeparationUniformBuffer: GPUBuffer;
  hashCountUniformBuffer: GPUBuffer;
  hashFillUniformBuffer: GPUBuffer;
  p2gUniformBuffer: GPUBuffer;
  densityUniformBuffer: GPUBuffer;
  cellTypesUniformBuffer: GPUBuffer;
  p2gVelocityXUniformBuffer: GPUBuffer;
  p2gVelocityXNormalizeUniformBuffer: GPUBuffer;
  p2gVelocityYUniformBuffer: GPUBuffer;
  g2pVelocityUniformBuffer: GPUBuffer;
  clearPressureUniformBuffer: GPUBuffer;
  pressureUniformBuffer: GPUBuffer;
  bindGroup: GPUBindGroup;
  meshBindGroup: GPUBindGroup;
  
  particlePosBuffer: GPUBuffer | null = null;
  particleVelBuffer: GPUBuffer | null = null;
  particleColorBuffer: GPUBuffer | null = null;
  gridPosBuffer: GPUBuffer | null = null;
  gridColorBuffer: GPUBuffer | null = null;
  velocityXBuffer: GPUBuffer | null = null;
  velocityYBuffer: GPUBuffer | null = null;
  velocityXPrevBuffer: GPUBuffer | null = null;
  velocityYPrevBuffer: GPUBuffer | null = null;
  velocityXScratchBuffer: GPUBuffer | null = null;
  velocityYScratchBuffer: GPUBuffer | null = null;
  pressureBuffer: GPUBuffer | null = null;
  pressureScratchBuffer: GPUBuffer | null = null;
  divergenceBuffer: GPUBuffer | null = null;
  particleDensityBuffer: GPUBuffer | null = null;
  firstCellParticleBuffer: GPUBuffer | null = null;
  cellParticleIdsBuffer: GPUBuffer | null = null;
  hashCountsBuffer: GPUBuffer | null = null;
  hashOffsetsBuffer: GPUBuffer | null = null;
  hashCountsReadbackBuffer: GPUBuffer | null = null;
  gridCellCountsBuffer: GPUBuffer | null = null;
  p2gVelocityXAccumBuffer: GPUBuffer | null = null;
  p2gVelocityXWeightBuffer: GPUBuffer | null = null;
  p2gVelocityYAccumBuffer: GPUBuffer | null = null;
  p2gVelocityYWeightBuffer: GPUBuffer | null = null;
  solidMaskBuffer: GPUBuffer | null = null;
  cellTypeBuffer: GPUBuffer | null = null;
  hashBuildInFlight = false;
  particlePosScratchBuffer: GPUBuffer | null = null;
  particlePosReadbackBuffer: GPUBuffer | null = null;
  particleVelReadbackBuffer: GPUBuffer | null = null;
  particleColorReadbackBuffer: GPUBuffer | null = null;
  readbackInFlight = false;

  constructor(device: GPUDevice, format: GPUTextureFormat) {
    this.device = device;
    this.format = format;

    // --- Particle Pipeline ---
    const particleModule = device.createShaderModule({ code: particleShaderWGSL });
    this.particlePipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: particleModule,
        entryPoint: 'vs_main',
        buffers: [
          { // Position buffer
            arrayStride: 8,
            stepMode: 'instance',
            attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }],
          },
          { // Color buffer
            arrayStride: 12,
            stepMode: 'instance',
            attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x3' }],
          },
        ],
      },
      fragment: {
        module: particleModule,
        entryPoint: 'fs_main',
        targets: [{ format }],
      },
      primitive: { topology: 'triangle-strip' },
    });

    // --- Mesh (Obstacle) Pipeline ---
    const meshModule = device.createShaderModule({ code: meshShaderWGSL });
    this.meshPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: meshModule,
        entryPoint: 'vs_main',
      },
      fragment: {
        module: meshModule,
        entryPoint: 'fs_main',
        targets: [{ format }],
      },
      primitive: { topology: 'triangle-list' },
    });

    const boundaryModule = device.createShaderModule({ code: boundaryCollisionShaderWGSL });
    this.boundaryCollisionPipeline = device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: boundaryModule,
        entryPoint: 'main',
      },
    });
    const integrateModule = device.createShaderModule({ code: integrateParticlesShaderWGSL });
    this.integrateParticlesPipeline = device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: integrateModule,
        entryPoint: 'main',
      },
    });
    const colorFadeModule = device.createShaderModule({ code: particleColorFadeShaderWGSL });
    this.particleColorFadePipeline = device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: colorFadeModule,
        entryPoint: 'main',
      },
    });
    const surfaceTintModule = device.createShaderModule({ code: particleSurfaceTintShaderWGSL });
    this.particleSurfaceTintPipeline = device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: surfaceTintModule,
        entryPoint: 'main',
      },
    });
    const particleSeparationModule = device.createShaderModule({ code: particleSeparationShaderWGSL });
    this.particleSeparationPipeline = device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: particleSeparationModule,
        entryPoint: 'main',
      },
    });
    const hashCountModule = device.createShaderModule({ code: hashCountShaderWGSL });
    this.hashCountPipeline = device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: hashCountModule,
        entryPoint: 'main',
      },
    });
    const hashFillModule = device.createShaderModule({ code: hashFillShaderWGSL });
    this.hashFillPipeline = device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: hashFillModule,
        entryPoint: 'main',
      },
    });
    const p2gCountModule = device.createShaderModule({ code: p2gCellCountShaderWGSL });
    this.p2gCellCountPipeline = device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: p2gCountModule,
        entryPoint: 'main',
      },
    });
    const densityModule = device.createShaderModule({ code: cellCountsToDensityShaderWGSL });
    this.cellCountsToDensityPipeline = device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: densityModule,
        entryPoint: 'main',
      },
    });
    const buildCellTypesModule = device.createShaderModule({ code: buildCellTypesShaderWGSL });
    this.buildCellTypesPipeline = device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: buildCellTypesModule,
        entryPoint: 'main',
      },
    });
    const p2gVelocityXScatterModule = device.createShaderModule({ code: p2gVelocityXScatterShaderWGSL });
    this.p2gVelocityXScatterPipeline = device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: p2gVelocityXScatterModule,
        entryPoint: 'main',
      },
    });
    const p2gVelocityXNormalizeModule = device.createShaderModule({ code: p2gVelocityXNormalizeShaderWGSL });
    this.p2gVelocityXNormalizePipeline = device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: p2gVelocityXNormalizeModule,
        entryPoint: 'main',
      },
    });
    const p2gVelocityYScatterModule = device.createShaderModule({ code: p2gVelocityYScatterShaderWGSL });
    this.p2gVelocityYScatterPipeline = device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: p2gVelocityYScatterModule,
        entryPoint: 'main',
      },
    });
    const g2pVelocityModule = device.createShaderModule({ code: g2pVelocityShaderWGSL });
    this.g2pVelocityPipeline = device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: g2pVelocityModule,
        entryPoint: 'main',
      },
    });
    const pressureDivergenceModule = device.createShaderModule({ code: pressureDivergenceShaderWGSL });
    this.pressureDivergencePipeline = device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: pressureDivergenceModule,
        entryPoint: 'main',
      },
    });
    const pressureProjectModule = device.createShaderModule({ code: pressureProjectShaderWGSL });
    this.pressureProjectPipeline = device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: pressureProjectModule,
        entryPoint: 'main',
      },
    });
    const clearPressureModule = device.createShaderModule({ code: clearPressureShaderWGSL });
    this.clearPressurePipeline = device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: clearPressureModule,
        entryPoint: 'main',
      },
    });
    const pressureJacobiModule = device.createShaderModule({ code: pressureJacobiShaderWGSL });
    this.pressureJacobiPipeline = device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: pressureJacobiModule,
        entryPoint: 'main',
      },
    });

    // --- Uniforms ---
    this.uniformBuffer = device.createBuffer({
      size: 16, // domainSize(8), pointSize(4), drawDisk(4)
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.meshUniformBuffer = device.createBuffer({
      size: 48, // domainSize(8), pad(8), color(12), pad(4), translation(8), scale(4), pad(4)
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.boundaryUniformBuffer = device.createBuffer({
      size: 64,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.integrateUniformBuffer = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.particleColorFadeUniformBuffer = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.particleSurfaceTintUniformBuffer = device.createBuffer({
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.particleSeparationUniformBuffer = device.createBuffer({
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.hashCountUniformBuffer = device.createBuffer({
      size: 48,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.hashFillUniformBuffer = device.createBuffer({
      size: 48,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.p2gUniformBuffer = device.createBuffer({
      size: 48,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.densityUniformBuffer = device.createBuffer({
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.cellTypesUniformBuffer = device.createBuffer({
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.p2gVelocityXUniformBuffer = device.createBuffer({
      size: 48,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.p2gVelocityXNormalizeUniformBuffer = device.createBuffer({
      size: 48,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.p2gVelocityYUniformBuffer = device.createBuffer({
      size: 48,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.g2pVelocityUniformBuffer = device.createBuffer({
      size: 48,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.clearPressureUniformBuffer = device.createBuffer({
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.pressureUniformBuffer = device.createBuffer({
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.bindGroup = device.createBindGroup({
      layout: this.particlePipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
    });

    this.meshBindGroup = device.createBindGroup({
      layout: this.meshPipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.meshUniformBuffer } }],
    });
  }

  private createOrUpdateBuffer(data: Float32Array, existingBuffer: GPUBuffer | null, usage: GPUBufferUsageFlags): GPUBuffer {
    if (existingBuffer && existingBuffer.size === data.byteLength) {
      this.writeFloat32(existingBuffer, 0, data);
      return existingBuffer;
    }
    if (existingBuffer) existingBuffer.destroy();
    const buffer = this.device.createBuffer({
      size: data.byteLength,
      usage: usage | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Float32Array(buffer.getMappedRange()).set(data);
    buffer.unmap();
    return buffer;
  }

  private ensureReadbackBuffer(existing: GPUBuffer | null, size: number): GPUBuffer {
    if (existing && existing.size === size) return existing;
    if (existing) existing.destroy();
    return this.device.createBuffer({
      size,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
  }

  private writeFloat32(target: GPUBuffer, offset: number, data: Float32Array) {
    this.device.queue.writeBuffer(
      target,
      offset,
      data.buffer as ArrayBuffer,
      data.byteOffset,
      data.byteLength
    );
  }

  private createOrUpdateIntBuffer(data: Int32Array, existingBuffer: GPUBuffer | null, usage: GPUBufferUsageFlags): GPUBuffer {
    if (existingBuffer && existingBuffer.size === data.byteLength) {
      this.device.queue.writeBuffer(
        existingBuffer,
        0,
        data.buffer as ArrayBuffer,
        data.byteOffset,
        data.byteLength
      );
      return existingBuffer;
    }
    if (existingBuffer) existingBuffer.destroy();
    const buffer = this.device.createBuffer({
      size: data.byteLength,
      usage: usage | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Int32Array(buffer.getMappedRange()).set(data);
    buffer.unmap();
    return buffer;
  }

  private createOrUpdateUintBuffer(data: Uint32Array, existingBuffer: GPUBuffer | null, usage: GPUBufferUsageFlags): GPUBuffer {
    if (existingBuffer && existingBuffer.size === data.byteLength) {
      this.device.queue.writeBuffer(
        existingBuffer,
        0,
        data.buffer as ArrayBuffer,
        data.byteOffset,
        data.byteLength
      );
      return existingBuffer;
    }
    if (existingBuffer) existingBuffer.destroy();
    const buffer = this.device.createBuffer({
      size: data.byteLength,
      usage: usage | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Uint32Array(buffer.getMappedRange()).set(data);
    buffer.unmap();
    return buffer;
  }

  async buildSpatialHashHybrid(scene: Scene, options: { useGpuState?: boolean } = {}) {
    const fluid = scene.fluid;
    if (!fluid || fluid.numParticles === 0 || this.hashBuildInFlight) return;
    const useGpuState = options.useGpuState ?? false;

    const canReuseGpuState =
      useGpuState &&
      this.particlePosBuffer != null &&
      this.particlePosBuffer.size === fluid.particlePos.byteLength;

    if (!canReuseGpuState) {
      this.particlePosBuffer = this.createOrUpdateBuffer(
        fluid.particlePos,
        this.particlePosBuffer,
        GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
      );
    }

    const gridCells = fluid.spatialGridTotalCells;
    const numParticles = fluid.numParticles;
    const countsSize = gridCells * Uint32Array.BYTES_PER_ELEMENT;
    this.hashCountsBuffer = this.createOrUpdateUintBuffer(
      new Uint32Array(gridCells),
      this.hashCountsBuffer,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
    );
    this.hashCountsReadbackBuffer = this.ensureReadbackBuffer(this.hashCountsReadbackBuffer, countsSize);

    const hashUniformData = new Float32Array(8);
    hashUniformData[0] = numParticles;
    hashUniformData[1] = fluid.spatialGridNumX;
    hashUniformData[2] = fluid.spatialGridNumY;
    hashUniformData[4] = fluid.spatialGridInvSpacing;
    this.writeFloat32(this.hashCountUniformBuffer, 0, hashUniformData);
    this.writeFloat32(this.hashFillUniformBuffer, 0, hashUniformData);

    const countBindGroup = this.device.createBindGroup({
      layout: this.hashCountPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.hashCountUniformBuffer } },
        { binding: 1, resource: { buffer: this.particlePosBuffer! } },
        { binding: 2, resource: { buffer: this.hashCountsBuffer } },
      ],
    });

    const countEncoder = this.device.createCommandEncoder();
    const countPass = countEncoder.beginComputePass();
    countPass.setPipeline(this.hashCountPipeline);
    countPass.setBindGroup(0, countBindGroup);
    countPass.dispatchWorkgroups(Math.ceil(numParticles / 64));
    countPass.end();
    countEncoder.copyBufferToBuffer(this.hashCountsBuffer, 0, this.hashCountsReadbackBuffer, 0, countsSize);
    this.device.queue.submit([countEncoder.finish()]);

    this.hashBuildInFlight = true;
    try {
      await this.hashCountsReadbackBuffer.mapAsync(GPUMapMode.READ);
      const counts = new Uint32Array(this.hashCountsReadbackBuffer.getMappedRange());
      const starts = new Uint32Array(gridCells + 1);
      for (let i = 0; i < gridCells; i++) {
        starts[i + 1] = starts[i] + counts[i];
      }
      this.hashCountsReadbackBuffer.unmap();

      this.firstCellParticleBuffer = this.createOrUpdateUintBuffer(
        starts,
        this.firstCellParticleBuffer,
        GPUBufferUsage.STORAGE
      );
      this.hashOffsetsBuffer = this.createOrUpdateUintBuffer(
        starts.subarray(0, gridCells),
        this.hashOffsetsBuffer,
        GPUBufferUsage.STORAGE
      );
      this.cellParticleIdsBuffer = this.createOrUpdateUintBuffer(
        new Uint32Array(numParticles),
        this.cellParticleIdsBuffer,
        GPUBufferUsage.STORAGE
      );

      const fillBindGroup = this.device.createBindGroup({
        layout: this.hashFillPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.hashFillUniformBuffer } },
          { binding: 1, resource: { buffer: this.particlePosBuffer! } },
          { binding: 2, resource: { buffer: this.hashOffsetsBuffer } },
          { binding: 3, resource: { buffer: this.cellParticleIdsBuffer } },
        ],
      });

      const fillEncoder = this.device.createCommandEncoder();
      const fillPass = fillEncoder.beginComputePass();
      fillPass.setPipeline(this.hashFillPipeline);
      fillPass.setBindGroup(0, fillBindGroup);
      fillPass.dispatchWorkgroups(Math.ceil(numParticles / 64));
      fillPass.end();
      this.device.queue.submit([fillEncoder.finish()]);
    } finally {
      this.hashBuildInFlight = false;
    }
  }

  buildGridDensity(scene: Scene, options: { useGpuState?: boolean } = {}) {
    const fluid = scene.fluid;
    if (!fluid || fluid.numParticles === 0) return;
    const useGpuState = options.useGpuState ?? false;

    const canReuseGpuState =
      useGpuState &&
      this.particlePosBuffer != null &&
      this.particlePosBuffer.size === fluid.particlePos.byteLength;
    if (!canReuseGpuState) {
      this.particlePosBuffer = this.createOrUpdateBuffer(
        fluid.particlePos,
        this.particlePosBuffer,
        GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
      );
    }

    this.gridCellCountsBuffer = this.createOrUpdateUintBuffer(
      new Uint32Array(fluid.totalCells),
      this.gridCellCountsBuffer,
      GPUBufferUsage.STORAGE
    );
    this.particleDensityBuffer = this.createOrUpdateBuffer(
      new Float32Array(fluid.totalCells),
      this.particleDensityBuffer,
      GPUBufferUsage.STORAGE
    );

    const p2gData = new Float32Array(8);
    p2gData[0] = fluid.numParticles;
    p2gData[1] = fluid.numX;
    p2gData[2] = fluid.numY;
    p2gData[4] = fluid.invCellSize;
    p2gData[5] = fluid.cellSize;
    p2gData[6] = 65536.0;
    this.writeFloat32(this.p2gUniformBuffer, 0, p2gData);

    const countBindGroup = this.device.createBindGroup({
      layout: this.p2gCellCountPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.p2gUniformBuffer } },
        { binding: 1, resource: { buffer: this.particlePosBuffer! } },
        { binding: 2, resource: { buffer: this.gridCellCountsBuffer } },
      ],
    });

    const densityBindGroup = this.device.createBindGroup({
      layout: this.cellCountsToDensityPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.p2gUniformBuffer } },
        { binding: 1, resource: { buffer: this.gridCellCountsBuffer } },
        { binding: 2, resource: { buffer: this.particleDensityBuffer } },
      ],
    });

    const encoder = this.device.createCommandEncoder();
    const countPass = encoder.beginComputePass();
    countPass.setPipeline(this.p2gCellCountPipeline);
    countPass.setBindGroup(0, countBindGroup);
    countPass.dispatchWorkgroups(Math.ceil(fluid.numParticles / 64));
    countPass.end();

    const densityPass = encoder.beginComputePass();
    densityPass.setPipeline(this.cellCountsToDensityPipeline);
    densityPass.setBindGroup(0, densityBindGroup);
    densityPass.dispatchWorkgroups(Math.ceil(fluid.totalCells / 64));
    densityPass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  buildCellTypes(scene: Scene) {
    const fluid = scene.fluid;
    if (!fluid || !this.gridCellCountsBuffer) return;

    this.solidMaskBuffer = this.createOrUpdateBuffer(
      fluid.solidMask,
      this.solidMaskBuffer,
      GPUBufferUsage.STORAGE
    );
    this.cellTypeBuffer = this.createOrUpdateIntBuffer(
      fluid.cellType,
      this.cellTypeBuffer,
      GPUBufferUsage.STORAGE
    );

    const uniformData = new Uint32Array(4);
    uniformData[0] = fluid.totalCells;
    this.device.queue.writeBuffer(this.cellTypesUniformBuffer, 0, uniformData);

    const bindGroup = this.device.createBindGroup({
      layout: this.buildCellTypesPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.cellTypesUniformBuffer } },
        { binding: 1, resource: { buffer: this.solidMaskBuffer } },
        { binding: 2, resource: { buffer: this.gridCellCountsBuffer } },
        { binding: 3, resource: { buffer: this.cellTypeBuffer } },
      ],
    });

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.buildCellTypesPipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(fluid.totalCells / 64));
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  prepareGridSolverState(scene: Scene) {
    const fluid = scene.fluid;
    if (!fluid) return;

    this.velocityXBuffer = this.createOrUpdateBuffer(
      fluid.velocityX,
      this.velocityXBuffer,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
    );
    this.velocityYBuffer = this.createOrUpdateBuffer(
      fluid.velocityY,
      this.velocityYBuffer,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
    );
    this.velocityXScratchBuffer = this.createOrUpdateBuffer(
      fluid.velocityX,
      this.velocityXScratchBuffer,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
    );
    this.velocityYScratchBuffer = this.createOrUpdateBuffer(
      fluid.velocityY,
      this.velocityYScratchBuffer,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
    );
    this.pressureBuffer = this.createOrUpdateBuffer(
      fluid.pressure,
      this.pressureBuffer,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
    );
    this.pressureScratchBuffer = this.createOrUpdateBuffer(
      fluid.pressure,
      this.pressureScratchBuffer,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
    );
    this.divergenceBuffer = this.createOrUpdateBuffer(
      new Float32Array(fluid.totalCells),
      this.divergenceBuffer,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
    );
  }

  buildVelocitiesFromParticles(scene: Scene, options: { useGpuState?: boolean } = {}) {
    const fluid = scene.fluid;
    if (!fluid || fluid.numParticles === 0) return;
    const useGpuState = options.useGpuState ?? false;

    const canReuseGpuState =
      useGpuState &&
      this.particlePosBuffer != null &&
      this.particleVelBuffer != null &&
      this.particlePosBuffer.size === fluid.particlePos.byteLength &&
      this.particleVelBuffer.size === fluid.particleVel.byteLength;
    if (!canReuseGpuState) {
      this.particlePosBuffer = this.createOrUpdateBuffer(
        fluid.particlePos,
        this.particlePosBuffer,
        GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
      );
      this.particleVelBuffer = this.createOrUpdateBuffer(
        fluid.particleVel,
        this.particleVelBuffer,
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
      );
    }

    this.velocityXBuffer = this.createOrUpdateBuffer(
      new Float32Array(fluid.totalCells),
      this.velocityXBuffer,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
    );
    this.velocityYBuffer = this.createOrUpdateBuffer(
      new Float32Array(fluid.totalCells),
      this.velocityYBuffer,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
    );
    this.velocityXPrevBuffer = this.createOrUpdateBuffer(
      new Float32Array(fluid.totalCells),
      this.velocityXPrevBuffer,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
    );
    this.velocityYPrevBuffer = this.createOrUpdateBuffer(
      new Float32Array(fluid.totalCells),
      this.velocityYPrevBuffer,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
    );
    this.p2gVelocityXAccumBuffer = this.createOrUpdateIntBuffer(
      new Int32Array(fluid.totalCells),
      this.p2gVelocityXAccumBuffer,
      GPUBufferUsage.STORAGE
    );
    this.p2gVelocityXWeightBuffer = this.createOrUpdateUintBuffer(
      new Uint32Array(fluid.totalCells),
      this.p2gVelocityXWeightBuffer,
      GPUBufferUsage.STORAGE
    );
    this.p2gVelocityYAccumBuffer = this.createOrUpdateIntBuffer(
      new Int32Array(fluid.totalCells),
      this.p2gVelocityYAccumBuffer,
      GPUBufferUsage.STORAGE
    );
    this.p2gVelocityYWeightBuffer = this.createOrUpdateUintBuffer(
      new Uint32Array(fluid.totalCells),
      this.p2gVelocityYWeightBuffer,
      GPUBufferUsage.STORAGE
    );

    const scale = 65536.0;
    const scatterXData = new Float32Array(8);
    scatterXData[0] = fluid.numParticles;
    scatterXData[1] = fluid.numX;
    scatterXData[2] = fluid.numY;
    scatterXData[4] = fluid.invCellSize;
    scatterXData[5] = fluid.cellSize;
    scatterXData[6] = scale;
    this.writeFloat32(this.p2gVelocityXUniformBuffer, 0, scatterXData);
    const scatterYData = new Float32Array(8);
    scatterYData[0] = fluid.numParticles;
    scatterYData[1] = fluid.numX;
    scatterYData[2] = fluid.numY;
    scatterYData[4] = fluid.invCellSize;
    scatterYData[5] = fluid.cellSize;
    scatterYData[6] = scale;
    this.writeFloat32(this.p2gVelocityYUniformBuffer, 0, scatterYData);

    const normalizeData = new Float32Array(8);
    normalizeData[0] = fluid.totalCells;
    normalizeData[4] = scale;
    this.writeFloat32(this.p2gVelocityXNormalizeUniformBuffer, 0, normalizeData);

    const scatterBindGroup = this.device.createBindGroup({
      layout: this.p2gVelocityXScatterPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.p2gVelocityXUniformBuffer } },
        { binding: 1, resource: { buffer: this.particlePosBuffer! } },
        { binding: 2, resource: { buffer: this.particleVelBuffer! } },
        { binding: 3, resource: { buffer: this.p2gVelocityXAccumBuffer } },
        { binding: 4, resource: { buffer: this.p2gVelocityXWeightBuffer } },
      ],
    });
    const scatterYBindGroup = this.device.createBindGroup({
      layout: this.p2gVelocityYScatterPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.p2gVelocityYUniformBuffer } },
        { binding: 1, resource: { buffer: this.particlePosBuffer! } },
        { binding: 2, resource: { buffer: this.particleVelBuffer! } },
        { binding: 3, resource: { buffer: this.p2gVelocityYAccumBuffer! } },
        { binding: 4, resource: { buffer: this.p2gVelocityYWeightBuffer! } },
      ],
    });

    const normalizeXBindGroup = this.device.createBindGroup({
      layout: this.p2gVelocityXNormalizePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.p2gVelocityXNormalizeUniformBuffer } },
        { binding: 1, resource: { buffer: this.p2gVelocityXAccumBuffer } },
        { binding: 2, resource: { buffer: this.p2gVelocityXWeightBuffer } },
        { binding: 3, resource: { buffer: this.velocityXBuffer } },
      ],
    });
    const normalizeYBindGroup = this.device.createBindGroup({
      layout: this.p2gVelocityXNormalizePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.p2gVelocityXNormalizeUniformBuffer } },
        { binding: 1, resource: { buffer: this.p2gVelocityYAccumBuffer! } },
        { binding: 2, resource: { buffer: this.p2gVelocityYWeightBuffer! } },
        { binding: 3, resource: { buffer: this.velocityYBuffer! } },
      ],
    });

    const encoder = this.device.createCommandEncoder();
    const scatterXPass = encoder.beginComputePass();
    scatterXPass.setPipeline(this.p2gVelocityXScatterPipeline);
    scatterXPass.setBindGroup(0, scatterBindGroup);
    scatterXPass.dispatchWorkgroups(Math.ceil(fluid.numParticles / 64));
    scatterXPass.end();

    const normalizeXPass = encoder.beginComputePass();
    normalizeXPass.setPipeline(this.p2gVelocityXNormalizePipeline);
    normalizeXPass.setBindGroup(0, normalizeXBindGroup);
    normalizeXPass.dispatchWorkgroups(Math.ceil(fluid.totalCells / 64));
    normalizeXPass.end();

    const scatterYPass = encoder.beginComputePass();
    scatterYPass.setPipeline(this.p2gVelocityYScatterPipeline);
    scatterYPass.setBindGroup(0, scatterYBindGroup);
    scatterYPass.dispatchWorkgroups(Math.ceil(fluid.numParticles / 64));
    scatterYPass.end();

    const normalizeYPass = encoder.beginComputePass();
    normalizeYPass.setPipeline(this.p2gVelocityXNormalizePipeline);
    normalizeYPass.setBindGroup(0, normalizeYBindGroup);
    normalizeYPass.dispatchWorkgroups(Math.ceil(fluid.totalCells / 64));
    normalizeYPass.end();
    encoder.copyBufferToBuffer(this.velocityXBuffer, 0, this.velocityXPrevBuffer!, 0, fluid.totalCells * Float32Array.BYTES_PER_ELEMENT);
    encoder.copyBufferToBuffer(this.velocityYBuffer, 0, this.velocityYPrevBuffer!, 0, fluid.totalCells * Float32Array.BYTES_PER_ELEMENT);
    this.device.queue.submit([encoder.finish()]);
  }

  applyGridToParticleVelocities(scene: Scene, options: { useGpuState?: boolean } = {}) {
    const fluid = scene.fluid;
    if (!fluid || fluid.numParticles === 0) return;
    const useGpuState = options.useGpuState ?? false;
    if (
      !this.velocityXBuffer ||
      !this.velocityYBuffer ||
      !this.velocityXPrevBuffer ||
      !this.velocityYPrevBuffer ||
      !this.cellTypeBuffer
    ) return;

    const canReuseGpuState =
      useGpuState &&
      this.particlePosBuffer != null &&
      this.particleVelBuffer != null &&
      this.particlePosBuffer.size === fluid.particlePos.byteLength &&
      this.particleVelBuffer.size === fluid.particleVel.byteLength;
    if (!canReuseGpuState) {
      this.particlePosBuffer = this.createOrUpdateBuffer(
        fluid.particlePos,
        this.particlePosBuffer,
        GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
      );
      this.particleVelBuffer = this.createOrUpdateBuffer(
        fluid.particleVel,
        this.particleVelBuffer,
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
      );
    }

    const g2pData = new Float32Array(8);
    g2pData[0] = fluid.numParticles;
    g2pData[1] = fluid.numX;
    g2pData[2] = fluid.numY;
    g2pData[4] = fluid.invCellSize;
    g2pData[5] = fluid.cellSize;
    g2pData[6] = scene.flipRatio;
    this.writeFloat32(this.g2pVelocityUniformBuffer, 0, g2pData);

    const bindGroup = this.device.createBindGroup({
      layout: this.g2pVelocityPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.g2pVelocityUniformBuffer } },
        { binding: 1, resource: { buffer: this.particlePosBuffer! } },
        { binding: 2, resource: { buffer: this.particleVelBuffer! } },
        { binding: 3, resource: { buffer: this.cellTypeBuffer! } },
        { binding: 4, resource: { buffer: this.velocityXBuffer } },
        { binding: 5, resource: { buffer: this.velocityYBuffer } },
        { binding: 6, resource: { buffer: this.velocityXPrevBuffer } },
        { binding: 7, resource: { buffer: this.velocityYPrevBuffer } },
      ],
    });

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.g2pVelocityPipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(fluid.numParticles / 64));
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  applyPressureSkeleton(scene: Scene, iterations?: number) {
    const fluid = scene.fluid;
    if (
      !fluid ||
      !this.velocityXBuffer ||
      !this.velocityYBuffer ||
      !this.velocityXScratchBuffer ||
      !this.velocityYScratchBuffer ||
      !this.pressureBuffer
    ) return;
    if (!this.solidMaskBuffer || !this.cellTypeBuffer) return;
    this.pressureScratchBuffer = this.createOrUpdateBuffer(
      new Float32Array(fluid.totalCells),
      this.pressureScratchBuffer,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
    );
    this.divergenceBuffer = this.createOrUpdateBuffer(
      new Float32Array(fluid.totalCells),
      this.divergenceBuffer,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
    );
    if (!this.particleDensityBuffer || this.particleDensityBuffer.size !== fluid.particleDensity.byteLength) {
      this.particleDensityBuffer = this.createOrUpdateBuffer(
        fluid.particleDensity,
        this.particleDensityBuffer,
        GPUBufferUsage.STORAGE
      );
    }

    const clearUniform = new Uint32Array(4);
    clearUniform[0] = fluid.totalCells;
    this.device.queue.writeBuffer(this.clearPressureUniformBuffer, 0, clearUniform);

    const clearPressureBindGroup = this.device.createBindGroup({
      layout: this.clearPressurePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.clearPressureUniformBuffer } },
        { binding: 1, resource: { buffer: this.pressureBuffer } },
      ],
    });
    const clearScratchBindGroup = this.device.createBindGroup({
      layout: this.clearPressurePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.clearPressureUniformBuffer } },
        { binding: 1, resource: { buffer: this.pressureScratchBuffer } },
      ],
    });

    const pressureUniform = new Float32Array(8);
    pressureUniform[0] = fluid.numX;
    pressureUniform[1] = fluid.numY;
    pressureUniform[4] = scene.overRelaxation;
    pressureUniform[5] = scene.compensateDrift ? 1.0 : 0.0;
    pressureUniform[6] = fluid.particleRestDensity;
    this.writeFloat32(this.pressureUniformBuffer, 0, pressureUniform);

    const divergenceBindGroup = this.device.createBindGroup({
      layout: this.pressureDivergencePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.pressureUniformBuffer } },
        { binding: 1, resource: { buffer: this.solidMaskBuffer } },
        { binding: 2, resource: { buffer: this.cellTypeBuffer } },
        { binding: 3, resource: { buffer: this.velocityXBuffer } },
        { binding: 4, resource: { buffer: this.velocityYBuffer } },
        { binding: 5, resource: { buffer: this.particleDensityBuffer } },
        { binding: 6, resource: { buffer: this.divergenceBuffer } },
      ],
    });

    const pressureIters = Math.max(1, Math.floor(iterations ?? scene.numPressureIters));
    const jacobiBindGroups: GPUBindGroup[] = [];
    for (let iter = 0; iter < pressureIters; iter++) {
      const pressureIn = iter % 2 === 0 ? this.pressureBuffer : this.pressureScratchBuffer;
      const pressureOut = iter % 2 === 0 ? this.pressureScratchBuffer : this.pressureBuffer;
      jacobiBindGroups.push(this.device.createBindGroup({
        layout: this.pressureJacobiPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.pressureUniformBuffer } },
          { binding: 1, resource: { buffer: this.solidMaskBuffer } },
          { binding: 2, resource: { buffer: this.cellTypeBuffer } },
          { binding: 3, resource: { buffer: this.divergenceBuffer } },
          { binding: 4, resource: { buffer: pressureIn! } },
          { binding: 5, resource: { buffer: pressureOut! } },
        ],
      }));
    }

    const finalPressureBuffer = pressureIters % 2 === 0 ? this.pressureBuffer : this.pressureScratchBuffer;
    const projectBindGroup = this.device.createBindGroup({
      layout: this.pressureProjectPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.pressureUniformBuffer } },
        { binding: 1, resource: { buffer: this.solidMaskBuffer } },
        { binding: 2, resource: { buffer: this.cellTypeBuffer } },
        { binding: 3, resource: { buffer: finalPressureBuffer! } },
        { binding: 4, resource: { buffer: this.velocityXBuffer } },
        { binding: 5, resource: { buffer: this.velocityYBuffer } },
        { binding: 6, resource: { buffer: this.velocityXScratchBuffer } },
        { binding: 7, resource: { buffer: this.velocityYScratchBuffer } },
      ],
    });

    const encoder = this.device.createCommandEncoder();
    const clearPass = encoder.beginComputePass();
    clearPass.setPipeline(this.clearPressurePipeline);
    clearPass.setBindGroup(0, clearPressureBindGroup);
    clearPass.dispatchWorkgroups(Math.ceil(fluid.totalCells / 64));
    clearPass.setBindGroup(0, clearScratchBindGroup);
    clearPass.dispatchWorkgroups(Math.ceil(fluid.totalCells / 64));
    clearPass.end();

    const divPass = encoder.beginComputePass();
    divPass.setPipeline(this.pressureDivergencePipeline);
    divPass.setBindGroup(0, divergenceBindGroup);
    divPass.dispatchWorkgroups(Math.ceil(fluid.numX / 8), Math.ceil(fluid.numY / 8));
    divPass.end();

    const jacobiPass = encoder.beginComputePass();
    jacobiPass.setPipeline(this.pressureJacobiPipeline);
    for (let iter = 0; iter < pressureIters; iter++) {
      jacobiPass.setBindGroup(0, jacobiBindGroups[iter]);
      jacobiPass.dispatchWorkgroups(Math.ceil(fluid.numX / 8), Math.ceil(fluid.numY / 8));
    }
    jacobiPass.end();

    const projectPass = encoder.beginComputePass();
    projectPass.setPipeline(this.pressureProjectPipeline);
    projectPass.setBindGroup(0, projectBindGroup);
    projectPass.dispatchWorkgroups(Math.ceil(fluid.numX / 8), Math.ceil(fluid.numY / 8));
    projectPass.end();

    this.device.queue.submit([encoder.finish()]);

    const vxTmp: GPUBuffer | null = this.velocityXBuffer;
    this.velocityXBuffer = this.velocityXScratchBuffer;
    this.velocityXScratchBuffer = vxTmp;
    const vyTmp: GPUBuffer | null = this.velocityYBuffer;
    this.velocityYBuffer = this.velocityYScratchBuffer;
    this.velocityYScratchBuffer = vyTmp;
    if (finalPressureBuffer && this.pressureBuffer !== finalPressureBuffer) {
      const pTmp: GPUBuffer | null = this.pressureBuffer;
      this.pressureBuffer = finalPressureBuffer;
      this.pressureScratchBuffer = pTmp;
    }
  }

  applyBoundaryCollision(
    scene: Scene,
    simWidth: number,
    simHeight: number,
    options: { useGpuState?: boolean } = {}
  ) {
    const fluid = scene.fluid!;
    if (!fluid || fluid.numParticles === 0) return;
    const useGpuState = options.useGpuState ?? false;

    const canReuseGpuState =
      useGpuState &&
      this.particlePosBuffer != null &&
      this.particleVelBuffer != null &&
      this.particlePosBuffer.size === fluid.particlePos.byteLength &&
      this.particleVelBuffer.size === fluid.particleVel.byteLength;

    if (!canReuseGpuState) {
      this.particlePosBuffer = this.createOrUpdateBuffer(
        fluid.particlePos,
        this.particlePosBuffer,
        GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
      );
      this.particleVelBuffer = this.createOrUpdateBuffer(
        fluid.particleVel,
        this.particleVelBuffer,
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
      );
    }
    const posBuffer = this.particlePosBuffer!;
    const velBuffer = this.particleVelBuffer!;

    const obstacleRadius = scene.showObstacle ? scene.obstacleRadius : 0.0;
    const minX = fluid.cellSize + fluid.particleRadius;
    const maxX = (fluid.numX - 1) * fluid.cellSize - fluid.particleRadius;
    const minY = fluid.cellSize + fluid.particleRadius;
    const maxY = (fluid.numY - 1) * fluid.cellSize - fluid.particleRadius;

    const boundaryData = new Float32Array(16);
    boundaryData[0] = simWidth;
    boundaryData[1] = simHeight;
    boundaryData[2] = fluid.particleRadius;
    boundaryData[3] = fluid.numParticles;
    boundaryData[4] = scene.obstacleX;
    boundaryData[5] = scene.obstacleY;
    boundaryData[6] = obstacleRadius;
    boundaryData[8] = scene.obstacleVelX;
    boundaryData[9] = scene.obstacleVelY;
    boundaryData[10] = minX;
    boundaryData[11] = maxX;
    boundaryData[12] = minY;
    boundaryData[13] = maxY;
    this.writeFloat32(this.boundaryUniformBuffer, 0, boundaryData);

    const boundaryBindGroup = this.device.createBindGroup({
      layout: this.boundaryCollisionPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.boundaryUniformBuffer } },
        { binding: 1, resource: { buffer: posBuffer } },
        { binding: 2, resource: { buffer: velBuffer } },
      ],
    });

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.boundaryCollisionPipeline);
    pass.setBindGroup(0, boundaryBindGroup);
    pass.dispatchWorkgroups(Math.ceil(fluid.numParticles / 64));
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  applyIntegrateParticles(scene: Scene, options: { useGpuState?: boolean } = {}) {
    const fluid = scene.fluid!;
    if (!fluid || fluid.numParticles === 0) return;
    const useGpuState = options.useGpuState ?? false;

    const canReuseGpuState =
      useGpuState &&
      this.particlePosBuffer != null &&
      this.particleVelBuffer != null &&
      this.particlePosBuffer.size === fluid.particlePos.byteLength &&
      this.particleVelBuffer.size === fluid.particleVel.byteLength;

    if (!canReuseGpuState) {
      this.particlePosBuffer = this.createOrUpdateBuffer(
        fluid.particlePos,
        this.particlePosBuffer,
        GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
      );
      this.particleVelBuffer = this.createOrUpdateBuffer(
        fluid.particleVel,
        this.particleVelBuffer,
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
      );
    }
    const posBuffer = this.particlePosBuffer!;
    const velBuffer = this.particleVelBuffer!;

    const integrateData = new Float32Array(4);
    integrateData[0] = scene.dt;
    integrateData[1] = scene.gravity;
    integrateData[2] = fluid.numParticles;
    this.writeFloat32(this.integrateUniformBuffer, 0, integrateData);

    const integrateBindGroup = this.device.createBindGroup({
      layout: this.integrateParticlesPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.integrateUniformBuffer } },
        { binding: 1, resource: { buffer: posBuffer } },
        { binding: 2, resource: { buffer: velBuffer } },
      ],
    });

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.integrateParticlesPipeline);
    pass.setBindGroup(0, integrateBindGroup);
    pass.dispatchWorkgroups(Math.ceil(fluid.numParticles / 64));
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  applyParticleColorFade(scene: Scene, step: number = 0.01, options: { useGpuState?: boolean } = {}) {
    const fluid = scene.fluid!;
    if (!fluid || fluid.numParticles === 0) return;
    const useGpuState = options.useGpuState ?? false;

    const canReuseGpuState =
      useGpuState &&
      this.particleColorBuffer != null &&
      this.particleColorBuffer.size === fluid.particleColor.byteLength;

    if (!canReuseGpuState) {
      this.particleColorBuffer = this.createOrUpdateBuffer(
        fluid.particleColor,
        this.particleColorBuffer,
        GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
      );
    }
    const colorBuffer = this.particleColorBuffer!;

    const colorFadeData = new Float32Array(4);
    colorFadeData[0] = fluid.numParticles;
    colorFadeData[1] = step;
    this.writeFloat32(this.particleColorFadeUniformBuffer, 0, colorFadeData);

    const colorFadeBindGroup = this.device.createBindGroup({
      layout: this.particleColorFadePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.particleColorFadeUniformBuffer } },
        { binding: 1, resource: { buffer: colorBuffer } },
      ],
    });

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.particleColorFadePipeline);
    pass.setBindGroup(0, colorFadeBindGroup);
    pass.dispatchWorkgroups(Math.ceil(fluid.numParticles / 64));
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  applyParticleSurfaceTint(
    scene: Scene,
    threshold: number = 0.7,
    bright: number = 0.8,
    options: { useGpuState?: boolean; useGpuDensity?: boolean } = {}
  ) {
    const fluid = scene.fluid!;
    if (!fluid || fluid.numParticles === 0 || fluid.particleRestDensity <= 0.0) return;
    const useGpuState = options.useGpuState ?? false;
    const useGpuDensity = options.useGpuDensity ?? false;

    const canReuseGpuState =
      useGpuState &&
      this.particlePosBuffer != null &&
      this.particleColorBuffer != null &&
      this.particlePosBuffer.size === fluid.particlePos.byteLength &&
      this.particleColorBuffer.size === fluid.particleColor.byteLength;

    if (!canReuseGpuState) {
      this.particleColorBuffer = this.createOrUpdateBuffer(
        fluid.particleColor,
        this.particleColorBuffer,
        GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
      );
      this.particlePosBuffer = this.createOrUpdateBuffer(
        fluid.particlePos,
        this.particlePosBuffer,
        GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
      );
    }
    if (!useGpuDensity || this.particleDensityBuffer == null || this.particleDensityBuffer.size !== fluid.particleDensity.byteLength) {
      this.particleDensityBuffer = this.createOrUpdateBuffer(
        fluid.particleDensity,
        this.particleDensityBuffer,
        GPUBufferUsage.STORAGE
      );
    }

    const surfaceTintData = new Float32Array(8);
    surfaceTintData[0] = fluid.numParticles;
    surfaceTintData[1] = fluid.invCellSize;
    surfaceTintData[2] = fluid.particleRestDensity;
    surfaceTintData[3] = threshold;
    surfaceTintData[4] = bright;
    surfaceTintData[5] = fluid.numX;
    surfaceTintData[6] = fluid.numY;
    this.writeFloat32(this.particleSurfaceTintUniformBuffer, 0, surfaceTintData);

    const tintBindGroup = this.device.createBindGroup({
      layout: this.particleSurfaceTintPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.particleSurfaceTintUniformBuffer } },
        { binding: 1, resource: { buffer: this.particleColorBuffer! } },
        { binding: 2, resource: { buffer: this.particlePosBuffer! } },
        { binding: 3, resource: { buffer: this.particleDensityBuffer! } },
      ],
    });

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.particleSurfaceTintPipeline);
    pass.setBindGroup(0, tintBindGroup);
    pass.dispatchWorkgroups(Math.ceil(fluid.numParticles / 64));
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  applyParticleSeparation(scene: Scene, numIters: number = 1, options: { useGpuState?: boolean } = {}) {
    const fluid = scene.fluid!;
    if (!fluid || fluid.numParticles === 0) return;
    const useGpuState = options.useGpuState ?? false;

    const canReuseGpuState =
      useGpuState &&
      this.particlePosBuffer != null &&
      this.particlePosBuffer.size === fluid.particlePos.byteLength;

    if (!canReuseGpuState) {
      this.particlePosBuffer = this.createOrUpdateBuffer(
        fluid.particlePos,
        this.particlePosBuffer,
        GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
      );
    }
    this.particlePosScratchBuffer = this.createOrUpdateBuffer(
      fluid.particlePos,
      this.particlePosScratchBuffer,
      GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
    );

    this.firstCellParticleBuffer = this.createOrUpdateIntBuffer(
      fluid.firstCellParticle,
      this.firstCellParticleBuffer,
      GPUBufferUsage.STORAGE
    );
    this.cellParticleIdsBuffer = this.createOrUpdateIntBuffer(
      fluid.cellParticleIds,
      this.cellParticleIdsBuffer,
      GPUBufferUsage.STORAGE
    );

    const minDist = 2.0 * fluid.particleRadius;
    const separationData = new Float32Array(8);
    separationData[0] = fluid.numParticles;
    separationData[1] = fluid.spatialGridInvSpacing;
    separationData[2] = fluid.spatialGridNumX;
    separationData[3] = fluid.spatialGridNumY;
    separationData[4] = minDist;
    separationData[5] = minDist * minDist;
    this.writeFloat32(this.particleSeparationUniformBuffer, 0, separationData);

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.particleSeparationPipeline);

    const iters = Math.max(1, Math.floor(numIters));
    for (let iter = 0; iter < iters; iter++) {
      const bindGroup = this.device.createBindGroup({
        layout: this.particleSeparationPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.particleSeparationUniformBuffer } },
          { binding: 1, resource: { buffer: this.particlePosBuffer! } },
          { binding: 2, resource: { buffer: this.particlePosScratchBuffer! } },
          { binding: 3, resource: { buffer: this.firstCellParticleBuffer! } },
          { binding: 4, resource: { buffer: this.cellParticleIdsBuffer! } },
        ],
      });

      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(Math.ceil(fluid.numParticles / 64));

      const posTmp: GPUBuffer | null = this.particlePosBuffer;
      this.particlePosBuffer = this.particlePosScratchBuffer;
      this.particlePosScratchBuffer = posTmp;
    }

    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  async syncParticlesToCpu(scene: Scene, options: { includeColor?: boolean } = {}) {
    const fluid = scene.fluid;
    if (!fluid || !this.particlePosBuffer || !this.particleVelBuffer || this.readbackInFlight) return;
    const includeColor = options.includeColor ?? false;
    if (includeColor && !this.particleColorBuffer) return;

    this.particlePosReadbackBuffer = this.ensureReadbackBuffer(this.particlePosReadbackBuffer, fluid.particlePos.byteLength);
    this.particleVelReadbackBuffer = this.ensureReadbackBuffer(this.particleVelReadbackBuffer, fluid.particleVel.byteLength);
    if (includeColor) {
      this.particleColorReadbackBuffer = this.ensureReadbackBuffer(this.particleColorReadbackBuffer, fluid.particleColor.byteLength);
    }

    const encoder = this.device.createCommandEncoder();
    encoder.copyBufferToBuffer(this.particlePosBuffer, 0, this.particlePosReadbackBuffer, 0, fluid.particlePos.byteLength);
    encoder.copyBufferToBuffer(this.particleVelBuffer, 0, this.particleVelReadbackBuffer, 0, fluid.particleVel.byteLength);
    if (includeColor) {
      encoder.copyBufferToBuffer(this.particleColorBuffer!, 0, this.particleColorReadbackBuffer!, 0, fluid.particleColor.byteLength);
    }
    this.device.queue.submit([encoder.finish()]);

    this.readbackInFlight = true;
    try {
      const maps: Promise<void>[] = [
        this.particlePosReadbackBuffer.mapAsync(GPUMapMode.READ),
        this.particleVelReadbackBuffer.mapAsync(GPUMapMode.READ),
      ];
      if (includeColor) maps.push(this.particleColorReadbackBuffer!.mapAsync(GPUMapMode.READ));
      await Promise.all(maps);

      const posData = new Float32Array(this.particlePosReadbackBuffer!.getMappedRange());
      const velData = new Float32Array(this.particleVelReadbackBuffer!.getMappedRange());
      fluid.particlePos.set(posData);
      fluid.particleVel.set(velData);
      this.particlePosReadbackBuffer!.unmap();
      this.particleVelReadbackBuffer!.unmap();
      if (includeColor) {
        const colorData = new Float32Array(this.particleColorReadbackBuffer!.getMappedRange());
        fluid.particleColor.set(colorData);
        this.particleColorReadbackBuffer!.unmap();
      }
    } finally {
      this.readbackInFlight = false;
    }
  }

  draw(
    scene: Scene,
    simWidth: number,
    simHeight: number,
    context: GPUCanvasContext,
    options: { useGpuParticles?: boolean; useGpuParticleColors?: boolean } = {}
  ) {
    const fluid = scene.fluid!;
    if (!fluid) return;
    const useGpuParticles = options.useGpuParticles ?? false;
    const useGpuParticleColors = options.useGpuParticleColors ?? false;

    // 1. Update Uniforms
    this.writeFloat32(this.uniformBuffer, 0, new Float32Array([simWidth, simHeight]));

    const commandEncoder = this.device.createCommandEncoder();
    const renderPass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: context.getCurrentTexture().createView(),
        clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });

    // 2. Draw Grid
    if (scene.showGrid) {
      if (!this.gridPosBuffer) {
        const centers = new Float32Array(2 * fluid.totalCells);
        let p_idx = 0;
        for (let i = 0; i < fluid.numX; i++) {
          for (let j = 0; j < fluid.numY; j++) {
            centers[p_idx++] = (i + 0.5) * fluid.cellSize;
            centers[p_idx++] = (j + 0.5) * fluid.cellSize;
          }
        }
        this.gridPosBuffer = this.createOrUpdateBuffer(centers, null, GPUBufferUsage.VERTEX);
      }
      this.gridColorBuffer = this.createOrUpdateBuffer(fluid.cellColor, this.gridColorBuffer, GPUBufferUsage.VERTEX);

      const gridSize = fluid.cellSize * 0.9;
      this.writeFloat32(this.uniformBuffer, 8, new Float32Array([gridSize, 0.0])); // pointSize, drawDisk

      renderPass.setPipeline(this.particlePipeline);
      renderPass.setBindGroup(0, this.bindGroup);
      renderPass.setVertexBuffer(0, this.gridPosBuffer);
      renderPass.setVertexBuffer(1, this.gridColorBuffer);
      renderPass.draw(4, fluid.totalCells);
    }

    // 3. Draw Particles
    if (scene.showParticles) {
      if (!useGpuParticles || this.particlePosBuffer == null || this.particlePosBuffer.size !== fluid.particlePos.byteLength) {
        this.particlePosBuffer = this.createOrUpdateBuffer(
          fluid.particlePos,
          this.particlePosBuffer,
          GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
        );
      }
      if (!useGpuParticleColors || this.particleColorBuffer == null || this.particleColorBuffer.size !== fluid.particleColor.byteLength) {
        this.particleColorBuffer = this.createOrUpdateBuffer(
          fluid.particleColor,
          this.particleColorBuffer,
          GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
        );
      }

      const pSize = fluid.particleRadius * 2.0;
      this.writeFloat32(this.uniformBuffer, 8, new Float32Array([pSize, 1.0])); // pointSize, drawDisk

      renderPass.setPipeline(this.particlePipeline);
      renderPass.setBindGroup(0, this.bindGroup);
      renderPass.setVertexBuffer(0, this.particlePosBuffer);
      renderPass.setVertexBuffer(1, this.particleColorBuffer);
      renderPass.draw(4, fluid.numParticles);
    }

    // 4. Draw Obstacle
    if (scene.showObstacle) {
      // Mesh Uniforms (Respecting 16-byte alignment for vec3f)
      const meshData = new Float32Array(12); // 48 bytes
      meshData[0] = simWidth;
      meshData[1] = simHeight;
      // meshData[2,3] are padding
      meshData[4] = 1.0; // color.r (offset 16)
      meshData[5] = 0.0; // color.g
      meshData[6] = 0.0; // color.b
      // meshData[7] is padding
      meshData[8] = scene.obstacleX; // translation.x (offset 32)
      meshData[9] = scene.obstacleY; // translation.y
      meshData[10] = scene.obstacleRadius; // scale (offset 40)
      // meshData[11] is padding
      
      this.writeFloat32(this.meshUniformBuffer, 0, meshData);

      renderPass.setPipeline(this.meshPipeline);
      renderPass.setBindGroup(0, this.meshBindGroup);
      renderPass.draw(50 * 3); // 50 triangles for the disk
    }

    renderPass.end();
    this.device.queue.submit([commandEncoder.finish()]);
  }

  resetGridBuffer() {
    this.gridPosBuffer?.destroy();
    this.gridPosBuffer = null;
  }
}
