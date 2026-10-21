// Water pass (#550 FR6, #559 lit receiver): route-aligned strip. P2 ships
// colour and a Gerstner ripple approximation of today's
// `waterMaterial.ts` look. Reflections and caustics are later phases.
// P4 adds a shadow receiver via the shared `sampleShadow` snippet
// (injected from `shaderSnippets.ts` at pipeline-build time).

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
  @location(1) worldPos: vec3<f32>,
  @location(2) viewZ: f32,
};

@vertex
fn vs_main(@location(0) position: vec3<f32>) -> VSOut {
  let k = vec2<f32>(0.9, 0.2);
  let w = dot(k, position.xz) + frame.time * 1.3;
  let dy = sin(w) * 0.08 + sin(w * 1.9 + 0.4) * 0.04;
  let p = vec3<f32>(position.x, position.y + dy, position.z);

  var out: VSOut;
  out.pos = frame.viewProj * vec4<f32>(p, 1.0);
  out.worldXZ = position.xz;
  out.worldPos = p;
  let viewPos = frame.view * vec4<f32>(p, 1.0);
  out.viewZ = -viewPos.z;
  return out;
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  let shallow = vec3<f32>(0.22, 0.52, 0.58);
  let deep = vec3<f32>(0.07, 0.22, 0.36);
  let ripple = 0.5 + 0.5 * sin(in.worldXZ.x * 0.6 + frame.time * 2.0)
                   * cos(in.worldXZ.y * 0.5 - frame.time * 1.1);
  let col = mix(deep, shallow, ripple * 0.6);
  let lit = sampleShadow(in.worldPos, in.viewZ);
  // Water takes a lighter shadow — only the reflection dims.
  let shaded = col * (0.75 + 0.25 * lit);
  return vec4<f32>(shaded, 1.0);
}
