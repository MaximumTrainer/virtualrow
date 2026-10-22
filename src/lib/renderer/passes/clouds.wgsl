// Procedural cloud layer (#566 FR6, D7-a). Fullscreen quad drawn after
// the sky, before the lit passes. Reads the frame uniform's `time` and
// `sunDir` so clouds scroll with the wind direction and brighten toward
// the sun. 2D value-noise, two octaves — zero-asset and cheap, and the
// alpha blend keeps the sky visible through gaps.

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
  let xy = vec2<f32>(
    f32((vid << 1u) & 2u),
    f32(vid & 2u),
  );
  var out: VSOut;
  out.ndc = xy * 2.0 - 1.0;
  // Just inside the sky's z (sky draws at 0.9999 with depthCompare 'always';
  // we draw clouds at 0.9998 so the lit passes still write over them).
  out.pos = vec4<f32>(out.ndc, 0.9998, 1.0);
  return out;
}

fn hash12(p: vec2<f32>) -> f32 {
  var p3 = fract(vec3<f32>(p.xyx) * 0.1031);
  p3 = p3 + dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

fn valueNoise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let a = hash12(i);
  let b = hash12(i + vec2<f32>(1.0, 0.0));
  let c = hash12(i + vec2<f32>(0.0, 1.0));
  let d = hash12(i + vec2<f32>(1.0, 1.0));
  let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  // Push samples toward the horizon in Y so clouds thin out near the top.
  // ndc.y goes -1 (bottom) → +1 (top); we only render clouds for y > 0.
  let altitude = clamp(in.ndc.y, 0.0, 1.0);
  if (altitude < 0.02) {
    return vec4<f32>(0.0, 0.0, 0.0, 0.0);
  }
  // UV scroll: a slow uniform drift. Future wind source will replace the
  // constants here (parked in #567 as `animated cloud flow`).
  let scroll = vec2<f32>(frame.time * 0.012, frame.time * 0.004);
  let uv = in.ndc * vec2<f32>(2.0, 1.0) + scroll;

  // Two-octave value noise, lightly ridged.
  let n1 = valueNoise(uv * 2.5);
  let n2 = valueNoise(uv * 5.3 + vec2<f32>(13.0, 7.0));
  var density = n1 * 0.65 + n2 * 0.35;
  // Soft horizon fade and top fade so clouds live in a band.
  density = density * smoothstep(0.02, 0.35, altitude) * (1.0 - smoothstep(0.75, 0.98, altitude));
  // Threshold so the alpha has gaps rather than a uniform haze.
  let cover = smoothstep(0.46, 0.72, density);
  let shade = 0.78 + 0.22 * max(normalize(frame.sunDir).y, 0.0);
  let col = vec3<f32>(shade);
  return vec4<f32>(col, cover * 0.85);
}
