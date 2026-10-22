import { describe, it, expect, beforeEach } from 'vitest';
import { flushSync } from 'svelte';
import {
  GraphicsQualityStore,
  GRAPHICS_QUALITY_STORAGE_KEY,
  GRAPHICS_QUALITY_OPTIONS,
  migrateLegacyQuality,
} from '../lib/ui/graphicsQuality.svelte';

/**
 * Runes port of useGraphicsQuality (#455 FR5). Same storage key and migration,
 * so a rower's remembered tier survives the #542 rebuild.
 */
describe('GraphicsQualityStore (#542 port of useGraphicsQuality)', () => {
  beforeEach(() => localStorage.clear());

  it('offers auto plus the five tiers (#455 FR6)', () => {
    expect(GRAPHICS_QUALITY_OPTIONS.map((o) => o.value)).toEqual([
      'auto',
      'basic',
      'low',
      'medium',
      'high',
      'extra-high',
    ]);
  });

  it('migrates the legacy three-tier values on read (#455 D3)', () => {
    expect(migrateLegacyQuality('low')).toBe('basic');
    expect(migrateLegacyQuality('high')).toBe('extra-high');
    expect(migrateLegacyQuality('auto')).toBe('auto');
    expect(migrateLegacyQuality('medium')).toBe('medium');
    expect(migrateLegacyQuality('nonsense')).toBe('auto');
    expect(migrateLegacyQuality(null)).toBe('auto');
  });

  it('defaults to auto with nothing stored', () => {
    expect(new GraphicsQualityStore().quality).toBe('auto');
  });

  it('seeds from a migrated stored value', () => {
    localStorage.setItem(GRAPHICS_QUALITY_STORAGE_KEY, 'high');
    expect(new GraphicsQualityStore().quality).toBe('extra-high');
  });

  it('persists the rower’s choice under the same key', () => {
    const store = new GraphicsQualityStore();
    store.setQuality('low');
    expect(store.quality).toBe('low');
    expect(localStorage.getItem(GRAPHICS_QUALITY_STORAGE_KEY)).toBe('low');
  });

  it('ignores an invalid value', () => {
    const store = new GraphicsQualityStore();
    store.setQuality('bogus' as never);
    expect(store.quality).toBe('auto');
  });

  it('hands the engine undefined for auto and the tier otherwise', () => {
    const cleanup = $effect.root(() => {
      const store = new GraphicsQualityStore();
      flushSync();
      expect(store.performanceMode).toBeUndefined();
      store.setQuality('high');
      flushSync();
      expect(store.performanceMode).toBe('high');
    });
    cleanup();
  });
});
