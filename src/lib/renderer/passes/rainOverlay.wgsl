// Screen-space rain overlay (#574). A single fullscreen pass drawn after
// the lit opaque passes and before the composite. Fully procedural — no
// particle buffer, no CPU per-frame cost. The fragment shader partitions
// the frame into a grid of narrow vertical columns; each column carries
// one streak falling at a column-seeded speed and slant, with the streak
// alpha fading in at the top of the frame and out at the bottom so the
// stream reads as continuous rain rather than discrete pulses.
//
// Drawn with alpha blending; writes neither colour nor depth to any
// buffer the subsequent composite reads. Honouring scene depth was in
// the deferred spec, but on the chase-camera framing the only occluder
// is the near hull; a cosmetic optimisation to be revisited if the hull
// cutout reads wrong at race scale.

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

struct VSOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vi: u32) -> VSOut {
  var tri = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -3.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>( 3.0,  1.0),
  );
  var out: VSOut;
  let xy = tri[vi];
  out.pos = vec4<f32>(xy, 0.0, 1.0);
  out.uv = vec2<f32>((xy.x + 1.0) * 0.5, 1.0 - (xy.y + 1.0) * 0.5);
  return out;
}

fn hash(x: f32) -> f32 {
  return fract(sin(x * 12.9898) * 43758.5453);
}

// Rain column grid: COL_COUNT narrow slits across the frame. Each has
// one streak, STREAK_LEN tall; the streak's Y position advances with
// frame.time at a column-seeded speed. SLANT shears the streak slightly
// so the rain reads as falling toward one side (apparent wind).
const COL_COUNT: f32 = 72.0;
const STREAK_LEN: f32 = 0.08;   // fraction of frame height
const STREAK_WIDTH: f32 = 0.35; // fraction of column width around the centre line
const BASE_SPEED: f32 = 0.6;
const SLANT: f32 = 0.15;         // X-offset per full-frame vertical fall
const RAIN_COLOUR: vec3<f32> = vec3<f32>(0.78, 0.84, 0.92);
const RAIN_ALPHA: f32 = 0.35;

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  // Apply the slant by shifting x by y * SLANT before cell look-up — a
  // streak's apparent column tilts as it falls.
  let shiftedX = in.uv.x + in.uv.y * SLANT;
  let colIdx = floor(shiftedX * COL_COUNT);
  let colStart = colIdx / COL_COUNT;
  let xInCell = (shiftedX - colStart) * COL_COUNT; // 0..1
  // Soft centre line — the streak is thickest at xInCell = 0.5.
  let widthFalloff = 1.0 - smoothstep(0.0, STREAK_WIDTH, abs(xInCell - 0.5));
  if (widthFalloff <= 0.0) {
    return vec4<f32>(0.0);
  }
  // Column-seeded speed + random phase so adjacent columns don't fall in
  // sync. hash(colIdx) is deterministic per column.
  let seed = hash(colIdx);
  let speed = BASE_SPEED * (0.6 + seed * 0.9);
  let phase = fract(seed + frame.time * speed);
  // Streak centre falls from phase = 0 (top of frame) to phase = 1
  // (bottom). Fade in the first 10 % and out the last 15 % of the fall
  // so streaks aren't born or died on-screen with a hard edge.
  let streakCentreY = phase;
  let distFromStreak = abs(in.uv.y - streakCentreY);
  if (distFromStreak > STREAK_LEN) {
    return vec4<f32>(0.0);
  }
  let streakFalloff = 1.0 - smoothstep(0.0, STREAK_LEN, distFromStreak);
  let fadeIn = smoothstep(0.0, 0.1, phase);
  let fadeOut = 1.0 - smoothstep(0.85, 1.0, phase);
  let alpha = widthFalloff * streakFalloff * fadeIn * fadeOut * RAIN_ALPHA;
  return vec4<f32>(RAIN_COLOUR * alpha, alpha);
}
