import { describe, it, expect } from 'vitest';
import { chunkViewDistanceFor, fogFor } from '../components/rower3d/fogPlan';
import { SCENE_CONFIG } from '../components/rower3d/themeConfig';

/**
 * Issue #325 — the distance fades instead of ending.
 *
 * The scene config has carried `fogColor`, `fogNear` and `fogFar` since the theme
 * table was written, and nothing has ever read them. Without fog the water
 * strip simply stops: `geometryChunks.ts` records that the cut used to be
 * hidden by `fogExp2` and has been bare ever since, and #321 had to hold the
 * cull out at seven kilometres rather than expose an edge nothing softened.
 *
 * Fog is what lets that come back in. The two are one decision, so they are
 * computed in one place: nothing past the fog's far plane is worth drawing,
 * because nothing past it can be seen.
 */

describe('fogFor', () => {
  it('gives a fog it can actually see through', () => {
    const fog = fogFor();

    expect(Number.isFinite(fog.near), 'fogNear is not a number').toBe(true);
    expect(Number.isFinite(fog.far), 'fogFar is not a number').toBe(true);
    expect(fog.near, 'fog starts at or before the camera').toBeGreaterThan(0);
    expect(fog.far, 'fog is fully opaque before it begins').toBeGreaterThan(fog.near);
  });

  it('takes the colour the config authored', () => {
    expect(fogFor().color).toBe(SCENE_CONFIG.atmosphere.fogColor);
  });

  // #364 names these numbers as the thing the refactor must not move.
  it('fades from 80 m to 550 m', () => {
    expect(fogFor()).toMatchObject({ near: 80, far: 550 });
  });

  // Scenery is placed out to 240 m from the centreline (#321), and a fog that
  // closes before the far bank turns the world into a corridor.
  it('reaches past the furthest scenery', () => {
    expect(fogFor().far).toBeGreaterThan(300);
  });
});

describe('chunkViewDistanceFor', () => {
  it('stops drawing past the point it can be seen', () => {
    expect(chunkViewDistanceFor()).toBeGreaterThan(fogFor().far);
  });

  // Not much past it. The whole point is that the cut is hidden, and every
  // metre beyond the fog is geometry built, uploaded and drawn into opacity.
  it('does not draw far past it either', () => {
    expect(chunkViewDistanceFor()).toBeLessThan(fogFor().far * 1.5);
  });
});
