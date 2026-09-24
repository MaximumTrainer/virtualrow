import * as THREE from 'three';
import { WATER_SURFACE_Y } from './waterGeometry';

// ============================================================================
// THE WAKE, AND THE FOAM AT THE BLADE (#323)
//
// What was there before: three `planeGeometry` quads and two `circleGeometry`
// discs, all `meshBasicMaterial color="white"`, all with hard edges and no
// texture. Under the `auto` composer the bloom pass found them and turned the
// lot into a glowing white slab — the blob visible under the boat in both docs
// screenshots.
//
// Three separate faults, and this module is the pure half of fixing them:
//
//   1. *Brightness.* White at any opacity is the brightest thing on a river,
//      and bloom is a luminance threshold. `bloomSafeFoamColor` caps the foam
//      below it, so the pass cannot see the wake at all.
//   2. *Edges.* A quad has four of them. `createWakeTexture` draws an alpha
//      falloff along the wake and across it, so the trail fades out instead of
//      stopping.
//   3. *Place.* The old wake was drawn from z = 0 backwards — and z = 0 is the
//      middle of an eight-metre hull, so most of it was under the boat rather
//      than behind it. `STERN_Z_METRES` is where it starts now.
//
// Everything here is pure or canvas-only, so it is testable in jsdom; the
// meshes that consume it live in `effectComponents.tsx`.
// ============================================================================

/** One stop of a canvas gradient: where it is, and how opaque it is there. */
export interface AlphaStop {
  /** 0–1 along the gradient. */
  offset: number;
  /** 0–1 alpha at that point. */
  alpha: number;
}

/**
 * Where the hull ends, in the boat's local frame.
 *
 * The boat travels along local **+Z** — `getRoutePositionAtProgress` aligns
 * local +Z with the curve tangent, and the chase camera sits at local z = -6 —
 * so the stern is the negative end. `boatComponents.tsx` builds the hull as an
 * 8 m box centred on the origin with a cone at z = -4.2 whose base reaches
 * -4.7; a little clearance past that is where the water starts being disturbed.
 */
export const STERN_Z_METRES = -4.75;

/**
 * The height the wake and the foam are drawn at.
 *
 * Three centimetres over the water rather than a number of its own: the old
 * wake was authored at the boat's y minus 0.07 and happened to land on the
 * surface only because the route curve runs through y = 0. Anchored here it
 * stays on the water whatever the hull does.
 */
export const WAKE_SURFACE_Y = WATER_SURFACE_Y + 0.03;

/**
 * Drawn after the water and the shoreline strip.
 *
 * All three lie in the same plane to within a couple of centimetres, so the
 * depth test cannot separate them. Render order can, and only the water writes
 * depth.
 */
export const WAKE_RENDER_ORDER = 2;

/** Texture edge, in pixels. Square: the fade runs one way, the softening the other. */
export const WAKE_TEXTURE_SIZE = 128;

/** Edge of the blade-entry ring texture, in pixels. */
export const FOAM_RING_TEXTURE_SIZE = 64;

/** How long a blade-entry ring takes to expand and disappear, in seconds. */
export const FOAM_RING_LIFETIME_SECONDS = 0.6;

/**
 * The luminance the foam is not allowed to exceed.
 *
 * #327 set the bloom pass's `luminanceThreshold` to 0.9. Anything below that
 * is invisible to it, and the margin is there because the wake is composited
 * over water that is not black.
 */
export const BLOOM_SAFE_LUMINANCE = 0.85;

/** Rec. 709 weights — the same `LUMA` the postprocessing bloom pass uses. */
const LUMA = [0.2125, 0.7154, 0.0721] as const;

/**
 * The wake's alpha along its length: strongest where the water was just
 * disturbed, gone by the tail.
 *
 * The fall is steeper than linear because foam collapses quickly; a linear
 * ramp reads as a painted stripe rather than as something dispersing.
 */
export const WAKE_ALPHA_STOPS: readonly AlphaStop[] = [
  { offset: 0, alpha: 0.9 },
  { offset: 0.35, alpha: 0.45 },
  { offset: 0.7, alpha: 0.12 },
  { offset: 1, alpha: 0 },
];

