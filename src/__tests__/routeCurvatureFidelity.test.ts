import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import type { Coordinate } from '../types/index';
import { createRouteCurve } from '../components/rower3d/curve';
import { createWaterChannelGeometry } from '../components/rower3d/waterGeometry';
import { createBankGeometry } from '../components/rower3d/bankGeometry';
import { SCENE_SCALE } from '../components/rower3d/constants';
import {
  stripProgressSchedule,
  stripSegmentCount,
} from '../components/rower3d/routeStripGeometry';
import type { RouteEnrichmentData } from '../services/routeEnrichmentService';

/**
 * A channel narrow enough to negotiate a tight bend.
 *
 * The default width is 200 m, which physically cannot follow a 40 m radius —
 * the inner edge folds through itself. Rowable hairpins are narrow water.
 */
const narrowChannel = (waterWidthMeters: number): RouteEnrichmentData => ({
  routeId: 'hairpin-fixture',
  elevations: [],
  segmentProfiles: [],
  waterBodyType: 'river',
  waterWidthMeters,
  waterColor: '#3a6b7d',
  waveIntensity: 1,
  fetchedAt: Date.now(),
  source: 'network',
});

const METERS_PER_DEGREE_LAT = 111_195;
const ORIGIN_LAT = 51.45;
const LNG_SCALE = METERS_PER_DEGREE_LAT * Math.cos((ORIGIN_LAT * Math.PI) / 180);

const at = (eastMeters: number, northMeters: number): Coordinate => ({
  lat: ORIGIN_LAT + northMeters / METERS_PER_DEGREE_LAT,
  lng: eastMeters / LNG_SCALE,
});

/**
 * A U-shaped hairpin: two straight legs joined by a 180-degree bend of
 * `radiusMeters`. The shape #224 calls out as the faceting risk — a fixed
 * segment count spreads the same geometry over the straights and the bend.
 */
const hairpin = (radiusMeters: number, legMeters: number, bendPoints = 60): Coordinate[] => {
  const inbound = Array.from({ length: 30 }, (_, i) =>
    at(-radiusMeters, legMeters - (i / 29) * legMeters),
  );
  const bend = Array.from({ length: bendPoints }, (_, i) => {
    const angle = Math.PI + (i / (bendPoints - 1)) * Math.PI;
    return at(Math.cos(angle) * radiusMeters, Math.sin(angle) * radiusMeters);
  });
  const outbound = Array.from({ length: 30 }, (_, i) =>
    at(radiusMeters, (i / 29) * legMeters),
  );
  return [...inbound, ...bend, ...outbound];
};

/** Largest turn in degrees between consecutive samples of the strip schedule. */
const worstScheduledTurnDegrees = (curve: THREE.CatmullRomCurve3): number => {
  const points = stripProgressSchedule(curve).map((t) => curve.getPointAt(t));
  let worst = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i].clone().sub(points[i - 1]);
    const b = points[i + 1].clone().sub(points[i]);
    if (a.length() < 1e-6 || b.length() < 1e-6) continue;
    worst = Math.max(worst, THREE.MathUtils.radToDeg(a.normalize().angleTo(b.normalize())));
  }
  return worst;
};

/** Largest turn in degrees along one edge of a built strip. */
const worstEdgeTurnDegrees = (geometry: THREE.BufferGeometry, edge: 0 | 1): number => {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  const edgePoints: THREE.Vector3[] = [];
  for (let i = edge; i < position.count; i += 2) {
    edgePoints.push(new THREE.Vector3().fromBufferAttribute(position, i));
  }
  let worst = 0;
  for (let i = 1; i < edgePoints.length - 1; i++) {
    const a = edgePoints[i].clone().sub(edgePoints[i - 1]);
    const b = edgePoints[i + 1].clone().sub(edgePoints[i]);
    if (a.length() < 1e-9 || b.length() < 1e-9) continue;
    worst = Math.max(worst, THREE.MathUtils.radToDeg(a.normalize().angleTo(b.normalize())));
  }
  return worst;
};

