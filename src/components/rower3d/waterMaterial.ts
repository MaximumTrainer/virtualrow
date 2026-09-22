import type { PerformanceMode } from './constants';
import { TARGET_METERS_BETWEEN_SEGMENTS } from './curve';

// ============================================================================
// WHAT THE WATER IS MADE OF (#324)
//
// The route channel was `MeshStandardMaterial { roughness 0.55, metalness 0,
// emissive = the water colour, emissiveIntensity 0.35 }` with no normal map
// and nothing to reflect. At a rower's eye height that is not a surface; it is
// a blue plane with a light behind it, which is what both docs screenshots
// show.
//
// Three things were missing and they are separate decisions:
//
//   *Detail.* Ripples, at the scale a rower would see them.
//   *Reflection.* Something in the environment map to reflect. `PMREM
//    Environment` built one from the live scene on mount, before `Sky` had
//    rendered a frame, so it reflected black — and the material's comment,
//    "with no environment map to reflect", was describing a state it had
//    helped create.
//   *Fresnel.* Water is dark looking down and a mirror looking along. One
//    roughness for both is why the channel read as paint.
//
// ## The scale the mesh can carry
//
// VR-04 asks for Gerstner wavelengths of 1.5–6 m, so the boat rides small
// chop. The channel cannot carry that and no retune will make it: it is a
// two-vertex-wide ribbon — one vertex per bank, none in between — sampled
// every `TARGET_METERS_BETWEEN_SEGMENTS` (15 m) along the route. A 6 m wave
// needs samples every 3 m to exist at all. Displacing vertices at that scale
// produces aliasing, not chop.
//
// So the two scales are separated and named. The vertices carry swell long
// enough to sample; the normal map carries the 1.5–6 m chop, per-pixel, where
// there is no sampling limit and where a rower actually sees it. Subdividing
// the ribbon to 3 m would multiply its triangles by five, against the budget
// #342 has just set.
// ============================================================================

/**
 * Wavelengths, in metres, of the waves that displace vertices.
 *
 * Each is at least twice the distance between samples, which is the shortest
 * wave a mesh can represent without aliasing.
 */
export const SWELL_WAVELENGTHS_METRES = [180, 120, 75, 40] as const;

/**
 * Heights, in metres, of the four swell waves — tallest first, matching
 * `SWELL_WAVELENGTHS_METRES`.
 *
 * VR-04 asks for 0.03–0.08 m, and these are that range: a river is not a sea,
 * and the old 0.15 m at a 314 m wavelength was a slope no one could see rather
 * than a wave.
 */
export const SWELL_AMPLITUDES_METRES = [0.08, 0.06, 0.045, 0.03] as const;

/** Wavelengths, in metres, of the chop carried by the ripple texture. */
export const CHOP_WAVELENGTH_METRES = [1.5, 6] as const;

/**
 * How many metres one tile of the ripple texture covers.
 *
 * The texture holds several chop wavelengths, so the tile is a few times the
 * longest of them — small enough that the repeat is invisible from a boat,
 * large enough that it is not a screen door.
 */
export const RIPPLE_TILE_METRES = 12;

export interface WaterMaterialPlan {
  /** Strength of the ripple normals, 0–1. */
  normalScale: number;
  roughness: number;
  /** Always 0: with a weak environment map, metal renders as a hole (#269). */
  metalness: number;
  envMapIntensity: number;
  /** Whether to pay for a planar reflection. */
  useMirror: boolean;
}

/**
 * The water's material settings for a tier.
 *
 * Roughness falls as the tier rises because a sharper reflection is the thing
 * the extra budget buys, and a mirror on a rough surface is wasted.
 */
export const waterMaterialPlan = (mode: PerformanceMode): WaterMaterialPlan => {
  if (mode === 'high') {
    return {
      normalScale: 0.35,
      roughness: 0.12,
      metalness: 0,
      envMapIntensity: 1.0,
      useMirror: true,
    };
  }
  if (mode === 'auto') {
    return {
      normalScale: 0.3,
      roughness: 0.18,
      metalness: 0,
      envMapIntensity: 0.9,
      useMirror: false,
    };
  }
  return {
    normalScale: 0.2,
    roughness: 0.3,
    metalness: 0,
    envMapIntensity: 0.5,
    useMirror: false,
  };
};

export interface ChannelSize {
  /** How wide the channel is, in metres. */
  widthMetres: number;
  /** How long the route is, in metres. */
  lengthMetres: number;
}

/**
 * How many times the ripple texture tiles across the channel and along it.
 *
 * The channel's uv runs 0–1 across the water and 0–1 along the *whole route*,
 * so a texture left at its default repeat stretches one tile over kilometres
 * — which is how a normal map ends up contributing nothing. The repeat is the
 * route's size measured in tiles, which keeps a tile the same size in metres
 * on a 2 km course and on a marathon.
 */
export const rippleRepeat = ({ widthMetres, lengthMetres }: ChannelSize) => ({
  x: Math.max(1, widthMetres / RIPPLE_TILE_METRES),
  y: Math.max(1, lengthMetres / RIPPLE_TILE_METRES),
});

/** How far each ripple layer has scrolled, in texture units, at `seconds`. */
export interface RippleScroll {
  first: { x: number; y: number };
  second: { x: number; y: number };
}

/**
 * Where the two ripple layers have scrolled to.
 *
 * Two layers at different rates and in different directions, because one
 * scrolling layer reads as a texture being dragged rather than as water. The
 * offsets wrap at 1: a texture offset that climbs for an hour loses float
 * precision, and the ripples begin to judder.
 */
export const rippleScroll = (seconds: number): RippleScroll => {
  const wrap = (value: number) => value % 1;
  return {
    first: { x: wrap(seconds * 0.013), y: wrap(seconds * 0.03) },
    second: { x: wrap(seconds * -0.021), y: wrap(seconds * -0.018) },
  };
};

/**
 * The Gerstner frequency, in radians per metre, for a wavelength in metres.
 *
 * The shader takes a frequency; the issue, and anyone looking at water, thinks
 * in wavelengths. Converting here means the numbers above can stay readable.
 */
export const frequencyForWavelength = (metres: number): number => (Math.PI * 2) / metres;

/** The shortest wave this mesh can carry without aliasing, in metres. */
export const SHORTEST_SAMPLEABLE_WAVE_METRES = TARGET_METERS_BETWEEN_SEGMENTS * 2;
