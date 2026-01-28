struct CullParams {
  viewProjection: mat4x4<f32>,
  radius: f32,
  particleCount: u32,
  pad0: vec2<f32>,
};

struct IndirectArgs {
  vertexCount: u32,
  instanceCount: atomic<u32>,
  firstVertex: u32,
  firstInstance: u32,
};

@group(0) @binding(0) var<storage, read> positions: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> visibleIndices: array<u32>;
@group(0) @binding(2) var<storage, read_write> indirectArgs: IndirectArgs;
@group(0) @binding(3) var<uniform> params: CullParams;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let index = id.x;
  if (index >= params.particleCount) {
    return;
  }

  let pos = positions[index].xyz;
  let clipPos = params.viewProjection * vec4<f32>(pos, 1.0);

  // Check frustum bounds
  // In WebGPU clip space: -w <= x <= w, -w <= y <= w, 0 <= z <= w
  // We add radius to the check to avoid popping at edges
  let w = clipPos.w + params.radius; 
  
  // Note: For tight culling, we might need a slightly more complex check if w < 0 (behind camera)
  // But a standard homogeneous check works well enough for particles.
  
  let inFrustum = 
      clipPos.x >= -w && clipPos.x <= w &&
      clipPos.y >= -w && clipPos.y <= w &&
      clipPos.z >= -w && clipPos.z <= w; // -w for Near plane check usually (OpenGL style is -w, WebGPU is 0..w for Z?)
      // WebGPU clip space Z is 0 to w.
      // So z >= -radius and z <= w + radius

  // Let's rely on standard normalized device coordinates check after divide? 
  // Easier: -w <= x <= w, etc.
  
  // Refined check for WebGPU (0 to 1 depth):
  // x: [-w, w], y: [-w, w], z: [0, w]
  // With radius buffer:
  let r = params.radius;
  
  if (clipPos.x >= -clipPos.w - r && clipPos.x <= clipPos.w + r &&
      clipPos.y >= -clipPos.w - r && clipPos.y <= clipPos.w + r &&
      clipPos.z >= -r && clipPos.z <= clipPos.w + r) {
      
      let slot = atomicAdd(&indirectArgs.instanceCount, 1u);
      visibleIndices[slot] = index;
  }
}
