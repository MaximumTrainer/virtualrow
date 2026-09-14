import { describe, it, expect } from 'vitest';
import {
  SCENERY_REGIONS,
  resolveRegion,
  type SceneryRegion,
} from '../components/rower3d/sceneryRegion';

/** Real rowing water, one per region the Tier D kit covers. */
const VENUES: Array<[string, SceneryRegion, { lat: number; lng: number }]> = [
  ['Henley-on-Thames, GB', 'gb', { lat: 51.536, lng: -0.903 }],
  ['Brno Prygl, CZ', 'ce', { lat: 49.246, lng: 16.523 }],
  ['Po at Turin, IT', 'it', { lat: 45.05, lng: 7.688 }],
  ['Twentekanaal, NL', 'nl', { lat: 52.223, lng: 6.896 }],
  ['Charles River, Boston MA', 'us', { lat: 42.354, lng: -71.108 }],
];

describe('SCENERY_REGIONS', () => {
  it('covers every region the Tier D kit ships models for', () => {
    expect(Object.keys(SCENERY_REGIONS).sort()).toEqual(['ce', 'gb', 'it', 'nl', 'us']);
  });
});

describe('resolveRegion', () => {
  it.each(VENUES)('places %s in %s', (_venue, expected, coordinate) => {
    expect(resolveRegion([coordinate])).toBe(expected);
  });

  it('reads the middle of the route, so a border crossing does not flip the dressing', () => {
    const dutch = { lat: 52.223, lng: 6.896 };
    const german = { lat: 52.223, lng: 7.4 };

    expect(resolveRegion([dutch, dutch, dutch, german])).toBe('nl');
  });

  it('returns null for water outside the kit, so the generic models are used', () => {
    expect(resolveRegion([{ lat: -33.86, lng: 151.21 }])).toBeNull();
  });

  it('returns null for a route with no usable coordinates', () => {
    expect(resolveRegion([])).toBeNull();
    expect(resolveRegion(undefined)).toBeNull();
    expect(resolveRegion([{ lat: Number.NaN, lng: 0 }])).toBeNull();
  });
});
