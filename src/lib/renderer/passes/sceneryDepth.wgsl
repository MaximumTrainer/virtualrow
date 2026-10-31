// Scenery shadow-depth pass (#559 FR4 / FR11, D6-a / D7-a). Reuses the
// scenery pool's centres buffer; indexes by `instance_index` so no
// compact-indices binding is needed. Alpha-discards below `alphaCutoff`
// (D6-a: fixed 0.5) so the billboard crown projects a leaf-shaped
// shadow. Culling is left to the lit-pass compute cull — the depth pass
// relies on the orthographic cascade bounds + the standard view
// scissor to drop instances outside the cascade.

struct SceneryDepth {
  viewProj: mat4x4<f32>,
};
@group(0) @binding(0) var<uniform> cascade: SceneryDepth;
@group(1) @binding(0) var<storage, read> centres: array<vec4<f32>>;

struct DepthOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) local: vec2<f32>,
};

const QUAD_VERTS = array<vec3<f32>, 8>(
  vec3<f32>(-0.6, 0.0, 0.0),
  vec3<f32>( 0.6, 0.0, 0.0),
  vec3<f32>( 0.6, 1.0, 0.0),
  vec3<f32>(-0.6, 1.0, 0.0),
  vec3<f32>( 0.0, 0.0,-0.6),
  vec3<f32>( 0.0, 0.0, 0.6),
  vec3<f32>( 0.0, 1.0, 0.6),
  vec3<f32>( 0.0, 1.0,-0.6),
);

const QUAD_INDICES = array<u32, 12>(
  0u, 1u, 2u,
  0u, 2u, 3u,
  4u, 5u, 6u,
  4u, 6u, 7u,
);

const ALPHA_CUTOFF: f32 = 0.5;

@vertex
fn vs_main(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> DepthOut {
  let instance = centres[ii];
  let world = instance.xyz;
  let local = QUAD_VERTS[QUAD_INDICES[vi]];
  // No sway in the depth pass (a swaying leaf moves the shadow and reads
  // as noise at low tier atlas resolutions).
  let p = world + vec3<f32>(local.x, local.y * 1.8, local.z);
  var out: DepthOut;
  out.pos = cascade.viewProj * vec4<f32>(p, 1.0);
  out.local = vec2<f32>(local.x, local.y);
  return out;
}

@fragment
fn fs_main(in: DepthOut) {
  // Procedural crown mask: a round silhouette fading to zero at the
  // card's edge, matching the fs_main shape in `scenery.wgsl` enough to
  // give leaf-shaped shadows at AC9's tolerance.
  let r = sqrt(in.local.x * in.local.x + (in.local.y - 0.65) * (in.local.y - 0.65));
  let alpha = clamp(1.0 - r * 1.6, 0.0, 1.0);
  if (alpha < ALPHA_CUTOFF) {
    discard;
  }
}
