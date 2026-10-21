// Bank pass (#550 FR7): draws the two riverside strips. P2 ports the ground
// *colour* of `bankMaterial.ts` — procedural ground with a mild noise band
// along the water edge. Grass density (#496 model) is P5.

struct Frame {
  view: mat4x4<f32>,
  proj: mat4x4<f32>,
  viewProj: mat4x4<f32>,
  camPos: vec3<f32>,
  _pad0: f32,
  sunDir: vec3<f32>,
  _pad1: f32,
  fog: vec4<f32>,
  time: f32,
  _pad2: vec3<f32>,
};

@group(0) @binding(0) var<uniform> frame: Frame;

struct VSOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) worldXZ: vec2<f32>,
  @location(1) side: f32,
};

@vertex
fn vs_main(
  @location(0) position: vec3<f32>,
  @location(1) side: f32,
) -> VSOut {
  var out: VSOut;
  out.pos = frame.viewProj * vec4<f32>(position, 1.0);
  out.worldXZ = position.xz;
  out.side = side;
  return out;
}

fn hash12(p: vec2<f32>) -> f32 {
  var p3 = fract(vec3<f32>(p.xyx) * 0.1031);
  p3 = p3 + dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  let base = vec3<f32>(0.32, 0.42, 0.22); // damp grass
  let dry = vec3<f32>(0.52, 0.49, 0.33);
  let n = hash12(floor(in.worldXZ * 2.0));
  let col = mix(base, dry, n * 0.4);
  return vec4<f32>(col, 1.0);
}
