import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { Coordinate } from '../lib/types/index';
import { createRouteCurve } from '../components/rower3d/curve';
import { SCENE_SCALE } from '../components/rower3d/constants';
import { drawsStripQuad, type StripGeometryOptions } from '../components/rower3d/routeStripGeometry';
import { createWaterChannelGeometry } from '../components/rower3d/waterGeometry';
import { createBankGeometry, createShorelineGeometry } from '../components/rower3d/bankGeometry';
import {
  isOnLakeAtProgress,
  type RouteEnrichmentData,
  type RouteSegmentEnrichment,
} from '../lib/services/routeEnrichmentService';

/**
 * #493 Phase 3 (D5 a): on a lake route drawn from its outline, the ribbon, its
 * banks and its foam strip leave the lake stretch to the lake's own surface
 * and shore, and keep the river stretches either side of it.
 */

const LENGTH = 2000;
const SEGMENTS = 10;
const route: Coordinate[] = Array.from({ length: 50 }, (_, i) => ({ lat: 50 + (i / 49) * (LENGTH / 111_195), lng: 0 }));
const curve = createRouteCurve(route, SCENE_SCALE)!;

const segment = (index: number): RouteSegmentEnrichment => ({
  index,
  startMeters: index * (LENGTH / SEGMENTS),
  endMeters: (index + 1) * (LENGTH / SEGMENTS),
  sceneryProfile: 'fallback',
  treeDensity: 0.5,
  vegetationDensity: 0.5,
  buildingDensity: 0.1,
  objectScale: 1,
  waterWidthMeters: 55,
  dragMultiplier: 1,
  bearing: 0,
  bearingDelta: 0,
  // The middle of the route is on the lake.
  ...(index >= 3 && index <= 6 && { onLake: true as const }),
});

const enrichment: RouteEnrichmentData = {
  routeId: 'lake-ribbon',
  elevations: [],
  segmentProfiles: Array.from({ length: SEGMENTS }, (_, i) => segment(i)),
  waterBodyType: 'lake',
  waterWidthMeters: 55,
  waterColor: '#335577',
  waveIntensity: 0.3,
  lakes: { polygons: [{ featureId: 'way/1', outer: [], inner: [] }], elevationMeters: 0 },
  fetchedAt: 0,
  source: 'network',
};

/** How far along the route each triangle's centre is (the route runs north, so -z). */
const triangleProgress = (geometry: THREE.BufferGeometry) => {
  const position = geometry.getAttribute('position');
  const index = geometry.getIndex()!;
  return Array.from({ length: index.count / 3 }, (_, t) => {
    let z = 0;
    for (let k = 0; k < 3; k++) z += position.getZ(index.getX(t * 3 + k));
    return -z / 3 / LENGTH;
  });
};

describe('#493 Phase 3 lake stretch of a route (D5 a)', () => {
  it('reads the nearest segment\'s lake mark at a progress', () => {
    expect(isOnLakeAtProgress(enrichment.segmentProfiles, 0)).toBe(false);
    expect(isOnLakeAtProgress(enrichment.segmentProfiles, 0.5)).toBe(true);
    expect(isOnLakeAtProgress(enrichment.segmentProfiles, 1)).toBe(false);
    expect(isOnLakeAtProgress(undefined, 0.5)).toBe(false);
    expect(isOnLakeAtProgress([], 0.5)).toBe(false);
  });

  it('draws every quad unless asked to leave the lake out, and then only those with an end off it', () => {
    const omit: StripGeometryOptions = { enrichment, omitLake: true };
    expect(drawsStripQuad({ enrichment }, 0.45, 0.5)).toBe(true);
    expect(drawsStripQuad(omit, 0.45, 0.5)).toBe(false);
    expect(drawsStripQuad(omit, 0.1, 0.15)).toBe(true);
    // A quad crossing onto the lake is kept, so the ribbon meets the lake's edge.
    expect(drawsStripQuad(omit, 0.25, 0.4)).toBe(true);
  });

  it.each([
    ['water', (options: StripGeometryOptions) => createWaterChannelGeometry(curve, options)],
    ['left bank', (options: StripGeometryOptions) => createBankGeometry(curve, 'left', options)],
    ['right bank', (options: StripGeometryOptions) => createBankGeometry(curve, 'right', options)],
    ['shoreline', (options: StripGeometryOptions) => createShorelineGeometry(curve, 'left', options)],
  ])('leaves the lake stretch out of the %s and keeps the river either side', (_, build) => {
    const whole = triangleProgress(build({ enrichment }));
    const omitted = triangleProgress(build({ enrichment, omitLake: true }));
    const onLake = (p: number) => p > 0.4 && p < 0.6;
    expect(whole.some(onLake)).toBe(true);
    expect(omitted.some(onLake)).toBe(false);
    expect(omitted.filter((p) => p < 0.2)).toHaveLength(whole.filter((p) => p < 0.2).length);
    expect(omitted.filter((p) => p > 0.8)).toHaveLength(whole.filter((p) => p > 0.8).length);
  });
});
