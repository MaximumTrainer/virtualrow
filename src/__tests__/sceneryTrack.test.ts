import { describe, it, expect } from 'vitest';
import {
  WILLOWBROOK_ROUTE_ID,
  WILLOWBROOK_SCENERY_TRACK,
  getRouteSceneryTrack,
  trackProfileAt,
  trackWaterAt,
  trackProfiles,
  trackWaterForProfile,
} from '../components/rower3d/sceneryTrack';
import { getSegmentSceneryProfile } from '../components/rower3d/segmentScenery';
import type { RouteEnrichmentData } from '../services/routeEnrichmentService';

const enrichmentOf = (profiles: string[]): RouteEnrichmentData =>
  ({
    routeId: 'x',
    elevations: [],
    segmentProfiles: profiles.map((sceneryProfile) => ({ sceneryProfile })),
    waterBodyType: 'canal',
    waterWidthMeters: 20,
    waterColor: '#000',
    waveIntensity: 0.5,
    fetchedAt: 0,
    source: 'network',
  }) as unknown as RouteEnrichmentData;

describe('WILLOWBROOK_SCENERY_TRACK', () => {
  it('covers the whole route with contiguous, ascending bands', () => {
    const bounds = WILLOWBROOK_SCENERY_TRACK.bands.map((b) => b.untilProgress);

    expect(bounds).toEqual([...bounds].sort((a, b) => a - b));
    expect(bounds[bounds.length - 1]).toBe(1);
  });

  it('describes the five authored sections', () => {
    expect(WILLOWBROOK_SCENERY_TRACK.bands).toHaveLength(5);
    expect(WILLOWBROOK_SCENERY_TRACK.bands.map((b) => b.profile)).toEqual([
      'forest',
      'farmland',
      'forest',
      'residential',
      'wetland',
    ]);
  });
});

describe('trackProfileAt', () => {
  it.each([
    [0.1, 'forest'],
    [0.3, 'farmland'],
    [0.5, 'forest'],
    [0.7, 'residential'],
    [0.9, 'wetland'],
  ])('reads the authored profile at %s', (progress, expected) => {
    expect(trackProfileAt(WILLOWBROOK_SCENERY_TRACK, progress as number)).toBe(expected);
  });

  it('clamps progress outside the route', () => {
    expect(trackProfileAt(WILLOWBROOK_SCENERY_TRACK, -1)).toBe('forest');
    expect(trackProfileAt(WILLOWBROOK_SCENERY_TRACK, 5)).toBe('wetland');
    expect(trackProfileAt(WILLOWBROOK_SCENERY_TRACK, Number.NaN)).toBe('forest');
  });
});

describe('trackWaterAt', () => {
  it('opens into a lake at the delta and runs as river mid-route', () => {
    expect(trackWaterAt(WILLOWBROOK_SCENERY_TRACK, 0.9)).toBe('lake');
    expect(trackWaterAt(WILLOWBROOK_SCENERY_TRACK, 0.3)).toBe('river');
  });
});

describe('trackProfiles', () => {
  it('lists each profile once, so models resolve once per profile', () => {
    expect(trackProfiles(WILLOWBROOK_SCENERY_TRACK).sort()).toEqual([
      'farmland',
      'forest',
      'residential',
      'wetland',
    ]);
  });
});

describe('getRouteSceneryTrack', () => {
  it('returns the authored track for the bundled demo route', () => {
    expect(getRouteSceneryTrack(WILLOWBROOK_ROUTE_ID)).toBe(WILLOWBROOK_SCENERY_TRACK);
  });

  it('returns nothing for a real course, which is dressed from enrichment', () => {
    expect(getRouteSceneryTrack('rownative-42')).toBeNull();
    expect(getRouteSceneryTrack(undefined)).toBeNull();
  });
});

describe('getSegmentSceneryProfile with an authored track', () => {
  it('prefers the track over enrichment, so the demo stops rendering Munich', () => {
    const enrichment = enrichmentOf(['commercial', 'commercial', 'commercial']);

    expect(getSegmentSceneryProfile(enrichment, 0.9, WILLOWBROOK_SCENERY_TRACK)).toBe('wetland');
  });

  it('still reads enrichment when the route has no track', () => {
    const enrichment = enrichmentOf(['forest', 'commercial']);

    expect(getSegmentSceneryProfile(enrichment, 1)).toBe('commercial');
  });

  it('still falls back when there is neither track nor enrichment', () => {
    expect(getSegmentSceneryProfile(null, 0.5)).toBe('fallback');
  });
});

describe('trackWaterForProfile', () => {
  it('uses the water body of the first band that wears the profile', () => {
    expect(trackWaterForProfile(WILLOWBROOK_SCENERY_TRACK, 'wetland')).toBe('lake');
    expect(trackWaterForProfile(WILLOWBROOK_SCENERY_TRACK, 'forest')).toBe('stream');
  });

  it('reports unknown water for a profile the track never uses', () => {
    expect(trackWaterForProfile(WILLOWBROOK_SCENERY_TRACK, 'commercial')).toBe('unknown');
  });
});
