import { describe, it, expect, beforeEach } from 'vitest';
import { crashBannerStore, CRASH_BANNER_KEY } from '../lib/services/crashBannerStore';

/**
 * Unit tests for the FR9 banner store.
 *
 * Dismiss-of-A never silences B: a second raise with a different signature
 * reinstates the banner even if the first was dismissed.
 */
describe('crashBannerStore (#473 Phase 3, FR9)', () => {
  beforeEach(() => {
    try {
      localStorage.removeItem(CRASH_BANNER_KEY);
    } catch {
      /* ignored */
    }
  });

  it('hides the banner when nothing has been raised', () => {
    expect(crashBannerStore.current()).toBeNull();
  });

  it('shows the signature after raise() and hides it after dismiss()', () => {
    crashBannerStore.raise('sigA');
    expect(crashBannerStore.current()).toBe('sigA');
    crashBannerStore.dismiss();
    expect(crashBannerStore.current()).toBeNull();
  });

  it('reinstates the banner on a NEW signature even after a prior dismiss', () => {
    crashBannerStore.raise('sigA');
    crashBannerStore.dismiss();
    expect(crashBannerStore.current()).toBeNull();

    crashBannerStore.raise('sigB');
    expect(crashBannerStore.current()).toBe('sigB');
  });

  it('is idempotent on repeated raise of the same signature', () => {
    crashBannerStore.raise('sigA');
    const first = JSON.parse(localStorage.getItem(CRASH_BANNER_KEY) ?? '{}');
    crashBannerStore.raise('sigA');
    const second = JSON.parse(localStorage.getItem(CRASH_BANNER_KEY) ?? '{}');
    expect(second.raisedAt).toBe(first.raisedAt);
  });
});
