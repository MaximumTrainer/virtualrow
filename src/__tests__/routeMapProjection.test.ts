import { describe, it, expect } from 'vitest';
import { RouteService } from '../services/routeService';
import { latLngToMeters } from '../utils/geoUtils';
import {
  computeRouteMapPadding,
  createRouteMapTransform,
  type RouteMetreBounds,
} from '../components/routeMapProjection';
import type { Coordinate } from '../types/index';

/**
 * KV-2.3 (#191) — an imported route draws inside the map, at any size.
 *
 * The criterion was written for a Leaflet polyline and "viewport bounds at
 * initial zoom". There is no Leaflet: the map is a canvas that fits the route
 * to itself, so the equivalent property is that every projected point lands
 * inside the padded drawing area, whatever the route's shape and whatever the
 * canvas's aspect ratio.
 */

const boundsOf = (coordinates: Coordinate[]): { bounds: RouteMetreBounds; points: { x: number; y: number }[] } => {
  const originLat = coordinates[0].lat;
  const originLng = coordinates[0].lng;
  const points = coordinates.map((c) => {
    const p = latLngToMeters(c.lat, c.lng, originLat, originLng);
    return { x: p.x, y: p.y };
  });

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  return {
    points,
    bounds: { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY },
  };
};

/** The canvas sizes the app actually renders at, plus degenerate extremes. */
const CANVAS_SIZES = [
  { name: 'route card', width: 320, height: 200 },
  { name: 'mini-map (#195)', width: 148, height: 110 },
  { name: 'full map', width: 900, height: 520 },
  { name: 'very wide', width: 1200, height: 90 },
  { name: 'very tall', width: 90, height: 1200 },
  { name: 'square', width: 400, height: 400 },
];

const kmlWith = (coordinates: string) =>
  `<?xml version="1.0"?><kml><Document><Placemark><name>Projection</name>` +
  `<LineString><coordinates>${coordinates}</coordinates></LineString>` +
  `</Placemark></Document></kml>`;

/** A meandering imported route, in lon,lat order as KML stores it. */
const importedRoute = () => {
  const service = new RouteService();
  const tuples: string[] = [];
  for (let i = 0; i < 60; i++) {
    const lng = -1.2 + i * 0.0009;
    const lat = 51.5 + Math.sin(i / 6) * 0.004;
    tuples.push(`${lng},${lat}`);
  }
  const result = service.importRouteFromKML(kmlWith(tuples.join(' ')), {});
  if (result.status !== 'success') throw new Error('fixture failed to import');
  return result.route;
};

describe('route map projection (KV-2.3)', () => {
  it('keeps every point of an imported route inside the canvas', () => {
    const route = importedRoute();
    const { points, bounds } = boundsOf(route.coordinates);

    for (const canvas of CANVAS_SIZES) {
      const { toCanvas } = createRouteMapTransform(bounds, canvas);
      for (const point of points) {
        const { x, y } = toCanvas(point.x, point.y);
        expect(Number.isFinite(x), `${canvas.name} x`).toBe(true);
        expect(Number.isFinite(y), `${canvas.name} y`).toBe(true);
        expect(x, `${canvas.name} x >= 0`).toBeGreaterThanOrEqual(-1e-6);
        expect(x, `${canvas.name} x <= width`).toBeLessThanOrEqual(canvas.width + 1e-6);
        expect(y, `${canvas.name} y >= 0`).toBeGreaterThanOrEqual(-1e-6);
        expect(y, `${canvas.name} y <= height`).toBeLessThanOrEqual(canvas.height + 1e-6);
      }
    }
  });

  it('respects the padding on the axis the route fills', () => {
    const route = importedRoute();
    const { points, bounds } = boundsOf(route.coordinates);
    const canvas = { width: 900, height: 520 };
    const { toCanvas } = createRouteMapTransform(bounds, canvas);
    const padding = computeRouteMapPadding(canvas);

    for (const point of points) {
      const { x, y } = toCanvas(point.x, point.y);
      expect(x).toBeGreaterThanOrEqual(padding - 1e-6);
      expect(x).toBeLessThanOrEqual(canvas.width - padding + 1e-6);
      expect(y).toBeGreaterThanOrEqual(padding - 1e-6);
      expect(y).toBeLessThanOrEqual(canvas.height - padding + 1e-6);
    }
  });

  it('centres the route rather than pinning it to a corner', () => {
    const route = importedRoute();
    const { points, bounds } = boundsOf(route.coordinates);
    const canvas = { width: 900, height: 520 };
    const { toCanvas } = createRouteMapTransform(bounds, canvas);

    const projected = points.map((p) => toCanvas(p.x, p.y));
    const left = Math.min(...projected.map((p) => p.x));
    const right = canvas.width - Math.max(...projected.map((p) => p.x));
    const top = Math.min(...projected.map((p) => p.y));
    const bottom = canvas.height - Math.max(...projected.map((p) => p.y));

    expect(left).toBeCloseTo(right, 4);
    expect(top).toBeCloseTo(bottom, 4);
  });

  it('scales both axes equally, so the route is not stretched', () => {
    // A route drawn with an axis-independent fit would report a shape it does
    // not have — a straight reach would bend, a square loop would flatten.
    const route = importedRoute();
    const { points, bounds } = boundsOf(route.coordinates);
    const { toCanvas, scale } = createRouteMapTransform(bounds, { width: 1200, height: 90 });

    const first = toCanvas(points[0].x, points[0].y);
    const last = toCanvas(points[points.length - 1].x, points[points.length - 1].y);
    const metreDx = points[points.length - 1].x - points[0].x;
    const metreDy = points[points.length - 1].y - points[0].y;

    expect(last.x - first.x).toBeCloseTo(metreDx * scale, 4);
    expect(first.y - last.y).toBeCloseTo(metreDy * scale, 4);
  });

  it('does not divide by zero for a route with no extent', () => {
    // Two identical points: degenerate, but the map must still draw something
    // rather than emit NaN into the canvas.
    const bounds: RouteMetreBounds = { minX: 0, maxX: 0, minY: 0, maxY: 0, width: 0, height: 0 };
    const { toCanvas } = createRouteMapTransform(bounds, { width: 320, height: 200 });
    const { x, y } = toCanvas(0, 0);

    expect(Number.isFinite(x)).toBe(true);
    expect(Number.isFinite(y)).toBe(true);
  });

  it('shrinks the padding on a small canvas so the route keeps room', () => {
    // #195: a fixed 40px left the mini-map 68x30 of usable area.
    const mini = computeRouteMapPadding({ width: 148, height: 110 });
    const full = computeRouteMapPadding({ width: 900, height: 520 });

    expect(mini).toBeLessThan(full);
    expect(148 - mini * 2).toBeGreaterThan(110);
  });
});
