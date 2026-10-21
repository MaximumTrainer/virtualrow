import { render, screen, fireEvent } from '@testing-library/svelte';
import { describe, it, expect, vi } from 'vitest';

import RouteDetailOverlay from '../lib/ui/RouteDetailOverlay.svelte';
import { OUTLINE_ONLY_TAG } from '../lib/services/routeService';
import type { WaterRoute } from '../lib/types/index';

const ROUTE: WaterRoute = {
  id: 'r1',
  name: 'Thames Reach',
  description: 'A calm stretch',
  distance: 5,
  difficulty: 'moderate',
  location: 'London, UK',
  coordinates: [
    { lat: 51.5, lng: -0.1 },
    { lat: 51.51, lng: -0.11 },
  ],
  elevationGain: 0,
  estimatedTime: 20,
  tags: [],
  createdAt: new Date('2020-01-01'),
};

// #542 P1: RouteDetailOverlay ported to Svelte, same DOM/classes/testids.
describe('RouteDetailOverlay.svelte', () => {
  it('renders nothing when route is null', () => {
    const { container } = render(RouteDetailOverlay, {
      route: null,
      onClose: vi.fn(),
      onStartRow: vi.fn(),
    });
    expect(container.querySelector('[data-testid="route-detail-overlay"]')).toBeNull();
  });

  it('shows the route name and controls when given a route', () => {
    const { container } = render(RouteDetailOverlay, {
      route: ROUTE,
      onClose: vi.fn(),
      onStartRow: vi.fn(),
    });
    expect(container.querySelector('[data-testid="route-detail-overlay"]')).not.toBeNull();
    expect(screen.getByText('Thames Reach')).toBeTruthy();
    expect(container.querySelector('.route-detail-overlay__close')).not.toBeNull();
    expect(container.querySelector('[data-testid="route-detail-row"]')).not.toBeNull();
  });

  it('calls onClose from the close button and onStartRow from the row button', async () => {
    const onClose = vi.fn();
    const onStartRow = vi.fn();
    const { container } = render(RouteDetailOverlay, { route: ROUTE, onClose, onStartRow });

    await fireEvent.click(container.querySelector('.route-detail-overlay__close')!);
    expect(onClose).toHaveBeenCalledTimes(1);

    await fireEvent.click(container.querySelector('[data-testid="route-detail-row"]')!);
    expect(onStartRow).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape', async () => {
    const onClose = vi.fn();
    render(RouteDetailOverlay, { route: ROUTE, onClose, onStartRow: vi.fn() });
    await fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes when the backdrop itself is clicked', async () => {
    const onClose = vi.fn();
    const { container } = render(RouteDetailOverlay, { route: ROUTE, onClose, onStartRow: vi.fn() });
    const backdrop = container.querySelector('[data-testid="route-detail-overlay"]')!;
    await fireEvent.click(backdrop); // target === currentTarget
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows the provenance badge and the rownative distance note', () => {
    const route: WaterRoute = {
      ...ROUTE,
      geometrySource: 'gate-chain',
      // 5 km locally vs 8 km upstream → past the discrepancy threshold.
      externalDistanceMeters: 8000,
    };
    const { container } = render(RouteDetailOverlay, { route, onClose: vi.fn(), onStartRow: vi.fn() });
    expect(container.querySelector('.meta-badge--external-distance')?.textContent).toContain(
      'rownative lists',
    );
    // A gate-chain source renders the geometry-provenance badge.
    expect(container.querySelectorAll('.route-detail-overlay__meta .meta-badge').length).toBeGreaterThan(3);
  });

  it('derives the gate-chain source from the outline-only tag', () => {
    const route: WaterRoute = { ...ROUTE, tags: [OUTLINE_ONLY_TAG] };
    const { container } = render(RouteDetailOverlay, { route, onClose: vi.fn(), onStartRow: vi.fn() });
    // No explicit geometrySource, but the tag drives a provenance badge.
    const titled = container.querySelector('.route-detail-overlay__meta .meta-badge[title]');
    expect(titled).not.toBeNull();
  });

  it('renders the empty outline placeholder for a route with too few points', () => {
    const route: WaterRoute = { ...ROUTE, coordinates: [{ lat: 51.5, lng: -0.1 }] };
    const { container } = render(RouteDetailOverlay, { route, onClose: vi.fn(), onStartRow: vi.fn() });
    const outline = container.querySelector('.route-detail-overlay__outline');
    expect(outline).not.toBeNull();
    expect(outline?.getAttribute('aria-hidden')).toBe('true');
  });
});
