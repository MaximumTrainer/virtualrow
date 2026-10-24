// Sky pass (#550 FR8, upgraded in #566 FR5 to a Preetham-ish analytic
// model). The horizon colour varies with the sun's XZ azimuth so a
// setting sun pulls warm tones from the horizon the sun is on, and the
// opposite horizon stays cool. The zenith stays blue regardless. The
// cheap sun disc from P2 stays — a full atmospheric model with Rayleigh
// / Mie is a #567 backlog candidate.

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
  // t = 0 at the bottom edge, 1 at the top.
  let t = clamp(in.ndc.y * 0.5 + 0.5, 0.0, 1.0);

  // Horizon palette: cool and warm. We mix between them by `azimuthDot`,
  // which is 1 when the fragment is in the sun's azimuth, -1 opposite,
  // 0 at 90°. This gives the whole horizon ring a varying hue instead
  // of a static one — the Preetham model's dominant visual, cheap.
  let sunDir = normalize(frame.sunDir);
  let sunAzimuth = normalize(vec2<f32>(sunDir.x, sunDir.z));
  // ndc.x maps roughly to view azimuth; this is intentionally a cheap
  // approximation that works for the fixed-camera smoke and the chase
  // camera the engine uses — a view-ray lookup is a later refinement.
  let viewAzimuth = normalize(vec2<f32>(in.ndc.x, -1.0));
  let azimuthDot = dot(sunAzimuth, viewAzimuth);
  let warmShare = clamp(azimuthDot * 0.5 + 0.5, 0.0, 1.0);

  let coolHorizon = vec3<f32>(0.70, 0.80, 0.92);
  let warmHorizon = vec3<f32>(0.98, 0.80, 0.55);
  let horizon = mix(coolHorizon, warmHorizon, warmShare * max(sunDir.y, 0.0));

  // Zenith stays blue; a touch darker when the sun is low.
  let dayZenith = vec3<f32>(0.32, 0.52, 0.86);
  let nightZenith = vec3<f32>(0.08, 0.13, 0.26);
  let zenith = mix(nightZenith, dayZenith, clamp(sunDir.y, 0.0, 1.0));

  var col = mix(horizon, zenith, t);

  // Cheap sun disc as before: scale the sun's XY by a soft radius.
  let sun2 = normalize(vec2<f32>(sunDir.x, sunDir.y));
  let d = length(in.ndc - sun2 * 0.6);
  let sun = smoothstep(0.18, 0.08, d);
  col = col + vec3<f32>(1.0, 0.95, 0.85) * sun * 0.6;

  return vec4<f32>(col, 1.0);
}
