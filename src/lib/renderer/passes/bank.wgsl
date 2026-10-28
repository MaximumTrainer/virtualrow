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
@group(2) @binding(3) var bankAtlas: texture_2d<f32>;
@group(2) @binding(4) var bankAtlasSampler: sampler;

struct VSOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) worldXZ: vec2<f32>,
  // (sign, shoreDist). sign kept for compatibility; shoreDist drives the
  // triplanar grass-vs-earth mix in the fragment (0 at the water edge,
  // bankWidth at the outer edge of the strip).
  @location(1) side: vec2<f32>,
  @location(2) worldPos: vec3<f32>,
  @location(3) viewZ: f32,
};

@vertex
fn vs_main(
  @location(0) position: vec3<f32>,
  @location(1) side: vec2<f32>,
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
  // Base palette: the pre-port damp-grass/dry-grass pair stays as a tint
  // so the triplanar albedo doesn't wash the bank into one neutral grey.
  let baseGreen = vec3<f32>(0.32, 0.42, 0.22);
  let baseDry = vec3<f32>(0.52, 0.49, 0.33);
  let paletteNoise = hash12(floor(in.worldXZ * 2.0));
  let paletteTint = mix(baseGreen, baseDry, paletteNoise * 0.4);

  // #591-fu P0b: triplanar albedo port of React `bankTriplanar.glsl`'s
  // grass/earth blend. Both tiles live in one atlas (grass left, earth
  // right); UVs tile every ~4 m so bricks of grass and earth don't
  // register as a seamless carpet.
  const GRASS_U_OFFSET: f32 = 0.0;
  const EARTH_U_OFFSET: f32 = 0.5;
  const HALF_U: f32 = 0.5;
  let grassUv = vec2<f32>(GRASS_U_OFFSET + fract(in.worldXZ.x * 0.25) * HALF_U, fract(in.worldXZ.y * 0.25));
  let earthUv = vec2<f32>(EARTH_U_OFFSET + fract(in.worldXZ.x * 0.25) * HALF_U, fract(in.worldXZ.y * 0.25));
  let grassTex = textureSample(bankAtlas, bankAtlasSampler, grassUv).rgb;
  let earthTex = textureSample(bankAtlas, bankAtlasSampler, earthUv).rgb;

  // Shore mix: 0 at the water edge, 1 by ~2.5 m out — matches React's
  // `smoothstep(0.0, 2.5, vBankShoreDist)`. Near the shore the ground
  // reads as wet earth; past the band it reads as lush grass.
  let shoreDist = in.side.y;
  let shoreMix = smoothstep(0.0, 2.5, shoreDist);
  var albedo = mix(earthTex, grassTex, shoreMix);
  // Palette-tint the albedo so a residential profile keeps the warm
  // sandstone tone and a wetland reads cool/green, same way the
  // triplanar tile is multiplied by `diffuseColor.rgb` on the React side.
  albedo = albedo * paletteTint * 1.6;

  // Macro-scale lushness noise (React's `bankMacroNoise`): a 64 m-grid
  // light/dark modulation so a long bank doesn't read as a repeating
  // 4 m stamp. Keeps near-camera texel density but adds metres-scale
  // variation.
  let macroN = 0.9 + 0.2 * hash12(floor(in.worldXZ * 0.015625));
  var col = albedo * macroN;

  // Biome-density grass modulation (#496 Phase 2, kept from the earlier
  // slice). Scales the colour, not the texture mix, so a wetter biome
  // boosts lushness without turning the shore wet-earth strip green.
  let tileMetres = max(grass.tileMetres, 1.0);
  let densityUv = in.worldXZ / tileMetres;
  let density = textureSample(grassTile, grassSampler, densityUv).r;
  let boost = mix(1.0, 0.72 + 0.56 * density, grass.strength);
  col = col * boost;

  let lit = sampleShadow(in.worldPos, in.viewZ);
  // Soft hemisphere ambient so a fully-shadowed fragment still reads as
  // ground, with a touch of sky bias to echo the hemisphere-ambient
  // follow-up on floraSolid / sceneryMesh.
  let shaded = col * (0.42 + 0.58 * lit);
  return vec4<f32>(shaded, 1.0);
}
