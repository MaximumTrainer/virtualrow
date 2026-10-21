// Bank shadow-depth pass (#559 FR4). Depth-only; one draw per cascade.
// Vertex shader mirrors `bank.wgsl`'s world-space geometry but applies
// the per-cascade light view-projection instead of the camera's.

struct BankDepth {
  viewProj: mat4x4<f32>,
};
@group(0) @binding(0) var<uniform> cascade: BankDepth;

@vertex
fn vs_main(
  @location(0) position: vec3<f32>,
  @location(1) side: f32,
) -> @builtin(position) vec4<f32> {
  // `side` isn't used for depth but keep the attribute to share the
  // same vertex-buffer layout as the lit bank pass.
  let _unused = side;
  return cascade.viewProj * vec4<f32>(position, 1.0);
}
