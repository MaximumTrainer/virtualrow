import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createBankGeometry, createShorelineGeometry } from '../components/rower3d/bankGeometry';
import { buildRiverGuides } from '../components/rower3d/riverGuideGeometry';
import { landClearance, waterHalfWidthAt } from '../components/rower3d/sceneryClearance';
import { createWaterChannelGeometry } from '../components/rower3d/waterGeometry';
import {
  applyMeasuredShores,
  getWaterEdgesSceneUnitsForProgress,
  getWaterWidthSceneUnitsForProgress,
  type RouteEnrichmentData,
  type RouteSegmentEnrichment,
} from '../lib/services/routeEnrichmentService';
import { MIN_NAVIGABLE_WIDTH_METERS } from '../components/rower3d/navigableWidth';
import { SHORE_RAY_LIMIT_METERS, type DetectedSample } from '../lib/utils/shoreDetection';

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
  coordinate: { lat: 0, lng: 0 },
  kind: 'water',
  featureId: 'way/1',
  leftShoreMeters: 15,
  rightShoreMeters: 45,
  ...overrides,
});

describe('#493 FR16 measured shore distances on each segment', () => {
  it('records each side and makes the width their sum (AC17)', () => {
    const [profile] = applyMeasuredShores([segment(0)], [sample(0), sample(25)]);
    expect(profile.leftShoreMeters).toBe(15);
    expect(profile.rightShoreMeters).toBe(45);
    expect(profile.waterWidthMeters).toBe(60);
  });

  it('takes the median of the samples in the segment', () => {
    const samples = [
      sample(0, { leftShoreMeters: 10 }),
      sample(10, { leftShoreMeters: 12 }),
      sample(20, { leftShoreMeters: 90 }),
    ];
    expect(applyMeasuredShores([segment(0)], samples)[0].leftShoreMeters).toBe(12);
  });

  it('reads a side as open when most samples see no shore there', () => {
    const samples = [sample(0, { rightShoreMeters: null }), sample(20, { rightShoreMeters: null }), sample(40)];
    const [profile] = applyMeasuredShores([segment(0)], samples);
    expect(profile.rightShoreMeters).toBeNull();
    // Nothing to add up, so the guessed width stays.
    expect(profile.waterWidthMeters).toBe(55);
  });

  it('leaves a segment with no sample on water as it was', () => {
    const [profile] = applyMeasuredShores([segment(0)], [sample(10, { kind: 'land' })]);
    expect(profile).toEqual(segment(0));
    expect('leftShoreMeters' in profile).toBe(false);
  });

  it('gives each segment its own samples', () => {
    const profiles = applyMeasuredShores(
      [segment(0), segment(1)],
      [sample(10, { leftShoreMeters: 5 }), sample(60, { leftShoreMeters: 30 }), sample(100, { leftShoreMeters: 30 })],
    );
    expect(profiles.map((profile) => profile.leftShoreMeters)).toEqual([5, 30]);
  });
});

describe('#493 D19 c water edges either side of the route', () => {
  it('places each edge at its own measured distance', () => {
    const edges = getWaterEdgesSceneUnitsForProgress(
      [segment(0, { leftShoreMeters: 15, rightShoreMeters: 45 })],
      55,
      0.5,
    );
    expect(edges).toEqual({ left: 15, right: 45 });
  });

  it('keeps each side wide enough for the blades', () => {
    const edges = getWaterEdgesSceneUnitsForProgress(
      [segment(0, { leftShoreMeters: 1, rightShoreMeters: 45 })],
      55,
      0,
    );
    expect(edges.left).toBe(MIN_NAVIGABLE_WIDTH_METERS / 2);
    expect(edges.right).toBe(45);
  });

  it('runs an open side out to the ray limit', () => {
    const edges = getWaterEdgesSceneUnitsForProgress(
      [segment(0, { leftShoreMeters: null, rightShoreMeters: 40 })],
      55,
      0,
    );
    expect(edges.left).toBe(SHORE_RAY_LIMIT_METERS);
  });

  it('centres an unmeasured segment on the route, as before', () => {
    expect(getWaterEdgesSceneUnitsForProgress([segment(0)], 55, 0)).toEqual({ left: 27.5, right: 27.5 });
    expect(getWaterEdgesSceneUnitsForProgress(undefined, 20, 0)).toEqual({ left: 10, right: 10 });
    expect(getWaterEdgesSceneUnitsForProgress(undefined, 2, 0)).toEqual({
      left: MIN_NAVIGABLE_WIDTH_METERS / 2,
      right: MIN_NAVIGABLE_WIDTH_METERS / 2,
    });
  });

  it('blends each side between segments', () => {
    const profiles = [
      segment(0, { leftShoreMeters: 10, rightShoreMeters: 40 }),
      segment(1, { leftShoreMeters: 30, rightShoreMeters: 20 }),
    ];
    expect(getWaterEdgesSceneUnitsForProgress(profiles, 55, 0.5)).toEqual({ left: 20, right: 30 });
  });

  it('keeps the width the sum of the two edges', () => {
    const profiles = [segment(0, { leftShoreMeters: 15, rightShoreMeters: 45 })];
    expect(getWaterWidthSceneUnitsForProgress(profiles, 55, 0)).toBe(60);
    expect(getWaterWidthSceneUnitsForProgress([segment(0, { waterWidthMeters: 2 })], 55, 0)).toBe(
      MIN_NAVIGABLE_WIDTH_METERS,
    );
  });
});

