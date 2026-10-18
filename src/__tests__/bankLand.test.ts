import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { layoutFoliage } from '../components/rower3d/foliagePlan';
import { layoutLandscape } from '../components/rower3d/landscapeLayout';
import { SCENE_CONFIG } from '../components/rower3d/themeConfig';
import { getSegmentSceneryProfile } from '../components/rower3d/segmentScenery';
import {
  applyMeasuredShores,
  SCENERY_PROFILE_CONFIG,
  type OverpassElement,
  type RouteEnrichmentData,
  type RouteSegmentEnrichment,
} from '../services/routeEnrichmentService';
import type { Coordinate } from '../types/index';
import { buildLandAreas, landAt } from '../utils/bankLand';
import { runRouteDetection } from '../utils/routeDetection';
import type { DetectedSample } from '../utils/shoreDetection';

/**
 * #493 FR18 / AC19: each bank's land is read from the OSM area just beyond
 * that bank's shore, not from the bbox-nearest feature shared by both (G6).
 */

// Local metres about (0, 0): x east, y north.
const M = 1 / 111_320;
const at = (x: number, y: number): Coordinate => ({ lat: y * M, lng: x * M });
const box = (x0: number, y0: number, x1: number, y1: number) => [at(x0, y0), at(x1, y0), at(x1, y1), at(x0, y1), at(x0, y0)];
const way = (id: number, tags: Record<string, string>, ring: Coordinate[]): OverpassElement => ({
  type: 'way',
  id,
  tags,
  geometry: ring.map(({ lat, lng }) => ({ lat, lon: lng })),
});

// A 60 m channel running north, the route 15 m from its west bank. Heading
// north, west is the rower's left.
const channel = way(1, { natural: 'water', water: 'river' }, box(-15, -100, 45, 1100));
const town = way(2, { landuse: 'residential' }, box(-400, -100, -15, 1100));
const park = way(3, { leisure: 'park' }, box(45, -100, 400, 1100));
const route = [at(0, 0), at(0, 1000)];
const bounds = { minLat: -200 * M, minLng: -700 * M, maxLat: 1200 * M, maxLng: 700 * M };

describe('#493 FR18 land on each bank', () => {
  it('finds the land area a point is in, the smallest where they overlap', () => {
    const playground = way(4, { leisure: 'park' }, box(-200, 400, -100, 500));
    const areas = buildLandAreas([channel, town, playground, way(5, { landuse: 'forest' }, [at(0, 0), at(1, 1)])]);

    expect(landAt(areas, at(-50, 100))).toBe('residential');
    expect(landAt(areas, at(-150, 450))).toBe('farmland');
    expect(landAt(areas, at(1000, 0))).toBeNull();
    // An open way encloses nothing; water is not land.
    expect(areas).toHaveLength(2);
  });

  it('gives each on-water sample the land beyond each shore', () => {
    const { samples } = runRouteDetection({ coordinates: route, elements: [channel, town, park], coastlineBounds: bounds });
    const water = samples.filter((sample) => sample.kind === 'water');

    expect(water.length).toBeGreaterThan(10);
    for (const sample of water) {
      expect(sample.leftLand).toBe('residential');
      expect(sample.rightLand).toBe('farmland');
    }
  });

  it('leaves a side unknown when its shore is open or nothing is mapped there', () => {
    const { samples } = runRouteDetection({ coordinates: route, elements: [channel, town], coastlineBounds: bounds });
    const lake = way(1, { natural: 'water' }, box(-15, -100, 2000, 1100));
    const open = runRouteDetection({ coordinates: route, elements: [lake, town], coastlineBounds: bounds }).samples;

    expect(samples.every((sample) => sample.kind !== 'water' || sample.rightLand === null)).toBe(true);
    expect(open.filter((sample) => sample.kind === 'water').every((sample) => sample.rightShoreMeters === null && sample.rightLand === null)).toBe(true);
  });
});

const segment = (index: number, overrides: Partial<RouteSegmentEnrichment> = {}): RouteSegmentEnrichment => ({
  index,
  startMeters: index * 50,
  endMeters: (index + 1) * 50,
  sceneryProfile: 'forest',
  ...SCENERY_PROFILE_CONFIG.forest,
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
  leftLand: 'residential',
  rightLand: 'farmland',
  ...overrides,
});

