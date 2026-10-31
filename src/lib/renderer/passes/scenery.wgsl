// Scenery render pass (#555 FR3). One `drawIndirect` per pool. Reads
// per-instance centres (vec4<f32> xyz + packed metadata) + the compact
// `indices` list the compute cull wrote. The vertex shader expands a
// crossed-quad billboard per instance; the fragment shader shades it with
// the frame uniforms' sun direction and fogs by distance to the camera.
//
// Full material parity with the three foliage material is a P5/P6 gate
// (see #556 for texture-pipeline and shader-grass items). P3's job is the
// pipeline, not the look.

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

// Sprout fade window (#562 FR6 / D6-b). Per-tier values 6/8/10/12/15 m.
// Sprites fade in BELOW sproutNear; the solid pool (floraSolid.wgsl) fades
// out ABOVE sproutFar. Together they form the hybrid LOD cross-fade with
// no hard swap at a single range.
struct Sprout {
  near: f32,
  far: f32,
  _pad: vec2<f32>,
};

@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var<uniform> sprout: Sprout;
@group(0) @binding(2) var foliageAtlas: texture_2d_array<f32>;
@group(0) @binding(3) var foliageSampler: sampler;
@group(1) @binding(0) var<storage, read> centres: array<vec4<f32>>;
@group(1) @binding(1) var<storage, read> indices: array<u32>;

struct VSOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) normal: vec3<f32>,
  @location(1) worldY: f32,
  @location(2) worldDist: f32,
  @location(3) fade: f32,
  // Per-species palette, picked in vs_main from the metadata's species bits.
  @location(4) baseCol: vec3<f32>,
  @location(5) crownCol: vec3<f32>,
  // UV for sampling the per-species leaf texture: (u, v).
  @location(6) uv: vec2<f32>,
  // Species index (flat), 0..2 — selects the atlas layer in fs_main.
  @location(7) @interpolate(flat) species: u32,
  // #591-fu P1b: per-instance tint seed in [0, 1); used in the fragment
  // to jitter hue + lightness so a stand of billboard trees doesn't read
  // as the same stamp repeated. Reuses the sway seed.
  @location(8) tintSeed: f32,
};

// Four verts per billboard pair (two crossed quads, 6 indices each via a
// strip). Keep the shape simple: a unit-tall, aspect-wide card at origin
// facing +X, then rotated 90° for the crossed companion.
const QUAD_VERTS = array<vec3<f32>, 8>(
  // card A, facing +X
  vec3<f32>(-0.6, 0.0, 0.0),
  vec3<f32>( 0.6, 0.0, 0.0),
  vec3<f32>( 0.6, 1.0, 0.0),
  vec3<f32>(-0.6, 1.0, 0.0),
  // card B, facing +Z (90°)
  vec3<f32>( 0.0, 0.0,-0.6),
  vec3<f32>( 0.0, 0.0, 0.6),
  vec3<f32>( 0.0, 1.0, 0.6),
  vec3<f32>( 0.0, 1.0,-0.6),
);

const QUAD_NORMALS = array<vec3<f32>, 2>(
  vec3<f32>(0.0, 0.4, 1.0),
  vec3<f32>(1.0, 0.4, 0.0),
);

// Each billboard pair = 12 indices (two quads × 2 triangles × 3 verts).
const QUAD_INDICES = array<u32, 12>(
  0u, 1u, 2u,
  0u, 2u, 3u,
  4u, 5u, 6u,
  4u, 6u, 7u,
);

