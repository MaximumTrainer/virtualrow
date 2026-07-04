import { describe, it, expect } from 'vitest';
import { routeService } from '../services/routeService';

// Willowbrook River bounding box
const WILLOWBROOK_BBOX = { minLat: 48.1200, maxLat: 48.1634, minLng: 11.5750, maxLng: 11.5862 };

describe('RouteService basic data', () => {
  it('provides only the Willowbrook River demo route by default', () => {
    const routes = routeService.getAllRoutes();
    expect(routes).toHaveLength(1);
    expect(routes[0]?.id).toBe('1');
  });
  
  it('provides Willowbrook River route with distance and coordinates', () => {
    const routes = routeService.getAllRoutes();
    
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
    expect(newRoute.source).toBeUndefined();
    const found = routeService.searchRoutes('Test Custom');
    expect(found.some(r => r.id === newRoute.id)).toBe(true);
  });

  it('creates a rownative route with source metadata', () => {
    const route = routeService.importRouteFromRownative({
      id: '99',
      name: 'Sample Rownative Course',
      country: 'Netherlands',
      distanceMeters: 5000,
      coordinates: [
        { lat: 52.37, lng: 4.89 },
        { lat: 52.38, lng: 4.9 },
      ],
      status: 'established',
    });

    expect(route.source).toBe('rownative');
    expect(route.distance).toBe(5);
    expect(route.tags).toContain('rownative');
    expect(route.tags).toContain('status:established');
  });

  it('does not add a status tag when rownative status is missing', () => {
    const route = routeService.importRouteFromRownative({
      id: '100',
      name: 'Statusless Course',
      country: 'Canada',
      distanceMeters: 3000,
      coordinates: [
        { lat: 45.42, lng: -75.69 },
        { lat: 45.43, lng: -75.68 },
      ],
    });

    expect(route.tags).toContain('rownative');
    expect(route.tags.some((tag) => tag.startsWith('status:'))).toBe(false);
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

describe('RouteService KML import', () => {
  it('imports a single-placemark KML route', () => {
    const kml = `<?xml version="1.0"?><kml><Document><Placemark><name>Test Route</name><LineString><coordinates>-73.962,40.786 -73.961,40.787 -73.960,40.788</coordinates></LineString></Placemark></Document></kml>`;
    const result = routeService.importRouteFromKML(kml, { difficulty: 'easy' });
    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.route.coordinates.length).toBe(3);
      expect(result.route.name).toBe('Test Route');
      expect(result.route.source).toBe('imported');
    }
  });

  it('extracts name from <name> element and ignores altitude', () => {
    const kml = `<?xml version="1.0"?><kml><Document><Placemark><name>Altitude Route</name><LineString><coordinates>-73.962,40.786,10 -73.961,40.787,20</coordinates></LineString></Placemark></Document></kml>`;
    const result = routeService.importRouteFromKML(kml, {});
    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.route.coordinates.length).toBe(2);
      expect(result.route.name).toBe('Altitude Route');
    }
  });

  it('parses KML with xml namespace declaration', () => {
    const kml = `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><name>Namespaced</name><LineString><coordinates>-73.962,40.786 -73.961,40.787</coordinates></LineString></Placemark></Document></kml>`;
    const result = routeService.importRouteFromKML(kml, {});
    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.route.coordinates.length).toBe(2);
    }
  });

  it('returns selectionRequired for multi-placemark KML', () => {
    const kml = `<?xml version="1.0"?><kml><Document>
      <Placemark><name>Leg 1</name><LineString><coordinates>-73.962,40.786 -73.961,40.787</coordinates></LineString></Placemark>
      <Placemark><name>Leg 2</name><LineString><coordinates>-73.960,40.788 -73.959,40.789</coordinates></LineString></Placemark>
    </Document></kml>`;
    const result = routeService.importRouteFromKML(kml, {});
    expect(result.status).toBe('selectionRequired');
    if (result.status === 'selectionRequired') {
      expect(result.candidates.length).toBe(2);
      expect(result.candidates[0].name).toBe('Leg 1');
      expect(result.candidates[1].name).toBe('Leg 2');
    }
  });

  it('finalizeKMLImport creates a route from a candidate', () => {
    const candidate = { name: 'Selected', description: 'desc', coordinates: [{ lat: 40.786, lng: -73.962 }, { lat: 40.787, lng: -73.961 }] };
    const route = routeService.finalizeKMLImport(candidate, { difficulty: 'hard' });
    expect(route.name).toBe('Selected');
    expect(route.difficulty).toBe('hard');
    expect(route.coordinates.length).toBe(2);
  });

  it('returns error for invalid XML', () => {
    const result = routeService.importRouteFromKML('<not valid xml <<<', {});
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.error).toMatch(/invalid xml/i);
    }
  });

  it('returns error for non-KML XML', () => {
    const result = routeService.importRouteFromKML('<?xml version="1.0"?><gpx><trk></trk></gpx>', {});
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.error).toMatch(/kml/i);
    }
  });

  it('returns error when no Placemark elements present', () => {
    const result = routeService.importRouteFromKML('<?xml version="1.0"?><kml><Document></Document></kml>', {});
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.error).toMatch(/placemark/i);
    }
  });

  it('returns error when no LineString with ≥2 valid points found', () => {
    const result = routeService.importRouteFromKML('<?xml version="1.0"?><kml><Document><Placemark><name>Bad</name><LineString><coordinates>-73.962,40.786</coordinates></LineString></Placemark></Document></kml>', {});
    expect(result.status).toBe('error');
  });

  it('skips malformed coordinate tuples (e.g. -122.1,abc,0)', () => {
    const kml = `<?xml version="1.0"?><kml><Document><Placemark><name>Mixed</name><LineString><coordinates>-73.962,40.786 -73.961,abc,0 -73.960,40.788</coordinates></LineString></Placemark></Document></kml>`;
    const result = routeService.importRouteFromKML(kml, {});
    expect(result.status).toBe('success');
    if (result.status === 'success') {
      // Malformed tuple is skipped; valid points remain
      expect(result.route.coordinates.length).toBe(2);
    }
  });

  it('handles coordinates with tabs and multiple spaces', () => {
    const kml = `<?xml version="1.0"?><kml><Document><Placemark><name>Whitespace</name><LineString><coordinates>
      -73.962,40.786,0\t\t-73.961,40.787,0
      -73.960,40.788,0
    </coordinates></LineString></Placemark></Document></kml>`;
    const result = routeService.importRouteFromKML(kml, {});
    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.route.coordinates.length).toBe(3);
    }
  });

  it('overrides KML name with meta.name when provided', () => {
    const kml = `<?xml version="1.0"?><kml><Document><Placemark><name>KML Name</name><LineString><coordinates>-73.962,40.786 -73.961,40.787</coordinates></LineString></Placemark></Document></kml>`;
    const result = routeService.importRouteFromKML(kml, { name: 'Custom Name' });
    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.route.name).toBe('Custom Name');
    }
  });

  it('uses Document-level name as fallback when Placemark has no name', () => {
    const kml = `<?xml version="1.0"?><kml><Document><name>Doc Name</name><Placemark><LineString><coordinates>-73.962,40.786 -73.961,40.787</coordinates></LineString></Placemark></Document></kml>`;
    const result = routeService.importRouteFromKML(kml, {});
    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.route.name).toBe('Doc Name');
    }
  });
});
