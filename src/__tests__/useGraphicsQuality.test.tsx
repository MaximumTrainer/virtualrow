import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useGraphicsQuality,
  GRAPHICS_QUALITY_STORAGE_KEY,
  GRAPHICS_QUALITY_OPTIONS,
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
    act(() => result.current.setQuality('low'));

    expect(result.current.quality).toBe('low');
    expect(result.current.performanceMode).toBe('low');
  });

  it('remembers the choice for the next session', () => {
    const { result } = renderHook(() => useGraphicsQuality());
    act(() => result.current.setQuality('high'));
    expect(localStorage.getItem(GRAPHICS_QUALITY_STORAGE_KEY)).toBe('high');

    const { result: reopened } = renderHook(() => useGraphicsQuality());
    expect(reopened.current.quality).toBe('high');
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
    expect(() => act(() => result.current.setQuality('low'))).not.toThrow();
    expect(result.current.quality).toBe('low');
  });

  it('offers exactly the tiers the scene understands', () => {
    expect(GRAPHICS_QUALITY_OPTIONS.map((o) => o.value)).toEqual(['auto', 'low', 'high']);
  });
});