@vertex
fn vs_main(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VSOut {
  let instanceId = indices[ii];
  let instance = centres[instanceId];
  let world = instance.xyz;
  // Metadata layout (matches `buildSmokeFoliagePools` + `batchFoliagePools`):
  //   bits 0..15   species index
  //   bits 16..31  sway seed (f32 in [0, 1) via /65535)
  let packed = bitcast<u32>(instance.w);
  let species = packed & 0xffffu;
  let swaySeed = f32((packed >> 16u) & 0xffffu) / 65535.0;

  // Species sizes (metres). 0-2 are trees — React's `FOLIAGE_SHAPE_SIZE`
  // scaled down to a cleaner silhouette at chase-camera height (unscaled
  // 14-17 m quads form a visible wall at the horizon because the camera
  // is only 2.6 m off the water). 3 is reed and 4 is rock: the solid pass
  // owns their visual (ported #591-fu); the sprite billboard would read
  // as a tree-shaped card at reed/rock positions so we collapse the quad
  // to zero and let the fragment discard. Keeping the pool in the sprite
  // iterator is cheaper than filtering it out on the CPU.
  const SPECIES_HEIGHTS = array<f32, 5>(4.0, 5.0, 3.5, 0.0, 0.0);
  const SPECIES_WIDTHS  = array<f32, 5>(0.9, 0.55, 1.15, 0.0, 0.0);
  let sIdx = min(species, 4u);
  let heightM = SPECIES_HEIGHTS[sIdx];
  let widthFactor = SPECIES_WIDTHS[sIdx];

  let local = QUAD_VERTS[QUAD_INDICES[vi]];
  // Gentle sway at the top of the card so standing fields are not static.
  let sway = sin(frame.time * 1.6 + swaySeed * 6.283) * 0.05 * local.y;
  let swept = vec3<f32>(
    (local.x + sway) * widthFactor * heightM,
    local.y * heightM,
    (local.z + sway * 0.5) * widthFactor * heightM,
  );
  let p = world + swept;
  let normalIdx = vi / 6u;
  let n = normalize(QUAD_NORMALS[normalIdx]);

  var out: VSOut;
  out.pos = frame.viewProj * vec4<f32>(p, 1.0);
  out.normal = n;
  out.worldY = p.y / max(heightM, 0.001); // 0..1 along the crown.

  // Per-species foliage palettes. Broadleaf = oak-green, conifer = pine,
  // willow = pale lime. Trunk darker than crown so the mix on worldY reads
  // from bottom to top.
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
  // Palettes are tree-only (3 entries): species 3/4 (reeds/rocks) ride the
  // last tree palette, which never shows because `heightM = 0` collapses
  // the billboard above and `species` is also clamped before the
  // fragment reads the atlas layer.
  let paletteIdx = min(species, 2u);
  out.baseCol = BASE_PAL[paletteIdx];
  out.crownCol = CROWN_PAL[paletteIdx];
  // Billboard UV: both crossed quads share the same (0..1, 0..1) space so
  // the same leaf texture tiles across both. local.x goes −0.6..0.6 and
  // local.y goes 0..1 before the per-species scale, so remap to UV.
  out.uv = vec2<f32>(local.x + 0.5, 1.0 - local.y);
  out.species = paletteIdx;
  out.tintSeed = swaySeed;
  let d = p - frame.camPos;
  let worldDist = length(vec3<f32>(d.x, 0.0, d.z));
  out.worldDist = worldDist;
  // Sprite fades IN above `sproutNear`, peaks at `sproutFar` and beyond.
  let span = max(1.0, sprout.far - sprout.near);
  out.fade = clamp((worldDist - sprout.near) / span, 0.0, 1.0);
  return out;
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  if (in.fade <= 0.001) { discard; }
  // Sample the per-species leaf texture atlas. Alpha carries the silhouette;
  // use it to mask the quad into a tree shape via alpha blending (the pass's
  // blend state is premult-friendly src-alpha / one-minus-src-alpha).
  let tex = textureSample(foliageAtlas, foliageSampler, in.uv, i32(in.species));
  // Discard pixels that are mostly transparent so the depth test still carves
  // the tree silhouette (otherwise distant foliage occludes the water behind).
  if (tex.a < 0.05) { discard; }
  let sun = normalize(frame.sunDir);
  let shade = clamp(dot(in.normal, sun) * 0.5 + 0.6, 0.3, 1.0);
  // #591-fu P1b: jitter the sprite's palette per-instance so distant
  // billboards don't read as a line of clones. Smaller delta than the
  // solid pass because sprites already share the atlas texture.
  let tj = (in.tintSeed - 0.5) * 2.0;
  let tintMul = clamp(vec3<f32>(
    1.0 + tj * 0.08,
    1.0 + tj * 0.05,
    1.0 - tj * 0.05,
  ), vec3<f32>(0.75), vec3<f32>(1.25));
  let lightMul = 1.0 + tj * 0.10;
  let paletteCol = mix(in.baseCol, in.crownCol, clamp(in.worldY, 0.0, 1.0)) * tintMul * lightMul;
  // Leaf texture's RGB is a grey leaf tone; multiply by the species palette.
  let col = paletteCol * tex.rgb * shade;
  // Fog with the frame's exponential density.
  let near = frame.fog.x;
  let far = frame.fog.y;
  let density = near + far * in.worldDist;
  let f = 1.0 - exp(-density * in.worldDist);
  let fogCol = vec3<f32>(0.72, 0.78, 0.82);
  // Fade modulates alpha so the handoff with the solid pool is a soft blend;
  // combined with the texture alpha so transparent leaves don't paint fog.
  return vec4<f32>(mix(col, fogCol, clamp(f, 0.0, 1.0)), in.fade * tex.a);
}
