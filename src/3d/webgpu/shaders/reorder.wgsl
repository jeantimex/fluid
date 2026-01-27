struct SortParams {
  particleCount: u32,
  pad0: vec3<u32>,
};

@group(0) @binding(0) var<storage, read> indices: array<u32>;
@group(0) @binding(1) var<storage, read_write> positions: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> velocities: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> predicted: array<vec4<f32>>;
@group(0) @binding(4) var<storage, read_write> positionsSorted: array<vec4<f32>>;
@group(0) @binding(5) var<storage, read_write> velocitiesSorted: array<vec4<f32>>;
@group(0) @binding(6) var<storage, read_write> predictedSorted: array<vec4<f32>>;
@group(0) @binding(7) var<uniform> params: SortParams;

@compute @workgroup_size(256)
fn reorder(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i >= params.particleCount) { return; }
  
  let sortedIndex = indices[i];
  
  positionsSorted[i] = positions[sortedIndex];
  velocitiesSorted[i] = velocities[sortedIndex];
  predictedSorted[i] = predicted[sortedIndex];
}

@compute @workgroup_size(256)
fn copyBack(@builtin(global_invocation_id) id: vec3<u32>) {
  let i = id.x;
  if (i >= params.particleCount) { return; }
  
  positions[i] = positionsSorted[i];
  velocities[i] = velocitiesSorted[i];
  predicted[i] = predictedSorted[i];
}