describe('#493 FR18 per-bank profile on each segment', () => {
  it('takes the most common land on each side', () => {
    const [profile] = applyMeasuredShores(
      [segment(0)],
      [sample(0), sample(10, { leftLand: 'commercial' }), sample(20), sample(30, { rightLand: null })],
    );
    expect(profile.leftSceneryProfile).toBe('residential');
    expect(profile.rightSceneryProfile).toBe('farmland');
  });

  it('keeps the shared profile on a side where no sample found land', () => {
    const [profile] = applyMeasuredShores([segment(0)], [sample(0, { rightLand: null }), sample(25, { rightLand: undefined })]);
    expect(profile.leftSceneryProfile).toBe('residential');
    expect(profile.rightSceneryProfile).toBeUndefined();
  });

  it('breaks a tie the same way whatever the sample order', () => {
    const a = [sample(0, { leftLand: 'forest' }), sample(10, { leftLand: 'beach' })];
    expect(applyMeasuredShores([segment(0)], a)[0].leftSceneryProfile).toBe(
      applyMeasuredShores([segment(0)], [...a].reverse())[0].leftSceneryProfile,
    );
  });

  it('is read per side, the shared profile standing in for a side with none, and a track over both', () => {
    const enrichment = {
      segmentProfiles: [segment(0, { leftSceneryProfile: 'residential' })],
    } as RouteEnrichmentData;

    expect(getSegmentSceneryProfile(enrichment, 0, null, 'left')).toBe('residential');
    expect(getSegmentSceneryProfile(enrichment, 0, null, 'right')).toBe('forest');
    expect(getSegmentSceneryProfile(enrichment, 0)).toBe('forest');
    expect(
      getSegmentSceneryProfile(enrichment, 0, { bands: [{ untilProgress: 1, profile: 'beach', water: 'river', label: 'Beach' }] }, 'left'),
    ).toBe('beach');
  });
});

describe('#493 AC19 landscape layout per bank', () => {
  const straight = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, -600), new THREE.Vector3(0, 0, 600)]);
  const banks = (left: RouteSegmentEnrichment['leftSceneryProfile'], right: RouteSegmentEnrichment['rightSceneryProfile']) =>
    ({
      segmentProfiles: [0, 1, 2, 3].map((index) =>
        segment(index, {
          sceneryProfile: 'farmland',
          ...SCENERY_PROFILE_CONFIG.farmland,
          leftSceneryProfile: left,
          rightSceneryProfile: right,
        }),
      ),
      elevations: [],
    }) as unknown as RouteEnrichmentData;

  it('builds a town on the residential bank and leaves the park bank open', () => {
    const { leftElements, rightElements } = layoutLandscape({ curve: straight, enrichment: banks('residential', 'farmland') });
    const buildings = (elements: typeof leftElements) => elements.filter((element) => element.type === 'building');

    expect(buildings(leftElements).length).toBeGreaterThan(buildings(rightElements).length * 3);
    expect(leftElements.every((element) => element.sceneryProfile === 'residential')).toBe(true);
    expect(rightElements.every((element) => element.sceneryProfile === 'farmland')).toBe(true);
  });

  it('matches the shared-profile layout where neither bank has its own', () => {
    const shared = layoutLandscape({ curve: straight, enrichment: banks(undefined, undefined) });
    const both = layoutLandscape({ curve: straight, enrichment: banks('farmland', 'farmland') });
    expect(both).toEqual(shared);
  });
});

describe('#493 FR18 foliage per bank', () => {
  it('plants each bank by its own land', () => {
    const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, -1000), new THREE.Vector3(0, 0, 1000)]);
    const enrichment = {
      segmentProfiles: [0, 1, 2, 3].map((index) =>
        segment(index, { sceneryProfile: 'farmland', leftSceneryProfile: 'forest', rightSceneryProfile: 'beach' }),
      ),
      elevations: [],
    } as unknown as RouteEnrichmentData;
    const trees = layoutFoliage({ curve, enrichment, species: SCENE_CONFIG.trees.species });
    // Heading +z the rower's right is -x (perp = tangent × up).
    const left = trees.filter((tree) => tree.position[0] > 0).length;
    const right = trees.filter((tree) => tree.position[0] < 0).length;

    expect(left).toBeGreaterThan(right * 2);
  });
});
