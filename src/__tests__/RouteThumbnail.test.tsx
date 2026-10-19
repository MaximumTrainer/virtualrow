import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { RouteThumbnail } from '../components/RouteThumbnail';

const coords = [
  { lat: 51.5, lng: -0.1 },
  { lat: 51.51, lng: -0.11 },
  { lat: 51.52, lng: -0.12 },
];

describe('RouteThumbnail', () => {
  afterEach(() => cleanup());

  it('renders a polyline for a route with ≥ 2 coordinates', () => {
    const { container } = render(<RouteThumbnail coordinates={coords} />);
    const line = container.querySelector('polyline.route-thumbnail-line');
    expect(line).not.toBeNull();
    expect(line?.getAttribute('points')?.split(/\s+/).length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it('renders a placeholder when there are not enough coordinates', () => {
    const { container } = render(<RouteThumbnail coordinates={[]} />);
    expect(container.querySelector('.route-thumbnail--placeholder')).not.toBeNull();
    expect(container.querySelector('polyline')).toBeNull();
  });

  it('omits the OSM backdrop by default', () => {
    render(<RouteThumbnail coordinates={coords} />);
    expect(screen.queryByTestId('route-thumbnail-backdrop')).toBeNull();
  });

  it('renders an OSM tile img when showBackdrop is true', () => {
    render(<RouteThumbnail coordinates={coords} showBackdrop />);
    const img = screen.getByTestId('route-thumbnail-backdrop') as HTMLImageElement;
    expect(img.src).toMatch(/^https:\/\/tile\.openstreetmap\.org\/\d+\/\d+\/\d+\.png$/);
    expect(img.getAttribute('loading')).toBe('lazy');
    // The polyline rides on top in the same wrapper.
    expect(screen.getByTestId('route-thumbnail-wrap').querySelector('polyline')).not.toBeNull();
  });

  it('skips the backdrop for a coord-less route even with showBackdrop set', () => {
    render(<RouteThumbnail coordinates={[]} showBackdrop />);
    expect(screen.queryByTestId('route-thumbnail-backdrop')).toBeNull();
  });
});
