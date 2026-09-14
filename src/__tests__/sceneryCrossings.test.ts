import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { BRIDGE_MODELS, bridgeModelFor } from '../components/rower3d/sceneryCrossings';
import {
  bridgeKindFromTags,
  findCrossings,
  type BridgeKind,
} from '../utils/bridgeCrossings';
import type { OverpassElement } from '../services/routeEnrichmentService';

/** A straight 1 km reach, north-south. */
const route = Array.from({ length: 21 }, (_, i) => ({ lat: 51.5 + i * 0.0001, lng: -0.9 }));

const bridgeAt = (lat: number, tags: Record<string, string>): OverpassElement => ({
  type: 'way',
  tags: { bridge: 'yes', ...tags },
  geometry: [
    { lat, lon: -0.9008 },
    { lat, lon: -0.8992 },
  ],
});

describe('bridgeKindFromTags', () => {
  it.each<[string, Record<string, string>, BridgeKind]>([
    ['a railway crossing', { railway: 'rail' }, 'rail'],
    ['a footbridge', { highway: 'footway' }, 'foot'],
    ['a masonry arch', { 'bridge:structure': 'arch' }, 'arch'],
    ['a steel truss', { 'bridge:structure': 'truss' }, 'truss'],
    ['a cantilever', { 'bridge:structure': 'cantilever' }, 'cantilever'],
    ['a bascule', { 'bridge:movable': 'bascule' }, 'bascule'],
    ['a Dutch lift bridge', { 'bridge:movable': 'lift' }, 'lift'],
    ['anything else carrying traffic', { highway: 'primary' }, 'road'],
  ])('reads %s', (_label, tags, expected) => {
    expect(bridgeKindFromTags(tags)).toBe(expected);
  });

  it('prefers the movable type over the structure', () => {
    expect(bridgeKindFromTags({ 'bridge:movable': 'bascule', 'bridge:structure': 'truss' })).toBe(
      'bascule',
    );
  });
});

describe('BRIDGE_MODELS', () => {
  it('maps every kind to a Tier C model that exists', () => {
    const missing = Object.values(BRIDGE_MODELS).filter(
      (id) => !fs.existsSync(path.join(process.cwd(), 'public/assets/scenery/tier-c', `${id}.glb`)),
    );

    expect(missing).toEqual([]);
  });

  it('uses the whole Tier C kit rather than one bridge for everything', () => {
    expect(new Set(Object.values(BRIDGE_MODELS)).size).toBe(Object.keys(BRIDGE_MODELS).length);
  });
});

describe('bridgeModelFor', () => {
  it('returns the model for the kind', () => {
    expect(bridgeModelFor('rail')).toBe(BRIDGE_MODELS.rail);
  });
});

describe('findCrossings', () => {
  it('locates a bridge along the route by progress', () => {
    const crossings = findCrossings(route, [bridgeAt(51.501, { railway: 'rail' })]);

    expect(crossings).toHaveLength(1);
    expect(crossings[0].kind).toBe('rail');
    expect(crossings[0].progress).toBeCloseTo(0.5, 1);
  });

  it('ignores bridges that are in the bounding box but not over this water', () => {
    const faraway = bridgeAt(51.6, { highway: 'primary' });

    expect(findCrossings(route, [faraway])).toEqual([]);
  });

  it('ignores ways that are not bridges', () => {
    const road: OverpassElement = {
      type: 'way',
      tags: { highway: 'primary' },
      geometry: [{ lat: 51.501, lon: -0.9 }],
    };

    expect(findCrossings(route, [road])).toEqual([]);
  });

  it('collapses bridges that land on the same stretch of water', () => {
    const crossings = findCrossings(route, [
      bridgeAt(51.5010, { railway: 'rail' }),
      bridgeAt(51.50101, { railway: 'rail' }),
    ]);

    expect(crossings).toHaveLength(1);
  });

  it('returns crossings in route order', () => {
    const crossings = findCrossings(route, [
      bridgeAt(51.5016, { highway: 'primary' }),
      bridgeAt(51.5004, { highway: 'footway' }),
    ]);

    expect(crossings.map((c) => c.kind)).toEqual(['foot', 'road']);
  });

  it('copes with a route or element list that has nothing usable', () => {
    expect(findCrossings([], [bridgeAt(51.5, {})])).toEqual([]);
    expect(findCrossings(route, [])).toEqual([]);
    expect(findCrossings(route, [{ type: 'way', tags: { bridge: 'yes' } }])).toEqual([]);
  });
});
