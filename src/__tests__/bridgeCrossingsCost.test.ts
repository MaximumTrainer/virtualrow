import { describe, it, expect, vi } from 'vitest';

/**
 * findCrossings runs on the main thread during enrichment, over every way the
 * `way["bridge"](bbox)` clause returns — on the order of a thousand on an urban
 * river — against every route point. Without a cheap reject first that is
 * millions of haversines per route (review of #232).
 */
const haversine = vi.hoisted(() => vi.fn());

vi.mock('../utils/geoUtils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/geoUtils')>();
  haversine.mockImplementation(actual.distanceBetweenLatLng);
  return { ...actual, distanceBetweenLatLng: haversine };
});

const { findCrossings } = await import('../utils/bridgeCrossings');
import type { OverpassElement } from '../services/routeEnrichmentService';

describe('findCrossings cost', () => {
  it('rejects distant bridges without measuring every route point', () => {
    const route = Array.from({ length: 2000 }, (_, i) => ({
      lat: 51.47 + i * 0.00005,
      lng: -0.24,
    }));
    // A thousand bridges spread over the bbox, none near the rowed line.
    const elements: OverpassElement[] = Array.from({ length: 1000 }, (_, i) => ({
      type: 'way',
      tags: { bridge: 'yes', highway: 'primary' },
      geometry: [
        { lat: 51.47 + (i % 100) * 0.0005, lon: -0.20 },
        { lat: 51.47 + (i % 100) * 0.0005, lon: -0.19 },
      ],
    }));

    haversine.mockClear();
    findCrossings(route, elements);

    // The naive form is 1000 x 2000 = 2,000,000. The window makes almost all of
    // those unnecessary; the bound is generous so it tracks the algorithm, not
    // the fixture.
    expect(haversine.mock.calls.length).toBeLessThan(100_000);
  });

  it('still finds a bridge that is genuinely there', () => {
    const route = Array.from({ length: 2000 }, (_, i) => ({
      lat: 51.47 + i * 0.00005,
      lng: -0.24,
    }));
    const at = route[1000];
    const elements: OverpassElement[] = [
      {
        type: 'way',
        tags: { bridge: 'yes', railway: 'rail' },
        geometry: [
          { lat: at.lat, lon: at.lng - 0.0006 },
          { lat: at.lat, lon: at.lng + 0.0006 },
        ],
      },
    ];

    const crossings = findCrossings(route, elements);

    expect(crossings).toHaveLength(1);
    expect(crossings[0].kind).toBe('rail');
  });
});
