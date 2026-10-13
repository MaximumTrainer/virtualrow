import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  CrashReportsPreferenceStore,
  CRASH_REPORTS_ENABLED_KEY,
  CRASH_REPORTS_ENABLED_DEFAULT,
} from '../services/crashReportsPreferenceStore';

/**
 * Static gate on the crash-reports opt-out (#473, FR8 / AC8).
 */
describe('crashReportsPreferenceStore (#473)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults to on (D3 = b) when the key is missing', () => {
    const store = new CrashReportsPreferenceStore();
    expect(store.isEnabled()).toBe(CRASH_REPORTS_ENABLED_DEFAULT);
    expect(store.isEnabled()).toBe(true);
  });

  it('round-trips a false (opt-out) write', () => {
    const store = new CrashReportsPreferenceStore();
    store.setEnabled(false);
    expect(localStorage.getItem(CRASH_REPORTS_ENABLED_KEY)).toBe('false');
    expect(store.isEnabled()).toBe(false);
  });

  it('round-trips a true (opt-in) write', () => {
    const store = new CrashReportsPreferenceStore();
    store.setEnabled(false);
    store.setEnabled(true);
    expect(localStorage.getItem(CRASH_REPORTS_ENABLED_KEY)).toBe('true');
    expect(store.isEnabled()).toBe(true);
  });

  it('falls back to the default without throwing on malformed values', () => {
    localStorage.setItem(CRASH_REPORTS_ENABLED_KEY, 'maybe');
    const store = new CrashReportsPreferenceStore();
    expect(() => store.isEnabled()).not.toThrow();
    expect(store.isEnabled()).toBe(CRASH_REPORTS_ENABLED_DEFAULT);
  });

  it('notifies subscribers on each flip (AC8 live toggle)', () => {
    const store = new CrashReportsPreferenceStore();
    const sub = vi.fn();
    const unsub = store.subscribe(sub);
    store.setEnabled(false);
    store.setEnabled(true);
    expect(sub).toHaveBeenNthCalledWith(1, false);
    expect(sub).toHaveBeenNthCalledWith(2, true);
    unsub();
    store.setEnabled(false);
    expect(sub).toHaveBeenCalledTimes(2);
  });
});
