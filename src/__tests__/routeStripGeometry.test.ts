import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import type { Coordinate } from '../types/index';
import { createRouteCurve, curveSegmentCount } from '../components/rower3d/curve';
import { createWaterChannelGeometry, WATER_SURFACE_Y } from '../components/rower3d/waterGeometry';
import { createBankGeometry, BANK_WATERLINE_Y } from '../components/rower3d/bankGeometry';
import { chunkProgressRanges } from '../components/rower3d/geometryChunks';
import { SCENE_SCALE, WATER_CHANNEL_WIDTH } from '../components/rower3d/constants';
import type { RouteEnrichmentData } from '../services/routeEnrichmentService';

const metersPerDegreeLat = 111_195;

/** A gently winding course of the requested real-world length. */
const windingRoute = (lengthMeters: number, bends = 4, points = 300): Coordinate[] =>
  Array.from({ length: points }, (_, i) => {
    const t = i / (points - 1);
    return {
      lat: 50 + (t * lengthMeters) / metersPerDegreeLat,
      lng:
        (Math.sin(t * bends * Math.PI) * 60) /
        (metersPerDegreeLat * Math.cos((50 * Math.PI) / 180)),
    };
  });

const curveFor = (lengthMeters: number, bends?: number) =>
  createRouteCurve(windingRoute(lengthMeters, bends), SCENE_SCALE)!;

const vertexAt = (geometry: THREE.BufferGeometry, index: number): THREE.Vector3 =>
  new THREE.Vector3().fromBufferAttribute(
    geometry.getAttribute('position') as THREE.BufferAttribute,
    index,
  );

const vertexCount = (geometry: THREE.BufferGeometry) =>
  geometry.getAttribute('position').count;

const flatEnrichment = (waterWidthMeters: number): RouteEnrichmentData => ({
  routeId: 'strip-fixture',
  elevations: [],
  segmentProfiles: [],
  waterBodyType: 'river',
  waterWidthMeters,
  waterColor: '#3a6b7d',
  waveIntensity: 1,
  fetchedAt: Date.now(),
  source: 'network',
});

describe('createWaterChannelGeometry', () => {
  it('lays two vertices per sample along the whole route', () => {
    const curve = curveFor(3000);
    const geometry = createWaterChannelGeometry(curve);
    expect(vertexCount(geometry)).toBe((curveSegmentCount(curve) + 1) * 2);
  });

  it('spends more geometry on a long route than a short one', () => {
    expect(vertexCount(createWaterChannelGeometry(curveFor(20_000)))).toBeGreaterThan(
      vertexCount(createWaterChannelGeometry(curveFor(1000))),
    );
  });

  it('keeps the surface flat at the waterline', () => {
    const geometry = createWaterChannelGeometry(curveFor(2000));
    const heights = Array.from(
      { length: vertexCount(geometry) },
      (_, i) => vertexAt(geometry, i).y,
    );
    expect(new Set(heights).size).toBe(1);
    expect(heights[0]).toBeCloseTo(WATER_SURFACE_Y, 6);
  });

  it('opens the channel to the route\u2019s measured water width', () => {
    const curve = curveFor(2000);
    const narrow = createWaterChannelGeometry(curve, { enrichment: flatEnrichment(20) });
    const wide = createWaterChannelGeometry(curve, { enrichment: flatEnrichment(200) });
    const spanAtStart = (geometry: THREE.BufferGeometry) =>
      vertexAt(geometry, 0).distanceTo(vertexAt(geometry, 1));

    expect(spanAtStart(wide)).toBeGreaterThan(spanAtStart(narrow) * 5);
    expect(spanAtStart(wide)).toBeCloseTo(WATER_CHANNEL_WIDTH, 3);
  });

  it('carries a bounding sphere so the frame loop can cull it', () => {
    const geometry = createWaterChannelGeometry(curveFor(5000));
    expect(geometry.boundingSphere).not.toBeNull();
    expect(geometry.boundingSphere!.radius).toBeGreaterThan(0);
  });
});

describe('chunked strips', () => {
  it('meets at the chunk boundary with no seam', () => {
    const curve = curveFor(12_000, 8);
    const ranges = chunkProgressRanges(8);

    ranges.slice(0, -1).forEach((range, i) => {
      const before = createWaterChannelGeometry(curve, { range });
      const after = createWaterChannelGeometry(curve, { range: ranges[i + 1] });
      const lastIndex = vertexCount(before) - 2;

      expect(vertexAt(before, lastIndex).distanceTo(vertexAt(after, 0))).toBe(0);
      expect(vertexAt(before, lastIndex + 1).distanceTo(vertexAt(after, 1))).toBe(0);
    });
  });

  it('meets at the chunk boundary on both banks too', () => {
    const curve = curveFor(12_000, 8);
    const [first, second] = chunkProgressRanges(4);

    (['left', 'right'] as const).forEach((side) => {
      const before = createBankGeometry(curve, side, { range: first });
      const after = createBankGeometry(curve, side, { range: second });
      const lastIndex = vertexCount(before) - 2;

      expect(vertexAt(before, lastIndex).distanceTo(vertexAt(after, 0))).toBe(0);
      expect(vertexAt(before, lastIndex + 1).distanceTo(vertexAt(after, 1))).toBe(0);
    });
  });

  it('keeps the resolution of an unchunked build', () => {
    const curve = curveFor(12_000, 8);
    const whole = vertexCount(createWaterChannelGeometry(curve));
    const chunked = chunkProgressRanges(8)
      .map((range) => vertexCount(createWaterChannelGeometry(curve, { range })))
      .reduce((a, b) => a + b, 0);

    // Every chunk repeats its predecessor's closing pair of vertices.
    expect(chunked).toBe(whole + 7 * 2);
  });

  it('traces the same water as the unchunked build', () => {
    const curve = curveFor(9000, 6);
    const whole = createWaterChannelGeometry(curve);
    const middle = createWaterChannelGeometry(curve, { range: { from: 0.5, to: 0.75 } });

    const startOfChunk = vertexAt(middle, 0);
    const nearest = Array.from({ length: vertexCount(whole) }, (_, i) =>
      startOfChunk.distanceTo(vertexAt(whole, i)),
    ).reduce((a, b) => Math.min(a, b));

    expect(nearest).toBeLessThan(1e-6);
  });

  it('builds a drawable chunk even for a hair-thin range', () => {
    const geometry = createWaterChannelGeometry(curveFor(2000), {
      range: { from: 0.5, to: 0.5001 },
    });
    expect(vertexCount(geometry)).toBe(4);
    expect(geometry.getIndex()!.count).toBe(6);
  });
});

describe('createBankGeometry', () => {
  it('pins the inner edge to the waterline and pushes the outer edge away', () => {
    const curve = curveFor(2000);
    const left = createBankGeometry(curve, 'left');
    const right = createBankGeometry(curve, 'right');

    expect(vertexAt(left, 0).y).toBe(BANK_WATERLINE_Y);
    expect(vertexAt(left, 1).distanceTo(vertexAt(left, 0))).toBeGreaterThan(0);
    // The two banks straddle the channel: their inner edges sit on opposite sides.
    expect(vertexAt(left, 0).distanceTo(vertexAt(right, 0))).toBeCloseTo(
      WATER_CHANNEL_WIDTH,
      3,
    );
  });

  it('scales its resolution with the route, like the water it borders', () => {
    const curve = curveFor(20_000);
    expect(vertexCount(createBankGeometry(curve, 'left'))).toBe(
      vertexCount(createWaterChannelGeometry(curve)),
    );
  });
});
