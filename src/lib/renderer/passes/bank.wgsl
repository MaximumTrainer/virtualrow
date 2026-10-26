// Bank pass (#550 FR7, #559 lit receiver): draws the two riverside strips.
// P2 ports the ground *colour* of `bankMaterial.ts` — procedural ground
// with a mild noise band along the water edge. P5 ported the per-biome
// density tile from React's `bankTriplanar.glsl` `grassDensityModulation`
// chunk: `grassTile` carries a baked density field (R channel) and
// `grass.strength` scales how much it biases the colour, so a lusher
// biome reads lusher at the ride-view camera; `strength = 0` on tiers
// where `isShaderGrassEnabled` is false. P4 adds a shadow receiver via
// the shared `sampleShadow` snippet (injected from `shaderSnippets.ts`
// at pipeline-build time).

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

struct Grass {
  strength: f32,
  tileMetres: f32,
  _pad: vec2<f32>,
};

@group(0) @binding(0) var<uniform> frame: Frame;
@group(2) @binding(0) var<uniform> grass: Grass;
@group(2) @binding(1) var grassTile: texture_2d<f32>;
@group(2) @binding(2) var grassSampler: sampler;

struct VSOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) worldXZ: vec2<f32>,
  @location(1) side: f32,
  @location(2) worldPos: vec3<f32>,
  @location(3) viewZ: f32,
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
  out.worldPos = position;
  let viewPos = frame.view * vec4<f32>(position, 1.0);
  out.viewZ = -viewPos.z;
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
  var col = mix(base, dry, n * 0.4);

  // Biome-density grass modulation (#496 Phase 2, ported from
  // `bankTriplanar.glsl`'s `grassDensityModulation` chunk). The red
  // channel of the baked tile is sampled on a 32 m plan-view grid, then
  // biased from 0.5 to (density - 0.5) × 1.12 so a wetter biome tints
  // the bank greener and a drier one leaves it as the base noise
  // already paints it. `grass.strength` scales the whole chunk so a
  // tier with `isShaderGrassEnabled = false` sends 0 and the colour
  // passes through unchanged (the pass still runs, which keeps the
  // pipeline+bind-group graph fixed across tier changes).
  let tileMetres = max(grass.tileMetres, 1.0);
  let densityUv = in.worldXZ / tileMetres;
  let density = textureSample(grassTile, grassSampler, densityUv).r;
  let boost = mix(1.0, 0.72 + 0.56 * density, grass.strength);
  col = col * boost;

  let lit = sampleShadow(in.worldPos, in.viewZ);
  // Soft ambient so a fully-shadowed fragment still reads as ground.
  let shaded = col * (0.45 + 0.55 * lit);
  return vec4<f32>(shaded, 1.0);
}
