// Auto-exposure luminance measurement (#574 slice). A one-pixel render-to-
// texture: samples the HDR scene at a sparse grid, averages the LOG of
// per-sample luminance, and writes the result as the sole R32F texel.
// The composite pass reads that single pixel next and divides the scene
// before tonemap so bright and dark scenes self-correct toward middle
// grey.
//
// Log-space averaging means a few blown-out pixels don't dominate the
// mean; the exposure glides even when a bright sun flash enters the
// frame. No EMA across frames — a camera cut pops the exposure in one
// step rather than drifting over a second. If that proves jarring,
// follow-up by keeping the previous value in a second 1-pixel texture
// and `mix(prev, measured, 0.08)` in a dedicated compute pass.

@group(0) @binding(0) var scene: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;

struct VSOut {
  @builtin(position) pos: vec4<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vi: u32) -> VSOut {
  // The fragment target is a single pixel; a 1x1 triangle covers it.
  let xy = vec2<f32>(
    f32((vi << 1u) & 2u),
    f32(vi & 2u),
  );
  var out: VSOut;
  out.pos = vec4<f32>(xy * 2.0 - 1.0, 0.0, 1.0);
  return out;
}

const SAMPLE_GRID: u32 = 8u;  // 8×8 = 64 taps across the frame
const INV_GRID: f32 = 1.0 / 8.0;
// Luminance weights per Rec. 709; the HDR scene is linear so this reads
// perceived brightness roughly correctly.
const LUMA_WEIGHTS: vec3<f32> = vec3<f32>(0.2126, 0.7152, 0.0722);
// Clamp per-sample lum so a single over-bright specular doesn't skew the
// log mean; and a floor so log(0) doesn't blow up.
const LUMA_MIN: f32 = 1e-4;
const LUMA_MAX: f32 = 32.0;

@fragment
fn fs_main() -> @location(0) f32 {
  var sum = 0.0;
  for (var y: u32 = 0u; y < SAMPLE_GRID; y = y + 1u) {
    for (var x: u32 = 0u; x < SAMPLE_GRID; x = x + 1u) {
      let uv = (vec2<f32>(f32(x), f32(y)) + 0.5) * INV_GRID;
      let col = textureSampleLevel(scene, samp, uv, 0.0).rgb;
      let lum = clamp(dot(col, LUMA_WEIGHTS), LUMA_MIN, LUMA_MAX);
      sum = sum + log(lum);
    }
  }
  let avgLogLum = sum / f32(SAMPLE_GRID * SAMPLE_GRID);
  return avgLogLum;
}
