// Buildings pass (#566 FR1-FR4). Draws extruded OSM-footprint prisms.
// Reads per-instance `(x, z, height, bitcast<u32>(paletteIndex))` from
// `centres`, half-sizes from `sizes`, and emits a 36-vertex unit box
// scaled to that footprint and height. Receives CSM via the shared
// `sampleShadow` snippet from `shaderSnippets.ts`.

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

@group(2) @binding(0) var<storage, read> centres: array<vec4<f32>>;
@group(2) @binding(1) var<storage, read> sizes: array<vec2<f32>>;

struct VSOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) worldPos: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) viewZ: f32,
  @location(3) @interpolate(flat) paletteIndex: u32,
  @location(4) faceSeed: f32,
};

// 36 vertices for a unit box centred on origin in XZ, spanning [0, 1] in Y.
// Positions are normalised corner picks; the vertex shader scales them.
// `corners` give (sx, sy, sz) where each component is -1, 0 or +1.
const CORNERS = array<vec3<f32>, 36>(
  // -X face
  vec3<f32>(-1.0, 0.0, -1.0), vec3<f32>(-1.0, 0.0,  1.0), vec3<f32>(-1.0, 1.0,  1.0),
  vec3<f32>(-1.0, 0.0, -1.0), vec3<f32>(-1.0, 1.0,  1.0), vec3<f32>(-1.0, 1.0, -1.0),
  // +X face
  vec3<f32>( 1.0, 0.0,  1.0), vec3<f32>( 1.0, 0.0, -1.0), vec3<f32>( 1.0, 1.0, -1.0),
  vec3<f32>( 1.0, 0.0,  1.0), vec3<f32>( 1.0, 1.0, -1.0), vec3<f32>( 1.0, 1.0,  1.0),
  // -Z face
  vec3<f32>( 1.0, 0.0, -1.0), vec3<f32>(-1.0, 0.0, -1.0), vec3<f32>(-1.0, 1.0, -1.0),
  vec3<f32>( 1.0, 0.0, -1.0), vec3<f32>(-1.0, 1.0, -1.0), vec3<f32>( 1.0, 1.0, -1.0),
  // +Z face
  vec3<f32>(-1.0, 0.0,  1.0), vec3<f32>( 1.0, 0.0,  1.0), vec3<f32>( 1.0, 1.0,  1.0),
  vec3<f32>(-1.0, 0.0,  1.0), vec3<f32>( 1.0, 1.0,  1.0), vec3<f32>(-1.0, 1.0,  1.0),
  // Roof (+Y)
  vec3<f32>(-1.0, 1.0,  1.0), vec3<f32>( 1.0, 1.0,  1.0), vec3<f32>( 1.0, 1.0, -1.0),
  vec3<f32>(-1.0, 1.0,  1.0), vec3<f32>( 1.0, 1.0, -1.0), vec3<f32>(-1.0, 1.0, -1.0),
  // Floor (-Y) — rarely visible but closes the volume for depth casts.
  vec3<f32>(-1.0, 0.0, -1.0), vec3<f32>( 1.0, 0.0, -1.0), vec3<f32>( 1.0, 0.0,  1.0),
  vec3<f32>(-1.0, 0.0, -1.0), vec3<f32>( 1.0, 0.0,  1.0), vec3<f32>(-1.0, 0.0,  1.0),
);

// One normal per triangle — six faces, six triangles each.
const NORMALS = array<vec3<f32>, 6>(
  vec3<f32>(-1.0, 0.0, 0.0),
  vec3<f32>( 1.0, 0.0, 0.0),
  vec3<f32>( 0.0, 0.0,-1.0),
  vec3<f32>( 0.0, 0.0, 1.0),
  vec3<f32>( 0.0, 1.0, 0.0),
  vec3<f32>( 0.0,-1.0, 0.0),
);

@vertex
fn vs_main(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VSOut {
  let instance = centres[ii];
  let origin = vec2<f32>(instance.x, instance.y);
  let height = max(0.1, instance.z);
  let half = sizes[ii];
  let corner = CORNERS[vi];
  let world = vec3<f32>(origin.x + corner.x * half.x, corner.y * height, origin.y + corner.z * half.y);

  var out: VSOut;
  out.pos = frame.viewProj * vec4<f32>(world, 1.0);
  out.worldPos = world;
  // 6 vertices per face → faceIndex = vi / 6.
  let faceIndex = vi / 6u;
  out.normal = NORMALS[faceIndex];
  let viewPos = frame.view * vec4<f32>(world, 1.0);
  out.viewZ = -viewPos.z;
  // The palette index is in the fourth lane of `centres[ii]`, reinterpreted
  // from the pre-packed u32.
  let meta = bitcast<u32>(instance.w);
  out.paletteIndex = meta;
  // Per-instance seed for the facade stripe pattern.
  out.faceSeed = f32(ii & 0xffu) * 0.3719;
  return out;
}

// Palette: (base, wall, roof) per profile. Luminance-sorted so the
// higher-contrast colour (roof) sits last; mirrors the Biketerra
// luminance ordering (#566 D3-a).
const PALETTE_BASE = array<vec3<f32>, 4>(
  vec3<f32>(0.74, 0.68, 0.60), // residential sandstone
  vec3<f32>(0.65, 0.68, 0.72), // commercial pale concrete
  vec3<f32>(0.55, 0.52, 0.50), // industrial grey
  vec3<f32>(0.70, 0.70, 0.70), // fallback neutral
);
const PALETTE_WALL = array<vec3<f32>, 4>(
  vec3<f32>(0.84, 0.76, 0.68),
  vec3<f32>(0.80, 0.82, 0.84),
  vec3<f32>(0.62, 0.60, 0.58),
  vec3<f32>(0.78, 0.78, 0.78),
);
const PALETTE_ROOF = array<vec3<f32>, 4>(
  vec3<f32>(0.42, 0.30, 0.24), // residential tile
  vec3<f32>(0.32, 0.34, 0.38), // commercial dark grey
  vec3<f32>(0.22, 0.22, 0.22), // industrial asphalt
  vec3<f32>(0.45, 0.45, 0.45), // fallback mid grey
);

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  let idx = min(in.paletteIndex, 3u);
  let base = PALETTE_BASE[idx];
  let wall = PALETTE_WALL[idx];
  let roof = PALETTE_ROOF[idx];

  // Pick base / wall / roof by the dominant normal component.
  var surface: vec3<f32>;
  if (in.normal.y > 0.5) {
    surface = roof;
  } else if (in.worldPos.y < 0.5) {
    surface = base;
  } else {
    surface = wall;
  }

  // Soft facade stripe (window band) along Y, cheap and texture-free.
  let band = 0.5 + 0.5 * sin(in.worldPos.y * 1.2 + in.faceSeed * 6.2831);
  let shaded = surface * (0.85 + 0.15 * band);

  // Lambertian-ish with the global sun direction.
  let ndotl = max(dot(in.normal, normalize(frame.sunDir)), 0.0);
  let lit = sampleShadow(in.worldPos, in.viewZ);
  let diffuse = shaded * (0.3 + 0.7 * ndotl * lit);
  return vec4<f32>(diffuse, 1.0);
}
