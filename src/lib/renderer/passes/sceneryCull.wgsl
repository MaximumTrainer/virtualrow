// Scenery compute cull (#555 FR2, D2-c frustum + distance only).
//
// One dispatch per pool. Reads the pool's centres buffer (vec4<f32> per
// instance; .xyz = world position, .w = packed u32 metadata via bitcast)
// and writes:
//   * `indices`: compact u32 array of surviving instance IDs.
//   * `indirect`: IndirectDrawArgs {indexCount, instanceCount, firstIndex,
//     baseVertex, firstInstance}; `.instanceCount` is grown atomically.
//
// Frustum uses six Hessian-form planes from the frame's view-projection
// matrix. Distance uses `camPos` + `maxDistance`. Hi-Z occlusion is deferred
// to #556 per D2-c.
//
// #556 polish — workgroup aggregation. The previous implementation did one
// `atomicAdd(&instanceCount, 1)` per surviving instance, so a dense pool
// serialised 64 threads through the same cache line and starved the
// scheduler. We now count survivors in a workgroup-local atomic, reserve
// the global range once per workgroup, and each surviving thread writes
// its index at `global_base + local_slot`. Global atomic traffic drops
// from O(N) to O(N / workgroup_size); the compact output is identical
// to the pre-polish version apart from ordering WITHIN each workgroup's
// block (which no consumer cares about — the indices buffer is read as
// a bag of instance ids, not an ordered list).

struct CullUniforms {
  // Six planes: nx, ny, nz, d. The point is inside the frustum when
  // dot(plane.xyz, p) + plane.w >= -radius for every plane.
  planes: array<vec4<f32>, 6>,
  camPos: vec4<f32>, // .xyz; .w = maxDistance
  // .xyz = world-space centre of the pool, .w = chunk radius for the sphere
  // test. The pool-level sphere is already checked on the CPU, but we keep
  // the radius so the per-instance test can treat each tree as a sphere of
  // this radius (coarse crown + sway margin).
  bounds: vec4<f32>,
  // Pre-computed: .x = indexCount per instance, .y = baseVertex,
  // .z = firstIndex, .w = unused.
  draw: vec4<u32>,
};

struct IndirectDrawArgs {
  indexCount: u32,
  instanceCount: atomic<u32>,
  firstIndex: u32,
  baseVertex: u32,
  firstInstance: u32,
};

@group(0) @binding(0) var<uniform> uniforms: CullUniforms;
@group(0) @binding(1) var<storage, read> centres: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> indices: array<u32>;
@group(0) @binding(3) var<storage, read_write> indirect: IndirectDrawArgs;

fn sphere_in_frustum(centre: vec3<f32>, radius: f32) -> bool {
  for (var i = 0u; i < 6u; i = i + 1u) {
    let p = uniforms.planes[i];
    let d = dot(p.xyz, centre) + p.w;
    if (d < -radius) {
      return false;
    }
  }
  return true;
}

// Workgroup-shared counter + reserved base. One atomicAdd on `local_count`
// per surviving thread (cheap, cache-line-local), then thread 0 reserves
// the group's global range with a single atomicAdd on `instanceCount`.
var<workgroup> local_count: atomic<u32>;
var<workgroup> global_base: u32;

@compute @workgroup_size(64)
fn cs_main(
  @builtin(global_invocation_id) gid: vec3<u32>,
  @builtin(local_invocation_id) lid: vec3<u32>,
) {
  // Thread 0 of workgroup 0 primes the fixed draw-arg fields once per
  // dispatch. Separate `if (gid.x == 0u)` block so the WG-local branch
  // below stays independent.
  if (gid.x == 0u) {
    indirect.indexCount = uniforms.draw.x;
    indirect.firstIndex = uniforms.draw.z;
    indirect.baseVertex = uniforms.draw.y;
    indirect.firstInstance = 0u;
  }
  if (lid.x == 0u) {
    atomicStore(&local_count, 0u);
  }
  workgroupBarrier();

  let total = arrayLength(&centres);
  let idx = gid.x;
  var survives = false;
  var local_slot: u32 = 0u;
  if (idx < total) {
    let instance = centres[idx];
    let centre = instance.xyz;
    let crown = uniforms.bounds.w;

    // Distance cull: cheap xz-radius check matching today's `compactVisible`.
    let dx = centre.x - uniforms.camPos.x;
    let dz = centre.z - uniforms.camPos.z;
    let maxDistance = uniforms.camPos.w;
    let in_range = (dx * dx + dz * dz) <= (maxDistance * maxDistance);
    if (in_range && sphere_in_frustum(centre, crown)) {
      survives = true;
      local_slot = atomicAdd(&local_count, 1u);
    }
  }
  workgroupBarrier();

  if (lid.x == 0u) {
    let cnt = atomicLoad(&local_count);
    global_base = atomicAdd(&indirect.instanceCount, cnt);
  }
  workgroupBarrier();

  if (survives) {
    indices[global_base + local_slot] = idx;
  }
}
