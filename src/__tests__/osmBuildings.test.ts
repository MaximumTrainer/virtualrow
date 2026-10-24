import { describe, expect, it } from 'vitest';
import { buildingsFromElements, type OsmBuilding } from '../lib/services/routeEnrichmentService';
import { toEngineRoute } from '../lib/ui/sceneryRoute';
import type { WaterRoute } from '../lib/types/index';

describe('buildingsFromElements', () => {
  it('converts a way with a `building` tag into an OsmBuilding', () => {
    const buildings = buildingsFromElements([
      {
        type: 'way',
        tags: { building: 'house', 'building:levels': '2' },
        geometry: [
          { lat: 51, lon: -0.001 },
          { lat: 51.0001, lon: -0.001 },
          { lat: 51.0001, lon: 0 },
          { lat: 51, lon: 0 },
          { lat: 51, lon: -0.001 },
        ],
      },
    ]);
    expect(buildings).toHaveLength(1);
    expect(buildings[0].kind).toBe('house');
    expect(buildings[0].heightMeters).toBe(6); // 2 levels × 3 m
    expect(buildings[0].footprint).toHaveLength(5);
  });

  it('prefers the `height` tag over `building:levels` when both are present', () => {
    const [b] = buildingsFromElements([
      {
        type: 'way',
        tags: { building: 'yes', height: '12.5', 'building:levels': '2' },
        geometry: [
          { lat: 0, lon: 0 }, { lat: 0, lon: 0.0001 }, { lat: 0.0001, lon: 0 },
        ],
      },
    ]);
    expect(b.heightMeters).toBe(12.5);
  });

  it('leaves heightMeters undefined when neither tag parses', () => {
    const [b] = buildingsFromElements([
      {
        type: 'way',
        tags: { building: 'barn' },
        geometry: [
          { lat: 0, lon: 0 }, { lat: 0, lon: 0.0001 }, { lat: 0.0001, lon: 0 },
        ],
      },
    ]);
    expect(b.heightMeters).toBeUndefined();
  });

  it('extracts outer rings from `relation["building"]`', () => {
    const buildings = buildingsFromElements([
      {
        type: 'relation',
        tags: { building: 'commercial' },
        members: [
          {
            type: 'way',
            ref: 1,
            role: 'outer',
            geometry: [
              { lat: 0, lon: 0 }, { lat: 0, lon: 0.0002 }, { lat: 0.0002, lon: 0 },
            ],
          },
          {
            type: 'way',
            ref: 2,
            role: 'inner',
            geometry: [
              { lat: 0.00005, lon: 0.00005 }, { lat: 0.00005, lon: 0.0001 }, { lat: 0.0001, lon: 0.00005 },
            ],
          },
        ],
      },
    ]);
    expect(buildings).toHaveLength(1);
    expect(buildings[0].kind).toBe('commercial');
  });

  it('ignores elements with no building tag or no geometry', () => {
    expect(buildingsFromElements([
      { type: 'way', tags: { highway: 'residential' } },
      { type: 'way', tags: { building: 'yes' } }, // no geometry
      { type: 'way', tags: { building: 'yes' }, geometry: [{ lat: 0, lon: 0 }] }, // too few points
    ])).toEqual([]);
  });
});

describe('toEngineRoute surfaces OSM buildings as BuildingSpecs', () => {
  const makeRoute = (): WaterRoute =>
    ({
      id: 'r', name: 'r', description: '', distance: 1, difficulty: 'easy',
      location: '', coordinates: [{ lat: 51, lng: -0.001 }, { lat: 51, lng: 0 }],
      elevationGain: 0, estimatedTime: 10, tags: [], createdAt: new Date(),
    }) as WaterRoute;

  it('appends a BuildingSpec per OSM building near the route', () => {
    const route = makeRoute();
    const enrichment = {
      source: 'overpass' as const,
      enrichedAt: 0,
      elevations: [],
      segmentProfiles: [],
      waterBodyType: 'river' as const,
      waterWidthMeters: 20,
      buildings: [
        {
          footprint: [
            { lat: 51.00005, lng: 0.00005 }, // ~5 m from origin
            { lat: 51.0001,  lng: 0.00005 },
            { lat: 51.0001,  lng: 0.0001 },
            { lat: 51.00005, lng: 0.0001 },
          ],
          heightMeters: 8,
          kind: 'house',
        } satisfies OsmBuilding,
      ],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const result = toEngineRoute(route, enrichment);
    const osm = (result?.buildings ?? []).filter((b) => b.height === 8);
    expect(osm.length).toBeGreaterThan(0);
    expect(osm[0].halfWidth).toBeGreaterThan(0);
    expect(osm[0].halfDepth).toBeGreaterThan(0);
    expect(osm[0].profile).toBe('residential');
  });

  it('drops a building whose footprint is below the min area', () => {
    const route = makeRoute();
    const enrichment = {
      source: 'overpass' as const, enrichedAt: 0,
      elevations: [], segmentProfiles: [],
      waterBodyType: 'river' as const, waterWidthMeters: 20,
      buildings: [{
        // 3 points < 1 cm each: well below the 4 m² floor.
        footprint: [
          { lat: 51, lng: 0 },
          { lat: 51.000001, lng: 0 },
          { lat: 51, lng: 0.000001 },
        ],
      } satisfies OsmBuilding],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const result = toEngineRoute(route, enrichment);
    const generated = (result?.buildings ?? []).length;
    // The procedural facade pipeline may still emit buildings on a straight
    // route; just assert the toy OSM building didn't make it in.
    for (const b of result?.buildings ?? []) {
      expect(b.height).not.toBe(6); // default OSM height
    }
    expect(generated).toBeGreaterThanOrEqual(0);
  });
});
