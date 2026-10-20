import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  debugPreferencesStore,
  SHOW_DEMO_CTA_KEY,
  LAKE_OUTLINES_KEY,
} from '../lib/services/debugPreferencesStore';

/**
 * Static gate on `debugPreferencesStore` (#453, AC3).
 *
 * The store is a tiny `localStorage` wrapper — the tests here fix the
 * default (off), the tolerance to malformed values, and the round-trip.
 */
describe('debugPreferencesStore (#453)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults showDemoCtaOverride to false when the key is missing', () => {
    expect(debugPreferencesStore.getShowDemoCtaOverride()).toBe(false);
  });

  it('returns false without throwing for malformed JSON in the key', () => {
    localStorage.setItem(SHOW_DEMO_CTA_KEY, '{"not":"a bool"');
    expect(() => debugPreferencesStore.getShowDemoCtaOverride()).not.toThrow();
    expect(debugPreferencesStore.getShowDemoCtaOverride()).toBe(false);
  });

  it('returns false without throwing for an unexpected string value', () => {
    localStorage.setItem(SHOW_DEMO_CTA_KEY, 'yes-please');
    expect(debugPreferencesStore.getShowDemoCtaOverride()).toBe(false);
  });

  it('round-trips a true write', () => {
    debugPreferencesStore.setShowDemoCtaOverride(true);
    expect(localStorage.getItem(SHOW_DEMO_CTA_KEY)).toBe('true');
    expect(debugPreferencesStore.getShowDemoCtaOverride()).toBe(true);
  });

  it('round-trips a false write', () => {
    debugPreferencesStore.setShowDemoCtaOverride(true);
    debugPreferencesStore.setShowDemoCtaOverride(false);
    expect(localStorage.getItem(SHOW_DEMO_CTA_KEY)).toBe('false');
    expect(debugPreferencesStore.getShowDemoCtaOverride()).toBe(false);
  });
});

describe('debugPreferencesStore lake outlines (#493)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults to off, so main shows the ribbon until a tester asks', () => {
    expect(debugPreferencesStore.getLakeOutlines()).toBe(false);
  });

  it('treats an unexpected value as off', () => {
    localStorage.setItem(LAKE_OUTLINES_KEY, 'yes-please');
    expect(debugPreferencesStore.getLakeOutlines()).toBe(false);
  });

  it('round-trips on and off', () => {
    debugPreferencesStore.setLakeOutlines(true);
    expect(localStorage.getItem(LAKE_OUTLINES_KEY)).toBe('true');
    expect(debugPreferencesStore.getLakeOutlines()).toBe(true);
    debugPreferencesStore.setLakeOutlines(false);
    expect(debugPreferencesStore.getLakeOutlines()).toBe(false);
  });

  it('falls back to off when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(debugPreferencesStore.getLakeOutlines()).toBe(false);
    vi.restoreAllMocks();
  });
});
