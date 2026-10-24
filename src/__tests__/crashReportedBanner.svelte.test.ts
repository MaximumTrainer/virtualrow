import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';

import CrashReportedBanner from '../lib/ui/CrashReportedBanner.svelte';
import { crashBannerStore, CRASH_BANNER_KEY } from '../lib/services/crashBannerStore';
import {
  crashReportsPreferenceStore,
  CRASH_REPORTS_ENABLED_KEY,
} from '../lib/services/crashReportsPreferenceStore';

/**
 * Component tests for the FR9 banner (#473 Phase 3), ported to Svelte for #542
 * P1. The stores carry persistence; this file tests just the view and drives
 * through the stores rather than reaching into localStorage directly.
 */
describe('CrashReportedBanner (#473 Phase 3, FR9)', () => {
  beforeEach(() => {
    try {
      localStorage.removeItem(CRASH_BANNER_KEY);
      localStorage.removeItem(CRASH_REPORTS_ENABLED_KEY);
    } catch {
      /* ignored */
    }
  });

  it('renders nothing when no crash has been raised', () => {
    const { container } = render(CrashReportedBanner, {});
    expect(container.querySelector('.crash-reported-banner')).toBeNull();
  });

  it('renders the one-line disclosure when a crash was raised', () => {
    crashBannerStore.raise('sigA');
    render(CrashReportedBanner, {});
    expect(screen.getByText(/previous session crashed/i)).toBeTruthy();
  });

  it('calls onOpenSettings when the Opt out link is clicked', async () => {
    crashBannerStore.raise('sigA');
    const onOpenSettings = vi.fn();
    render(CrashReportedBanner, { onOpenSettings });
    await fireEvent.click(screen.getByText(/opt out/i));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('hides when the viewer dismisses', async () => {
    crashBannerStore.raise('sigA');
    render(CrashReportedBanner, {});
    await fireEvent.click(screen.getByLabelText(/dismiss/i));
    expect(screen.queryByText(/previous session crashed/i)).toBeNull();
  });

  it('renders nothing when the opt-out is off, whatever the store says', () => {
    crashReportsPreferenceStore.setEnabled(false);
    crashBannerStore.raise('sigA');
    const { container } = render(CrashReportedBanner, {});
    expect(container.querySelector('.crash-reported-banner')).toBeNull();
  });
});
