import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import type { Coordinate } from '../types/index';
import { createRouteCurve } from '../components/rower3d/curve';
import { stripSegmentCount } from '../components/rower3d/routeStripGeometry';
import { createWaterChannelGeometry, WATER_SURFACE_Y } from '../components/rower3d/waterGeometry';
import { createBankGeometry, BANK_WATERLINE_Y } from '../components/rower3d/bankGeometry';
import { chunkProgressRanges } from '../components/rower3d/geometryChunks';
import { facingAway, faceNormals } from './faceNormals';
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
    expect(vertexCount(geometry)).toBe((stripSegmentCount(curve) + 1) * 2);
  });

  it('faces the sky, so a front-facing material draws it (#284)', () => {
    /**
     * The water strip walks its two vertices in the +perp direction while the
     * left bank walks -perp, and both used the same index order. Mirroring a
     * triangle reverses which way it faces, so every water triangle pointed
     * down - the same mistake #269 found in the banks, in the strip next to
     * them.
     *
     * It was invisible because waterComponents.tsx sets side: DoubleSide. That
     * hides the culling and not the shading: under DOUBLE_SIDED three flips the
     * normal for back faces, so the explicit (0,1,0) normal attribute was being
     * negated at shading time and the river was lit from underneath.
     */
    const geometry = createWaterChannelGeometry(curveFor(3000));

    const away = facingAway(geometry);
    expect(away, `${away} water triangles face away from the sky`).toBe(0);
  });

  it('agrees with the banks about which way is up', () => {
    // The three strips meet at the waterline and are lit by the same sun.
    const curve = curveFor(3000);
    const water = faceNormals(createWaterChannelGeometry(curve));
    const left = faceNormals(createBankGeometry(curve, 'left'));
    const right = faceNormals(createBankGeometry(curve, 'right'));

    for (const [label, normals] of [['water', water], ['left', left], ['right', right]] as const) {
      expect(normals.length, `${label} built no triangles`).toBeGreaterThan(0);
      expect(
        Math.min(...normals.map((n) => n.y)),
        `the ${label} strip has a triangle pointing away from the sky`,
      ).toBeGreaterThan(0);
    }
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
    const NARROW_METRES = 20;
    const WIDE_METRES = 200;
    const narrow = createWaterChannelGeometry(curve, {
      enrichment: flatEnrichment(NARROW_METRES),
    });
    const wide = createWaterChannelGeometry(curve, { enrichment: flatEnrichment(WIDE_METRES) });
    const spanAtStart = (geometry: THREE.BufferGeometry) =>
      vertexAt(geometry, 0).distanceTo(vertexAt(geometry, 1));

    expect(spanAtStart(wide)).toBeGreaterThan(spanAtStart(narrow) * 5);
    // The span is the width, in metres, because a unit is a metre (#321). This
    // used to read `WATER_CHANNEL_WIDTH` and passed on a coincidence: 200 m at
    // the old ten-metre unit came out as 20 units, which is the number the
    // default channel width happens to hold.
    expect(spanAtStart(wide)).toBeCloseTo(WIDE_METRES, 3);
    expect(spanAtStart(narrow)).toBeCloseTo(WATER_CHANNEL_WIDTH, 3);
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

    // Every chunk repeats its predecessor's closing pair of vertices, and each
    // chunk rounds its own share of the budget, so the totals agree loosely.
    expect(chunked).toBeGreaterThan(whole);
    expect(chunked).toBeLessThan(whole * 1.2);
  });

  it('traces the same water as the unchunked build', () => {
    const curve = curveFor(9000, 6);
    const whole = createWaterChannelGeometry(curve);
    const middle = createWaterChannelGeometry(curve, { range: { from: 0.5, to: 0.75 } });

    // Chunked and unchunked builds place their samples independently, so a
    // chunk vertex need not coincide with a whole-route vertex — it must lie on
    // the same edge. Measured against the edge's segments: nearest-vertex
    // distance would just report the sample spacing. 0.05 scene units is 50 cm.
    const startOfChunk = vertexAt(middle, 0);
    const edge: THREE.Vector3[] = [];
    for (let i = 0; i < vertexCount(whole); i += 2) edge.push(vertexAt(whole, i));

    const nearest = edge.slice(0, -1).reduce((best, a, i) => {
      const b = edge[i + 1];
      const span = b.clone().sub(a);
      const lengthSquared = span.lengthSq();
      const along =
        lengthSquared > 0
          ? Math.max(0, Math.min(1, startOfChunk.clone().sub(a).dot(span) / lengthSquared))
          : 0;
      return Math.min(best, startOfChunk.distanceTo(a.clone().addScaledVector(span, along)));
    }, Infinity);

    expect(nearest).toBeLessThan(0.05);
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
