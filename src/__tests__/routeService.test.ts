import { describe, it, expect } from 'vitest';
import { routeService } from '../services/routeService';

// Venice bounding box from GPX data
const VENICE_BBOX = { minLat: 45.435777, maxLat: 45.449551, minLng: 12.318319, maxLng: 12.336167 };
// Henley bounding box from GPX data
const HENLEY_BBOX = { minLat: 51.533121, maxLat: 51.560266, minLng: -0.901301, maxLng: -0.885381 };

describe('RouteService basic data', () => {
  it('provides Venice, Henley, Charles River, and Lake Bled routes with distance and coordinates', () => {
    const routes = routeService.getAllRoutes();
    expect(routes.length).toBe(4);
    
    // Venice route
    const venice = routes.find(r => r.id === '1');
    expect(venice?.name).toBe('Venice Grand Canal');
    expect(venice?.distance).toBeCloseTo(3.65, 1);
    expect(venice?.coordinates.length).toBeGreaterThan(150); // Should have ~272 coordinates from GPX
    
    // Henley route
    const henley = routes.find(r => r.id === '2');
    expect(henley?.name).toBe('Henley Regatta Route');
    expect(henley?.distance).toBeCloseTo(7.03, 1);
    expect(henley?.coordinates.length).toBeCloseTo(50, 5); // Should have ~50 coordinates from GPX
    
    // Charles River route
    const charles = routes.find(r => r.id === '3');
    expect(charles?.name).toBe('Charles River Boston');
    expect(charles?.distance).toBeCloseTo(11.07, 1);
    expect(charles?.coordinates.length).toBeGreaterThan(3000); // Should have ~3009 coordinates from GPX
    
    // Lake Bled route
    const bled = routes.find(r => r.id === '4');
    expect(bled?.name).toBe('Lake Bled Circuit');
    expect(bled?.distance).toBeCloseTo(6.24, 1);
    expect(bled?.coordinates.length).toBeGreaterThan(1800); // Should have ~1830 coordinates from GPX
  });

  it('ensures Venice route coordinates lie within Venice bounding box', () => {
    const routes = routeService.getAllRoutes();
    const venice = routes.find(r => r.id === '1')!;
    
    // Check that all coordinates are within Venice bbox (allowing some tolerance for GPS drift)
    const outOfBounds = venice.coordinates.filter(c => 
      c.lat < VENICE_BBOX.minLat - 0.01 || c.lat > VENICE_BBOX.maxLat + 0.01 ||
      c.lng < VENICE_BBOX.minLng - 0.01 || c.lng > VENICE_BBOX.maxLng + 0.01
    );
    
    // Most points should be within bounds (allow up to 10% drift for GPS accuracy)
    expect(outOfBounds.length).toBeLessThan(venice.coordinates.length * 0.1);
  });

  it('ensures Henley route coordinates lie within Henley bounding box', () => {
    const routes = routeService.getAllRoutes();
    const henley = routes.find(r => r.id === '2')!;
    
    // Check that all coordinates are within Henley bbox (allowing some tolerance for GPS drift)
    const outOfBounds = henley.coordinates.filter(c => 
      c.lat < HENLEY_BBOX.minLat - 0.01 || c.lat > HENLEY_BBOX.maxLat + 0.01 ||
      c.lng < HENLEY_BBOX.minLng - 0.01 || c.lng > HENLEY_BBOX.maxLng + 0.01
    );
    
    // Most points should be within bounds (allow up to 10% drift for GPS accuracy)
    expect(outOfBounds.length).toBeLessThan(henley.coordinates.length * 0.1);
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
