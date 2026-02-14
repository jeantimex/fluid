/**
 * ============================================================================
 * GPU FRUSTUM CULLING SHADER
 * ============================================================================
 *
 * Pipeline Stage: Pre-render (After physics, before particle rendering)
 * Entry Point: main
 * Workgroup Size: 256 threads
 *
 * Purpose:
 * --------
 * Determines which particles are visible to the camera and builds a compact
 * list of visible particle indices. This dramatically reduces rendering cost
 * by skipping off-screen particles.
 *
 * Performance Impact:
 * -------------------
 * Without culling: All N particles rendered, even if 80% are off-screen
 * With culling: Only visible particles rendered
 *
 * Typical scenarios:
 *   - Zoomed in: Maybe 10-20% visible → 5-10x faster rendering
 *   - Looking at corner: Maybe 30% visible → 3x faster rendering
 *   - Full view: ~100% visible → minimal overhead from culling pass
 *
 * Indirect Rendering:
 * -------------------
 * The culling result feeds into WebGPU's indirect draw mechanism:
 *
 *   CPU: encoder.drawIndirect(indirectBuffer, 0)
 *   GPU: Reads draw parameters FROM GPU buffer (not from CPU)
 *
 * This eliminates the CPU-GPU roundtrip that would be needed to read
 * the visible count back to CPU.
 *
 *     Traditional approach (slow):
 *     ┌─────┐                    ┌─────┐
 *     │ CPU │ ←── read count ─── │ GPU │  (sync stall!)
 *     │     │ ──── draw(N) ────→ │     │
 *     └─────┘                    └─────┘
 *
 *     Indirect approach (fast):
 *     ┌─────┐                    ┌─────┐
 *     │ CPU │ ── drawIndirect ─→ │ GPU │  (no readback!)
 *     └─────┘                    │     │
 *                                │ uses │
 *                                │count │
 *                                │from  │
 *                                │buffer│
 *                                └─────┘
 *
 * Frustum Culling in Clip Space:
 * ------------------------------
 * After multiplying by ViewProjection matrix, a point is in clip space.
 * In WebGPU clip space:
 *
 *   X ∈ [-w, +w]  (left to right)
 *   Y ∈ [-w, +w]  (bottom to top)
 *   Z ∈ [0, +w]   (near to far) ← Note: WebGPU uses [0,1] not [-1,1]
 *
 * A point is visible if ALL these conditions are true:
 *   -w ≤ x ≤ +w  AND  -w ≤ y ≤ +w  AND  0 ≤ z ≤ w
 *
 * We expand the bounds by particle radius to prevent particles from
 * popping in/out at frustum edges (the center might be outside but
 * the particle's visual extent overlaps the frustum).
 *
 * Output:
 * -------
 *   visibleIndices[]: Compact list of visible particle indices
 *   indirectArgs.instanceCount: Number of visible particles
 *
 *   Example:
 *     All particles: [0, 1, 2, 3, 4, 5, 6, 7]
 *     Visible:       [0, 2, 5, 7]  (4 particles visible)
 *
 *     indirectArgs = {
 *       vertexCount: 6,        // 6 vertices per particle (quad)
 *       instanceCount: 4,      // 4 particles to draw
 *       firstVertex: 0,
 *       firstInstance: 0
 *     }
 *
 * ============================================================================
 */

// Beginner note: outputs visibleIndices[] and updates indirectArgs.instanceCount.

/**
 * Culling Parameters Uniform Buffer
 *
 * Memory Layout (16-byte aligned, mat4 is 64 bytes):
 * Offset  Size  Field
 * ------  ----  -----
 *   0     64    viewProjection  - Combined view × projection matrix
 *  64      4    radius          - Particle radius for frustum expansion
 *  68      4    particleCount   - Total number of particles
 *  72      8    pad0            - Padding for 16-byte alignment
 * ------
 * Total: 80 bytes
 */
struct CullParams {
  viewProjection: mat4x4<f32>,
  radius: f32,
  particleCount: u32,
  pad0: vec2<f32>,
};

/**
 * Indirect Draw Arguments Structure
 *
 * Matches WebGPU's GPUDrawIndirectArgs layout:
 *   struct GPUDrawIndirectArgs {
 *     vertexCount: u32,    // Vertices per instance (6 for quad)
 *     instanceCount: u32,  // Number of instances to draw
 *     firstVertex: u32,    // Starting vertex index
 *     firstInstance: u32,  // Starting instance index
 *   }
 *
 * instanceCount is atomic because multiple threads increment it
 * concurrently as they discover visible particles.
 */
