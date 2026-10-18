import { describe, expect, it } from 'vitest';
import { mapOsmTagsToSceneryProfile } from '../utils/sceneryFromTags';

describe('mapOsmTagsToSceneryProfile', () => {
  it('maps land use to a scenery profile', () => {
    expect(mapOsmTagsToSceneryProfile({ natural: 'wood' })).toBe('forest');
    expect(mapOsmTagsToSceneryProfile({ landuse: 'residential' })).toBe('residential');
    expect(mapOsmTagsToSceneryProfile({ landuse: 'industrial' })).toBe('commercial');
    expect(mapOsmTagsToSceneryProfile({ natural: 'sand' })).toBe('beach');
    expect(mapOsmTagsToSceneryProfile()).toBe('fallback');
  });

  it('reads parks and gardens as open parkland (#493 AC19)', () => {
    for (const leisure of ['park', 'garden', 'recreation_ground', 'golf_course', 'common']) {
      expect(mapOsmTagsToSceneryProfile({ leisure })).toBe('farmland');
    }
    expect(mapOsmTagsToSceneryProfile({ leisure: 'marina' })).toBe('fallback');
  });
});
