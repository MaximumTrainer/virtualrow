import { describe, it, expect } from 'vitest';
import { routeService } from '../services/routeService';
import { polylineLengthMeters } from '../utils/coordinateUtils';

// Willowbrook River bounding box
const WILLOWBROOK_BBOX = { minLat: 48.1200, maxLat: 48.1634, minLng: 11.5750, maxLng: 11.5862 };

describe('RouteService basic data', () => {
  it('provides only the Willowbrook demo route', () => {
    const routes = routeService.getAllRoutes();
    expect(routes.length).toBe(1);
    expect(routes[0].id).toBe('1');
    expect(routes[0].name).toBe('Willowbrook River');
    expect(routes[0].distance).toBeCloseTo(5.0, 1);
    expect(routes[0].difficulty).toBe('easy');
    expect(routes[0].coordinates.length).toBeGreaterThan(70);
    expect(routes[0].tags).toContain('river');
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
      externalDistanceMeters: 5000,
      geometrySource: 'gate-chain',
      coordinates: [
        { lat: 52.37, lng: 4.89 },
        { lat: 52.38, lng: 4.9 },
      ],
      status: 'established',
    });

    expect(route.source).toBe('rownative');
    // Distance is measured from the geometry, not taken from distance_m (R-5).
    expect(Math.abs(route.distance * 1000 - polylineLengthMeters(route.coordinates))).toBeLessThan(1);
    expect(route.externalDistanceMeters).toBe(5000);
    expect(route.tags).toContain('rownative');
    expect(route.tags).toContain('status:established');
  });

  it('records the originating course id so repeat imports can be de-duplicated', () => {
    const route = routeService.importRouteFromRownative({
      id: '4242',
      name: 'Dedupe Course',
      country: 'Netherlands',
      externalDistanceMeters: 5000,
      geometrySource: 'gate-chain',
      coordinates: [{ lat: 52.37, lng: 4.89 }, { lat: 52.38, lng: 4.9 }],
    });

    expect(route.externalId).toBe('4242');
    expect(routeService.findRouteByRownativeId('4242')?.id).toBe(route.id);
    expect(routeService.findRouteByRownativeId('not-imported')).toBeUndefined();
  });

  it('marks a gate-chain course as an outline and densifies its centreline (RF-1)', () => {
    const route = routeService.importRouteFromRownative({
      id: '1',
      name: 'Quinsig South to North',
      country: 'United States',
      externalDistanceMeters: 5306,
      geometrySource: 'gate-chain',
      // Two gate centroids, as rownative course 1 actually supplies.
      coordinates: [{ lat: 42.24, lng: -71.81 }, { lat: 42.28766, lng: -71.81 }],
      status: 'established',
    });

    expect(route.tags).toContain('outline-only');
    expect(route.tags).toContain('geometry:gate-chain');
    expect(Math.abs(route.distance * 1000 - polylineLengthMeters(route.coordinates))).toBeLessThan(1);
    expect(route.coordinates.length).toBeGreaterThanOrEqual(100);
    expect(route.coordinates[0]).toEqual({ lat: 42.24, lng: -71.81 });
  });

  it('does not mark a course with real geometry as an outline, however few points it has', () => {
    // Point count no longer decides the badge — provenance does (R-10).
    const route = routeService.importRouteFromRownative({
      id: '555',
      name: 'Detailed Course',
      country: 'Netherlands',
      externalDistanceMeters: 1300,
      geometrySource: 'track',
      coordinates: [
        { lat: 52.37, lng: 4.89 },
        { lat: 52.3745, lng: 4.8925 },
        { lat: 52.379, lng: 4.891 },
      ],
    });

    expect(route.tags).not.toContain('outline-only');
    expect(route.tags).toContain('geometry:track');
    expect(route.geometrySource).toBe('track');
  });

  it('keeps imported coordinates inside valid WGS-84 bounds (KV-2)', () => {
    const route = routeService.importRouteFromRownative({
      id: '778',
      name: 'Bounds Course',
      country: 'New Zealand',
      externalDistanceMeters: 4000,
      geometrySource: 'gate-chain',
      coordinates: [{ lat: -41.29, lng: 174.78 }, { lat: -41.32, lng: 174.81 }],
    });

    for (const point of route.coordinates) {
      expect(point.lat).toBeGreaterThanOrEqual(-90);
      expect(point.lat).toBeLessThanOrEqual(90);
      expect(point.lng).toBeGreaterThanOrEqual(-180);
      expect(point.lng).toBeLessThanOrEqual(180);
      expect(Number.isNaN(point.lat)).toBe(false);
      expect(Number.isNaN(point.lng)).toBe(false);
    }
    // Southern/eastern hemisphere signs must survive the round trip.
    expect(route.coordinates[0].lat).toBeLessThan(0);
    expect(route.coordinates[0].lng).toBeGreaterThan(0);
  });

  it('does not add a status tag when rownative status is missing', () => {
    const route = routeService.importRouteFromRownative({
      id: '100',
      name: 'Statusless Course',
      country: 'Canada',
      externalDistanceMeters: 3000,
      geometrySource: 'gate-chain',
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

  it('skips out-of-range GeoJSON positions and keeps valid [lng,lat] points', () => {
    const geojson = JSON.stringify({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [[181, 0], [13.405, 52.52], [13.406, 52.521]],
      },
      properties: {},
    });
    const imported = routeService.importRouteFromGeoJSON(geojson, { name: 'GeoJSON Filtered', difficulty: 'easy' });
    expect(imported).toBeDefined();
    expect(imported!.coordinates).toEqual([
      { lat: 52.52, lng: 13.405 },
      { lat: 52.521, lng: 13.406 },
    ]);
  });

  it('skips GeoJSON positions with non-numeric values', () => {
    const geojson = JSON.stringify({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [[13.405, 52.52], [null, 52.521], [13.406, 52.522]],
      },
      properties: {},
    });
    const imported = routeService.importRouteFromGeoJSON(geojson, {
      name: 'GeoJSON NonFinite',
      difficulty: 'easy',
    });
    expect(imported).toBeDefined();
    expect(imported!.coordinates).toEqual([
      { lat: 52.52, lng: 13.405 },
      { lat: 52.522, lng: 13.406 },
    ]);
  });

  it('returns undefined when GeoJSON positions never yield two valid points', () => {
    const geojson = JSON.stringify({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [[13.405, 52.52], [13.405], [181, 0]],
      },
      properties: {},
    });
    const imported = routeService.importRouteFromGeoJSON(geojson, { name: 'GeoJSON Invalid', difficulty: 'easy' });
    expect(imported).toBeUndefined();
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