struct IndirectArgs {
  vertexCount: u32,
  instanceCount: atomic<u32>,
  firstVertex: u32,
  firstInstance: u32,
};

// ============================================================================
// BUFFER BINDINGS
// ============================================================================
// Group 0: Culling compute pass
//
//   Binding 0: positions[]      - Particle positions (world space)
//   Binding 1: visibleIndices[] - Output: compact list of visible indices
//              Pre-allocated to particleCount (worst case all visible)
//   Binding 2: indirectArgs     - Output: draw parameters for rendering
//              instanceCount is atomically incremented for each visible particle
//   Binding 3: params           - Culling parameters (matrix, radius, count)
// ============================================================================

@group(0) @binding(0) var<storage, read> positions: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> visibleIndices: array<u32>;
@group(0) @binding(2) var<storage, read_write> indirectArgs: IndirectArgs;
@group(0) @binding(3) var<uniform> params: CullParams;

/**
 * Main Culling Compute Kernel
 *
 * Tests each particle against the view frustum and builds a list of
 * visible particle indices.
 *
 * Dispatch: ceil(particleCount / 256) workgroups
 *
 * IMPORTANT: Before dispatching, the CPU must reset indirectArgs:
 *   indirectArgs.instanceCount = 0  (will be atomically incremented)
 *   indirectArgs.vertexCount = 6    (6 vertices per particle quad)
 *   indirectArgs.firstVertex = 0
 *   indirectArgs.firstInstance = 0
 */
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let index = id.x;

  // Bounds check
  if (index >= params.particleCount) {
    return;
  }

  // Get particle's world-space position
  let pos = positions[index].xyz;

  // ========================================================================
  // TRANSFORM TO CLIP SPACE
  // ========================================================================
  // clipPos = ViewProjection × worldPos
  //
  // After this transformation:
  //   clipPos.x, clipPos.y, clipPos.z are in homogeneous clip coordinates
  //   clipPos.w is the homogeneous divisor (perspective depth)
  //
  // For points in front of the camera: clipPos.w > 0
  // For points behind the camera: clipPos.w < 0 (automatically culled)
  let clipPos = params.viewProjection * vec4<f32>(pos, 1.0);

  // ========================================================================
  // FRUSTUM TEST IN CLIP SPACE
  // ========================================================================
  // WebGPU uses a specific clip space convention:
  //   X: [-w, +w] maps to screen left to right
  //   Y: [-w, +w] maps to screen bottom to top
  //   Z: [0, +w]  maps to near plane to far plane (depth)
  //
  // A point is visible if:
  //   -w ≤ x ≤ +w  AND  -w ≤ y ≤ +w  AND  0 ≤ z ≤ w
  //
  // We expand bounds by particle radius to prevent popping.
  // This is an approximation (true expansion would be view-dependent),
  // but works well in practice.
  let r = params.radius;

  // Visibility check with radius expansion:
  //   X: from (-w - r) to (+w + r)
  //   Y: from (-w - r) to (+w + r)
  //   Z: from (-r) to (+w + r)  ← Near plane can be slightly negative for radius
  //
  // Note: If clipPos.w < 0 (behind camera), these checks will fail
  // because the inequalities reverse for negative w.

  if (clipPos.x >= -clipPos.w - r && clipPos.x <= clipPos.w + r &&
      clipPos.y >= -clipPos.w - r && clipPos.y <= clipPos.w + r &&
      clipPos.z >= -r && clipPos.z <= clipPos.w + r) {

      // ====================================================================
      // PARTICLE IS VISIBLE - Add to output list
      // ====================================================================
      // Atomically reserve a slot in the visibleIndices array.
      // atomicAdd returns the OLD value (before increment), which becomes
      // our unique write position.
      //
      // Even if many threads pass the visibility test simultaneously,
      // each gets a unique slot due to atomic operation.
      let slot = atomicAdd(&indirectArgs.instanceCount, 1u);

      // Store this particle's index at the reserved slot
      // The render shader will read from visibleIndices[instance_index]
      // to get the actual particle data
      visibleIndices[slot] = index;
  }
  // If not visible, this particle is simply not added to the list
  // (it's as if it doesn't exist for rendering purposes)
}
