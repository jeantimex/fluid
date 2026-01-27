struct Params {
  count: u32,
  pad0: vec3<u32>,
};

@group(0) @binding(0) var<storage, read_write> data: array<u32>;
@group(0) @binding(1) var<storage, read_write> groupSums: array<u32>;
@group(0) @binding(2) var<uniform> params: Params;

var<workgroup> temp: array<u32, 512>;

@compute @workgroup_size(256)
fn blockScan(@builtin(global_invocation_id) global_id: vec3<u32>, @builtin(local_invocation_id) local_id: vec3<u32>, @builtin(workgroup_id) group_id: vec3<u32>) {
    let tid = local_id.x;
    let gid = global_id.x;
    let groupIndex = group_id.x;
    
    // Load 2 elements per thread into shared memory
    let idx1 = 2u * gid;
    let idx2 = 2u * gid + 1u;
    let n = params.count;
    
    if (idx1 < n) { temp[2u * tid] = data[idx1]; } else { temp[2u * tid] = 0u; }
    if (idx2 < n) { temp[2u * tid + 1u] = data[idx2]; } else { temp[2u * tid + 1u] = 0u; }
    
    workgroupBarrier();

    // Up-Sweep (Reduction)
    var offset = 1u;
    for (var d = 256u; d > 0u; d = d >> 1u) {
        workgroupBarrier();
        if (tid < d) {
            let ai = offset * (2u * tid + 1u) - 1u;
            let bi = offset * (2u * tid + 2u) - 1u;
            temp[bi] = temp[bi] + temp[ai];
        }
        offset = offset * 2u;
    }

    // Save total sum of this block
    if (tid == 0u) {
        if (groupIndex < arrayLength(&groupSums)) {
            groupSums[groupIndex] = temp[511u];
        }
        temp[511u] = 0u; // Clear last element for exclusive scan
    }

    // Down-Sweep
    for (var d = 1u; d < 512u; d = d * 2u) {
        offset = offset >> 1u;
        workgroupBarrier();
        if (tid < d) {
            let ai = offset * (2u * tid + 1u) - 1u;
            let bi = offset * (2u * tid + 2u) - 1u;
            let t = temp[ai];
            temp[ai] = temp[bi];
            temp[bi] = temp[bi] + t;
        }
    }

    workgroupBarrier();

    // Write back
    if (idx1 < n) { data[idx1] = temp[2u * tid]; }
    if (idx2 < n) { data[idx2] = temp[2u * tid + 1u]; }
}

@group(0) @binding(3) var<storage, read> scannedGroupSums: array<u32>;

@compute @workgroup_size(256)
fn blockCombine(@builtin(global_invocation_id) global_id: vec3<u32>, @builtin(workgroup_id) group_id: vec3<u32>) {
    let groupIndex = group_id.x;
    if (groupIndex == 0u) { return; }
    
    let groupAdd = scannedGroupSums[groupIndex];
    
    let idx1 = 2u * global_id.x;
    let idx2 = 2u * global_id.x + 1u;
    let n = params.count;
    
    if (idx1 < n) { data[idx1] = data[idx1] + groupAdd; }
    if (idx2 < n) { data[idx2] = data[idx2] + groupAdd; }
}
