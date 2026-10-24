import { render } from '@testing-library/svelte';
import { describe, it, expect } from 'vitest';

import RouteThumbnail from '../lib/ui/RouteThumbnail.svelte';
import type { Coordinate } from '../lib/types/index';

const COORDS: Coordinate[] = [
  { lat: 51.5, lng: -0.1 },
  { lat: 51.51, lng: -0.09 },
  { lat: 51.52, lng: -0.08 },
];

// #542 P1 (F-routes): RouteThumbnail ported to Svelte, same DOM the specs use.
describe('RouteThumbnail.svelte', () => {
  it('renders a placeholder when there are fewer than two coordinates', () => {
    const { container } = render(RouteThumbnail, {
      coordinates: [{ lat: 1, lng: 2 }],
      class: 'route-item-thumbnail',
    });
    const placeholder = container.querySelector('.route-thumbnail--placeholder');
    expect(placeholder).not.toBeNull();
    // The incoming class is threaded through, as React did.
    expect(placeholder!.classList.contains('route-item-thumbnail')).toBe(true);
    expect(container.querySelector('svg.route-thumbnail')).toBeNull();
  });

  it('renders the polyline preview for a real route', () => {
    const { container } = render(RouteThumbnail, {
      coordinates: COORDS,
      class: 'route-item-thumbnail',
    });
    const wrap = container.querySelector('[data-testid="route-thumbnail-wrap"]');
    expect(wrap).not.toBeNull();
    expect(wrap!.classList.contains('route-item-thumbnail')).toBe(true);
    const line = container.querySelector('polyline.route-thumbnail-line');
    expect(line).not.toBeNull();
    // Points are projected and sampled, so there is a non-empty coordinate list.
    expect(line!.getAttribute('points')).toMatch(/\d/);
  });

  it('draws the OSM tile backdrop when showBackdrop is set', () => {
    const { container } = render(RouteThumbnail, {
      coordinates: COORDS,
      showBackdrop: true,
    });
    const backdrop = container.querySelector('[data-testid="route-thumbnail-backdrop"]');
    expect(backdrop).not.toBeNull();
    expect(backdrop!.getAttribute('src')).toBeTruthy();
  });
});
