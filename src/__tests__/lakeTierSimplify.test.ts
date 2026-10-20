import { describe, expect, it } from 'vitest';
import type { Coordinate } from '../lib/types/index';
import { ALL_PERFORMANCE_MODES, LAKE_VERTEX_CAP } from '../components/rower3d/constants';
import { lakePolygonsForTier, vertexCount, type LakePolygon } from '../lib/utils/lakePolygons';

/**
 * #493 Phase 4 (FR9, D7 b, AC7): lake outlines are slimmed to each graphics
 * tier's vertex cap before they are drawn, and the slimming never pulls a
 * shoreline in towards the route.
 */

const M = 1 / 111_320;
const at = (x: number, y: number): Coordinate => ({ lat: y * M, lng: x * M });

/** A wobbly ring of `n` vertices round (cx, cy), closed. */
const wobblyRing = (n: number, radius: number, cx = 0, cy = 0, wobble = 0.08): Coordinate[] => {
  const ring = Array.from({ length: n }, (_, index) => {
    const angle = (index / n) * Math.PI * 2;
    const r = radius * (1 + wobble * Math.sin(index * 7.3) * Math.cos(index * 2.1));
    return at(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r);
  });
  return [...ring, ring[0]];
};

const lake = (): LakePolygon[] => [
  { featureId: 'way/1', outer: wobblyRing(3000, 1000), inner: [wobblyRing(600, 80, 300, 0)] },
];

/** Metres from a point to the nearest edge of any ring. */
const shoreDistance = (point: Coordinate, lakes: LakePolygon[]) => {
  const px = point.lng / M;
  const py = point.lat / M;
  let best = Infinity;
  for (const ring of lakes.flatMap((polygon) => [polygon.outer, ...polygon.inner])) {
    for (let index = 0; index + 1 < ring.length; index++) {
      const [ax, ay, bx, by] = [ring[index].lng / M, ring[index].lat / M, ring[index + 1].lng / M, ring[index + 1].lat / M];
      const dx = bx - ax;
      const dy = by - ay;
      const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
      best = Math.min(best, Math.hypot(px - ax - t * dx, py - ay - t * dy));
    }
  }
  return best;
};

describe('#493 Phase 4 lake outline detail per tier (FR9)', () => {
  it('caps each tier at the vertex count the issue sets', () => {
    expect(LAKE_VERTEX_CAP).toEqual({ basic: 256, low: 512, medium: 512, high: 1024, 'extra-high': 2048 });
  });

  it.each(ALL_PERFORMANCE_MODES)('keeps the %s tier inside its cap', (mode) => {
    const slimmed = lakePolygonsForTier(lake(), LAKE_VERTEX_CAP[mode], []);
    expect(vertexCount(slimmed)).toBeLessThanOrEqual(LAKE_VERTEX_CAP[mode]);
    expect(slimmed[0].inner).toHaveLength(1);
  });

  it('gives the same outline every time for the same tier', () => {
    expect(lakePolygonsForTier(lake(), 256, [])).toEqual(lakePolygonsForTier(lake(), 256, []));
  });

  it('leaves an outline already inside the cap untouched', () => {
    const small: LakePolygon[] = [{ featureId: 'way/2', outer: wobblyRing(40, 500), inner: [] }];
    expect(lakePolygonsForTier(small, 256, [])).toEqual(small);
  });

  it('never brings a shoreline closer to the route than it was', () => {
    // A north shore of shallow bays 6 m deep, every 100 m, with the route 10 m
    // off it. Dropping a bay's tip would lay the shore straight across its
    // mouth, nearer the route; the rest of the lake is rougher, so without the
    // guard the bays are the first detail to go.
    const north = Array.from({ length: 41 }, (_, index) => at(1000 - index * 50, index % 2 === 0 ? 1000 : 1006));
    const south = Array.from({ length: 3000 }, (_, index) => {
      const x = -1000 + (index / 2999) * 2000;
      return at(x, -1000 + 40 * Math.sin(index * 1.7) * Math.sin(index * 0.37));
    });
    const outer = [...north, ...south, north[0]];
    const original: LakePolygon[] = [{ featureId: 'way/3', outer, inner: [] }];
    const route = Array.from({ length: 81 }, (_, index) => at(-800 + index * 20, 990));

    const slimmed = lakePolygonsForTier(original, LAKE_VERTEX_CAP.basic, route);
    expect(vertexCount(slimmed)).toBeLessThanOrEqual(LAKE_VERTEX_CAP.basic);
    for (const point of route) {
      expect(shoreDistance(point, slimmed)).toBeGreaterThanOrEqual(shoreDistance(point, original) - 0.01);
    }
  });
});