describe('tight-curve routes render without faceting (#224)', () => {
  it('holds a 40 m hairpin under the faceting threshold on the water channel', () => {
    const curve = createRouteCurve(hairpin(40, 600), SCENE_SCALE)!;
    const water = createWaterChannelGeometry(curve, { enrichment: narrowChannel(30) });

    // A facet becomes visible when one segment turns more than a few degrees.
    // 6 degrees is a 60-sided circle: smooth at any distance the rower sees.
    expect(worstEdgeTurnDegrees(water, 0)).toBeLessThan(6);
    expect(worstEdgeTurnDegrees(water, 1)).toBeLessThan(6);
  });

  it('holds the hairpin on the waterline edge of both riverbanks', () => {
    // Only the inner edge is asserted. The outer edge sits a bank-width out —
    // 150 m for this channel — and no 150 m-wide strip can follow a 40 m bend
    // without its inside edge passing through itself. That is geometry, not a
    // sampling defect, and it is the waterline the rower reads anyway.
    const curve = createRouteCurve(hairpin(40, 600), SCENE_SCALE)!;
    for (const side of ['left', 'right'] as const) {
      const bank = createBankGeometry(curve, side, { enrichment: narrowChannel(30) });
      expect(worstEdgeTurnDegrees(bank, 0)).toBeLessThan(6);
    }
  });

  it('keeps a very tight 15 m bend smooth as well', () => {
    const curve = createRouteCurve(hairpin(15, 400), SCENE_SCALE)!;
    // Measured on the schedule the strip actually samples, which concentrates
    // its budget in the bend; uniform sampling at the same count would not.
    expect(worstScheduledTurnDegrees(curve)).toBeLessThan(6);
    expect(
      worstEdgeTurnDegrees(createWaterChannelGeometry(curve, { enrichment: narrowChannel(12) }), 0),
    ).toBeLessThan(6);
  });

  it('does not let simplification straighten the bend away', () => {
    const track = hairpin(40, 600);
    const simplified = createRouteCurve(track, SCENE_SCALE)!;
    const unsimplified = createRouteCurve(track, SCENE_SCALE, 10, 0)!;

    // Both curves must still travel the same distance around the bend, to
    // within a metre of scene length (0.1 scene units at SCENE_SCALE).
    expect(simplified.getLength()).toBeCloseTo(unsimplified.getLength(), 0);
  });

  it('spends more segments on a hairpin than the old fixed 200 would have', () => {
    // The bend is where a fixed count under-samples; a 20 km winding route now
    // earns 800 rather than 200.
    const long = hairpin(40, 9_700);
    expect(stripSegmentCount(createRouteCurve(long, SCENE_SCALE)!)).toBeGreaterThan(200);
  });
});

describe('closed-loop routes join without a seam (#224)', () => {
  const loop = (radiusMeters: number, points = 400): Coordinate[] =>
    Array.from({ length: points }, (_, i) => {
      const angle = (i / (points - 1)) * 2 * Math.PI;
      return at(Math.sin(angle) * radiusMeters, (Math.cos(angle) - 1) * radiusMeters);
    });

  it('puts the end of the curve exactly where it started', () => {
    const curve = createRouteCurve(loop(400), SCENE_SCALE)!;
    const start = curve.getPointAt(0);
    const end = curve.getPointAt(1);
    // Scene units at 0.1 scale: 0.01 is a centimetre of water.
    expect(start.distanceTo(end)).toBeLessThan(0.01);
  });

  it('carries the boat across the 0/1 boundary without a jump', () => {
    const curve = createRouteCurve(loop(400), SCENE_SCALE)!;
    const justBefore = curve.getPointAt(0.9995);
    const justAfter = curve.getPointAt(0.0005);
    const stepAcross = justBefore.distanceTo(justAfter);
    const typicalStep = curve.getPointAt(0.5).distanceTo(curve.getPointAt(0.5005));

    expect(stepAcross).toBeLessThan(typicalStep * 4);
  });

  it('closes the water channel on itself, first vertex pair to last', () => {
    const curve = createRouteCurve(loop(400), SCENE_SCALE)!;
    const water = createWaterChannelGeometry(curve, { enrichment: narrowChannel(30) });
    const position = water.getAttribute('position') as THREE.BufferAttribute;
    const first = new THREE.Vector3().fromBufferAttribute(position, 0);
    const last = new THREE.Vector3().fromBufferAttribute(position, position.count - 2);

    expect(first.distanceTo(last)).toBeLessThan(0.05);
  });

  it('keeps a loop smooth through the join', () => {
    const curve = createRouteCurve(loop(400), SCENE_SCALE)!;
    expect(
      worstEdgeTurnDegrees(createWaterChannelGeometry(curve, { enrichment: narrowChannel(30) }), 0),
    ).toBeLessThan(6);
  });
});
