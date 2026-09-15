import { describe, it, expect } from 'vitest';
import { findCrossings, bridgeKindFromTags } from '../utils/bridgeCrossings';
import type { OverpassElement } from '../services/routeEnrichmentService';

/** A straight run of route points heading north, ~11 m apart. */
const routeNorth = (count = 101) =>
  Array.from({ length: count }, (_, i) => ({ lat: 51.47 + i * 0.0001, lng: -0.24 }));

/** A way whose centroid lands on the given point, spanning east-west across it. */
const bridgeAcross = (lat: number, lng: number, tags: Record<string, string> = {}) =>
  ({
    type: 'way',
    tags: { bridge: 'yes', highway: 'primary', ...tags },
    geometry: [
      { lat, lon: lng - 0.0006 },
      { lat, lon: lng + 0.0006 },
    ],
  }) as OverpassElement;

describe('bridgeKindFromTags', () => {
  it('reads a movable deck ahead of the structure', () => {
    expect(bridgeKindFromTags({ 'bridge:movable': 'bascule', 'bridge:structure': 'arch' }))
      .toBe('bascule');
  });

  it('falls back to what the bridge carries', () => {
    expect(bridgeKindFromTags({ railway: 'rail' })).toBe('rail');
    expect(bridgeKindFromTags({ highway: 'footway' })).toBe('foot');
    expect(bridgeKindFromTags({ highway: 'primary' })).toBe('road');
  });
});

describe('findCrossings — which ways count as a bridge', () => {
  it('ignores a way tagged bridge=no', () => {
    // `!element.tags?.bridge` is false for the string "no", so an explicit
    // denial was read as a bridge and put a Tier C model over the water.
    const route = routeNorth();
    const at = route[50];

    const crossings = findCrossings(route, [bridgeAcross(at.lat, at.lng, { bridge: 'no' })]);

    expect(crossings).toEqual([]);
  });

  it('still accepts the ordinary bridge tags', () => {
    const route = routeNorth();
    const at = route[50];

    expect(findCrossings(route, [bridgeAcross(at.lat, at.lng)])).toHaveLength(1);
    expect(
      findCrossings(route, [bridgeAcross(at.lat, at.lng, { bridge: 'viaduct' })]),
    ).toHaveLength(1);
  });

  it('ignores a viaduct running alongside the water rather than over it', () => {
    // A centroid within 120 m is not enough: a road on an embankment parallel
    // to the river has one, and no part of it crosses the rowed line.
    const route = routeNorth();
    const at = route[50];
    const parallel = {
      type: 'way',
      tags: { bridge: 'yes', highway: 'primary' },
      // Runs north alongside the route, offset ~70 m east.
      geometry: Array.from({ length: 11 }, (_, i) => ({
        lat: at.lat - 0.0005 + i * 0.0001,
        lon: at.lng + 0.001,
      })),
    } as OverpassElement;

    expect(findCrossings(route, [parallel])).toEqual([]);
  });

  it('keeps a bridge whose way actually crosses the line', () => {
    const route = routeNorth();
    const at = route[50];

    expect(findCrossings(route, [bridgeAcross(at.lat, at.lng)])).toHaveLength(1);
  });
});

describe('findCrossings — separating neighbours', () => {
  it('measures separation from the last bridge it kept, not the one it dropped', () => {
    // 0.500 / 0.508 / 0.516 / 0.524: each is 0.008 from its predecessor, so
    // comparing against the unfiltered predecessor collapsed all four into one
    // — even though the last is 0.024 clear of the survivor.
    // 1001 points, so a progress step is 0.001 and 0.008 is representable.
    const route = routeNorth(1001);
    const elements = [500, 508, 516, 524].map((i) =>
      bridgeAcross(route[i].lat, route[i].lng),
    );

    const crossings = findCrossings(route, elements);

    expect(crossings.length).toBeGreaterThan(1);
    for (let i = 1; i < crossings.length; i += 1) {
      expect(crossings[i].progress - crossings[i - 1].progress).toBeGreaterThan(0.01);
    }
  });

  it('still collapses one structure mapped as several ways', () => {
    const route = routeNorth();
    const at = route[50];
    const elements = [0, 0.1, 0.2].map((d) => bridgeAcross(at.lat + d * 0.0001, at.lng));

    expect(findCrossings(route, elements)).toHaveLength(1);
  });

  it('returns crossings in route order', () => {
    const route = routeNorth();
    const elements = [80, 20, 50].map((i) => bridgeAcross(51.47 + i * 0.0001, -0.24));

    const progresses = findCrossings(route, elements).map((c) => c.progress);

    expect(progresses).toEqual([...progresses].sort((a, b) => a - b));
  });
});
