// Bloom pyramid up-pass (#573 D2-a). Additive 9-tap bilinear tent upsample.
// Each invocation reads a smaller mip and writes an additive contribution to
// the next-larger mip; `uUp.strength` scales the contribution per level so
// the bottom mips don't dominate.

struct UpUniforms {
  strength: f32,
  _pad0: f32,
  _pad1: f32,
  _pad2: f32,
};

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var<uniform> uUp: UpUniforms;

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
  let dims = vec2<f32>(textureDimensions(src, 0));
  let o = vec2<f32>(1.0, 1.0) / dims;
  // 3x3 tent kernel.
  var s =
      textureSample(src, samp, in.uv + vec2<f32>(-o.x, -o.y)) * 1.0
    + textureSample(src, samp, in.uv + vec2<f32>( 0.0, -o.y)) * 2.0
    + textureSample(src, samp, in.uv + vec2<f32>( o.x, -o.y)) * 1.0
    + textureSample(src, samp, in.uv + vec2<f32>(-o.x,  0.0)) * 2.0
    + textureSample(src, samp, in.uv + vec2<f32>( 0.0,  0.0)) * 4.0
    + textureSample(src, samp, in.uv + vec2<f32>( o.x,  0.0)) * 2.0
    + textureSample(src, samp, in.uv + vec2<f32>(-o.x,  o.y)) * 1.0
    + textureSample(src, samp, in.uv + vec2<f32>( 0.0,  o.y)) * 2.0
    + textureSample(src, samp, in.uv + vec2<f32>( o.x,  o.y)) * 1.0;
  s = s * (1.0 / 16.0);
  return vec4<f32>(s.rgb * uUp.strength, 1.0);
}
