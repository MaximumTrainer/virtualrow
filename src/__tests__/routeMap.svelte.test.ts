import { render } from '@testing-library/svelte';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
// jsdom has no real 2D canvas, so `getContext` logs "Not implemented" when
// called for real. Every test here either stubs it to null (the component
// bails gracefully, as it does in a non-canvas browser) or to a recording
// stub, so the real jsdom path is never hit.

import RouteMap from '../lib/ui/RouteMap.svelte';
import type { WaterRoute } from '../lib/types/index';

/** A minimal WaterRoute; only the fields the map reads need real values. */
function route(coordinates: { lat: number; lng: number }[]): WaterRoute {
  return {
    id: 'r1',
    name: 'Test',
    description: '',
    distance: 1,
    difficulty: 'easy',
    location: '',
    coordinates,
    elevationGain: 0,
    estimatedTime: 5,
    tags: [],
    createdAt: new Date(0),
  };
}

const LINE = [
  { lat: 51.5, lng: -0.1 },
  { lat: 51.51, lng: -0.09 },
  { lat: 51.52, lng: -0.08 },
];

/**
 * jsdom gives no real 2D context. A recording stub lets the draw path run end
 * to end so it is exercised rather than short-circuited at `getContext`.
 */
function stubContext() {
  const gradient = { addColorStop: vi.fn() };
  return {
    scale: vi.fn(),
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    fillText: vi.fn(),
    createRadialGradient: vi.fn(() => gradient),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    lineCap: '',
    lineJoin: '',
    globalAlpha: 1,
    font: '',
    textAlign: '',
  } as unknown as CanvasRenderingContext2D;
}

describe('RouteMap.svelte', () => {
  beforeEach(() => {
    // Default: no drawable context (as in a headless/jsdom environment). The
    // "with a drawable 2D context" block overrides this.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the canvas container without a 2D context (jsdom default)', () => {
    const { container } = render(RouteMap, { route: route(LINE) });
    expect(container.querySelector('.route-map-container')).not.toBeNull();
    expect(container.querySelector('.route-map canvas')).not.toBeNull();
  });

  it('adds the highlight-mode modifier only when highlightMode is set', () => {
    const { container } = render(RouteMap, { route: route(LINE), highlightMode: true });
    expect(container.querySelector('.route-map-container.highlight-mode')).not.toBeNull();
  });

  it('does not throw for an empty or single-point route', () => {
    expect(() => render(RouteMap, { route: route([]) })).not.toThrow();
    expect(() => render(RouteMap, { route: route([{ lat: 1, lng: 2 }]) })).not.toThrow();
  });

  describe('with a drawable 2D context', () => {
    let ctx: CanvasRenderingContext2D;
    beforeEach(() => {
      ctx = stubContext();
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
        ctx as unknown as ReturnType<HTMLCanvasElement['getContext']>,
      );
      vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
        width: 200,
        height: 120,
        top: 0,
        left: 0,
        right: 200,
        bottom: 120,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect);
    });

    it('draws the route line and start/end markers', () => {
      render(RouteMap, { route: route(LINE) });
      expect(ctx.clearRect).toHaveBeenCalled();
      expect(ctx.stroke).toHaveBeenCalled();
      // start + end markers are filled arcs.
      expect(ctx.arc).toHaveBeenCalled();
      expect(ctx.fillText).toHaveBeenCalled(); // distance scale (no highlight mode)
    });

    it('omits the distance scale label in highlight mode', () => {
      render(RouteMap, { route: route(LINE), highlightMode: true });
      expect(ctx.fillText).not.toHaveBeenCalled();
    });

    it('draws the completed/remaining split when progressPercent is set', () => {
      render(RouteMap, { route: route(LINE), progressPercent: 50 });
      expect(ctx.stroke).toHaveBeenCalled();
      expect(ctx.arc).toHaveBeenCalled();
    });
  });
});
