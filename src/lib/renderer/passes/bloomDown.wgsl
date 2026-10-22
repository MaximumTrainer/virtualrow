// Bloom pyramid down-pass (#573 D2-a). One pipeline reused for every mip:
// reads the previous mip at `src`, writes a half-res tap into the next mip.
// The first invocation (level 0 → level 1) runs with `uBloom.brightPass = 1`
// so pixels under the knee contribute nothing to the pyramid.

struct BloomUniforms {
  brightPass: f32,
  threshold: f32,
  knee: f32,
  _pad: f32,
};

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var<uniform> uBloom: BloomUniforms;

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

fn brightPass(c: vec3<f32>) -> vec3<f32> {
  let l = dot(c, vec3<f32>(0.2126, 0.7152, 0.0722));
  let soft = max(0.0, l - uBloom.threshold + uBloom.knee);
  let w = min(soft * soft / (4.0 * uBloom.knee + 1e-5), l);
  let k = select(0.0, w / l, l > 0.0);
  return c * k;
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  // 4-tap box downsample.
  let dims = vec2<f32>(textureDimensions(src, 0));
  let o = vec2<f32>(0.5, 0.5) / dims;
  let s = textureSample(src, samp, in.uv + vec2<f32>(-o.x, -o.y))
        + textureSample(src, samp, in.uv + vec2<f32>( o.x, -o.y))
        + textureSample(src, samp, in.uv + vec2<f32>(-o.x,  o.y))
        + textureSample(src, samp, in.uv + vec2<f32>( o.x,  o.y));
  var rgb = (s.rgb) * 0.25;
  if (uBloom.brightPass > 0.5) {
    rgb = brightPass(rgb);
  }
  return vec4<f32>(rgb, 1.0);
}
