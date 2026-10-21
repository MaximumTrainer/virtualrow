import { render, screen } from '@testing-library/svelte';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { tick } from 'svelte';

import RouteLoadingBar from '../lib/ui/RouteLoadingBar.svelte';
import {
  BOAT_UNAVAILABLE_MESSAGE,
  type LoadProgress,
} from '../lib/utils/loadingProgress';

function progress(over: Partial<LoadProgress> = {}): LoadProgress {
  return {
    percent: 40,
    phase: 'Preparing the scene',
    complete: false,
    failed: [],
    ...over,
  };
}

// #542 P1 workout view: RouteLoadingBar (#318) ported to Svelte, same DOM/ARIA.
describe('RouteLoadingBar.svelte', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders a real progressbar carrying the percent and phase while loading', () => {
    const { container } = render(RouteLoadingBar, { progress: progress({ percent: 42, phase: 'Fetching the 3D view' }) });

    expect(container.querySelector('.route-loading')?.getAttribute('data-loaded')).toBe('loading');
    const bar = container.querySelector('[role="progressbar"]')!;
    expect(bar.getAttribute('aria-label')).toBe('Loading the 3D view');
    expect(bar.getAttribute('aria-valuemin')).toBe('0');
    expect(bar.getAttribute('aria-valuemax')).toBe('100');
    expect(bar.getAttribute('aria-valuenow')).toBe('42');
    expect(bar.getAttribute('aria-valuetext')).toBe('Fetching the 3D view');
    expect((container.querySelector('.route-loading-fill') as HTMLElement).style.width).toBe('42%');
    expect(container.querySelector('.route-loading-phase')?.textContent).toContain('Fetching the 3D view');
    expect(container.querySelector('.route-loading-percent')?.textContent).toContain('42%');
    expect(container.querySelector('.route-loading-warning')).toBeNull();
  });

  it('renders nothing when it mounts already complete and the boat is present', () => {
    const { container } = render(RouteLoadingBar, { progress: progress({ complete: true, percent: 100 }) });
    expect(container.querySelector('.route-loading')).toBeNull();
  });

  it('holds the finished bar briefly after a load completes, then dismisses it', async () => {
    vi.useFakeTimers();
    const { container, rerender } = render(RouteLoadingBar, { progress: progress({ complete: false, percent: 90 }) });
    expect(container.querySelector('[role="progressbar"]')).not.toBeNull();

    await rerender({ progress: progress({ complete: true, percent: 100 }) });
    await tick();
    // Held up on the transition, now marked loaded.
    expect(container.querySelector('.route-loading')?.getAttribute('data-loaded')).toBe('loaded');
    expect(container.querySelector('[role="progressbar"]')).not.toBeNull();

    vi.advanceTimersByTime(400);
    await tick();
    expect(container.querySelector('.route-loading')).toBeNull();
  });

  it('keeps the boat-unavailable warning after the bar is gone', () => {
    const { container } = render(RouteLoadingBar, {
      progress: progress({ complete: true, percent: 100, failed: ['boat'] }),
    });
    // The bar is not held (mounted complete), but the warning stands.
    expect(container.querySelector('[role="progressbar"]')).toBeNull();
    const warning = screen.getByRole('status');
    expect(warning.textContent).toContain(BOAT_UNAVAILABLE_MESSAGE);
  });

  it('shows the warning alongside the bar while still loading with a failed boat', () => {
    const { container } = render(RouteLoadingBar, {
      progress: progress({ complete: false, percent: 60, failed: ['boat'] }),
    });
    expect(container.querySelector('[role="progressbar"]')).not.toBeNull();
    expect(container.querySelector('.route-loading-warning')?.textContent).toContain(BOAT_UNAVAILABLE_MESSAGE);
  });
});
