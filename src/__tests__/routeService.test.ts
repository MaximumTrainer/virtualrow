import { describe, it, expect } from 'vitest';
import { routeService } from '../services/routeService';

// Replicate bounding boxes for validation (kept in sync with service for tests)
const BBOXES: Record<string, { minLat: number; maxLat: number; minLng: number; maxLng: number }> = {
  'Lake Tahoe Circuit': { minLat: 38.90, maxLat: 39.25, minLng: -120.16, maxLng: -119.80 },
  'Central Park Loop': { minLat: 40.7816, maxLat: 40.7944, minLng: -73.9659, maxLng: -73.9486 },
  'Thames River Challenge': { minLat: 51.48, maxLat: 51.51, minLng: -0.14, maxLng: -0.06 },
  'Crater Lake Explorer': { minLat: 42.93, maxLat: 42.96, minLng: -122.14, maxLng: -122.07 },
  'Finger Lakes Sprint': { minLat: 42.73, maxLat: 42.79, minLng: -76.86, maxLng: -76.80 },
  'Boston Harbor Classic': { minLat: 42.33, maxLat: 42.38, minLng: -71.08, maxLng: -70.99 },
  'Henley Regatta Route': { minLat: 51.53, maxLat: 51.55, minLng: -0.77, maxLng: -0.75 },
  'Venice Grand Canal': { minLat: 45.43, maxLat: 45.45, minLng: 12.33, maxLng: 12.35 },
};

describe('RouteService basic data', () => {
  it('provides initial routes with distances and coordinates', () => {
    const routes = routeService.getAllRoutes();
    expect(routes.length).toBeGreaterThan(0);
    for (const r of routes) {
      expect(typeof r.distance).toBe('number');
      expect(r.coordinates.length).toBeGreaterThan(0);
    }
  });

  it('ensures majority of route coordinates lie within declared water bounding boxes (>=60%)', () => {
    const routes = routeService.getAllRoutes();
    for (const r of routes) {
      const bbox = BBOXES[r.name];
      if (!bbox) continue; // skip if not a known mapping
      const inBox = r.coordinates.filter(c => c.lat >= bbox.minLat && c.lat <= bbox.maxLat && c.lng >= bbox.minLng && c.lng <= bbox.maxLng).length;
      const ratio = inBox / r.coordinates.length;
      expect(ratio).toBeGreaterThanOrEqual(0.6);
    }
  });
});

describe('RouteService creation & search', () => {
  it('creates a custom route and computes distance', () => {
    const newRoute = routeService.createRoute({
      name: 'Test Custom',
      description: 'Test route',
      location: 'Testland',
      difficulty: 'easy',
      coordinates: [
        { lat: 40.785, lng: -73.96 },
        { lat: 40.786, lng: -73.959 },
        { lat: 40.787, lng: -73.958 },
      ],
      tags: ['test'],
      imageUrl: undefined,
    });
    expect(newRoute.distance).toBeGreaterThan(0);
    const found = routeService.searchRoutes('Test Custom');
    expect(found.some(r => r.id === newRoute.id)).toBe(true);
  });
});

describe('RouteService import routines', () => {
  it('imports a GPX route in water', () => {
    const gpx = `<?xml version="1.0"?><gpx><trk><trkseg><trkpt lat="40.785" lon="-73.96" /><trkpt lat="40.786" lon="-73.959" /></trkseg></trk></gpx>`;
    const imported = routeService.importRouteFromGPX(gpx, { name: 'GPX Water', difficulty: 'easy' });
    expect(imported).toBeDefined();
    expect(imported!.coordinates.length).toBe(2);
  });

  it('rejects a GPX route out of water unless forced', () => {
    const gpx = `<?xml version="1.0"?><gpx><trk><trkseg><trkpt lat="0" lon="0" /><trkpt lat="0.001" lon="0.001" /></trkseg></trk></gpx>`;
    const normal = routeService.importRouteFromGPX(gpx, { name: 'GPX Land', difficulty: 'easy' });
    expect(normal).toBeUndefined();
    const forced = routeService.importRouteFromGPX(gpx, { name: 'GPX Land Forced', difficulty: 'easy' }, true);
    expect(forced).toBeDefined();
  });

  it('imports a GeoJSON LineString route in water', () => {
    const geojson = JSON.stringify({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [ [-73.962, 40.786], [-73.961, 40.787] ] },
      properties: {}
    });
    const imported = routeService.importRouteFromGeoJSON(geojson, { name: 'GeoJSON Water', difficulty: 'moderate' });
    expect(imported).toBeDefined();
    expect(imported!.coordinates.length).toBeGreaterThan(0);
  });

  it('rejects GeoJSON out of water unless forced', () => {
    const geojson = JSON.stringify({ type: 'Feature', geometry: { type: 'LineString', coordinates: [[0,0],[0.001,0.001]] }, properties: {} });
    const normal = routeService.importRouteFromGeoJSON(geojson, { name: 'GeoJSON Land', difficulty: 'easy' });
    expect(normal).toBeUndefined();
    const forced = routeService.importRouteFromGeoJSON(geojson, { name: 'GeoJSON Land Forced', difficulty: 'easy' }, true);
    expect(forced).toBeDefined();
  });
});
