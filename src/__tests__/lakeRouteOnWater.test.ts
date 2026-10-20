import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  createLakeLandGeometry,
  createLakeWaterGeometry,
  ribbonClearings,
  type LakeClearing,
} from '../components/rower3d/lakeGeometry';
import { SCENE_SCALE } from '../components/rower3d/constants';
import {
  applyMeasuredShores,
  lakeLandSamples,
  waterDetectionTelemetry,
  type RouteEnrichmentData,
  type RouteSegmentEnrichment,
} from '../services/routeEnrichmentService';
import type { Coordinate } from '../types/index';
import type { LakePolygon } from '../utils/lakePolygons';
import type { DetectedSample } from '../utils/shoreDetection';

/**
 * #493 Phase 4 (FR8, D21 b + ii, AC6): a route sample on land past the drift
 * tolerance never puts the boat on land. That stretch keeps the ribbon, the
 * lake's land opens to let it through, and the samples are reported.
 */

const M = 1 / 111_320;
const origin: Coordinate = { lat: 0, lng: 0 };
const at = (x: number, y: number): Coordinate => ({ lat: y * M, lng: x * M });
const square = (x0: number, y0: number, x1: number, y1: number) => [at(x0, y0), at(x1, y0), at(x1, y1), at(x0, y1), at(x0, y0)];

// 400 m square of water around the origin, with a 40 m island at (100, 100) m.
const lake: LakePolygon = { featureId: 'way/1', outer: square(-200, -200, 200, 200), inner: [square(80, 80, 120, 120)] };

const segment = (index: number, overrides: Partial<RouteSegmentEnrichment> = {}): RouteSegmentEnrichment => ({
  index,
  startMeters: index * 50,
  endMeters: (index + 1) * 50,
  sceneryProfile: 'fallback',
  treeDensity: 0.5,
  vegetationDensity: 0.5,
  buildingDensity: 0.1,
  objectScale: 1,
  waterWidthMeters: 55,
  dragMultiplier: 1,
  bearing: 0,
  bearingDelta: 0,
  ...overrides,
});

const sample = (distanceMeters: number, overrides: Partial<DetectedSample> = {}): DetectedSample => ({
  distanceMeters,
  coordinate: at(distanceMeters, 0),
  kind: 'water',
  featureId: 'way/1',
  leftShoreMeters: 15,
  rightShoreMeters: 45,
  ...overrides,
});

const lakeIds = new Set(['way/1']);

/** Scene x/z of a point `x` m east and `y` m north of the origin. */
const scene = (x: number, y: number) => ({ x: x * SCENE_SCALE, z: -y * SCENE_SCALE });

const vertices = (geometry: THREE.BufferGeometry) => {
  const position = geometry.getAttribute('position');
  return Array.from({ length: position.count }, (_, i) => new THREE.Vector3().fromBufferAttribute(position, i));
};

const triangleCentres = (geometry: THREE.BufferGeometry) => {
  const position = geometry.getAttribute('position');
  const index = geometry.getIndex()!;
  return Array.from({ length: index.count / 3 }, (_, t) => {
    const centre = new THREE.Vector3();
    for (let k = 0; k < 3; k++) centre.add(new THREE.Vector3().fromBufferAttribute(position, index.getX(t * 3 + k)));
    return centre.divideScalar(3);
  });
};

const areaXZ = (geometry: THREE.BufferGeometry) => {
  const position = geometry.getAttribute('position');
  const index = geometry.getIndex()!;
  let sum = 0;
  for (let t = 0; t < index.count / 3; t++) {
    const [a, b, c] = [0, 1, 2].map((k) => new THREE.Vector3().fromBufferAttribute(position, index.getX(t * 3 + k)));
    sum += Math.abs((b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z)) / 2;
  }
  return sum;
};

