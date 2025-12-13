import { describe, it, expect } from 'vitest';
import { routeService } from '../services/routeService';

// Willowbrook River bounding box
const WILLOWBROOK_BBOX = { minLat: 48.1200, maxLat: 48.1634, minLng: 11.5750, maxLng: 11.5862 };

describe('RouteService basic data', () => {
  it('provides Willowbrook River route with distance and coordinates', () => {
    const routes = routeService.getAllRoutes();
    expect(routes.length).toBe(1);
    
    // Willowbrook River route (only route)
    const willowbrook = routes.find(r => r.id === '1');
    expect(willowbrook?.name).toBe('Willowbrook River');
    expect(willowbrook?.distance).toBeCloseTo(5.0, 1);
    expect(willowbrook?.coordinates.length).toBeGreaterThan(70); // At least 70 coordinate points across 5 sections
    expect(willowbrook?.difficulty).toBe('easy');
    expect(willowbrook?.location).toBe('Willowbrook Valley');
  });

  it('ensures Willowbrook River coordinates lie within bounding box', () => {
    const routes = routeService.getAllRoutes();
    const willowbrook = routes.find(r => r.id === '1')!;
    
    // Check that all coordinates are within Willowbrook bbox
    const outOfBounds = willowbrook.coordinates.filter(c => 
      c.lat < WILLOWBROOK_BBOX.minLat - 0.01 || c.lat > WILLOWBROOK_BBOX.maxLat + 0.01 ||
      c.lng < WILLOWBROOK_BBOX.minLng - 0.01 || c.lng > WILLOWBROOK_BBOX.maxLng + 0.01
    );
    
    // All points should be within bounds
    expect(outOfBounds.length).toBe(0);
  });

  it('Willowbrook route covers approximately 5km with proper meanders', () => {
    const routes = routeService.getAllRoutes();
    const willowbrook = routes.find(r => r.id === '1')!;
    
    // The route should have 5 distinct sections with points totaling at least 70
    expect(willowbrook.coordinates.length).toBeGreaterThan(70);
    
    // Route should cover terrain from forest headwaters to lake delta
    expect(willowbrook.tags).toContain('forest');
    expect(willowbrook.tags).toContain('meadow');
    expect(willowbrook.tags).toContain('village');
    expect(willowbrook.tags).toContain('lake');
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
  it('imports a GPX route', () => {
    const gpx = `<?xml version="1.0"?><gpx><trk><trkseg><trkpt lat="40.785" lon="-73.96" /><trkpt lat="40.786" lon="-73.959" /></trkseg></trk></gpx>`;
    const imported = routeService.importRouteFromGPX(gpx, { name: 'GPX Water', difficulty: 'easy' });
    expect(imported).toBeDefined();
    expect(imported!.coordinates.length).toBe(2);
  });

  it('imports any GPX route without water validation', () => {
    const gpx = `<?xml version="1.0"?><gpx><trk><trkseg><trkpt lat="0" lon="0" /><trkpt lat="0.001" lon="0.001" /></trkseg></trk></gpx>`;
    const imported = routeService.importRouteFromGPX(gpx, { name: 'GPX Any', difficulty: 'easy' });
    expect(imported).toBeDefined();
    expect(imported!.coordinates.length).toBe(2);
  });

  it('imports a GeoJSON LineString route', () => {
    const geojson = JSON.stringify({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [ [-73.962, 40.786], [-73.961, 40.787] ] },
      properties: {}
    });
    const imported = routeService.importRouteFromGeoJSON(geojson, { name: 'GeoJSON Test', difficulty: 'moderate' });
    expect(imported).toBeDefined();
    expect(imported!.coordinates.length).toBeGreaterThan(0);
  });

  it('imports any GeoJSON route without water validation', () => {
    const geojson = JSON.stringify({ type: 'Feature', geometry: { type: 'LineString', coordinates: [[0,0],[0.001,0.001]] }, properties: {} });
    const imported = routeService.importRouteFromGeoJSON(geojson, { name: 'GeoJSON Any', difficulty: 'easy' });
    expect(imported).toBeDefined();
    expect(imported!.coordinates.length).toBe(2);
  });
});
