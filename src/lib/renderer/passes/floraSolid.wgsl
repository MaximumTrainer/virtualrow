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
@group(0) @binding(2) var leafAtlas: texture_2d<f32>;
@group(0) @binding(3) var leafSampler: sampler;
@group(1) @binding(0) var<storage, read> centres: array<vec4<f32>>;
@group(1) @binding(1) var<storage, read> indices: array<u32>;

struct VSOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) normal: vec3<f32>,
  @location(1) mix: vec2<f32>,
  @location(2) worldDist: f32,
  @location(3) fade: f32,
  @location(4) @interpolate(flat) species: u32,
  // #591-fu P1b: per-instance tint seed in [0, 1). Derived from the
  // instance id (sway seed in metaBits >> 16) and read in the fragment to
  // jitter crown hue + lightness so a stand of trees doesn't read as the
  // same stamp repeated.
  @location(5) tintSeed: f32,
  // #591-fu P1a: 2D UV into the leaf atlas, from (species-column offset +
  // angle-around-trunk, crown-height). The angle makes the texture wrap
  // smoothly around a cone without a visible seam at the back.
  @location(6) leafUv: vec2<f32>,
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
  // Sway seed in the top 16 bits — reused as the per-instance tint seed so
  // crown hue + leaf-atlas sampling vary across a pool. Normalised to [0, 1).
  let tintSeed = f32((metaBits >> 16u) & 0xffffu) / 65536.0;

  // Leaf-atlas UV. Species column is 1/3 of the atlas wide so each entry
  // of SPECIES_COL_OFFSET lines up with `paintLeafAtlas`'s column edges.
  // Angle around the local trunk gives horizontal wrap; mix.y is the
  // vertex-shader's crown-height proxy from `buildFloraSolidMesh`.
  let SPECIES_COL_WIDTH = 1.0 / 3.0;
  let colIdx = min(species, 2u);
  let colStart = f32(colIdx) * SPECIES_COL_WIDTH;
  let angle = atan2(position.z, position.x);
  let u = colStart + (angle * 0.1591549 + 0.5) * SPECIES_COL_WIDTH;
  let v = clamp(mixAttr.y, 0.0, 1.0);

  var out: VSOut;
  out.pos = frame.viewProj * vec4<f32>(world, 1.0);
  out.normal = normalize(normal);
  out.mix = mixAttr;
  out.worldDist = worldDist;
  out.fade = fade;
  out.species = species;
  out.tintSeed = tintSeed;
  out.leafUv = vec2<f32>(u, v);
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
  // the distant billboards. Trunk is a shared warm brown. Species 3 and 4
  // carry reeds and rocks (ported from React `vegetationComponents.tsx`):
  // the mesh builder gives reeds `mix = (1, …)` so they land on the base
  // palette (dry warm reed) and rocks `mix = (0, …)` so they land on the
  // trunk-swap colour — a plain mid-grey piped through `TRUNK_PAL`.
  const TRUNK_PAL = array<vec3<f32>, 5>(
    vec3<f32>(0.33, 0.22, 0.14),
    vec3<f32>(0.33, 0.22, 0.14),
    vec3<f32>(0.33, 0.22, 0.14),
    vec3<f32>(0.60, 0.52, 0.32),
    vec3<f32>(0.42, 0.42, 0.44),
  );
  const BASE_PAL = array<vec3<f32>, 5>(
    vec3<f32>(0.20, 0.34, 0.18),
    vec3<f32>(0.18, 0.26, 0.16),
    vec3<f32>(0.32, 0.45, 0.22),
    vec3<f32>(0.68, 0.60, 0.32),
    vec3<f32>(0.46, 0.45, 0.46),
  );
  const CROWN_PAL = array<vec3<f32>, 5>(
    vec3<f32>(0.42, 0.60, 0.30),
    vec3<f32>(0.30, 0.52, 0.28),
    vec3<f32>(0.60, 0.74, 0.38),
    vec3<f32>(0.82, 0.74, 0.38),
    vec3<f32>(0.56, 0.55, 0.54),
  );
  let sIdx = min(in.species, 4u);
  let trunk = TRUNK_PAL[sIdx];
  let base = BASE_PAL[sIdx];
  let crown = CROWN_PAL[sIdx];

  // Per-instance jitter (#591-fu P1b). `tintSeed` is a stable [0, 1) hash
  // of the instance id; shift the crown slightly cooler/warmer and ±10%
  // in lightness so a stand of trees doesn't read as the same stamp. The
  // trunk takes a smaller jitter so trunks stay recognisably brown.
  let tintJitter = (in.tintSeed - 0.5) * 2.0;
  let crownTint = clamp(vec3<f32>(
    1.0 + tintJitter * 0.08,
    1.0 + tintJitter * 0.05,
    1.0 - tintJitter * 0.06,
  ), vec3<f32>(0.7), vec3<f32>(1.3));
  let lightJitter = 1.0 + tintJitter * 0.10;
  let crownVar = crown * crownTint * lightJitter;
  let baseVar = base * crownTint * lightJitter;
  let trunkVar = trunk * (1.0 + tintJitter * 0.05);

  // Leaf-atlas modulation (#591-fu P1a). WGSL requires `textureSample`
  // under uniform control flow, so always sample and gate the effect with
  // a `select()` instead of branching: trees (species 0-2) take the leaf
  // modulation; reeds (3) and rocks (4) take the plain foliage colour
  // because their atlas region would read as broadleaf and the geometry
  // already carries their silhouette. Fragment stays depth-opaque; the
  // alpha channel feeds a soft under-canopy darken, no alpha-test.
  let leaf = textureSample(leafAtlas, leafSampler, in.leafUv);
  let leafMul = 0.55 + 0.9 * leaf.r;
  let underCanopy = 0.6 + 0.4 * leaf.a;
  let plainFoliage = mix(baseVar, crownVar, clamp(in.mix.y, 0.0, 1.0));
  let leafyFoliage = plainFoliage * leafMul * underCanopy;
  let foliage = select(plainFoliage, leafyFoliage, in.species < 3u);
  let col = mix(trunkVar, foliage, clamp(in.mix.x, 0.0, 1.0)) * shade;
  let near = frame.fog.x;
  let far = frame.fog.y;
  let density = near + far * in.worldDist;
  let f = 1.0 - exp(-density * in.worldDist);
  let fogCol = vec3<f32>(0.72, 0.78, 0.82);
  let litCol = mix(col, fogCol, clamp(f, 0.0, 1.0));
  // Fade modulates alpha so the handoff with the sprite pool is a soft blend.
  return vec4<f32>(litCol, in.fade);
}
