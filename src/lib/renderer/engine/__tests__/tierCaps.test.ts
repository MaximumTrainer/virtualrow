import { describe, expect, it } from 'vitest';
import { tierCapsFor } from '../tierCaps';

describe('tierCaps (P6 D8)', () => {
  it('basic draws neither buildings nor clouds, no cast', () => {
    expect(tierCapsFor('basic')).toEqual({
      drawBuildings: false,
      drawClouds: false,
      castBuildingShadows: false,
    });
  });

  it('low draws buildings but no clouds and no cast', () => {
    expect(tierCapsFor('low')).toEqual({
      drawBuildings: true,
      drawClouds: false,
      castBuildingShadows: false,
    });
  });

  it('medium draws everything and casts', () => {
    expect(tierCapsFor('medium')).toEqual({
      drawBuildings: true,
      drawClouds: true,
      castBuildingShadows: true,
    });
  });

  it('high draws everything and casts', () => {
    expect(tierCapsFor('high')).toEqual({
      drawBuildings: true,
      drawClouds: true,
      castBuildingShadows: true,
    });
  });

  it('extra-high draws everything and casts', () => {
    expect(tierCapsFor('extra-high')).toEqual({
      drawBuildings: true,
      drawClouds: true,
      castBuildingShadows: true,
    });
  });

  it('an unknown tier string falls back to the default (medium) caps', () => {
    expect(tierCapsFor('fancy')).toEqual(tierCapsFor('medium'));
  });

  it('undefined falls back to the default caps', () => {
    expect(tierCapsFor(undefined)).toEqual(tierCapsFor('medium'));
  });
});
