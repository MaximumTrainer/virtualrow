// Sky pass (#550 FR8): a procedural dome drawn as a fullscreen triangle.
// Gradient from horizon to zenith + a soft sun disc. P2 ships enough of a
// sky for the water and bank to have an environment behind them; the full
// cloud/fog model from `cloudPlan.ts` / `fogPlan.ts` lands in P8.

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
  @location(0) ndc: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> VSOut {
  // One oversized triangle covering the viewport.
  let xy = vec2<f32>(
    f32((vid << 1u) & 2u),
    f32(vid & 2u),
  );
  var out: VSOut;
  out.ndc = xy * 2.0 - 1.0;
  out.pos = vec4<f32>(out.ndc, 0.9999, 1.0);
  return out;
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  // Horizon gradient driven by the Y of the NDC.
  let t = clamp(in.ndc.y * 0.5 + 0.5, 0.0, 1.0);
  let horizon = vec3<f32>(0.78, 0.86, 0.95);
  let zenith = vec3<f32>(0.35, 0.56, 0.86);
  var col = mix(horizon, zenith, t);

  // Cheap sun disc: distance from a point driven by sunDir's XY.
  let sun2 = normalize(vec2<f32>(frame.sunDir.x, frame.sunDir.y));
  let d = length(in.ndc - sun2 * 0.6);
  let sun = smoothstep(0.18, 0.08, d);
  col = col + vec3<f32>(1.0, 0.95, 0.85) * sun * 0.6;

  return vec4<f32>(col, 1.0);
}
