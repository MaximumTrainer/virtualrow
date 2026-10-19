// Foliage frustum + distance cull on the GPU (#498 spike).
//
// Reads one tree per invocation, keeps the ones inside the view frustum AND
// inside the cull radius, and appends their index to a compact visibleIndices
// buffer whose length is held in an atomic counter. The kernel's parity target
// is `compactVisible` in src/components/rower3d/foliagePlan.ts — same cull
// radius, same frustum, same tree set.
//
// The six frustum planes are the standard three.js layout (xyzw = plane
// equation Ax+By+Cz+D=0 with the normal pointing INTO the frustum, so a point
// is inside the plane when plane.xyz·p + plane.w >= 0). We only have an xz
// centre per tree, so y is approximated by `uniforms.treeY`, the chunk's mean
// ground height, which is close enough for the 400 m billboard scale.

struct CullUniforms {
  boat: vec2<f32>,
  rangeSquared: f32,
  treeY: f32,
  frustumPlanes: array<vec4<f32>, 6>,
  instanceCount: u32,
  _pad: vec3<u32>,
};

@group(0) @binding(0) var<uniform> uniforms: CullUniforms;
@group(0) @binding(1) var<storage, read> instanceCentres: array<vec2<f32>>;
@group(0) @binding(2) var<storage, read_write> visibleIndices: array<u32>;
@group(0) @binding(3) var<storage, read_write> visibleCount: atomic<u32>;

fn insideFrustum(centre: vec3<f32>) -> bool {
  for (var i: u32 = 0u; i < 6u; i = i + 1u) {
    let plane = uniforms.frustumPlanes[i];
    if (dot(plane.xyz, centre) + plane.w < 0.0) {
      return false;
    }
  }
  return true;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= uniforms.instanceCount) {
    return;
  }
  let centre = instanceCentres[i];
  let dx = centre.x - uniforms.boat.x;
  let dz = centre.y - uniforms.boat.y;
  if (dx * dx + dz * dz > uniforms.rangeSquared) {
    return;
  }
  if (!insideFrustum(vec3<f32>(centre.x, uniforms.treeY, centre.y))) {
    return;
  }
  let slot = atomicAdd(&visibleCount, 1u);
  visibleIndices[slot] = i;
}
