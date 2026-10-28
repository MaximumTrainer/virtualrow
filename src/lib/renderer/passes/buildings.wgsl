// Buildings pass (#566 FR1-FR4, #591-fu P0a textured walls + pitched roof).
// Draws extruded OSM-footprint prisms with a pyramid roof cap and samples a
// shared albedo atlas (brick wall on the left half, tile roof on the right).
// Reads per-instance `(x, z, height, bitcast<u32>(paletteIndex))` from
// `centres`, half-sizes from `sizes`, and synthesises a 48-vertex geometry
// (36 box + 12 pyramid roof) scaled to that footprint and height. Receives
// CSM via the shared `sampleShadow` snippet from `shaderSnippets.ts`.

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
@group(2) @binding(2) var atlasTex: texture_2d<f32>;
@group(2) @binding(3) var atlasSampler: sampler;

struct VSOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) worldPos: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) viewZ: f32,
  @location(3) @interpolate(flat) paletteIndex: u32,
  @location(4) uv: vec2<f32>,
  @location(5) @interpolate(flat) isRoof: u32,
};

// 48 vertices total: 36 box (6 faces × 2 tris × 3 verts) + 12 pyramid roof
// (4 triangle faces, 3 verts each). `corner.y` of `2.0` is a sentinel the
// vertex shader reads as "roof apex" — see vs_main.
const CORNERS = array<vec3<f32>, 48>(
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
  // Ceiling at building top (+Y) — kept so a camera looking down from above
  // sees a filled interior under the pyramid roof.
  vec3<f32>(-1.0, 1.0,  1.0), vec3<f32>( 1.0, 1.0,  1.0), vec3<f32>( 1.0, 1.0, -1.0),
  vec3<f32>(-1.0, 1.0,  1.0), vec3<f32>( 1.0, 1.0, -1.0), vec3<f32>(-1.0, 1.0, -1.0),
  // Floor (-Y) — rarely visible but closes the volume for depth casts.
  vec3<f32>(-1.0, 0.0, -1.0), vec3<f32>( 1.0, 0.0, -1.0), vec3<f32>( 1.0, 0.0,  1.0),
  vec3<f32>(-1.0, 0.0, -1.0), vec3<f32>( 1.0, 0.0,  1.0), vec3<f32>(-1.0, 0.0,  1.0),
  // Pyramid roof (4 triangles). The apex uses the sentinel y = 2.0 so the
  // vertex shader can lift it to `height + roofHeight` instead of
  // `height * 2`. Winding is CCW seen from outside each slope.
  //   -X slope
  vec3<f32>(-1.0, 1.0, -1.0), vec3<f32>(-1.0, 1.0,  1.0), vec3<f32>( 0.0, 2.0,  0.0),
  //   +X slope
  vec3<f32>( 1.0, 1.0,  1.0), vec3<f32>( 1.0, 1.0, -1.0), vec3<f32>( 0.0, 2.0,  0.0),
  //   -Z slope
  vec3<f32>( 1.0, 1.0, -1.0), vec3<f32>(-1.0, 1.0, -1.0), vec3<f32>( 0.0, 2.0,  0.0),
  //   +Z slope
  vec3<f32>(-1.0, 1.0,  1.0), vec3<f32>( 1.0, 1.0,  1.0), vec3<f32>( 0.0, 2.0,  0.0),
);

// One normal per triangle — six box faces, then one per pyramid slope.
const NORMALS = array<vec3<f32>, 10>(
  vec3<f32>(-1.0, 0.0, 0.0),       // -X wall
  vec3<f32>( 1.0, 0.0, 0.0),       // +X wall
  vec3<f32>( 0.0, 0.0,-1.0),       // -Z wall
  vec3<f32>( 0.0, 0.0, 1.0),       // +Z wall
  vec3<f32>( 0.0, 1.0, 0.0),       // ceiling (under the roof)
  vec3<f32>( 0.0,-1.0, 0.0),       // floor
  vec3<f32>(-0.7071, 0.7071, 0.0), // -X pyramid slope
  vec3<f32>( 0.7071, 0.7071, 0.0), // +X pyramid slope
  vec3<f32>( 0.0, 0.7071,-0.7071), // -Z pyramid slope
  vec3<f32>( 0.0, 0.7071, 0.7071), // +Z pyramid slope
);

