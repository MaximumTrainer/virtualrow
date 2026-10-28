// Solid-flora shadow-depth pass (#591-fu P1c). Mirrors the lit
// `floraSolid.wgsl` geometry so the shadow volume matches the lit tree:
// one cone-stack per instance using the same per-vertex position +
// mix.y crown-height proxy. Alpha-respecting so a crown casts a leafy
// silhouette rather than a solid pyramid — the FS samples the shared
// leaf atlas (same one the lit pass uses) and discards transparent
// texels. Reed (species 3) and rock (species 4) meshes keep an opaque
// discard since their atlas slot would read as broadleaf.

struct FloraDepth {
  viewProj: mat4x4<f32>,
};
@group(0) @binding(0) var<uniform> cascade: FloraDepth;
@group(0) @binding(1) var leafAtlas: texture_2d<f32>;
@group(0) @binding(2) var leafSampler: sampler;
@group(1) @binding(0) var<storage, read> centres: array<vec4<f32>>;

struct DepthOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) leafUv: vec2<f32>,
  @location(1) @interpolate(flat) species: u32,
};

// Only `position` + `mix` are needed for depth; the lit pass's `normal`
// attribute is not bound here, so the TypeScript pipeline sets up just
// two vertex buffers (positionBuffer at location 0, mixBuffer at
// location 1 — note the shaderLocation remap from the lit pass's 0/2).
@vertex
fn vs_main(
  @location(0) position: vec3<f32>,
  @location(1) mixAttr: vec2<f32>,
  @builtin(instance_index) ii: u32,
) -> DepthOut {
  let instance = centres[ii];
  let world = instance.xyz + position;
  let metaBits = bitcast<u32>(instance.w);
  let species = metaBits & 0xffffu;

  // Mirror the lit pass's leaf-atlas UV so the depth silhouette matches
  // the lit silhouette texel-for-texel.
  let SPECIES_COL_WIDTH = 1.0 / 3.0;
  let colIdx = min(species, 2u);
  let colStart = f32(colIdx) * SPECIES_COL_WIDTH;
  let angle = atan2(position.z, position.x);
  let u = colStart + (angle * 0.1591549 + 0.5) * SPECIES_COL_WIDTH;
  let v = clamp(mixAttr.y, 0.0, 1.0);

  var out: DepthOut;
  out.pos = cascade.viewProj * vec4<f32>(world, 1.0);
  out.leafUv = vec2<f32>(u, v);
  out.species = species;
  return out;
}

const ALPHA_CUTOFF: f32 = 0.5;

@fragment
fn fs_main(in: DepthOut) {
  // Always sample (uniform control flow). For trees, discard transparent
  // texels so the shadow carries the leaf silhouette. For reeds/rocks,
  // the geometry is already small and tightly packed, so an opaque
  // discard is fine — their atlas column would read as a broadleaf and
  // over-discard the shadow.
  let leaf = textureSample(leafAtlas, leafSampler, in.leafUv);
  let isTree = in.species < 3u;
  // `select` keeps the shader branch-free; `drop` is true when a tree
  // fragment is below the alpha cutoff.
  let drop = isTree && leaf.a < ALPHA_CUTOFF;
  if (drop) { discard; }
}
