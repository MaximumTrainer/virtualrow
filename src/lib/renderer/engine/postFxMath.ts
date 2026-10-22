/**
 * P8 of #542 — pure-TS mirrors of the composite shader's math so the ACs can
 * be asserted without a GPU readback (AC2–AC5 of #573). The WGSL in
 * `src/lib/renderer/passes/composite.wgsl` is the source of truth; this file
 * is the parallel CPU implementation. The pair is kept in step by
 * `postFxMath.test.ts`.
 */

export type Vec3 = readonly [number, number, number];

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

/**
 * ACES Filmic tone-map (D3-a of #573). The Narkowicz approximation of the
 * ACES RRT+ODT pipeline: cheap, maps `[0, +∞)` into `[0, 1]`, keeps a shoulder.
 */
export const acesFilmic = (x: Vec3): Vec3 => {
  const map = (v: number): number => {
    const a = 2.51;
    const b = 0.03;
    const c = 2.43;
    const d = 0.59;
    const e = 0.14;
    return clamp01((v * (a * v + b)) / (v * (c * v + d) + e));
  };
  return [map(x[0]), map(x[1]), map(x[2])];
};

export const luminance = (c: Vec3): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/**
 * Bright-pass threshold used by `bloomDown.wgsl` on the first downsample
 * (D2-a). Pixels at or above the knee contribute to the bloom pyramid; below
 * it the contribution tapers smoothly to zero.
 */
export const brightPass = (c: Vec3, threshold = 1.0, knee = 0.5): Vec3 => {
  const l = luminance(c);
  const soft = Math.max(0, l - threshold + knee);
  const w = Math.min(soft * soft / (4 * knee + 1e-5), l);
  const k = l > 0 ? w / l : 0;
  return [c[0] * k, c[1] * k, c[2] * k];
};

/**
 * 32×32×32 LUT sampled as a 1024×32 2D texture (D4-a). The LUT lives on a row
 * with 32 slices side-by-side; slice `b` lives at `[b*32, b*32 + 32)` in u.
 * Trilinear across (u, v, b-slice).
 */
export interface Lut3D {
  /** Row-major RGBA8, 1024×32 pixels. */
  pixels: Uint8ClampedArray;
  /** Must be 32 for the current packing. */
  size: number;
}

export const sampleLut = (lut: Lut3D, rgb: Vec3): Vec3 => {
  const n = lut.size;
  const x = clamp01(rgb[0]) * (n - 1);
  const y = clamp01(rgb[1]) * (n - 1);
  const z = clamp01(rgb[2]) * (n - 1);
  const zL = Math.floor(z);
  const zH = Math.min(n - 1, zL + 1);
  const tz = z - zL;
  const sampleSlice = (zi: number): Vec3 => {
    const xL = Math.floor(x);
    const xH = Math.min(n - 1, xL + 1);
    const yL = Math.floor(y);
    const yH = Math.min(n - 1, yL + 1);
    const tx = x - xL;
    const ty = y - yL;
    const fetch = (xi: number, yi: number): Vec3 => {
      const px = zi * n + xi; // slice offset
      const py = yi;
      const i = (py * (n * n) + px) * 4;
      return [lut.pixels[i] / 255, lut.pixels[i + 1] / 255, lut.pixels[i + 2] / 255];
    };
    const a = fetch(xL, yL);
    const b = fetch(xH, yL);
    const c = fetch(xL, yH);
    const d = fetch(xH, yH);
    const r = (va: number, vb: number, vc: number, vd: number): number =>
      va * (1 - tx) * (1 - ty) + vb * tx * (1 - ty) + vc * (1 - tx) * ty + vd * tx * ty;
    return [r(a[0], b[0], c[0], d[0]), r(a[1], b[1], c[1], d[1]), r(a[2], b[2], c[2], d[2])];
  };
  const lo = sampleSlice(zL);
  const hi = sampleSlice(zH);
  return [
    lo[0] * (1 - tz) + hi[0] * tz,
    lo[1] * (1 - tz) + hi[1] * tz,
    lo[2] * (1 - tz) + hi[2] * tz,
  ];
};

/**
 * Build a neutral (identity) 32×32×32 LUT packed as 1024×32 RGBA8. A sample
 * at colour `(r, g, b)` returns `(r, g, b)` to within 1/255.
 */
export const buildNeutralLutPixels = (size = 32): Uint8ClampedArray => {
  const w = size * size;
  const h = size;
  const px = new Uint8ClampedArray(w * h * 4);
  for (let b = 0; b < size; b += 1) {
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const i = (y * w + b * size + x) * 4;
        px[i] = Math.round((x / (size - 1)) * 255);
        px[i + 1] = Math.round((y / (size - 1)) * 255);
        px[i + 2] = Math.round((b / (size - 1)) * 255);
        px[i + 3] = 255;
      }
    }
  }
  return px;
};

/**
 * Analytic radial vignette (D5-a). `uv` is the fragment's UV in [0, 1]².
 * `strength` 0 is no vignette; 1 fully darkens the corners.
 */
export const vignette = (uv: readonly [number, number], strength = 0.4): number => {
  const dx = uv[0] - 0.5;
  const dy = uv[1] - 0.5;
  const r = Math.sqrt(dx * dx + dy * dy) * Math.SQRT2;
  const falloff = 1 - r * r * strength;
  return Math.max(0, falloff);
};

/**
 * Full composite: scene colour + bloom (additive) → LUT → vignette → ACES.
 * Returns the final linear-after-tone-map RGB; the sRGB encode is the
 * swap-chain's job (sky uses `rgba16float` scene, swap uses `*srgb`).
 */
export const composite = (
  scene: Vec3,
  bloom: Vec3,
  lut: Lut3D,
  uv: readonly [number, number],
  opts: { bloomStrength?: number; vignetteStrength?: number } = {},
): Vec3 => {
  const bs = opts.bloomStrength ?? 0.08;
  const vs = opts.vignetteStrength ?? 0.4;
  const added: Vec3 = [scene[0] + bloom[0] * bs, scene[1] + bloom[1] * bs, scene[2] + bloom[2] * bs];
  const graded = sampleLut(lut, added);
  const v = vignette(uv, vs);
  const dimmed: Vec3 = [graded[0] * v, graded[1] * v, graded[2] * v];
  return acesFilmic(dimmed);
};

/**
 * GTAO-lite kernel for AC5 (D6-a). Returns the AO term in `[0, 1]` where 1 is
 * no occlusion. The real shader samples depth with 8 taps; the CPU mirror
 * takes 8 depth samples by callback so a unit test can set up a synthetic
 * ground-plane scene.
 */
export const gtaoLite = (
  sampleDepth: (dx: number, dy: number) => number,
  centerDepth: number,
  radius = 1.0,
): number => {
  // 8 taps around a half-circle; the sign of `dx` determines the horizon
  // bracket. This is a drastically simplified GTAO — enough to produce a
  // darker-than-1 result at building/ground creases.
  const taps: Array<[number, number]> = [];
  for (let i = 0; i < 8; i += 1) {
    const a = (i / 8) * Math.PI * 2;
    taps.push([Math.cos(a) * radius, Math.sin(a) * radius]);
  }
  let occlusion = 0;
  for (const [dx, dy] of taps) {
    const sd = sampleDepth(dx, dy);
    // Closer-than-centre pixels along the horizon cast occlusion.
    if (sd < centerDepth) occlusion += (centerDepth - sd) / radius;
  }
  const ao = 1 - occlusion / taps.length;
  return clamp01(ao);
};
