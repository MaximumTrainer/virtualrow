import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import type { Coordinate } from '../types/index';
import { createRouteCurve, gpsToScenePoints } from '../components/rower3d/curve';
import { SCENE_SCALE } from '../components/rower3d/constants';
import { DEFAULT_SIMPLIFY_EPSILON_METERS } from '../utils/coordinateUtils';

/**
 * The shape guarantee #224 actually asks for.
 *
 * `routeSimplification.test.ts` checks the simplifier's own contract: no dropped
 * point strays further than the epsilon from the *polyline* that replaced it.
 * That is not the number the rower sees. The scene draws a Catmull-Rom spline
 * through Hermite-upsampled control points, and a spline cuts the corner on the
 * inside of a bend — so the drawn water can sit further out than the epsilon
 * ever allowed. These tests measure the drawn curve against the imported track.
 */

const METERS_PER_DEGREE_LAT = 111_195;
const ORIGIN_LAT = 51.45;
const LNG_SCALE = METERS_PER_DEGREE_LAT * Math.cos((ORIGIN_LAT * Math.PI) / 180);

const at = (eastMeters: number, northMeters: number): Coordinate => ({
  lat: ORIGIN_LAT + northMeters / METERS_PER_DEGREE_LAT,
  lng: eastMeters / LNG_SCALE,
});

/** A U-turn of `radiusMeters` between two straight legs. */
const hairpin = (radiusMeters: number, legMeters: number, bendPoints = 60): Coordinate[] => [
  ...Array.from({ length: 30 }, (_, i) => at(-radiusMeters, legMeters - (i / 29) * legMeters)),
  ...Array.from({ length: bendPoints }, (_, i) => {
    const angle = Math.PI + (i / (bendPoints - 1)) * Math.PI;
    return at(Math.cos(angle) * radiusMeters, Math.sin(angle) * radiusMeters);
  }),
  ...Array.from({ length: 30 }, (_, i) => at(radiusMeters, (i / 29) * legMeters)),
];

const serpentine = (points: number, lengthMeters: number, bends: number, amplitudeMeters: number) =>
  Array.from({ length: points }, (_, i) => {
    const t = i / (points - 1);
    return at(Math.sin(t * bends * 2 * Math.PI) * amplitudeMeters, t * lengthMeters);
  });

/** Distance from `point` to the segment `a`-`b`, in the horizontal plane. */
const distanceToSegment = (point: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): number => {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const lengthSquared = dx * dx + dz * dz;
  const along =
    lengthSquared > 0
      ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / lengthSquared))
      : 0;
  return Math.hypot(a.x + along * dx - point.x, a.z + along * dz - point.z);
};

/**
 * Worst distance in metres from any imported point to the curve as drawn.
 *
 * Measured against the sampled *segments*, not the samples: nearest-sample
 * distance would carry half the sample spacing as spurious error, which on a
 * 12 km route is a couple of metres of pure measurement artefact.
 */
const renderedDeviationMeters = (
  track: Coordinate[],
  epsilonMeters: number = DEFAULT_SIMPLIFY_EPSILON_METERS,
  samples = 4000,
): number => {
  const curve = createRouteCurve(track, SCENE_SCALE, 10, epsilonMeters)!;
  const drawn = Array.from({ length: samples + 1 }, (_, i) => curve.getPointAt(i / samples));
  const imported = gpsToScenePoints(track, SCENE_SCALE);

  let worst = 0;
  for (const point of imported) {
    let nearest = Infinity;
    for (let i = 0; i < drawn.length - 1; i++) {
      nearest = Math.min(nearest, distanceToSegment(point, drawn[i], drawn[i + 1]));
    }
    worst = Math.max(worst, nearest);
  }
  return worst / SCENE_SCALE;
};

/** The deviation the acceptance criterion allows. */
const MAX_RENDERED_DEVIATION_METERS = 3;

describe('the drawn curve stays on the imported water (#224)', () => {
  it('holds a 15 m hairpin', () => {
    expect(renderedDeviationMeters(hairpin(15, 600))).toBeLessThanOrEqual(
      MAX_RENDERED_DEVIATION_METERS,
    );
  });

  it('holds a 40 m hairpin', () => {
    expect(renderedDeviationMeters(hairpin(40, 600))).toBeLessThanOrEqual(
      MAX_RENDERED_DEVIATION_METERS,
    );
  });

  it('holds a 100 m hairpin, where the spline has most room to cut the corner', () => {
    expect(renderedDeviationMeters(hairpin(100, 600))).toBeLessThanOrEqual(
      MAX_RENDERED_DEVIATION_METERS,
    );
  });

  it('holds a long serpentine course', () => {
    expect(renderedDeviationMeters(serpentine(2000, 3000, 8, 60))).toBeLessThanOrEqual(
      MAX_RENDERED_DEVIATION_METERS,
    );
  });

  it('holds a dense 4,000-point import', () => {
    expect(renderedDeviationMeters(serpentine(4000, 12_000, 10, 45))).toBeLessThanOrEqual(
      MAX_RENDERED_DEVIATION_METERS,
    );
  });

  it('keeps a margin at the default epsilon, across every shape', () => {
    // The default leaves roughly a third of the budget spare. Recorded as a
    // guard: the tangent weighting in `upsampleRouteCoordinates` is what buys
    // it, and without that these same shapes measured 6.8 m. Doubling the
    // epsilon does *not* hold — 6 m of chord tolerance draws 3.5 m off — so
    // this margin is the headroom, not a licence to raise the epsilon.
    const worst = [
      hairpin(15, 600),
      hairpin(40, 600),
      hairpin(100, 600),
      serpentine(2000, 3000, 8, 60),
      serpentine(4000, 12_000, 10, 45),
    ].reduce((acc, track) => Math.max(acc, renderedDeviationMeters(track)), 0);

    expect(worst).toBeLessThanOrEqual(2.5);
  });

  it('still throws away most of a dense import', () => {
    const track = serpentine(4000, 12_000, 10, 45);
    const curve = createRouteCurve(track, SCENE_SCALE)!;
    expect(curve.points.length).toBeLessThan(track.length / 2);
  });
});
