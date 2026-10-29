// GTAO-lite SSAO (#573 D6-a). Reads scene depth; writes a single-channel AO
// factor to its own target (sampled by composite.wgsl). 8 taps around a
// disc; closer-than-centre neighbours cast occlusion. Not photoreal, but
// enough to make building/ground creases visibly darker on tier high+
// (P8-AC5).

struct AoUniforms {
  radiusUV: f32,
  strength: f32,
  _pad0: f32,
  _pad1: f32,
};

@group(0) @binding(0) var depthTex: texture_depth_2d;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var<uniform> u: AoUniforms;

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

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  // texture_depth_2d's textureSampleLevel takes i32 level, not f32 (#592).
  let centre = textureSampleLevel(depthTex, samp, in.uv, 0i);
  var occlusion = 0.0;
  // 8 taps on a disc.
  let TAU = 6.2831853;
  for (var i = 0u; i < 8u; i = i + 1u) {
    let a = (f32(i) / 8.0) * TAU;
    let o = vec2<f32>(cos(a), sin(a)) * u.radiusUV;
    let d = textureSampleLevel(depthTex, samp, in.uv + o, 0i);
    if (d < centre) {
      occlusion = occlusion + (centre - d);
    }
  }
  let ao = clamp(1.0 - occlusion * u.strength, 0.0, 1.0);
  return vec4<f32>(ao, ao, ao, 1.0);
}
