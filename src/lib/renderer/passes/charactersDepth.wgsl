// Characters depth pass (#570 FR8, D7-a). Casts boat + crew into a cascade
// of the shadow atlas. Same mesh buffer as `boat.ts`, same skin bones, but
// writes only depth with no colour or lighting.

struct CascadeUniform {
  viewProj: mat4x4<f32>,
};

struct BoatUniforms {
  model: mat4x4<f32>,
  tint: vec4<f32>,
  flags: vec4<f32>,
};

struct BoatSkin {
  bones: array<mat4x4<f32>, 4>,
};

@group(0) @binding(0) var<uniform> cascade: CascadeUniform;
@group(1) @binding(0) var<uniform> boat: BoatUniforms;
@group(1) @binding(1) var<uniform> skin: BoatSkin;

struct VsIn {
  @location(0) position: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) boneIndex: f32,
  @location(3) boneWeight: f32,
};

@vertex
fn vs_main(input: VsIn) -> @builtin(position) vec4<f32> {
  let idx = u32(round(input.boneIndex));
  let boneMat = skin.bones[idx];
  let world = boat.model * (boneMat * vec4<f32>(input.position, 1.0));
  return cascade.viewProj * world;
}
