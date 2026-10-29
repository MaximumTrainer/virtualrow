// PostFx composite pass (#573 FR2 / D3-a + D4-a + D5-a). Reads the HDR scene
// colour, the bloom result, the colour-grade LUT, and the AO buffer. Applies
// scene + bloom add → LUT → vignette → ACES tone-map → sRGB encode (the
// swap-chain target is sRGB, so hardware does the final gamma).

struct CompositeUniforms {
  bloomStrength: f32,
  vignetteStrength: f32,
  lutSize: f32,
  aoEnabled: f32,
  // #574: when non-zero, divide the scene by `exp(avgLogLum) / 0.18`
  // (middle-grey target key) before tonemap. The 1-pixel `exposureTex`
  // carries the measured log-luminance of the last-encoded scene.
  autoExposureEnabled: f32,
  _pad0: f32,
  _pad1: f32,
  _pad2: f32,
};

@group(0) @binding(0) var scene: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var bloom: texture_2d<f32>;
@group(0) @binding(3) var lut: texture_2d<f32>;
@group(0) @binding(4) var ao: texture_2d<f32>;
@group(0) @binding(5) var<uniform> u: CompositeUniforms;
// 1×1 R32F log-luminance of the previous composite's input, written by
// `luminance.wgsl`. Sampled once per fragment; the value is uniform
// across the whole frame.
@group(0) @binding(6) var exposureTex: texture_2d<f32>;

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

fn sampleLut(c: vec3<f32>) -> vec3<f32> {
  // 1024x32 slice-packed LUT. Slice index runs along u in 32-pixel chunks.
  let n = u.lutSize;
  let r = clamp(c.r, 0.0, 1.0);
  let g = clamp(c.g, 0.0, 1.0);
  let b = clamp(c.b, 0.0, 1.0);
  let zF = b * (n - 1.0);
  let zL = floor(zF);
  let zH = min(n - 1.0, zL + 1.0);
  let tz = zF - zL;
  let uLo = (zL * n + r * (n - 1.0) + 0.5) / (n * n);
  let uHi = (zH * n + r * (n - 1.0) + 0.5) / (n * n);
  let v = (g * (n - 1.0) + 0.5) / n;
  let lo = textureSample(lut, samp, vec2<f32>(uLo, v)).rgb;
  let hi = textureSample(lut, samp, vec2<f32>(uHi, v)).rgb;
  return mix(lo, hi, tz);
}

fn acesFilmic(x: vec3<f32>) -> vec3<f32> {
  let a = 2.51;
  let b = 0.03;
  let c = 2.43;
  let d = 0.59;
  let e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3<f32>(0.0), vec3<f32>(1.0));
}

fn vignetteStrength(uv: vec2<f32>) -> f32 {
  let d = uv - vec2<f32>(0.5, 0.5);
  let r = length(d) * 1.41421356;
  return max(0.0, 1.0 - r * r * u.vignetteStrength);
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  let s = textureSample(scene, samp, in.uv).rgb;
  let bl = textureSample(bloom, samp, in.uv).rgb;
  var combined = s + bl * u.bloomStrength;
  if (u.aoEnabled > 0.5) {
    let aoV = textureSample(ao, samp, in.uv).r;
    combined = combined * aoV;
  }
  if (u.autoExposureEnabled > 0.5) {
    // Pull the single-pixel log-luminance texel. The key value 0.18 is
    // the middle-grey convention from Reinhard's auto-exposure. Clamp the
    // exposure scale so a near-black scene (very negative logLum) doesn't
    // multiply the frame into a bright white, and a near-white scene
    // doesn't crush all contrast.
    let avgLogLum = textureLoad(exposureTex, vec2<i32>(0, 0), 0).r;
    let avgLum = max(exp(avgLogLum), 1e-4);
    let exposureScale = clamp(0.18 / avgLum, 0.25, 4.0);
    combined = combined * exposureScale;
  }
  let graded = sampleLut(combined);
  let v = vignetteStrength(in.uv);
  let dimmed = graded * v;
  let tm = acesFilmic(dimmed);
  return vec4<f32>(tm, 1.0);
}
