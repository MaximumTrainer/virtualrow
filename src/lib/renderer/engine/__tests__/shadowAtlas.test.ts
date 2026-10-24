/**
 * Shadow-atlas sizing + layout tests (#559 FR3). Pins per-tier atlas sizes
 * through `shadowConfigFor` and the horizontal tile layout.
 */

import { describe, expect, it } from 'vitest';
import { makeMockDevice } from '../../__tests__/_mockWebGPU';
import { cascadeViewport, createShadowAtlas } from '../shadowAtlas';
import { KNOWN_TIERS, shadowConfigFor } from '../shadowConfig';

describe('shadowConfigFor', () => {
  it('returns the medium default for unknown tiers', () => {
    expect(shadowConfigFor('mystery')).toEqual({ cascades: 3, atlasSize: 1024 });
    expect(shadowConfigFor(undefined)).toEqual({ cascades: 3, atlasSize: 1024 });
  });

  it('maps every known tier to a cascades count in [2, 4]', () => {
    for (const t of KNOWN_TIERS) {
      const cfg = shadowConfigFor(t);
      expect(cfg.cascades).toBeGreaterThanOrEqual(2);
      expect(cfg.cascades).toBeLessThanOrEqual(4);
      expect(cfg.atlasSize).toBeLessThanOrEqual(2048);
    }
  });
});

describe('createShadowAtlas', () => {
  it('sizes the atlas tiles × tileSize wide, tileSize tall', () => {
    const device = makeMockDevice();
    const atlas = createShadowAtlas(device, 1024, 3);
    expect(atlas.cascades).toBe(3);
    expect(atlas.tileSize).toBe(1024);
    expect(atlas.width).toBe(3072);
    expect(atlas.height).toBe(1024);
    expect(atlas.bytes).toBe(3072 * 1024 * 4);
    atlas.dispose();
  });

  it('clamps requested cascades to [1, 4]', () => {
    const device = makeMockDevice();
    const over = createShadowAtlas(device, 512, 7);
    expect(over.cascades).toBe(4);
    const under = createShadowAtlas(device, 512, 0);
    expect(under.cascades).toBe(1);
  });

  it('dispose() is idempotent', () => {
    const device = makeMockDevice();
    const atlas = createShadowAtlas(device, 512, 2);
    atlas.dispose();
    atlas.dispose();
  });
});

describe('cascadeViewport', () => {
  it('lays out tiles horizontally', () => {
    const device = makeMockDevice();
    const atlas = createShadowAtlas(device, 1024, 3);
    expect(cascadeViewport(atlas, 0)).toEqual([0, 0, 1024, 1024]);
    expect(cascadeViewport(atlas, 1)).toEqual([1024, 0, 1024, 1024]);
    expect(cascadeViewport(atlas, 2)).toEqual([2048, 0, 1024, 1024]);
  });

  it('clamps out-of-range indices', () => {
    const device = makeMockDevice();
    const atlas = createShadowAtlas(device, 512, 2);
    expect(cascadeViewport(atlas, -1)).toEqual([0, 0, 512, 512]);
    expect(cascadeViewport(atlas, 10)).toEqual([512, 0, 512, 512]);
  });
});
