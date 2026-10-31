import { render, fireEvent } from '@testing-library/svelte';
import { describe, it, expect, vi } from 'vitest';

import RouteOverviewMap from '../lib/ui/RouteOverviewMap.svelte';
import type { WaterRoute } from '../lib/types/index';

/** A minimal WaterRoute; only the fields the map reads need real values. */
function route(id: string, name: string, lat: number, lng: number): WaterRoute {
  return {
    id,
    name,
    description: '',
    distance: 1,
    difficulty: 'easy',
    location: '',
    coordinates: [
      { lat, lng },
      { lat: lat + 0.01, lng: lng + 0.01 },
    ],
    elevationGain: 0,
    estimatedTime: 5,
    tags: [],
    createdAt: new Date(0),
  };
}

// #542 P1: RouteOverviewMap ported to Svelte. In jsdom MapLibre never
// initialises, so the component renders its SVG-fallback pin layer — which is
// the DOM the Playwright selectors read.
describe('RouteOverviewMap.svelte', () => {
  const ROUTES = [
    route('uk', 'Thames', 51.5, -1.0),
    route('au', 'Swan River', -33.0, 151.0),
  ];

  it('renders the map surface and an OSM attribution when there are pins', () => {
    const { container } = render(RouteOverviewMap, {
      routes: ROUTES,
      defaultRouteId: null,
      selectedRouteId: null,
      onSelect: vi.fn(),
    });
    expect(container.querySelector('[data-testid="route-overview-map"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="route-overview-attribution"]')).not.toBeNull();
  });

  it('renders a pin per well-separated route and selects it on click', async () => {
    const onSelect = vi.fn();
    const { container } = render(RouteOverviewMap, {
      routes: ROUTES,
      defaultRouteId: 'uk',
      selectedRouteId: null,
      onSelect,
    });

    const pins = container.querySelectorAll('[data-testid="route-pin"]');
    expect(pins.length).toBe(2);

    const ukPin = container.querySelector('[data-route-id="uk"]');
    expect(ukPin).not.toBeNull();
    expect(ukPin!.getAttribute('data-default')).toBe('true');

    await fireEvent.click(ukPin!);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0]).toMatchObject({ id: 'uk' });
  });
});
