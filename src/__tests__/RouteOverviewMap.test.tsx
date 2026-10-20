import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { RouteOverviewMap } from '../components/RouteOverviewMap';
import type { WaterRoute } from '../lib/types/index';

const route = (over: Partial<WaterRoute>): WaterRoute => ({
  id: 'r1',
  name: 'A',
  description: '',
  distance: 2,
  difficulty: 'easy',
  location: '',
  coordinates: [{ lat: 51, lng: -0.5 }, { lat: 51.1, lng: -0.4 }],
  elevationGain: 0,
  estimatedTime: 10,
  tags: [],
  createdAt: new Date(0),
  ...over,
});

describe('RouteOverviewMap', () => {
  afterEach(() => cleanup());

  // Well-separated so Phase 2b's wide-zoom clustering keeps them as singletons.
  const farApartRoutes = [
    route({ id: 'r1', coordinates: [{ lat: 51.5, lng: -0.1 }] }),
    route({ id: 'r2', coordinates: [{ lat: 40.7, lng: -74 }] }),
  ];

  it('renders one pin per route with its id as a data attribute', () => {
    render(<RouteOverviewMap routes={farApartRoutes} defaultRouteId={null} selectedRouteId={null} onSelect={() => {}} />);
    const pins = screen.getAllByTestId('route-pin');
    expect(pins).toHaveLength(2);
    expect(pins.map((p) => p.getAttribute('data-route-id')).sort()).toEqual(['r1', 'r2']);
  });

  it('marks the default route pin with data-default="true"', () => {
    render(<RouteOverviewMap routes={farApartRoutes} defaultRouteId="r2" selectedRouteId={null} onSelect={() => {}} />);
    const [, r2] = screen.getAllByTestId('route-pin').sort((a, b) =>
      (a.getAttribute('data-route-id') ?? '').localeCompare(b.getAttribute('data-route-id') ?? ''),
    );
    expect(r2.getAttribute('data-default')).toBe('true');
  });

  it('dims pins whose route is filtered out, keeping the pin so counts match the catalogue', () => {
    render(
      <RouteOverviewMap
        routes={farApartRoutes}
        defaultRouteId={null}
        selectedRouteId={null}
        onSelect={() => {}}
        dimmedRouteIds={new Set(['r2'])}
      />,
    );
    const r1 = screen.getAllByTestId('route-pin').find((p) => p.getAttribute('data-route-id') === 'r1');
    const r2 = screen.getAllByTestId('route-pin').find((p) => p.getAttribute('data-route-id') === 'r2');
    expect(r1?.getAttribute('data-dimmed')).toBe('false');
    expect(r2?.getAttribute('data-dimmed')).toBe('true');
  });

  it('renders a cluster bubble when routes sit on top of each other at the overview zoom', () => {
    const stacked = [
      route({ id: 'a', coordinates: [{ lat: 51.5, lng: -0.1 }] }),
      route({ id: 'b', coordinates: [{ lat: 51.5001, lng: -0.1001 }] }),
      route({ id: 'c', coordinates: [{ lat: 51.5002, lng: -0.1002 }] }),
    ];
    render(<RouteOverviewMap routes={stacked} defaultRouteId={null} selectedRouteId={null} onSelect={() => {}} />);
    const clusters = screen.getAllByTestId('route-cluster');
    expect(clusters).toHaveLength(1);
    expect(clusters[0].getAttribute('data-cluster-count')).toBe('3');
    // No route-pin rendered for the clustered members at this zoom.
    expect(screen.queryAllByTestId('route-pin')).toHaveLength(0);
  });

  it('calls onSelect with the route when its pin is clicked', () => {
    const onSelect = vi.fn();
    const r1 = route({ id: 'r1', coordinates: [{ lat: 51.5, lng: -0.1 }] });
    render(<RouteOverviewMap routes={[r1]} defaultRouteId={null} selectedRouteId={null} onSelect={onSelect} />);
    screen.getByTestId('route-pin').click();
    expect(onSelect).toHaveBeenCalledWith(r1);
  });

  it('skips a route with no coordinates (no pin to place)', () => {
    const routes = [route({ id: 'r1' }), route({ id: 'r2', coordinates: [] })];
    render(<RouteOverviewMap routes={routes} defaultRouteId={null} selectedRouteId={null} onSelect={() => {}} />);
    const pins = screen.getAllByTestId('route-pin');
    expect(pins).toHaveLength(1);
    expect(pins[0].getAttribute('data-route-id')).toBe('r1');
  });

  it('shows OpenStreetMap attribution when any pin is rendered', () => {
    render(<RouteOverviewMap routes={[route({})]} defaultRouteId={null} selectedRouteId={null} onSelect={() => {}} />);
    expect(screen.getByTestId('route-overview-attribution').textContent).toMatch(/OpenStreetMap/i);
  });
});
