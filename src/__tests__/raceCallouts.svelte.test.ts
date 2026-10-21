import { render, screen } from '@testing-library/svelte';
import { describe, it, expect } from 'vitest';

import StartCallout from '../lib/ui/StartCallout.svelte';
import FinishBanner from '../lib/ui/FinishBanner.svelte';

// #542 P1 workout view: the race callouts (#336) ported to Svelte, same
// DOM/classes/data-testids/copy so the Playwright selectors keep resolving.
describe('StartCallout.svelte', () => {
  it('renders nothing before the sequence arms', () => {
    const { container } = render(StartCallout, { phase: 'idle', countdown: null });
    expect(container.querySelector('[data-testid="start-callout"]')).toBeNull();
  });

  it('renders nothing once the rower is rowing', () => {
    const { container } = render(StartCallout, { phase: 'rowing', countdown: null });
    expect(container.querySelector('[data-testid="start-callout"]')).toBeNull();
  });

  it('shows the ready prompt when armed', () => {
    render(StartCallout, { phase: 'armed', countdown: null });
    const el = screen.getByTestId('start-callout');
    expect(el.getAttribute('data-phase')).toBe('armed');
    const span = el.querySelector('span')!;
    expect(span.className).toBe('race-callout-prompt');
    expect(span.textContent).toBe('Ready — take your first stroke');
  });

  it('shows the countdown number as a count while counting', () => {
    render(StartCallout, { phase: 'counting', countdown: 3 });
    const el = screen.getByTestId('start-callout');
    expect(el.getAttribute('data-phase')).toBe('counting');
    const span = el.querySelector('span')!;
    expect(span.className).toBe('race-callout-count');
    expect(span.textContent).toBe('3');
  });

  it('shows Row! on go', () => {
    render(StartCallout, { phase: 'go', countdown: null });
    const span = screen.getByTestId('start-callout').querySelector('span')!;
    expect(span.className).toBe('race-callout-count');
    expect(span.textContent).toBe('Row!');
  });
});

describe('FinishBanner.svelte', () => {
  it('shows the distance grouped by thousands and the elapsed time', () => {
    render(FinishBanner, { distanceMeters: 2000, elapsedMs: 8 * 60_000 + 12_000 });
    const banner = screen.getByTestId('finish-banner');
    expect(banner.className).toBe('race-callout race-callout--finish');
    expect(banner.getAttribute('role')).toBe('status');
    expect(banner.querySelector('.race-callout-prompt')?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'Finished — 2 000 m in 8:12',
    );
  });
});
