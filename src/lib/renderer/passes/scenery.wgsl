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
@group(1) @binding(0) var<storage, read> centres: array<vec4<f32>>;
@group(1) @binding(1) var<storage, read> indices: array<u32>;

struct VSOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) normal: vec3<f32>,
  @location(1) worldY: f32,
  @location(2) worldDist: f32,
  @location(3) fade: f32,
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
  // Metadata reinterpretation — only the low 16 bits (species index) matter
  // for the P3 look; sway seed stays available for a later pass.
  let packed = bitcast<u32>(instance.w);
  let swaySeed = f32((packed >> 16u) & 0xffffu) / 65535.0;

  let local = QUAD_VERTS[QUAD_INDICES[vi]];
  // Gentle sway at the top of the card so standing fields are not static.
  let sway = sin(frame.time * 1.6 + swaySeed * 6.283) * 0.05 * local.y;
  let swept = vec3<f32>(local.x + sway, local.y * 1.8, local.z + sway * 0.5);
  let p = world + swept;
  let normalIdx = vi / 6u;
  let n = normalize(QUAD_NORMALS[normalIdx]);

  var out: VSOut;
  out.pos = frame.viewProj * vec4<f32>(p, 1.0);
  out.normal = n;
  out.worldY = p.y;
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
  let sun = normalize(frame.sunDir);
  let shade = clamp(dot(in.normal, sun) * 0.5 + 0.6, 0.3, 1.0);
  let base = vec3<f32>(0.26, 0.42, 0.22);
  let crown = vec3<f32>(0.42, 0.56, 0.26);
  let col = mix(base, crown, clamp(in.worldY / 1.8, 0.0, 1.0)) * shade;
  // Fog with the frame's exponential density.
  let near = frame.fog.x;
  let far = frame.fog.y;
  let density = near + far * in.worldDist;
  let f = 1.0 - exp(-density * in.worldDist);
  let fogCol = vec3<f32>(0.72, 0.78, 0.82);
  // Fade modulates alpha so the handoff with the solid pool is a soft blend.
  return vec4<f32>(mix(col, fogCol, clamp(f, 0.0, 1.0)), in.fade);
}
