import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { RouteOverviewMap } from '../components/RouteOverviewMap';
import type { WaterRoute } from '../types/index';

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

  it('renders one pin per route with its id as a data attribute', () => {
    const routes = [
      route({ id: 'r1' }),
      route({ id: 'r2', coordinates: [{ lat: 52, lng: 1 }] }),
    ];
    render(<RouteOverviewMap routes={routes} defaultRouteId={null} selectedRouteId={null} onSelect={() => {}} />);
    const pins = screen.getAllByTestId('route-pin');
    expect(pins).toHaveLength(2);
    expect(pins.map((p) => p.getAttribute('data-route-id')).sort()).toEqual(['r1', 'r2']);
  });

  it('marks the default route pin with data-default="true"', () => {
    const routes = [route({ id: 'r1' }), route({ id: 'r2', coordinates: [{ lat: 52, lng: 1 }] })];
    render(<RouteOverviewMap routes={routes} defaultRouteId="r2" selectedRouteId={null} onSelect={() => {}} />);
    const [, r2] = screen.getAllByTestId('route-pin').sort((a, b) =>
      (a.getAttribute('data-route-id') ?? '').localeCompare(b.getAttribute('data-route-id') ?? ''),
    );
    expect(r2.getAttribute('data-default')).toBe('true');
  });

  it('dims pins whose route is filtered out, keeping the pin so counts match the catalogue', () => {
    const routes = [
      route({ id: 'r1' }),
      route({ id: 'r2', coordinates: [{ lat: 52, lng: 1 }] }),
    ];
    render(
      <RouteOverviewMap
        routes={routes}
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

  it('calls onSelect with the route when its pin is clicked', () => {
    const onSelect = vi.fn();
    const r1 = route({ id: 'r1' });
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