describe('#493 FR8 a lake segment with a sample on land keeps the ribbon', () => {
  it('marks a segment on the lake only when none of its samples is on land', () => {
    const profiles = applyMeasuredShores(
      [segment(0), segment(1)],
      [sample(0), sample(20), sample(40), sample(55), sample(70, { kind: 'land', featureId: undefined }), sample(85)],
      lakeIds,
    );
    expect(profiles[0].onLake).toBe(true);
    expect(profiles[1].onLake).toBeUndefined();
  });

  it('reports the land samples that kept a lake segment off the lake', () => {
    const samples = [sample(0), sample(20), sample(55), sample(70, { kind: 'land', featureId: undefined }), sample(85)];
    expect(lakeLandSamples([segment(0), segment(1)], samples, lakeIds)).toEqual([at(70, 0)]);
  });

  it('reports nothing on a route that never leaves its lake', () => {
    expect(lakeLandSamples([segment(0)], [sample(0), sample(20)], lakeIds)).toEqual([]);
  });

  it('logs how many samples were off the water, and where (FR22)', () => {
    const enrichment = {
      routeId: 'r',
      elevations: [],
      segmentProfiles: [],
      waterBodyType: 'lake',
      waterWidthMeters: 100,
      waterColor: '#335577',
      waveIntensity: 0.3,
      lakes: { polygons: [lake], elevationMeters: 0, offWater: [at(70, 0)] },
      fetchedAt: 0,
      source: 'network',
    } as RouteEnrichmentData;
    expect(waterDetectionTelemetry(enrichment)).toMatchObject({ offWater: 1, offWaterSamples: [at(70, 0)] });
  });
});

describe('#493 FR8 D21 ii the lake opens where the ribbon runs', () => {
  it('lays no lake land within a clearing', () => {
    // The ribbon leaving the lake through its east shore.
    const clearing: LakeClearing = { ...scene(200, 0), radius: 20 * SCENE_SCALE };
    const land = createLakeLandGeometry([lake], origin, { clearings: [clearing] });
    for (const centre of triangleCentres(land)) {
      expect(Math.hypot(centre.x - clearing.x, centre.z - clearing.z)).toBeGreaterThan(clearing.radius);
    }
    expect(triangleCentres(land).length).toBeGreaterThan(0);
  });

  it('drops an island the ribbon crosses, so the lake fills its place', () => {
    const clearing: LakeClearing = { ...scene(100, 100), radius: 10 * SCENE_SCALE };
    const land = createLakeLandGeometry([lake], origin, { clearings: [clearing] });
    const islandTop = vertices(land).filter((v) => {
      const x = v.x / SCENE_SCALE;
      const y = -v.z / SCENE_SCALE;
      return x > 85 && x < 115 && y > 85 && y < 115;
    });
    expect(islandTop).toHaveLength(0);

    const water = createLakeWaterGeometry([lake], origin, undefined, [clearing]);
    expect(areaXZ(water)).toBeCloseTo((400 * SCENE_SCALE) ** 2, -1);
  });

  it('keeps an island the ribbon passes well clear of', () => {
    const clearing: LakeClearing = { ...scene(-150, -150), radius: 10 * SCENE_SCALE };
    const water = createLakeWaterGeometry([lake], origin, undefined, [clearing]);
    expect(areaXZ(water)).toBeCloseTo((400 * SCENE_SCALE) ** 2 - (40 * SCENE_SCALE) ** 2, -1);
  });

  it('clears the lake along every stretch where the ribbon is drawn, and nowhere else', () => {
    const curve = new THREE.CatmullRomCurve3(
      Array.from({ length: 11 }, (_, i) => new THREE.Vector3(i * 10, 0, 0)),
    );
    const enrichment = {
      waterWidthMeters: 30,
      segmentProfiles: Array.from({ length: 10 }, (_, i) => segment(i, { waterWidthMeters: 30, ...(i < 5 && { onLake: true as const }) })),
    } as unknown as RouteEnrichmentData;
    const clearings = ribbonClearings(curve, enrichment);
    expect(clearings.length).toBeGreaterThan(0);
    expect(clearings.every((c) => c.x >= 45)).toBe(true);
    expect(clearings.some((c) => c.x > 90)).toBe(true);
    expect(clearings.every((c) => c.radius > 0)).toBe(true);
  });

  it('clears nothing on a route that stays on its lake', () => {
    const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(100, 0, 0)]);
    const enrichment = {
      waterWidthMeters: 30,
      segmentProfiles: [segment(0, { onLake: true }), segment(1, { onLake: true })],
    } as unknown as RouteEnrichmentData;
    expect(ribbonClearings(curve, enrichment)).toEqual([]);
  });
});
