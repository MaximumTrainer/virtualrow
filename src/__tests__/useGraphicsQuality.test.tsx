import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useGraphicsQuality,
  GRAPHICS_QUALITY_STORAGE_KEY,
  GRAPHICS_QUALITY_OPTIONS,
  migrateLegacyQuality,
} from '../hooks/useGraphicsQuality';

describe('useGraphicsQuality', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('starts on auto, and asks the scene to decide for itself', () => {
    const { result } = renderHook(() => useGraphicsQuality());
    expect(result.current.quality).toBe('auto');
    expect(result.current.performanceMode).toBeUndefined();
  });

  it('pins the scene to the tier the rower picked', () => {
    const { result } = renderHook(() => useGraphicsQuality());
    act(() => result.current.setQuality('basic'));

    expect(result.current.quality).toBe('basic');
    expect(result.current.performanceMode).toBe('basic');
  });

  it('remembers the choice for the next session', () => {
    const { result } = renderHook(() => useGraphicsQuality());
    act(() => result.current.setQuality('extra-high'));
    expect(localStorage.getItem(GRAPHICS_QUALITY_STORAGE_KEY)).toBe('extra-high');

    const { result: reopened } = renderHook(() => useGraphicsQuality());
    expect(reopened.current.quality).toBe('extra-high');
  });

  it('falls back to auto when storage holds something else', () => {
    localStorage.setItem(GRAPHICS_QUALITY_STORAGE_KEY, 'ultra');
    const { result } = renderHook(() => useGraphicsQuality());
    expect(result.current.quality).toBe('auto');
  });

  it('ignores a value that is not a quality', () => {
    const { result } = renderHook(() => useGraphicsQuality());
    act(() => result.current.setQuality('ludicrous' as never));
    expect(result.current.quality).toBe('auto');
  });

  it('works where localStorage throws', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    });

    const { result } = renderHook(() => useGraphicsQuality());
    expect(result.current.quality).toBe('auto');
    expect(() => act(() => result.current.setQuality('basic'))).not.toThrow();
    expect(result.current.quality).toBe('basic');
  });

  it('offers all six tiers in the shipped order (#455 FR6)', () => {
    expect(GRAPHICS_QUALITY_OPTIONS.map((o) => o.value)).toEqual([
      'auto',
      'basic',
      'low',
      'medium',
      'high',
      'extra-high',
    ]);
  });

  describe('#455 D3 / FR5 — legacy storage migration', () => {
    it('maps a stored "low" (today\'s basic) to "basic"', () => {
      expect(migrateLegacyQuality('low')).toBe('basic');
    });

    it('maps a stored "high" (today\'s extra-high) to "extra-high"', () => {
      expect(migrateLegacyQuality('high')).toBe('extra-high');
    });

    it('leaves a stored "auto" alone (still the picker default)', () => {
      expect(migrateLegacyQuality('auto')).toBe('auto');
    });

    it('passes new-scheme values through', () => {
      expect(migrateLegacyQuality('basic')).toBe('basic');
      expect(migrateLegacyQuality('medium')).toBe('medium');
      expect(migrateLegacyQuality('extra-high')).toBe('extra-high');
    });

    it('maps anything else (nonsense, empty, missing) to "auto"', () => {
      expect(migrateLegacyQuality('nonsense')).toBe('auto');
      expect(migrateLegacyQuality('')).toBe('auto');
      expect(migrateLegacyQuality(null)).toBe('auto');
    });

    it('rewrites the stored key when the hook reads back a migrated value', () => {
      localStorage.setItem(GRAPHICS_QUALITY_STORAGE_KEY, 'low');
      const { result } = renderHook(() => useGraphicsQuality());
      expect(result.current.quality).toBe('basic');
      expect(localStorage.getItem(GRAPHICS_QUALITY_STORAGE_KEY)).toBe('basic');
    });
  });
});
