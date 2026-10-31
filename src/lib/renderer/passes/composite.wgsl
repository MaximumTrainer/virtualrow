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
  // #574: radial chromatic aberration offset (UV units at corner). 0 = off.
  caOffset: f32,
  _pad0: f32,
  _pad1: f32,
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

// #574 lens-dirt: a procedural speckle pattern that modulates the bloom
// contribution. Adds "character" to the glow at zero asset cost — the
// bright highlights read as though the lens has a few specks of dust
// smearing light out, rather than the clean mathematical bloom of the
// bare composite. Four octaves of hash noise, dot-product-combined so
// the pattern is non-repeating across the frame. Peak modulation is
// ±15 % of the bloom (so a highlight-less scene stays visually
// identical).
fn lensDirtMul(uv: vec2<f32>) -> f32 {
  let p = uv * vec2<f32>(13.0, 7.0);
  let n1 = fract(sin(dot(p, vec2<f32>(12.9898, 78.233))) * 43758.5453);
  let p2 = uv * vec2<f32>(27.0, 19.0) + vec2<f32>(0.37, 0.91);
  let n2 = fract(sin(dot(p2, vec2<f32>(39.3468, 11.135))) * 24634.6345);
  let p3 = uv * vec2<f32>(53.0, 41.0) + vec2<f32>(0.73, 0.29);
  let n3 = fract(sin(dot(p3, vec2<f32>(68.1123, 52.981))) * 15731.743);
  let p4 = uv * vec2<f32>(97.0, 83.0) + vec2<f32>(0.17, 0.62);
  let n4 = fract(sin(dot(p4, vec2<f32>(21.6342, 93.871))) * 9876.5432);
  let avg = n1 * 0.4 + n2 * 0.3 + n3 * 0.2 + n4 * 0.1; // ∈ [0, 1]
  // Centre on 1.0, keep swing within ±0.15 so bloom-less fragments stay
  // visually identical (shaded colour comes from the scene, bloom goes
  // through this multiplier so a 15 % jitter on near-zero is invisible).
  return 0.85 + avg * 0.3;
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  // #574 chromatic aberration: offset the R and B samples along a radial
  // direction from the centre; keep G at the centre so the perceived image
  // sharpness is preserved. The offset scales with distance from centre so
  // the frame centre stays crisp and the edges carry the lens feel.
  let dir = in.uv - vec2<f32>(0.5, 0.5);
  let caShift = dir * u.caOffset;
  let sR = textureSample(scene, samp, in.uv + caShift).r;
  let sG = textureSample(scene, samp, in.uv).g;
  let sB = textureSample(scene, samp, in.uv - caShift).b;
  let s = vec3<f32>(sR, sG, sB);
  // #574 lens-dirt: modulate the bloom by a procedural dirt pattern.
  let bl = textureSample(bloom, samp, in.uv).rgb * lensDirtMul(in.uv);
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
