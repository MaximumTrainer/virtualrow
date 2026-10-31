// Buildings shadow-depth pass (#566 FR4, D4-a). Mirrors `sceneryDepth`
// in shape: one draw per cascade, instance-indexed over the same
// centres/sizes buffers the lit pass uses. No colour target, no shadow
// receive. Builds the prism from `vertex_index` + `instance_index`
// alone so the depth atlas records the full occluder volume.

struct BuildingsDepth {
  viewProj: mat4x4<f32>,
};
@group(0) @binding(0) var<uniform> cascade: BuildingsDepth;
@group(1) @binding(0) var<storage, read> centres: array<vec4<f32>>;
@group(1) @binding(1) var<storage, read> sizes: array<vec2<f32>>;

// 48 verts = 36 box + 12 pyramid roof. Mirrors the lit `buildings.wgsl`
// `CORNERS` byte-for-byte so the shadow volume matches what the lit pass
// draws, including the pyramid-roof apex sentinel (`corner.y = 2.0`).
const CORNERS = array<vec3<f32>, 48>(
  vec3<f32>(-1.0, 0.0, -1.0), vec3<f32>(-1.0, 0.0,  1.0), vec3<f32>(-1.0, 1.0,  1.0),
  vec3<f32>(-1.0, 0.0, -1.0), vec3<f32>(-1.0, 1.0,  1.0), vec3<f32>(-1.0, 1.0, -1.0),
  vec3<f32>( 1.0, 0.0,  1.0), vec3<f32>( 1.0, 0.0, -1.0), vec3<f32>( 1.0, 1.0, -1.0),
  vec3<f32>( 1.0, 0.0,  1.0), vec3<f32>( 1.0, 1.0, -1.0), vec3<f32>( 1.0, 1.0,  1.0),
  vec3<f32>( 1.0, 0.0, -1.0), vec3<f32>(-1.0, 0.0, -1.0), vec3<f32>(-1.0, 1.0, -1.0),
  vec3<f32>( 1.0, 0.0, -1.0), vec3<f32>(-1.0, 1.0, -1.0), vec3<f32>( 1.0, 1.0, -1.0),
  vec3<f32>(-1.0, 0.0,  1.0), vec3<f32>( 1.0, 0.0,  1.0), vec3<f32>( 1.0, 1.0,  1.0),
  vec3<f32>(-1.0, 0.0,  1.0), vec3<f32>( 1.0, 1.0,  1.0), vec3<f32>(-1.0, 1.0,  1.0),
  vec3<f32>(-1.0, 1.0,  1.0), vec3<f32>( 1.0, 1.0,  1.0), vec3<f32>( 1.0, 1.0, -1.0),
  vec3<f32>(-1.0, 1.0,  1.0), vec3<f32>( 1.0, 1.0, -1.0), vec3<f32>(-1.0, 1.0, -1.0),
  vec3<f32>(-1.0, 0.0, -1.0), vec3<f32>( 1.0, 0.0, -1.0), vec3<f32>( 1.0, 0.0,  1.0),
  vec3<f32>(-1.0, 0.0, -1.0), vec3<f32>( 1.0, 0.0,  1.0), vec3<f32>(-1.0, 0.0,  1.0),
  // Pyramid roof slopes (apex uses sentinel y=2.0).
  vec3<f32>(-1.0, 1.0, -1.0), vec3<f32>(-1.0, 1.0,  1.0), vec3<f32>( 0.0, 2.0,  0.0),
  vec3<f32>( 1.0, 1.0,  1.0), vec3<f32>( 1.0, 1.0, -1.0), vec3<f32>( 0.0, 2.0,  0.0),
  vec3<f32>( 1.0, 1.0, -1.0), vec3<f32>(-1.0, 1.0, -1.0), vec3<f32>( 0.0, 2.0,  0.0),
  vec3<f32>(-1.0, 1.0,  1.0), vec3<f32>( 1.0, 1.0,  1.0), vec3<f32>( 0.0, 2.0,  0.0),
);

@vertex
fn vs_main(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> @builtin(position) vec4<f32> {
  let instance = centres[ii];
  let origin = vec2<f32>(instance.x, instance.y);
  let height = max(0.1, instance.z);
  let half = sizes[ii];
  let corner = CORNERS[vi];
  // Pyramid apex: same scaling the lit pass uses.
  let isApex = corner.y > 1.5;
  let roofHeight = clamp(min(half.x, half.y) * 0.9, 1.0, 4.0);
  var worldY: f32;
  if (isApex) {
    worldY = height + roofHeight;
  } else {
    worldY = corner.y * height;
  }
  let world = vec3<f32>(origin.x + corner.x * half.x, worldY, origin.y + corner.z * half.y);
  return cascade.viewProj * vec4<f32>(world, 1.0);
}

@fragment
fn fs_main() {
  // Depth-only; opaque, no alpha discard.
}
