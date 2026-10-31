import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Coordinate } from '../lib/types/index';
import type { OverpassElement } from '../lib/services/routeEnrichmentService';
import { buildWaterMask, type MaskBounds, type MaskFeature } from '../lib/utils/osmWaterMask';
import { detectRoute, type DetectedSample } from '../lib/utils/shoreDetection';
import { classifyDetectedRoute, waterTypeOfArea } from '../lib/utils/waterClassification';

const feature = (tags: Record<string, string>, id = 'way/1'): MaskFeature => ({ id, tags, polygons: [] });

describe('#493 water type of a mapped area (D24 c)', () => {
  it.each([
    [{ natural: 'water', water: 'river' }, 'river'],
    [{ waterway: 'riverbank' }, 'river'],
    [{ natural: 'water', water: 'canal' }, 'canal'],
    [{ waterway: 'dock' }, 'canal'],
    [{ natural: 'water', water: 'lake' }, 'lake'],
    [{ natural: 'water', water: 'pond' }, 'lake'],
    [{ natural: 'water', water: 'reservoir' }, 'reservoir'],
    [{ landuse: 'reservoir' }, 'reservoir'],
    [{ natural: 'bay' }, 'open_water'],
    [{ natural: 'strait' }, 'open_water'],
    [{ natural: 'coastline' }, 'open_water'],
  ] as const)('%o is %s', (tags, type) => {
    expect(waterTypeOfArea(feature(tags))).toBe(type);
  });

  it('leaves a bare natural=water to the waterway line through it', () => {
    expect(waterTypeOfArea(feature({ natural: 'water' }))).toBeNull();
  });
});

const sample = (overrides: Partial<DetectedSample>): DetectedSample => ({
  distanceMeters: 0,
  coordinate: { lat: 0, lng: 0 },
  kind: 'water',
  leftShoreMeters: 50,
  rightShoreMeters: 50,
  ...overrides,
});

describe('#493 route water type from detection (D13, D24 c)', () => {
  const lake = feature({ natural: 'water', water: 'lake' }, 'way/10');
  const river = feature({ natural: 'water', water: 'river' }, 'way/11');
  const untyped = feature({ natural: 'water' }, 'way/12');
  const mask = { water: [lake, river, untyped], land: [] };
  const canalLine: OverpassElement = {
    type: 'way',
    id: 20,
    tags: { waterway: 'canal' },
    geometry: [
      { lat: 0, lon: -0.01 },
      { lat: 0, lon: 0.01 },
    ],
  };

  it('takes the type most samples are on', () => {
    const samples = [
      sample({ featureId: 'way/11' }),
      sample({ featureId: 'way/11' }),
      sample({ featureId: 'way/10' }),
    ];
    expect(classifyDetectedRoute(samples, mask, []).waterBodyType).toBe('river');
  });

  it('reads an untyped area from the waterway line beside the sample', () => {
    const samples = [sample({ featureId: 'way/12' }), sample({ featureId: 'way/12' })];
    expect(classifyDetectedRoute(samples, mask, [canalLine]).waterBodyType).toBe('canal');
  });

  it('calls an untyped area with no line near it a lake', () => {
    const far: Coordinate = { lat: 0.01, lng: 0 }; // ~1.1 km off the canal
    const samples = [sample({ featureId: 'way/12', coordinate: far })];
    expect(classifyDetectedRoute(samples, mask, [canalLine]).waterBodyType).toBe('lake');
  });

  it('calls a lake open water where neither shore is in view', () => {
    const samples = [
      sample({ featureId: 'way/10', leftShoreMeters: null, rightShoreMeters: null }),
      sample({ featureId: 'way/10', leftShoreMeters: null, rightShoreMeters: null }),
      sample({ featureId: 'way/10' }),
    ];
    expect(classifyDetectedRoute(samples, mask, []).waterBodyType).toBe('open_water');
  });

  it('calls the sea between two shores in view a tidal river', () => {
    const sea = feature({ natural: 'coastline' }, 'coastline/sea0');
    const coastal = { water: [sea], land: [] };
    expect(classifyDetectedRoute([sample({ featureId: 'coastline/sea0' })], coastal, []).waterBodyType).toBe('river');
    const offshore = sample({ featureId: 'coastline/sea0', rightShoreMeters: null });
    expect(classifyDetectedRoute([offshore], coastal, []).waterBodyType).toBe('open_water');
  });

  it('keeps a river a river however wide it is', () => {
    const samples = [sample({ featureId: 'way/11', leftShoreMeters: null, rightShoreMeters: null })];
    expect(classifyDetectedRoute(samples, mask, []).waterBodyType).toBe('river');
  });

  it('says unknown when no sample is on water, and ignores land samples in the vote', () => {
    expect(classifyDetectedRoute([sample({ kind: 'land' })], mask, []).waterBodyType).toBe('unknown');
    const samples = [sample({ kind: 'land' }), sample({ kind: 'land' }), sample({ featureId: 'way/10' })];
    expect(classifyDetectedRoute(samples, mask, []).waterBodyType).toBe('lake');
  });

  it('reports the share of on-water samples of each type', () => {
    const samples = [sample({ featureId: 'way/11' }), sample({ featureId: 'way/10' }), sample({ kind: 'land' })];
    expect(classifyDetectedRoute(samples, mask, []).shares).toEqual({ river: 0.5, lake: 0.5 });
  });
});

interface OsmFixture {
  route: Coordinate[];
  bounds: MaskBounds;
  elements: OverpassElement[];
}

describe('#493 reference courses classify as the water they are on', () => {
  const load = (id: number) =>
    JSON.parse(readFileSync(join(process.cwd(), 'src/__tests__/fixtures/osm', `${id}.json`), 'utf8')) as OsmFixture;

  it.each([
    [1, 'lake'], // Lake Quinsigamond
    [61, 'river'], // Charles
    [153, 'river'], // Charles
    [175, 'open_water'], // North Sea off Stonehaven
    [179, 'river'], // the tidal Clyde, which OSM's coastline treats as sea up to Glasgow
    [237, 'lake'], // Lake Washington, Portage Bay, Montlake Cut
    [257, 'river'], // Detroit River, 640 m wide
    [277, 'canal'], // Heerenveens Kanaal, mapped mostly as bare natural=water
  ] as const)('course %i is %s', (id, type) => {
    const fixture = load(id);
    const mask = buildWaterMask(fixture.elements, { coastlineBounds: fixture.bounds });
    const { samples } = detectRoute(fixture.route, mask);
    expect(classifyDetectedRoute(samples, mask, fixture.elements).waterBodyType).toBe(type);
  });
});
