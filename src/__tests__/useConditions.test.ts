import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useConditions, CONDITIONS_STORAGE_KEY } from '../hooks/useConditions';

/**
 * Issue #346 — the rower's choice of conditions, remembered.
 *
 * Set once, not every row, exactly as the graphics tier is. The default is
 * "match my clock": someone rowing at six in the morning gets a dawn, which is
 * the whole point of having presets and is a better first impression than a
 * menu nobody has opened.
 */

beforeEach(() => {
  localStorage.clear();
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/** Freeze the wall clock at a given local hour. */
const atHour = (hour: number) => {
  const now = new Date();
  now.setHours(hour, 0, 0, 0);
  vi.useFakeTimers();
  vi.setSystemTime(now);
};

describe('the conditions a row is rowed in', () => {
  it('matches the rower’s own clock until they say otherwise', () => {
    atHour(6);

    const { result } = renderHook(() => useConditions());

    expect(result.current.choice).toBe('auto');
    expect(result.current.conditions).toBe('dawn');
  });

  it('follows the clock into the evening', () => {
    atHour(20);

    const { result } = renderHook(() => useConditions());

    expect(result.current.conditions).toBe('dusk');
  });

  it('takes the preset the rower picked over the hour', () => {
    atHour(12);
    const { result } = renderHook(() => useConditions());

    act(() => result.current.setChoice('overcast'));

    expect(result.current.choice).toBe('overcast');
    expect(result.current.conditions).toBe('overcast');
  });

  it('goes back to the clock when the rower asks it to', () => {
    atHour(12);
    const { result } = renderHook(() => useConditions());

    act(() => result.current.setChoice('dusk'));
    act(() => result.current.setChoice('auto'));

    expect(result.current.conditions).toBe('midday');
  });

  // Set once, not every row.
  it('is remembered for next time', () => {
    const first = renderHook(() => useConditions());
    act(() => first.result.current.setChoice('golden'));

    const second = renderHook(() => useConditions());

    expect(second.result.current.choice).toBe('golden');
  });

  it('ignores a stored value that is not a preset', () => {
    atHour(12);
    localStorage.setItem(CONDITIONS_STORAGE_KEY, 'thunderstorm');

    const { result } = renderHook(() => useConditions());

    expect(result.current.choice).toBe('auto');
    expect(result.current.conditions).toBe('midday');
  });

  // Private browsing, or storage switched off. The default is no worse for it.
  it('still works when there is nowhere to remember anything', () => {
    atHour(12);
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });

    const { result } = renderHook(() => useConditions());
    act(() => result.current.setChoice('dawn'));

    expect(result.current.conditions).toBe('dawn');

    getItem.mockRestore();
    setItem.mockRestore();
  });

  /**
   * The scene reads a config, not a preset.
   *
   * `applyConditions` is covered in `conditions.test.ts`; what matters here is
   * that the hook hands over the applied config rather than leaving every
   * call-site to apply it and to disagree about how.
   */
  it('hands the scene a config with the preset already applied', () => {
    atHour(12);
    const { result } = renderHook(() => useConditions());

    act(() => result.current.setChoice('overcast'));

    expect(result.current.sceneConfig.clouds.opacity).toBeGreaterThan(0.8);
    expect(result.current.sceneConfig.lighting.sunElevation).toBe(40);
  });
});

/**
 * Under automation, "match my clock" means midday.
 *
 * Every visual baseline and every contrast check would otherwise be a function
 * of the hour CI happened to start: a scene recorded at midday and compared at
 * dusk is a failure nobody caused, and a dusk scene would quietly fail the
 * contrast floors #291 exists to hold.
 */
describe('the clock under automation', () => {
  it('is midday, whatever hour the runner thinks it is', async () => {
    atHour(21);
    window.__PLAYWRIGHT_TESTING = true;
    vi.resetModules();
    const { useConditions: underTest } = await import('../hooks/useConditions');

    const { result } = renderHook(() => underTest());

    expect(result.current.conditions).toBe('midday');
    delete window.__PLAYWRIGHT_TESTING;
  });

  // A spec that wants another preset stores one, which is the path a rower
  // takes: the pin is on "auto", not on the feature.
  it('still honours a preset a spec asked for', async () => {
    atHour(21);
    window.__PLAYWRIGHT_TESTING = true;
    localStorage.setItem(CONDITIONS_STORAGE_KEY, 'dusk');
    vi.resetModules();
    const { useConditions: underTest } = await import('../hooks/useConditions');

    const { result } = renderHook(() => underTest());

    expect(result.current.conditions).toBe('dusk');
    delete window.__PLAYWRIGHT_TESTING;
  });
});
