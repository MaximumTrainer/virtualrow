import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  defaultRoutePreferenceStore,
  DEFAULT_ROUTE_KEY_PREFIX,
} from '../services/defaultRoutePreferenceStore';

/**
 * Issue #219, R6 — a signed-in athlete can make a route their default.
 *
 * The store is keyed by intervals.icu athlete ID, mirroring
 * localStorageWorkoutStore, so two athletes sharing a browser do not inherit
 * each other's preference (AC6.9).
 */
describe('defaultRoutePreferenceStore', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('AC6.2: stores the route id under the athlete-scoped key', () => {
    defaultRoutePreferenceStore.setDefaultRouteId('i12345', '1');

    expect(localStorage.getItem(`${DEFAULT_ROUTE_KEY_PREFIX}i12345`)).toBe('1');
    expect(defaultRoutePreferenceStore.getDefaultRouteId('i12345')).toBe('1');
  });

  it('returns null when the athlete has set no default', () => {
    expect(defaultRoutePreferenceStore.getDefaultRouteId('i12345')).toBeNull();
  });

  it('AC6.5: setting a new default replaces the old one', () => {
    defaultRoutePreferenceStore.setDefaultRouteId('i12345', '1');
    defaultRoutePreferenceStore.setDefaultRouteId('i12345', 'rownative-henley');

    expect(defaultRoutePreferenceStore.getDefaultRouteId('i12345')).toBe('rownative-henley');
  });

  it('AC6.6: clearing removes the key', () => {
    defaultRoutePreferenceStore.setDefaultRouteId('i12345', '1');
    defaultRoutePreferenceStore.clearDefaultRouteId('i12345');

    expect(defaultRoutePreferenceStore.getDefaultRouteId('i12345')).toBeNull();
    expect(localStorage.getItem(`${DEFAULT_ROUTE_KEY_PREFIX}i12345`)).toBeNull();
  });

  it('AC6.9: two athletes on the same browser keep separate defaults', () => {
    defaultRoutePreferenceStore.setDefaultRouteId('i12345', '1');
    defaultRoutePreferenceStore.setDefaultRouteId('i99999', 'rownative-henley');

    expect(defaultRoutePreferenceStore.getDefaultRouteId('i12345')).toBe('1');
    expect(defaultRoutePreferenceStore.getDefaultRouteId('i99999')).toBe('rownative-henley');
  });

  it('ignores an empty athlete id rather than writing a shared key', () => {
    defaultRoutePreferenceStore.setDefaultRouteId('', '1');

    expect(localStorage.getItem(`${DEFAULT_ROUTE_KEY_PREFIX}`)).toBeNull();
    expect(defaultRoutePreferenceStore.getDefaultRouteId('')).toBeNull();
  });

  it('AC6.8: a throwing localStorage is survivable on write', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError');
    });

    expect(() => defaultRoutePreferenceStore.setDefaultRouteId('i12345', '1')).not.toThrow();
    expect(warn).toHaveBeenCalled();
  });

  it('AC6.8: a throwing localStorage reads as "no default"', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('SecurityError');
    });

    expect(defaultRoutePreferenceStore.getDefaultRouteId('i12345')).toBeNull();
  });

  it('AC6.8: a throwing localStorage is survivable on clear', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('SecurityError');
    });

    expect(() => defaultRoutePreferenceStore.clearDefaultRouteId('i12345')).not.toThrow();
  });
});

/**
 * AC6.3 / AC6.4 — resolving the stored id against the catalogue on load.
 */
describe('resolveDefaultRoute', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('AC6.3: returns the stored route when it is still in the catalogue', () => {
    defaultRoutePreferenceStore.setDefaultRouteId('i12345', 'b');

    const resolved = defaultRoutePreferenceStore.resolveDefaultRouteId(
      'i12345',
      ['a', 'b', 'c'],
    );

    expect(resolved).toBe('b');
  });

  it('AC6.4: a stored id that is no longer in the catalogue is dropped and cleared', () => {
    defaultRoutePreferenceStore.setDefaultRouteId('i12345', 'gone');

    const resolved = defaultRoutePreferenceStore.resolveDefaultRouteId(
      'i12345',
      ['a', 'b'],
    );

    expect(resolved).toBeNull();
    expect(defaultRoutePreferenceStore.getDefaultRouteId('i12345')).toBeNull();
  });

  it('returns null for a signed-out visitor (no athlete id)', () => {
    expect(defaultRoutePreferenceStore.resolveDefaultRouteId(null, ['a'])).toBeNull();
  });
});