/**
 * How much of the wake survives across its width — nothing at either edge,
 * all of it down the middle.
 *
 * Drawn as a `destination-out` mask, so the canvas gets `1 - alpha`; this is
 * stated the way it reads on screen because that is what a reader wants to
 * check.
 */
export const WAKE_EDGE_KEEP_STOPS: readonly AlphaStop[] = [
  { offset: 0, alpha: 0 },
  { offset: 0.3, alpha: 1 },
  { offset: 0.5, alpha: 1 },
  { offset: 0.7, alpha: 1 },
  { offset: 1, alpha: 0 },
];

const clamp01 = (value: number) => THREE.MathUtils.clamp(value, 0, 1);

/** Parse `#rrggbb` into three 0–1 components. Unparseable input reads as black. */
const componentsOf = (hex: string): [number, number, number] => {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return [0, 0, 0];
  const value = parseInt(match[1], 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
};

/**
 * Back to `#rrggbb`, rounding *down*.
 *
 * Rounding to nearest can land a channel above the value asked for, and eight
 * bits of rounding error is enough to put a colour dimmed to exactly the bloom
 * ceiling back over it. Down is the only direction that keeps the promise.
 */
const toHex = (components: readonly [number, number, number]) =>
  '#' +
  components
    .map((c) => Math.floor(clamp01(c) * 255).toString(16).padStart(2, '0'))
    .join('');

/** The relative luminance of a colour, on the scale the bloom pass thresholds. */
export const foamLuminance = (hex: string): number => {
  const [r, g, b] = componentsOf(hex);
  return LUMA[0] * r + LUMA[1] * g + LUMA[2] * b;
};

/**
 * The foam colour, dimmed just far enough that the bloom pass cannot find it.
 *
 * Scaling all three channels together keeps the hue, so a theme that wants
 * grey-green foam still gets grey-green foam — only darker.
 */
export const bloomSafeFoamColor = (hex: string): string => {
  const luminance = foamLuminance(hex);
  if (luminance <= BLOOM_SAFE_LUMINANCE) return hex;

  const scale = BLOOM_SAFE_LUMINANCE / luminance;
  const [r, g, b] = componentsOf(hex);
  return toHex([r * scale, g * scale, b * scale]);
};

/** How long the wake is and how strongly it shows, at a boat speed. */
export const wakeFor = (velocityMps: number): { length: number; opacity: number } => ({
  length: THREE.MathUtils.clamp(velocityMps * 2.2, 0, 14),
  opacity: clamp01(velocityMps / 4.5) * 0.55,
});

/**
 * A blade-entry ring partway through its life.
 *
 * `life` runs 1 at the catch down to 0 six tenths of a second later; the ring
 * expands from 0.4 to 1.4 as it goes, and fades from 0.7 to nothing.
 */
export const foamRingFor = (life: number): { scale: number; opacity: number } => {
  const remaining = clamp01(life);
  return { scale: 0.4 + (1 - remaining) * 1.0, opacity: remaining * 0.7 };
};

/**
 * How strongly the blade foam shows at the finish (#336): a burst at the line,
 * several times the theme's everyday foam, capped so it never reads as paint.
 */
export const FINISH_FOAM_BOOST = 2.5;

export const foamIntensityFor = (base: number, finished: boolean): number =>
  finished ? Math.min(1, base * FINISH_FOAM_BOOST) : base;

const applyStops = (
  gradient: CanvasGradient,
  stops: readonly AlphaStop[],
  alphaOf: (stop: AlphaStop) => number,
) => {
  for (const stop of stops) {
    gradient.addColorStop(stop.offset, 'rgba(255, 255, 255, ' + alphaOf(stop) + ')');
  }
};

/**
 * The wake's alpha mask: a soft trail with no edge anywhere on it.
 *
 * Returns null where there is no 2D context to draw into — the wake is
 * decoration, and decoration that throws has turned a missing trail into a
 * missing river. Same failure as the shoreline's foam line.
 */
export const createWakeTexture = (size = WAKE_TEXTURE_SIZE): THREE.CanvasTexture | null => {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;

  const context = canvas.getContext('2d');
  if (!context) return null;

  // Down the canvas: the stern end at the top, the tail at the bottom.
  const along = context.createLinearGradient(0, 0, 0, size);
  applyStops(along, WAKE_ALPHA_STOPS, (stop) => stop.alpha);
  context.fillStyle = along;
  context.fillRect(0, 0, size, size);

  // Across it: cut the sides away, so the arms of the V have no cut edge.
  const across = context.createLinearGradient(0, 0, size, 0);
  applyStops(across, WAKE_EDGE_KEEP_STOPS, (stop) => 1 - stop.alpha);
  context.globalCompositeOperation = 'destination-out';
  context.fillStyle = across;
  context.fillRect(0, 0, size, size);
  context.globalCompositeOperation = 'source-over';

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  // uv.y runs 0 at the stern to 1 at the tail and the gradient is drawn the
  // same way round; three's default flip would fade the wake in, not out.
  texture.flipY = false;
  return texture;
};

/**
 * A ring of foam, soft on both sides: a blade leaves a torn circle on the
 * surface, not a disc.
 */
export const createFoamRingTexture = (
  size = FOAM_RING_TEXTURE_SIZE,
): THREE.CanvasTexture | null => {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;

  const context = canvas.getContext('2d');
  if (!context) return null;

  const half = size / 2;
  const ring = context.createRadialGradient(half, half, 0, half, half, half);
  ring.addColorStop(0, 'rgba(255, 255, 255, 0)');
  ring.addColorStop(0.45, 'rgba(255, 255, 255, 0.15)');
  ring.addColorStop(0.72, 'rgba(255, 255, 255, 0.9)');
  ring.addColorStop(0.88, 'rgba(255, 255, 255, 0.35)');
  ring.addColorStop(1, 'rgba(255, 255, 255, 0)');

  context.fillStyle = ring;
  context.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
};

/** The Kelvin wake's half-angle. A real one is 19.47°; this is within a tenth. */
const HALF_ANGLE = Math.PI / 9.2;
/** Width of each arm of the V, as a fraction of the wake's length. */
const ARM_WIDTH = 0.06;
/** Width of the flat patch immediately behind the stern, as a fraction of length. */
const STERN_PATCH_WIDTH = 0.13;
/** How far back the stern patch runs, as a fraction of length. */
const STERN_PATCH_LENGTH = 0.45;

/**
 * One strip lying flat in XZ, running `length` back along -Z from the origin,
 * `width` across, and drifting sideways as `centreAt` says. uv runs 0→1 both ways.
 *
 * The width is laid out purely in X so that both ends of the strip are square
 * to the boat, which is what the water does: the wake starts on a line across
 * the stern, not on a line square to the arm. It also keeps every vertex
 * inside [0, -length] in Z, and *that* is what stops the wake creeping back
 * under the hull — the fault this whole module exists to fix.
 */
const pushStrip = (
  positions: number[],
  uvs: number[],
  indices: number[],
  centreAt: (t: number) => number,
  length: number,
  width: number,
) => {
  const base = positions.length / 3;

  for (const t of [0, 1]) {
    for (const s of [-0.5, 0.5]) {
      positions.push(centreAt(t) + width * s, 0, -length * t);
      uvs.push(s + 0.5, t);
    }
  }
  indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
};

/**
 * The whole wake as a single mesh: both arms of the V and the disturbed patch
 * behind the stern.
 *
 * Built over a unit length along -Z and scaled by speed at draw time, so the
 * V keeps its angle as the boat accelerates and the arms spread with it.
 * Nothing here reaches past z = 0, which is the stern in the frame this is
 * positioned in — that is the property that keeps it out from under the hull.
 */
export const createWakeGeometry = (): THREE.BufferGeometry => {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const spread = Math.tan(HALF_ANGLE);
  pushStrip(positions, uvs, indices, (t) => -spread * t, 1, ARM_WIDTH);
  pushStrip(positions, uvs, indices, (t) => spread * t, 1, ARM_WIDTH);
  pushStrip(positions, uvs, indices, () => 0, STERN_PATCH_LENGTH, STERN_PATCH_WIDTH);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
};
