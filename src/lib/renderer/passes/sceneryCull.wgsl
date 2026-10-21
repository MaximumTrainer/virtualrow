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

@compute @workgroup_size(64)
fn cs_main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let total = arrayLength(&centres);
  let idx = gid.x;
  if (idx >= total) {
    return;
  }

  // Prime the fixed draw-arg fields on the first thread. The atomic grows
  // `instanceCount` as culled survivors are appended.
  if (idx == 0u) {
    indirect.indexCount = uniforms.draw.x;
    indirect.firstIndex = uniforms.draw.z;
    indirect.baseVertex = uniforms.draw.y;
    indirect.firstInstance = 0u;
  }

  let instance = centres[idx];
  let centre = instance.xyz;
  let crown = uniforms.bounds.w;

  // Distance cull: a cheap xz-radius check matching today's `compactVisible`.
  let dx = centre.x - uniforms.camPos.x;
  let dz = centre.z - uniforms.camPos.z;
  let maxDistance = uniforms.camPos.w;
  if (dx * dx + dz * dz > maxDistance * maxDistance) {
    return;
  }

  if (!sphere_in_frustum(centre, crown)) {
    return;
  }

  // Append the surviving instance id to the compact `indices` list.
  let slot = atomicAdd(&indirect.instanceCount, 1u);
  indices[slot] = idx;
}
