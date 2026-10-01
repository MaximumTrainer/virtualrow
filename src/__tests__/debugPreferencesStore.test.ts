import { describe, it, expect, beforeEach } from 'vitest';
import {
  debugPreferencesStore,
  SHOW_DEMO_CTA_KEY,
} from '../services/debugPreferencesStore';

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
