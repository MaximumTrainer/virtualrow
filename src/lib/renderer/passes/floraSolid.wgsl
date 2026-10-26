// Solid flora render pass (#562 FR5 / FR6). Low-poly crown + trunk per
// species, drawn per-instance via `drawIndirect` with the compact indices
// the P3 compute cull wrote. Applies a per-vertex sprout fade: the solid
// pool fades out ABOVE `sproutFar`; the sprite pool (scenery.wgsl) fades
// out BELOW `sproutNear`. Together they form the Biketerra-style hybrid
// LOD with no hard swap at a single range.

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

struct Sprout {
  near: f32,
  far: f32,
  _pad: vec2<f32>,
};

@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var<uniform> sprout: Sprout;
@group(1) @binding(0) var<storage, read> centres: array<vec4<f32>>;
@group(1) @binding(1) var<storage, read> indices: array<u32>;

struct VSOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) normal: vec3<f32>,
  @location(1) mix: vec2<f32>,
  @location(2) worldDist: f32,
  @location(3) fade: f32,
  @location(4) @interpolate(flat) species: u32,
};

@vertex
fn vs_main(
  @location(0) position: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) mixAttr: vec2<f32>,
  @builtin(instance_index) ii: u32,
) -> VSOut {
  let instanceId = indices[ii];
  let instance = centres[instanceId];
  let world = instance.xyz + position;
  let d = world - frame.camPos;
  let worldDist = length(vec3<f32>(d.x, 0.0, d.z));
  // Solid fades to zero ABOVE `sproutFar`; peak at `sproutNear`.
  let span = max(1.0, sprout.far - sprout.near);
  let fade = clamp(1.0 - (worldDist - sprout.near) / span, 0.0, 1.0);
  // Species index rides in the bottom 16 bits of the centres.w metadata the
  // foliage planner packs (see `foliagePlan.ts` `batchFoliagePools`), so we
  // can tint each pool's trees without an extra bind group.
  let metaBits = bitcast<u32>(instance.w);
  let species = metaBits & 0xffffu;

  var out: VSOut;
  out.pos = frame.viewProj * vec4<f32>(world, 1.0);
  out.normal = normalize(normal);
  out.mix = mixAttr;
  out.worldDist = worldDist;
  out.fade = fade;
  out.species = species;
  return out;
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  if (in.fade <= 0.001) { discard; }
  let sun = normalize(frame.sunDir);
  // Half-lambert + sky/ground ambient: a sun-lit face reads bright, a
  // down-facing face picks up a touch of ground bounce, and up-facing
  // leaves pick up sky — the old `*0.5+0.6` clamp was flat enough that
  // trees looked like painted cardboard.
  let halfLambert = clamp(dot(in.normal, sun) * 0.5 + 0.5, 0.0, 1.0);
  let sky = clamp(in.normal.y * 0.5 + 0.5, 0.0, 1.0);
  let ambient = mix(vec3<f32>(0.20, 0.19, 0.17), vec3<f32>(0.42, 0.46, 0.52), sky);
  let shade = ambient + halfLambert * halfLambert * 0.9;

  // Per-species palettes mirror the sprite pass's BASE_PAL/CROWN_PAL in
  // `scenery.wgsl` so the near-tree solid handoff keeps the same green as
  // the distant billboards. Trunk is a shared warm brown.
  const TRUNK = vec3<f32>(0.33, 0.22, 0.14);
  const BASE_PAL = array<vec3<f32>, 3>(
    vec3<f32>(0.20, 0.34, 0.18),
    vec3<f32>(0.18, 0.26, 0.16),
    vec3<f32>(0.32, 0.45, 0.22),
  );
  const CROWN_PAL = array<vec3<f32>, 3>(
    vec3<f32>(0.42, 0.60, 0.30),
    vec3<f32>(0.30, 0.52, 0.28),
    vec3<f32>(0.60, 0.74, 0.38),
  );
  let sIdx = min(in.species, 2u);
  let base = BASE_PAL[sIdx];
  let crown = CROWN_PAL[sIdx];
  let foliage = mix(base, crown, clamp(in.mix.y, 0.0, 1.0));
  let col = mix(TRUNK, foliage, clamp(in.mix.x, 0.0, 1.0)) * shade;
  let near = frame.fog.x;
  let far = frame.fog.y;
  let density = near + far * in.worldDist;
  let f = 1.0 - exp(-density * in.worldDist);
  let fogCol = vec3<f32>(0.72, 0.78, 0.82);
  let litCol = mix(col, fogCol, clamp(f, 0.0, 1.0));
  // Fade modulates alpha so the handoff with the sprite pool is a soft blend.
  return vec4<f32>(litCol, in.fade);
}