@vertex
fn vs_main(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VSOut {
  let instance = centres[ii];
  let origin = vec2<f32>(instance.x, instance.y);
  let height = max(0.1, instance.z);
  let half = sizes[ii];
  let corner = CORNERS[vi];

  // The pyramid-roof apex is encoded as corner.y = 2.0: lift it to
  // `height + roofHeight` instead of the box's `height * 2`. Roof height
  // scales with footprint so a tall slender tower doesn't get a tiny
  // pointed hat, with a floor so very small cottages keep a visible pitch.
  let isApex = corner.y > 1.5;
  let roofHeight = clamp(min(half.x, half.y) * 0.9, 1.0, 4.0);
  var worldY: f32;
  if (isApex) {
    worldY = height + roofHeight;
  } else {
    worldY = corner.y * height;
  }
  let world = vec3<f32>(origin.x + corner.x * half.x, worldY, origin.y + corner.z * half.y);

  var out: VSOut;
  out.pos = frame.viewProj * vec4<f32>(world, 1.0);
  out.worldPos = world;
  // The CORNERS array is: 6 box faces × 6 verts = 36, then 4 pyramid slopes
  // × 3 verts = 12. Normals follow the same order.
  var faceIndex: u32;
  if (vi < 36u) {
    faceIndex = vi / 6u;
  } else {
    faceIndex = 6u + (vi - 36u) / 3u;
  }
  out.normal = NORMALS[faceIndex];
  let viewPos = frame.view * vec4<f32>(world, 1.0);
  out.viewZ = -viewPos.z;
  let packed = bitcast<u32>(instance.w);
  out.paletteIndex = packed;

  // Atlas UV: walls land on the LEFT half (u in [0, 0.5]) and the roof
  // slopes on the RIGHT (u in [0.5, 1.0]). The upload-time atlas constants
  // in `buildingAtlas.ts` have to match these offsets. We tile the UV so
  // bricks are 2 m tall and roof tiles ~1 m wide at ride-view scale.
  const WALL_U_OFFSET: f32 = 0.0;
  const ROOF_U_OFFSET: f32 = 0.5;
  const HALF: f32 = 0.5;
  var uv: vec2<f32>;
  var isRoof: u32 = 0u;
  if (faceIndex >= 6u) {
    // Pyramid roof — project world (x, z) through atlas-right tiling.
    isRoof = 1u;
    uv = vec2<f32>(ROOF_U_OFFSET + fract(world.x * 0.5) * HALF, fract(world.z * 0.5));
  } else if (faceIndex == 4u || faceIndex == 5u) {
    // Interior ceiling / floor — hidden in normal play; cheap wall UV so
    // the depth cast at least ships a value.
    uv = vec2<f32>(WALL_U_OFFSET + fract(world.x * 0.5) * HALF, fract(world.z * 0.5));
  } else {
    // Side walls — U wraps around the perimeter (x on -Z/+Z walls, z on
    // -X/+X walls), V goes up the building. 0.3 m per brick vertically
    // keeps bricks reading at camera-close distance without jarring tiling.
    var perim: f32;
    if (faceIndex == 0u || faceIndex == 1u) {
      perim = world.z;
    } else {
      perim = world.x;
    }
    uv = vec2<f32>(WALL_U_OFFSET + fract(perim * 0.5) * HALF, fract(world.y * 0.33));
  }
  out.uv = uv;
  out.isRoof = isRoof;
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

  // Pick the palette tint by surface: roof slopes land on `roof`, the base
  // course (lower 0.5 m of the walls) on `base`, everything else on `wall`.
  // `in.isRoof` is set per-vertex for the pyramid slopes so interior ceiling
  // triangles don't accidentally pick up the roof tint.
  var surface: vec3<f32>;
  if (in.isRoof == 1u) {
    surface = roof;
  } else if (in.worldPos.y < 0.5) {
    surface = base;
  } else {
    surface = wall;
  }

  // Sample the shared albedo atlas (brick/stone wall on the LEFT half, tile
  // on the RIGHT). The texture is neutral grey so `tint * texel` reads as a
  // palette-tinted brick/tile rather than a wholly new colour.
  let texel = textureSample(atlasTex, atlasSampler, in.uv).rgb;
  let shaded = surface * texel * 1.1;

  // Half-lambert against the global sun direction, scaled by the shadow map,
  // with a soft hemisphere ambient so a face in shadow still carries hue.
  let n = normalize(in.normal);
  let ndotl = max(dot(n, normalize(frame.sunDir)), 0.0);
  let lit = sampleShadow(in.worldPos, in.viewZ);
  let diffuse = shaded * (0.28 + 0.72 * ndotl * lit);
  return vec4<f32>(diffuse, 1.0);
}