// A straight route due north: the left bank is to the west (-x), the right to the east (+x).
const northward = () =>
  new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, -50),
    new THREE.Vector3(0, 0, -100),
    new THREE.Vector3(0, 0, -150),
  ]);

/** A 60 m channel with the route 15 m off its left bank (AC17). */
const offCentre = (): RouteEnrichmentData => ({
  routeId: 'off-centre',
  elevations: [],
  segmentProfiles: [0, 1, 2].map((index) => segment(index, { leftShoreMeters: 15, rightShoreMeters: 45 })),
  waterBodyType: 'river',
  waterWidthMeters: 60,
  waterColor: '#000000',
  waveIntensity: 1,
  fetchedAt: 0,
  source: 'network',
});

const xs = (geometry: THREE.BufferGeometry) => {
  const position = geometry.getAttribute('position');
  return Array.from({ length: position.count }, (_, index) => position.getX(index));
};

describe('#493 AC17 the scene draws each bank at its own distance', () => {
  it('builds the water from 15 m left to 45 m right', () => {
    const values = xs(createWaterChannelGeometry(northward(), { enrichment: offCentre() }));
    expect(Math.min(...values)).toBeCloseTo(-15, 3);
    expect(Math.max(...values)).toBeCloseTo(45, 3);
  });

  it('starts each bank at its own waterline', () => {
    const left = xs(createBankGeometry(northward(), 'left', { enrichment: offCentre() }));
    const right = xs(createBankGeometry(northward(), 'right', { enrichment: offCentre() }));
    // Even vertices are the inner edge, the waterline.
    expect(left.filter((_, index) => index % 2 === 0).every((x) => Math.abs(x + 15) < 1e-3)).toBe(true);
    expect(right.filter((_, index) => index % 2 === 0).every((x) => Math.abs(x - 45) < 1e-3)).toBe(true);
  });

  it('lays the foam along each waterline', () => {
    const left = xs(createShorelineGeometry(northward(), 'left', { enrichment: offCentre() }));
    const right = xs(createShorelineGeometry(northward(), 'right', { enrichment: offCentre() }));
    expect(Math.max(...left)).toBeGreaterThan(-15);
    expect(Math.min(...left)).toBeGreaterThan(-18);
    expect(Math.min(...right)).toBeLessThan(45);
    expect(Math.max(...right)).toBeLessThan(48);
  });

  it('draws the debug edges where the water ends', () => {
    const guides = buildRiverGuides(northward(), offCentre());
    expect(guides.left.every((point) => Math.abs(point.x + 15) < 1e-3)).toBe(true);
    expect(guides.right.every((point) => Math.abs(point.x - 45) < 1e-3)).toBe(true);
  });

  it('measures clearance from the waterline on the side the placement is on', () => {
    expect(waterHalfWidthAt(offCentre(), 0.5, 'left')).toBe(15);
    expect(waterHalfWidthAt(offCentre(), 0.5, 'right')).toBe(45);
    const reading = (x: number) =>
      landClearance([{ position: [x, 0, -75], progress: 0.5 }], northward(), offCentre()).nearestM;
    expect(reading(-20)).toBeCloseTo(5, 3);
    expect(reading(20)).toBeCloseTo(-25, 3);
  });
});
