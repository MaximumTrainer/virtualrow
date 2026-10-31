// Boat + ghost render pass (#570 FR1-FR3). Draws the boat mesh with a
// per-draw model matrix in `BoatUniforms`. The crew bones are sampled from
// `BoatSkin` so a bone-index of 0 (hull) stays rigid while bones 1..3 pick
// up the stroke-driven rotations. The ghost reuses this pipeline — a flag
// in `uGhost` enables the alpha + tint path.

struct Frame {
  view: mat4x4<f32>,
  proj: mat4x4<f32>,
  viewProj: mat4x4<f32>,
  camPos: vec4<f32>,
  sunDir: vec4<f32>,
  fog: vec4<f32>,
  time: f32,
};

struct BoatUniforms {
  model: mat4x4<f32>,
  tint: vec4<f32>,     // rgb + alpha
  flags: vec4<f32>,    // x=isGhost (0/1); y..w unused
};

struct BoatSkin {
  bones: array<mat4x4<f32>, 4>,
};

@group(0) @binding(0) var<uniform> frame: Frame;
@group(2) @binding(0) var<uniform> boat: BoatUniforms;
@group(2) @binding(1) var<uniform> skin: BoatSkin;

struct VsIn {
  @location(0) position: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) boneIndex: f32,
  @location(3) boneWeight: f32,
};

struct VsOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) worldPos: vec3<f32>,
  @location(1) viewZ: f32,
  @location(2) worldNormal: vec3<f32>,
};

@vertex
fn vs_main(input: VsIn) -> VsOut {
  let idx = u32(round(input.boneIndex));
  let w = input.boneWeight;
  // Pure 4-bone skin — one bone per vertex (hard-skinned, D2-a). The branch
  // on idx keeps the vertex shader small; a palette with weights is parked
  // for #556.
  let boneMat = skin.bones[idx];
  let local4 = vec4<f32>(input.position, 1.0);
  let skinned = boneMat * local4;
  let world4 = boat.model * skinned;
  let normal4 = boat.model * vec4<f32>((boneMat * vec4<f32>(input.normal, 0.0)).xyz, 0.0);

  var out: VsOut;
  out.clip = frame.viewProj * world4;
  out.worldPos = world4.xyz;
  out.worldNormal = normalize(normal4.xyz);
  // Reverse-sign view-space Z so it is positive looking forward.
  let viewPos = frame.view * world4;
  out.viewZ = -viewPos.z;
  return out;
}

@fragment
fn fs_main(input: VsOut) -> @location(0) vec4<f32> {
  let lightDir = normalize(frame.sunDir.xyz);
  let n = normalize(input.worldNormal);
  let diffuse = max(dot(n, lightDir), 0.0);
  let ambient = 0.35;
  let shade = ambient + 0.65 * diffuse;
  let baseColor = boat.tint.rgb * shade;
  let alpha = boat.tint.a;
  return vec4<f32>(baseColor, alpha);
}
