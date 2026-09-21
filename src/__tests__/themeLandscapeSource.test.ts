import { describe, it, expect } from 'vitest';
import { THEME_CONFIG, themeUsesGlbScenery } from '../components/rower3d/themeConfig';

/**
 * Which catalogue dresses the banks.
 *
 * There is one theme since #361 and it takes the shared GLB kit, so the
 * `bespoke` alternative has no subjects left. The comparisons that used to live
 * here — "the stylised themes keep their own scenes", "an unknown theme falls
 * back to the default" — went with the five themes and the fallback they were
 * about. What is left is the fact the scene actually depends on.
 */
describe('landscapeSource', () => {
  it('is declared for the theme', () => {
    expect(THEME_CONFIG.willowbrook.landscapeSource).toBeDefined();
  });

  it('dresses the banks from the GLB kit', () => {
    expect(THEME_CONFIG.willowbrook.landscapeSource).toBe('glb-kit');
    expect(themeUsesGlbScenery('willowbrook')).toBe(true);
  });
});
