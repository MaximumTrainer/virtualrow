// GLB-kit scenery shadow-depth pass (#591-fu P1c). Mirrors the lit
// `sceneryMesh.wgsl` geometry so the shadow volume matches the lit
// kit mesh. Only `position` is needed for depth; colour and normal are
// unused. GLB kit is opaque, so no alpha discard — a plain depth write
// is enough.

struct SceneryMeshDepth {
  viewProj: mat4x4<f32>,
};
@group(0) @binding(0) var<uniform> cascade: SceneryMeshDepth;
@group(1) @binding(0) var<storage, read> instances: array<mat4x4<f32>>;

@vertex
fn vs_main(
  @location(0) position: vec3<f32>,
  @builtin(instance_index) ii: u32,
) -> @builtin(position) vec4<f32> {
  let model = instances[ii];
  let world = model * vec4<f32>(position, 1.0);
  return cascade.viewProj * world;
}

@fragment
fn fs_main() {
  // Depth-only; opaque, no alpha discard.
}
