// Cheap near/far linear-blur DOF approximation (#573 D7-c). On tier
// extra-high only, behind `window.__VIRTUALROW_POSTFX_DOF`. The full
// separable CoC blur is the backlog item in P8 optional additions.
//
// This pass runs AFTER composite so it blurs tone-mapped colour. Fragments
// whose depth is far from the focus plane get a soft horizontal + vertical
// box blur mixed in; near the focus plane the output is a straight copy.

struct DofUniforms {
  focusDepth: f32,
  focusRange: f32,
  blurRadius: f32,
  _pad: f32,
};

@group(0) @binding(0) var colour: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var depthTex: texture_depth_2d;
@group(0) @binding(3) var<uniform> u: DofUniforms;

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
  let d = textureSampleLevel(depthTex, samp, in.uv, 0.0);
  let dist = abs(d - u.focusDepth);
  let coc = clamp((dist - u.focusRange) / max(u.focusRange, 1e-4), 0.0, 1.0);
  let dims = vec2<f32>(textureDimensions(colour, 0));
  let o = vec2<f32>(u.blurRadius, u.blurRadius) / dims;
  let s0 = textureSample(colour, samp, in.uv);
  let sNE = textureSample(colour, samp, in.uv + vec2<f32>( o.x, -o.y));
  let sNW = textureSample(colour, samp, in.uv + vec2<f32>(-o.x, -o.y));
  let sSE = textureSample(colour, samp, in.uv + vec2<f32>( o.x,  o.y));
  let sSW = textureSample(colour, samp, in.uv + vec2<f32>(-o.x,  o.y));
  let blurred = (s0 + sNE + sNW + sSE + sSW) * 0.2;
  return mix(s0, blurred, coc);
}
