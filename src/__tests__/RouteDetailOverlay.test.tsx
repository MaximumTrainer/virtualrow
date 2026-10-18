import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { RouteDetailOverlay } from '../components/RouteDetailOverlay';
import type { WaterRoute } from '../types/index';

const route = (over: Partial<WaterRoute> = {}): WaterRoute => ({
  id: 'r1',
  name: 'Thames tideway',
  description: '',
  distance: 10,
  difficulty: 'moderate',
  location: 'London',
  coordinates: [
    { lat: 51.47, lng: -0.21 },
    { lat: 51.49, lng: -0.11 },
  ],
  elevationGain: 0,
  estimatedTime: 42,
  tags: [],
  createdAt: new Date(0),
  ...over,
});

describe('RouteDetailOverlay', () => {
  afterEach(() => cleanup());

  it('renders nothing when no route is open', () => {
    const { container } = render(
      <RouteDetailOverlay route={null} onClose={() => {}} onStartRow={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the route name, location, distance, time and difficulty', () => {
    render(<RouteDetailOverlay route={route()} onClose={() => {}} onStartRow={() => {}} />);
    expect(screen.getByTestId('route-detail-overlay')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Thames tideway' })).toBeInTheDocument();
    expect(screen.getByText('London')).toBeInTheDocument();
    expect(screen.getByText(/10\.00\s*km/)).toBeInTheDocument();
    expect(screen.getByText(/42\s*min/)).toBeInTheDocument();
    expect(screen.getByText('moderate')).toBeInTheDocument();
  });

  it('fires onStartRow when "Row this route" is clicked', () => {
    const onStartRow = vi.fn();
    render(<RouteDetailOverlay route={route()} onClose={() => {}} onStartRow={onStartRow} />);
    screen.getByRole('button', { name: /Row this route/i }).click();
    expect(onStartRow).toHaveBeenCalledOnce();
  });

  it('fires onClose when the close button is clicked', () => {
    const onClose = vi.fn();
    render(<RouteDetailOverlay route={route()} onClose={onClose} onStartRow={() => {}} />);
    screen.getByRole('button', { name: /close/i }).click();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(<RouteDetailOverlay route={route()} onClose={onClose} onStartRow={() => {}} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('shows OSM attribution so OSM-sourced polygons stay credited', () => {
    render(<RouteDetailOverlay route={route()} onClose={() => {}} onStartRow={() => {}} />);
    expect(screen.getByTestId('route-detail-attribution').textContent).toMatch(/OpenStreetMap/i);
  });
});
