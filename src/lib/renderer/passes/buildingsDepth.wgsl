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

const CORNERS = array<vec3<f32>, 36>(
  // -X face
  vec3<f32>(-1.0, 0.0, -1.0), vec3<f32>(-1.0, 0.0,  1.0), vec3<f32>(-1.0, 1.0,  1.0),
  vec3<f32>(-1.0, 0.0, -1.0), vec3<f32>(-1.0, 1.0,  1.0), vec3<f32>(-1.0, 1.0, -1.0),
  // +X face
  vec3<f32>( 1.0, 0.0,  1.0), vec3<f32>( 1.0, 0.0, -1.0), vec3<f32>( 1.0, 1.0, -1.0),
  vec3<f32>( 1.0, 0.0,  1.0), vec3<f32>( 1.0, 1.0, -1.0), vec3<f32>( 1.0, 1.0,  1.0),
  // -Z face
  vec3<f32>( 1.0, 0.0, -1.0), vec3<f32>(-1.0, 0.0, -1.0), vec3<f32>(-1.0, 1.0, -1.0),
  vec3<f32>( 1.0, 0.0, -1.0), vec3<f32>(-1.0, 1.0, -1.0), vec3<f32>( 1.0, 1.0, -1.0),
  // +Z face
  vec3<f32>(-1.0, 0.0,  1.0), vec3<f32>( 1.0, 0.0,  1.0), vec3<f32>( 1.0, 1.0,  1.0),
  vec3<f32>(-1.0, 0.0,  1.0), vec3<f32>( 1.0, 1.0,  1.0), vec3<f32>(-1.0, 1.0,  1.0),
  // Roof
  vec3<f32>(-1.0, 1.0,  1.0), vec3<f32>( 1.0, 1.0,  1.0), vec3<f32>( 1.0, 1.0, -1.0),
  vec3<f32>(-1.0, 1.0,  1.0), vec3<f32>( 1.0, 1.0, -1.0), vec3<f32>(-1.0, 1.0, -1.0),
  // Floor
  vec3<f32>(-1.0, 0.0, -1.0), vec3<f32>( 1.0, 0.0, -1.0), vec3<f32>( 1.0, 0.0,  1.0),
  vec3<f32>(-1.0, 0.0, -1.0), vec3<f32>( 1.0, 0.0,  1.0), vec3<f32>(-1.0, 0.0,  1.0),
);

@vertex
fn vs_main(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> @builtin(position) vec4<f32> {
  let instance = centres[ii];
  let origin = vec2<f32>(instance.x, instance.y);
  let height = max(0.1, instance.z);
  let half = sizes[ii];
  let corner = CORNERS[vi];
  let world = vec3<f32>(origin.x + corner.x * half.x, corner.y * height, origin.y + corner.z * half.y);
  return cascade.viewProj * vec4<f32>(world, 1.0);
}

@fragment
fn fs_main() {
  // Depth-only; opaque, no alpha discard.
}
